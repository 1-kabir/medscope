import { tablesDB, Collections, DATABASE_ID, Query } from "./lib/appwrite";
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
  dosePerSlot: number; // tablets per dose: 0.25, 0.5, 1, 2...
  tabletsLeft: number; // fractional — a half tablet counts as 0.5
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
  units: number; // tablets consumed by this dose
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
  // Pause: no reminders spoken, no escalation, stock doesn't expect consumption.
  pauseUntil: number | null; // epoch ms — device returns automatically when it passes
};

const DB_NAME = "medscope";
const DB_VERSION = 3; // v3: pause settings in settings store (no-op migration); added dosePerSlot/units fields

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
  // decrement stock locally by the dose's units
  const medicines = await listMedicines();
  const med = medicines.find((m) => m.id === l.medicineId);
  if (med && l.status === "taken" && l.units > 0) {
    med.tabletsLeft = Math.max(0, med.tabletsLeft - l.units);
    med.synced = false;
    await saveMedicine(med);
  }
  queueSync(Collections.takenLogs, l.id, logToDoc(l));
}

// Undo a taken log: remove the local log and restore the tablets.
export async function undoDose(logId: string): Promise<void> {
  const db = await open();
  const store = db.transaction("taken", "readwrite").objectStore("taken");
  const log = (await reqAs(store.get(logId))) as DoseLog | undefined;
  if (!log) return;
  await reqAs(store.delete(logId));
  if (log.status === "taken") {
    const medicines = await listMedicines();
    const med = medicines.find((m) => m.id === log.medicineId);
    if (med) {
      med.tabletsLeft += log.units || 1;
      med.synced = false;
      await saveMedicine(med);
    }
    // A synced row is removed on the server too. Writing a correcting "missed"
    // row instead left both entries in history, so the dose looked missed.
    if (log.synced) {
      void tablesDB
        .deleteRow({ databaseId: DATABASE_ID, tableId: Collections.takenLogs, rowId: log.id })
        .catch(() => { /* offline: the row is gone locally, which is what the user sees */ });
    }
  }
}

export async function deleteLog(logId: string): Promise<void> {
  const db = await open();
  await reqAs(db.transaction("taken", "readwrite").objectStore("taken").delete(logId));
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

// One canonical form: digits only, with the country code. The elder types
// "91233 13155"; WhatsApp needs "919123313155". Doing it at save time means
// every screen, the tel: link and the escalation checker agree on one number.
const DEFAULT_COUNTRY = "91"; // India

export function normalizePhone(raw: string): string {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = DEFAULT_COUNTRY + d;
  return d;
}

// Display form for a saved number: +91 91233 13155.
export function formatPhone(e164: string): string {
  const d = normalizePhone(e164);
  if (d.length === 12 && d.startsWith(DEFAULT_COUNTRY)) {
    return `+${DEFAULT_COUNTRY} ${d.slice(2, 7)} ${d.slice(7)}`;
  }
  return d ? `+${d}` : "";
}

export async function listContacts(): Promise<Contact[]> {
  return getAll<Contact>("contacts");
}

export async function saveContact(c: Contact): Promise<void> {
  const saved = { ...c, whatsapp: normalizePhone(c.whatsapp) || c.whatsapp };
  await put("contacts", saved);
  queueSync(Collections.contacts, saved.id, contactToDoc(saved));
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
  const [lang, mode, householdId, pauseUntil] = await Promise.all([
    getSetting<Lang>("lang"),
    getSetting<Settings["mode"]>("mode"),
    getSetting<string>("householdId"),
    getSetting<number | null>("pauseUntil"),
  ]);
  return { deviceKey, lang: lang ?? "bn", mode: mode ?? null, householdId: householdId ?? null, pauseUntil: pauseUntil ?? null };
}

// Pause reminders: away at a wedding, hospital visit — no noise, no false misses.
export async function setPause(until: number | null): Promise<void> {
  await setSetting("pauseUntil", until);
  void pushPauseState(until);
}

// Best-effort: the checker reads pauseUntil off the elder's device row and stays
// quiet while it is in the future. Deliberately not queued — an unprovisioned
// attribute or an offline phone must never block the rest of the sync queue.
async function pushPauseState(until: number | null): Promise<void> {
  try {
    const s = await getSettings();
    if (!s.householdId || !navigator.onLine) return;
    await tablesDB.updateRow({
      databaseId: DATABASE_ID,
      tableId: Collections.devices,
      rowId: s.deviceKey,
      data: { pauseUntil: until ?? 0 },
    });
  } catch {
    /* attribute not provisioned yet, or offline */
  }
}

export async function isPaused(): Promise<boolean> {
  const until = await getSetting<number | null>("pauseUntil");
  if (!until) return false;
  if (Date.now() > until) {
    await setSetting("pauseUntil", null);
    return false;
  }
  return true;
}

// ---- Backup restore (used by family Settings → Backup & restore) ----
// Adopts another device's identity: deviceKey, household, medicines, contacts.
// Local rows that don't exist in the backup are kept; backup rows win on id.

export type BackupApply = {
  deviceKey: string;
  householdId: string | null;
  medicines: Medicine[];
  contacts: Contact[];
};

export async function applyBackup(b: BackupApply): Promise<{ householdId: string | null; medicines: number; contacts: number }> {
  await setSetting("deviceKey", b.deviceKey);
  await setSetting("householdId", b.householdId);
  for (const m of b.medicines || []) {
    await put("medicines", { ...m, synced: false });
    queueSync(Collections.medicines, m.id, medicineToDoc({ ...m, synced: false }));
  }
  for (const c of b.contacts || []) {
    await put("contacts", { ...c, synced: false });
    queueSync(Collections.contacts, c.id, contactToDoc({ ...c, synced: false }));
  }
  return { householdId: b.householdId, medicines: (b.medicines || []).length, contacts: (b.contacts || []).length };
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
    const res = await tablesDB.listRows({
      databaseId: DATABASE_ID,
      tableId: Collections.medicines,
      queries: [Query.equal("householdId", code), Query.limit(1)],
    });
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
let lastSyncAt: number | null = null;

// What the family surface shows so nobody has to wonder whether a change
// landed. Local-first means writes can wait; saying so is cheaper than doubt.
export type SyncState = { pending: number; syncing: boolean; lastSyncAt: number | null };

const syncListeners = new Set<(s: SyncState) => void>();

export function getSyncState(): SyncState {
  return { pending: syncQueue.length, syncing, lastSyncAt };
}

export function subscribeSync(fn: (s: SyncState) => void): () => void {
  syncListeners.add(fn);
  fn(getSyncState());
  return () => {
    syncListeners.delete(fn);
  };
}

function notifySync() {
  const state = getSyncState();
  for (const fn of syncListeners) fn(state);
}

function queueSync(collection: string, id: string, doc: Record<string, unknown>) {
  syncQueue.push({ collection, id, doc });
  notifySync();
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
    dosePerSlot: m.dosePerSlot ?? 1,
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
    units: l.units ?? 0,
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
  const existing = await getSetting<string>("deviceName");
  if (!s.householdId) return;
  const info: DeviceInfo = { id: s.deviceKey, householdId: s.householdId, role, name: existing ?? "" };
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

// ---- Who am I ----
// A name on the device row is what the other phone shows ("Kabir's medicines"
// instead of "Elder 1"), so both the elder and a family member can set it.

export async function getMyName(): Promise<string> {
  return (await getSetting<string>("deviceName")) ?? "";
}

export async function setMyName(name: string): Promise<void> {
  const clean = name.trim().slice(0, 40);
  const s = await getSettings();
  const mode = await getSetting<"elder" | "family">("mode");
  await setSetting("deviceName", clean);
  await put("devices", { id: s.deviceKey, householdId: s.householdId ?? "", role: mode ?? "family", name: clean });
  queueSync(Collections.devices, s.deviceKey, { name: clean });
}

// Pull the household's shared data into the local store. Remote wins for
// medicines (the elder's device is the truth for schedules); logs merge by id.
export async function pullHousehold(): Promise<void> {
  const s = await getSettings();
  if (!s.householdId || !navigator.onLine) return;
  try {
    const [medRes, logRes, devRes, conRes] = await Promise.all([
      tablesDB.listRows({ databaseId: DATABASE_ID, tableId: Collections.medicines, queries: [Query.equal("householdId", s.householdId), Query.limit(100)] }),
      tablesDB.listRows({ databaseId: DATABASE_ID, tableId: Collections.takenLogs, queries: [Query.equal("householdId", s.householdId), Query.limit(100)] }),
      tablesDB.listRows({ databaseId: DATABASE_ID, tableId: Collections.devices, queries: [Query.equal("householdId", s.householdId), Query.limit(100)] }),
      // Contacts are the shared family roster: whoever the family adds is in
      // the elder's phone book, and whoever the elder adds shows up for family.
      tablesDB.listRows({ databaseId: DATABASE_ID, tableId: Collections.contacts, queries: [Query.equal("householdId", s.householdId), Query.limit(100)] }),
    ]);

    for (const d of medRes.rows as unknown as Record<string, unknown>[]) {
      const m: Medicine = {
        id: String(d.$id),
        elderId: String(d.elderId ?? ""),
        nickname: String(d.nickname ?? ""),
        name: String(d.name ?? ""),
        strength: String(d.strength ?? ""),
        instruction: String(d.instruction ?? ""),
        times: JSON.parse(String(d.times ?? "[]")) as string[],
        tabletsLeft: Number(d.tabletsLeft ?? 0),
        dosePerSlot: Number(d.dosePerSlot ?? 1),
        createdAt: Number(d.createdAt ?? 0),
        synced: true,
      };
      await put("medicines", m);
    }

    for (const d of logRes.rows as unknown as Record<string, unknown>[]) {
      const l: DoseLog = {
        id: String(d.$id),
        medicineId: String(d.medicineId ?? ""),
        elderId: String(d.elderId ?? ""),
        nickname: String(d.nickname ?? ""),
        slot: String(d.slot ?? ""),
        date: String(d.date ?? ""),
        status: (d.status as DoseLog["status"]) ?? "missed",
        units: Number(d.units ?? 0),
        at: Number(d.at ?? 0),
        synced: true,
      };
      await put("taken", l);
    }

    for (const d of conRes.rows as unknown as Record<string, unknown>[]) {
      const c: Contact = {
        id: String(d.$id),
        name: String(d.name ?? ""),
        relation: String(d.relation ?? ""),
        whatsapp: String(d.whatsapp ?? ""),
        synced: true,
      };
      // A contact with no number is useless as a call button; skip it.
      if (c.whatsapp) await put("contacts", c);
    }

    for (const d of devRes.rows as unknown as Record<string, unknown>[]) {
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
        await tablesDB.createRow({ databaseId: DATABASE_ID, tableId: item.collection, rowId: item.id, data: doc });
        syncQueue.shift();
        lastSyncAt = Date.now();
      } catch {
        // Row probably exists (a local update, e.g. stock change): upsert.
        try {
          await tablesDB.updateRow({ databaseId: DATABASE_ID, tableId: item.collection, rowId: item.id, data: doc });
          syncQueue.shift();
          lastSyncAt = Date.now();
        } catch {
          break; // offline or table not ready — retry later
        }
      }
      notifySync();
    }
  } finally {
    syncing = false;
    notifySync();
  }
}

window.addEventListener("online", () => void drainSync());
