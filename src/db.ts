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

// The single directory of people in a household. Replaces the contacts table
// (family numbers) and the directory role of the devices table.
//  - role "elder": a person who takes medicines. deviceKey = the device
//    currently claiming them; null means nobody's phone is set up yet.
//  - role "family": a person who gets called/texted. phone = WhatsApp number.
export type Member = {
  id: string;
  householdId: string;
  role: "elder" | "family";
  name: string;
  phone: string; // family members only
  deviceKey: string; // elder members only, "" when unclaimed
  pauseUntil: number; // epoch ms, 0 = not paused (elder members only)
  lang?: string; // elder's spoken language, for the voice agent (default bn)
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
  // Pause: no reminders spoken, no escalation, stock doesn't expect consumption.
  pauseUntil: number | null; // epoch ms — device returns automatically when it passes
};

const DB_NAME = "medscope";
const DB_VERSION = 4; // v4: added "members" store — the single people directory

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
        if (!db.objectStoreNames.contains("members")) {
          db.createObjectStore("members", { keyPath: "id" });
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
    // Prefer the member identity (stable across devices); deviceKey is legacy.
    l.elderId = (await myMemberId()) ?? (await getSettings()).deviceKey;
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

// ---- Members: the single source of truth for people in the household ----
// Family members are the emergency contacts; elders own medicines. There is
// no separate contacts list and the devices table no longer carries names.

export async function listMembers(): Promise<Member[]> {
  return getAll<Member>("members");
}

export async function saveMember(m: Member): Promise<void> {
  await put("members", m);
  queueSync(Collections.members, m.id, memberToDoc(m));
}

export async function deleteMember(id: string): Promise<void> {
  const db = await open();
  await reqAs(db.transaction("members", "readwrite").objectStore("members").delete(id));
  // Server-side delete is fire-and-forget; the local store is what the UI sees.
  void tablesDB.deleteRow({ databaseId: DATABASE_ID, tableId: Collections.members, rowId: id }).catch(() => {});
}

export function memberToDoc(m: Member): Record<string, unknown> {
  return {
    role: m.role,
    name: m.name,
    phone: m.role === "family" ? m.phone : "",
    deviceKey: m.role === "elder" ? m.deviceKey : "",
    pauseUntil: m.role === "elder" ? m.pauseUntil : 0,
  };
}

function rowToMember(d: Record<string, unknown>, householdId: string): Member {
  return {
    id: String(d.$id),
    householdId: String(d.householdId ?? householdId),
    role: (d.role as Member["role"]) === "family" ? "family" : "elder",
    name: String(d.name ?? ""),
    phone: String(d.phone ?? ""),
    deviceKey: String(d.deviceKey ?? ""),
    pauseUntil: Number(d.pauseUntil ?? 0),
    synced: true,
  };
}

// My member identity: which member of the household this device claims.
export async function myMemberId(): Promise<string | null> {
  return getSetting<string>("myMemberId");
}

export async function setMyMemberId(id: string | null): Promise<void> {
  await setSetting("myMemberId", id);
}

// Elder members no device has claimed — the choices for a phone joining a
// family that already has elders listed remotely.
export async function unclaimedElders(householdId: string): Promise<Member[]> {
  try {
    const res = await tablesDB.listRows({
      databaseId: DATABASE_ID,
      tableId: Collections.members,
      queries: [Query.equal("householdId", householdId), Query.limit(50)],
    });
    return (res.rows as unknown as Record<string, unknown>[])
      .map((d) => rowToMember(d, householdId))
      .filter((m) => m.role === "elder" && !m.deviceKey);
  } catch {
    return [];
  }
}

export async function listContacts(): Promise<Contact[]> {
  // Compatibility shim over members: family members ARE the contacts.
  const members = await listMembers();
  return members
    .filter((m) => m.role === "family" && m.phone)
    .map((m) => ({ id: m.id, name: m.name, relation: "", whatsapp: m.phone, synced: m.synced }));
}

export async function saveContact(c: Contact): Promise<void> {
  // Legacy path — writes a family member under the hood.
  const s = await getSettings();
  const existing = (await listMembers()).find((m) => m.id === c.id);
  const m: Member = {
    id: c.id,
    householdId: s.householdId ?? "",
    role: "family",
    name: c.name,
    phone: c.whatsapp,
    deviceKey: "",
    pauseUntil: 0,
    synced: false,
  };
  await saveMember(existing ? { ...m, synced: existing.synced } : m);
}

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

// Best-effort: the checker reads pauseUntil off my member row and stays quiet
// while it is in the future. Deliberately not queued — an offline phone must
// never block the rest of the sync queue.
async function pushPauseState(until: number | null): Promise<void> {
  try {
    const s = await getSettings();
    const myId = await myMemberId();
    if (!s.householdId || !myId || !navigator.onLine) return;
    // Local member first, then the server row directly (not queued).
    const members = await listMembers();
    const me = members.find((m) => m.id === myId);
    if (me) await saveMember({ ...me, pauseUntil: until ?? 0, synced: me.synced });
    await tablesDB.updateRow({
      databaseId: DATABASE_ID,
      tableId: Collections.members,
      rowId: myId,
      data: { pauseUntil: until ?? 0 },
    });
  } catch {
    /* offline, or member row not created yet */
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
// Adopts another device's identity: deviceKey, household, medicines, members.
// Local rows that don't exist in the backup are kept; backup rows win on id.
// Legacy payloads carrying `contacts` are mapped to family members.

export type BackupApply = {
  deviceKey: string;
  householdId: string | null;
  medicines: Medicine[];
  members?: Member[];
  contacts?: { id: string; name: string; whatsapp: string }[]; // legacy
};

export async function applyBackup(b: BackupApply): Promise<{ householdId: string | null; medicines: number; members: number }> {
  await setSetting("deviceKey", b.deviceKey);
  await setSetting("householdId", b.householdId);
  for (const m of b.medicines || []) {
    await put("medicines", { ...m, synced: false });
    queueSync(Collections.medicines, m.id, medicineToDoc({ ...m, synced: false }));
  }
  const legacyMembers: Member[] = (b.members || []).map((m) => ({ ...m, synced: false }));
  for (const c of b.contacts || []) {
    legacyMembers.push({
      id: c.id,
      householdId: b.householdId ?? "",
      role: "family",
      name: c.name,
      phone: c.whatsapp,
      deviceKey: "",
      pauseUntil: 0,
      synced: false,
    });
  }
  for (const m of legacyMembers) {
    await put("members", m);
    queueSync(Collections.members, m.id, memberToDoc(m));
  }
  return {
    householdId: b.householdId,
    medicines: (b.medicines || []).length,
    members: legacyMembers.length,
  };
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

// (contactToDoc and the contacts-table write path were retired — members are
// the single directory; legacy payloads are mapped on restore.)

// ---- Device ↔ member binding ----
// Registration creates/claims this device's member. Names live on the member;
// the devices row is only a binding (and, later, a push-token holder).

export async function registerDevice(role: "elder" | "family", lang?: string): Promise<void> {
  const s = await getSettings();
  if (!s.householdId) return;
  const existingName = (await getSetting<string>("deviceName")) ?? "";
  const members = await listMembers();
  const mine = members.find((m) => m.deviceKey === s.deviceKey);
  if (mine) {
    if (mine.role !== role || (lang && mine.lang !== lang)) {
      await saveMember({ ...mine, role, lang: lang ?? mine.lang ?? "bn", synced: false });
    }
    await setMyMemberId(mine.id);
    return;
  }
  const m: Member = {
    id: crypto.randomUUID(),
    householdId: s.householdId,
    role,
    name: existingName,
    phone: "",
    deviceKey: s.deviceKey,
    pauseUntil: 0,
    lang: lang ?? "bn",
    synced: false,
  };
  await saveMember(m);
  await put("devices", { id: s.deviceKey, householdId: s.householdId, role, name: existingName });
  await setMyMemberId(m.id);
}

export async function setMemberName(memberId: string, name: string): Promise<void> {
  const members = await listMembers();
  const m = members.find((x) => x.id === memberId);
  if (m) {
    await saveMember({ ...m, name: name.trim().slice(0, 40), synced: false });
  } else {
    const s = await getSettings();
    await saveMember({
      id: memberId,
      householdId: s.householdId ?? "",
      role: "elder",
      name: name.trim().slice(0, 40),
      phone: "",
      deviceKey: memberId === s.deviceKey ? s.deviceKey : "",
      pauseUntil: 0,
      synced: false,
    });
  }
}

// ---- Who am I ----
// The member name is what the other phones show ("Kabir's medicines" instead
// of "Elder 1"), so both the elder and a family member can set it.

export async function getMyName(): Promise<string> {
  const myId = await myMemberId();
  if (myId) {
    const m = (await listMembers()).find((x) => x.id === myId);
    if (m?.name) return m.name;
  }
  return (await getSetting<string>("deviceName")) ?? "";
}

export async function setMyName(name: string): Promise<void> {
  const clean = name.trim().slice(0, 40);
  await setSetting("deviceName", clean);
  const myId = await myMemberId();
  if (myId) {
    await setMemberName(myId, clean);
    return;
  }
  // No member yet (e.g. named before household join): keep the local setting;
  // registerDevice() picks it up when the household exists.
}

// Pull the household's shared data into the local store. Remote wins for
// medicines (the elder's device is the truth for schedules); logs merge by id.
// Members are the shared people roster — both surfaces see the same names.
export async function pullHousehold(): Promise<void> {
  const s = await getSettings();
  if (!s.householdId || !navigator.onLine) return;
  try {
    const [medRes, logRes, memRes] = await Promise.all([
      tablesDB.listRows({ databaseId: DATABASE_ID, tableId: Collections.medicines, queries: [Query.equal("householdId", s.householdId), Query.limit(100)] }),
      tablesDB.listRows({ databaseId: DATABASE_ID, tableId: Collections.takenLogs, queries: [Query.equal("householdId", s.householdId), Query.limit(100)] }),
      tablesDB.listRows({ databaseId: DATABASE_ID, tableId: Collections.members, queries: [Query.equal("householdId", s.householdId), Query.limit(100)] }),
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

    for (const d of memRes.rows as unknown as Record<string, unknown>[]) {
      await put("members", rowToMember(d, s.householdId));
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
