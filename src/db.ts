import { databases, Collections, DATABASE_ID, Query } from "./lib/appwrite";
import type { Lang } from "./i18n";

// Local-first: IndexedDB is the source of truth. Appwrite sync is best-effort,
// queued and retried; nothing in the UI ever waits on the network.

export type Medicine = {
  id: string;
  elderId?: string; // deviceKey of the elder who takes this medicine; auto-filled for the local device
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
  elderId?: string;
  nickname: string;
  slot: string; // "08:00"
  date: string; // "2026-11-21"
  status: "taken" | "missed" | "deferred";
  at: number;
  synced: boolean;
};

export type DeviceInfo = {
  id: string; // deviceKey
  householdId: string;
  role: "elder" | "family";
  name: string;
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
const DB_VERSION = 2; // v2: added "devices" store — bump when changing the store layout

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
        if (!db.objectStoreNames.contains("devices")) {
          db.createObjectStore("devices", { keyPath: "id" });
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
  if (!m.elderId) {
    const s = await getSettings();
    m.elderId = s.deviceKey;
  }
  await put("medicines", m);
  queueSync(Collections.medicines, m.id, medicineToDoc(m));
}

export async function deleteMedicine(id: string): Promise<void> {
  const db = await open();
  await reqAs(db.transaction("medicines", "readwrite").objectStore("medicines").delete(id));
}

// ---- Dose logs ----

export async function logDose(l: DoseLog): Promise<void> {
  if (!l.elderId) {
    const s = await getSettings();
    l.elderId = s.deviceKey;
  }
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
    elderId: m.elderId ?? "",
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
    elderId: l.elderId ?? "",
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

// ---- Multi-elder households ----
// A household may hold several elder devices and several family devices.
// Medicines/logs carry elderId (= elder deviceKey); family phones pull the
// whole household and group the UI per elder. Devices register themselves so
// names and roles can be resolved across devices.

export async function registerDevice(role: "elder" | "family"): Promise<void> {
  const s = await getSettings();
  if (!s.householdId) return;
  const existing = await getSetting<string>("deviceName");
  const info: DeviceInfo = { id: s.deviceKey, householdId: s.householdId, role, name: existing ?? (role === "elder" ? "" : "") };
  await put("devices", info);
  queueSync(Collections.devices, info.id, { role: info.role, name: info.name });
}

export async function setDeviceName(deviceId: string, name: string): Promise<void> {
  const db = await open();
  const store = db.transaction("devices", "readwrite").objectStore("devices");
  const row = await reqAs(store.get(deviceId)) as DeviceInfo | undefined;
  if (row) {
    row.name = name;
    await put("devices", row);
  } else {
    const s = await getSettings();
    await put("devices", { id: deviceId, householdId: s.householdId ?? "", role: "elder", name });
  }
  queueSync(Collections.devices, deviceId, { name });
}

export async function listDevices(): Promise<DeviceInfo[]> {
  return getAll<DeviceInfo>("devices");
}

// Pull the household's shared data into the local store. Remote wins for
// medicines (the elder's device is the truth for schedules); logs merge by id.
export async function pullHousehold(): Promise<void> {
  const s = await getSettings();
  if (!s.householdId || !navigator.onLine) return;
  try {
    const [medRes, logRes, devRes] = await Promise.all([
      databases.listDocuments(DATABASE_ID, Collections.medicines, [Query.equal("householdId", s.householdId), Query.limit(100)]),
      databases.listDocuments(DATABASE_ID, Collections.takenLogs, [Query.equal("householdId", s.householdId), Query.limit(100)]),
      databases.listDocuments(DATABASE_ID, Collections.devices, [Query.equal("householdId", s.householdId), Query.limit(100)]),
    ]);

    for (const d of medRes.documents as unknown as Record<string, unknown>[]) {
      const m: Medicine = {
        id: String(d.$id),
        elderId: String(d.elderId ?? ""),
        nickname: String(d.nickname ?? ""),
        name: String(d.name ?? ""),
        strength: String(d.strength ?? ""),
        instruction: String(d.instruction ?? ""),
        times: JSON.parse(String(d.times ?? "[]")) as string[],
        tabletsLeft: Number(d.tabletsLeft ?? 0),
        createdAt: Number(d.createdAt ?? 0),
        synced: true,
      };
      await put("medicines", m);
    }

    for (const d of logRes.documents as unknown as Record<string, unknown>[]) {
      const l: DoseLog = {
        id: String(d.$id),
        medicineId: String(d.medicineId ?? ""),
        elderId: String(d.elderId ?? ""),
        nickname: String(d.nickname ?? ""),
        slot: String(d.slot ?? ""),
        date: String(d.date ?? ""),
        status: (d.status as DoseLog["status"]) ?? "missed",
        at: Number(d.at ?? 0),
        synced: true,
      };
      await put("taken", l);
    }

    for (const d of devRes.documents as unknown as Record<string, unknown>[]) {
      const info: DeviceInfo = {
        id: String(d.$id),
        householdId: String(d.householdId ?? s.householdId),
        role: (d.role as DeviceInfo["role"]) ?? "elder",
        name: String(d.name ?? ""),
      };
      await put("devices", info);
    }
  } catch {
    /* offline or collections not ready — local data still works */
  }
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
        // Document probably exists (a local update, e.g. stock change): upsert.
        try {
          await databases.updateDocument(DATABASE_ID, item.collection, item.id, doc);
          syncQueue.shift();
        } catch {
          break; // offline or collection not ready — retry later
        }
      }
    }
  } finally {
    syncing = false;
  }
}

window.addEventListener("online", () => void drainSync());
