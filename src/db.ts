import { databases, Collections, DATABASE_ID, Query } from "./lib/appwrite";
import type { Lang } from "./i18n";

// Local-first: IndexedDB is the source of truth. Appwrite sync is best-effort,
// queued and retried; nothing in the UI ever waits on the network.

export type Medicine = {
  id: string;
  nickname: string;
  name: string;
  strength: string;
  instruction: string;
  times: string[]; // "08:00"
  tabletsLeft: number;
  createdAt: number;
  synced: boolean;
};

export type DoseLog = {
  id: string;
  medicineId: string;
  nickname: string;
  slot: string; // "08:00"
  date: string; // "2026-11-21"
  status: "taken" | "missed" | "deferred";
  at: number;
  synced: boolean;
};

export type Contact = {
  id: string;
  name: string;
  relation: string;
  whatsapp: string;
  synced: boolean;
};

export type Settings = {
  lang: Lang;
  mode: "elder" | "family" | null;
  deviceKey: string;
  householdId: string | null;
};

const DB_NAME = "medscope";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("medicines")) {
          db.createObjectStore("medicines", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("taken")) {
          const s = db.createObjectStore("taken", { keyPath: "id" });
          s.createIndex("by_date", "date");
          s.createIndex("by_sync", "synced");
        }
        if (!db.objectStoreNames.contains("contacts")) {
          db.createObjectStore("contacts", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function reqAs<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAll<T>(store: string): Promise<T[]> {
  const db = await open();
  return reqAs(db.transaction(store, "readonly").objectStore(store).getAll()) as Promise<T[]>;
}

async function put(store: string, value: object): Promise<void> {
  const db = await open();
  await reqAs(db.transaction(store, "readwrite").objectStore(store).put(value));
}

// ---- Medicines ----

export async function listMedicines(): Promise<Medicine[]> {
  return getAll<Medicine>("medicines");
}

export async function saveMedicine(m: Medicine): Promise<void> {
  await put("medicines", m);
  queueSync(Collections.medicines, m.id, medicineToDoc(m));
}

export async function deleteMedicine(id: string): Promise<void> {
  const db = await open();
  await reqAs(db.transaction("medicines", "readwrite").objectStore("medicines").delete(id));
}

// ---- Dose logs ----

export async function logDose(l: DoseLog): Promise<void> {
  await put("taken", l);
  // decrement stock locally
  const medicines = await listMedicines();
  const med = medicines.find((m) => m.id === l.medicineId);
  if (med && l.status === "taken" && med.tabletsLeft > 0) {
    med.tabletsLeft -= 1;
    med.synced = false;
    await saveMedicine(med);
  }
  queueSync(Collections.takenLogs, l.id, logToDoc(l));
}

export async function logsByDate(date: string): Promise<DoseLog[]> {
  const db = await open();
  const idx = db.transaction("taken", "readonly").objectStore("taken").index("by_date");
  return reqAs(idx.getAll(date)) as Promise<DoseLog[]>;
}

export async function logsSince(days: number): Promise<DoseLog[]> {
  const all = await getAll<DoseLog>("taken");
  const cutoff = Date.now() - days * 86400_000;
  return all.filter((l) => l.at >= cutoff);
}

// ---- Contacts ----

export async function listContacts(): Promise<Contact[]> {
  return getAll<Contact>("contacts");
}

export async function saveContact(c: Contact): Promise<void> {
  await put("contacts", c);
  queueSync(Collections.contacts, c.id, contactToDoc(c));
}

// ---- Settings ----

export async function getSetting<T>(key: string): Promise<T | null> {
  const db = await open();
  const row = await reqAs(db.transaction("settings", "readonly").objectStore("settings").get(key));
  return row ? (row as { key: string; value: T }).value : null;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  await put("settings", { key, value });
}

export async function getSettings(): Promise<Settings> {
  let deviceKey = await getSetting<string>("deviceKey");
  if (!deviceKey) {
    deviceKey = crypto.randomUUID();
    await setSetting("deviceKey", deviceKey);
  }
  const [lang, mode, householdId] = await Promise.all([
    getSetting<Lang>("lang"),
    getSetting<Settings["mode"]>("mode"),
    getSetting<string>("householdId"),
  ]);
  return { deviceKey, lang: lang ?? "bn", mode: mode ?? null, householdId: householdId ?? null };
}

// ---- Household linking ----
// One 6-digit code per household. The elder's phone creates it; family phones
// join by entering it. Every synced doc carries householdId, which is what
// the escalation checker and other devices query.

export function newHouseholdCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function createHousehold(): Promise<string> {
  const code = newHouseholdCode();
  await setSetting("householdId", code);
  return code;
}

export async function joinHousehold(code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  // If the Appwrite database is reachable, verify the code exists by looking
  // for any medicine doc from that household. If unreachable, trust the code
  // (local-first: the family may set up before the elder's phone syncs).
  try {
    const res = await databases.listDocuments(DATABASE_ID, Collections.medicines, [
      Query.equal("householdId", code),
      Query.limit(1),
    ]);
    if (res.total === 0) return false;
  } catch {
    /* offline: accept and reconcile later */
  }
  await setSetting("householdId", code);
  return true;
}

export async function leaveHousehold(): Promise<void> {
  await setSetting("householdId", null);
}

// ---- Appwrite sync (queue, fire-and-forget) ----

const syncQueue: { collection: string; id: string; doc: Record<string, unknown> }[] = [];
let syncing = false;

function queueSync(collection: string, id: string, doc: Record<string, unknown>) {
  syncQueue.push({ collection, id, doc });
  void drainSync();
}

export function medicineToDoc(m: Medicine): Record<string, unknown> {
  return {
    deviceId: undefined, // filled at drain time
    nickname: m.nickname,
    name: m.name,
    strength: m.strength,
    instruction: m.instruction,
    times: JSON.stringify(m.times),
    tabletsLeft: m.tabletsLeft,
    createdAt: m.createdAt,
  };
}

export function logToDoc(l: DoseLog): Record<string, unknown> {
  return {
    nickname: l.nickname,
    medicineId: l.medicineId,
    slot: l.slot,
    date: l.date,
    status: l.status,
    at: l.at,
  };
}

export function contactToDoc(c: Contact): Record<string, unknown> {
  return { name: c.name, relation: c.relation, whatsapp: c.whatsapp };
}

async function drainSync(): Promise<void> {
  if (syncing || syncQueue.length === 0 || !navigator.onLine) return;
  syncing = true;
  try {
    while (syncQueue.length > 0 && navigator.onLine) {
      const item = syncQueue[0];
      const s = await getSettings();
      const doc = { ...item.doc, deviceId: s.deviceKey, householdId: s.householdId };
      try {
        await databases.createDocument(DATABASE_ID, item.collection, item.id, doc);
        syncQueue.shift();
      } catch {
        break; // retry later (offline, or document exists)
      }
    }
  } finally {
    syncing = false;
  }
}

window.addEventListener("online", () => void drainSync());
