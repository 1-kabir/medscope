import { account, ID, Permission, Role, tablesDB, Collections, DATABASE_ID, Query } from "./appwrite";
import { listMedicines, listContacts, getSettings, type Medicine, type Contact } from "../db";

// Optional account auth (phone SMS + email/password). Entirely hidden from
// onboarding — its only job is "backup this device's data, restore on another
// phone". Elder mode never shows auth.

export type AccountInfo = { userId: string; label: string };

export async function getAccountInfo(): Promise<AccountInfo | null> {
  try {
    const a = await account.get();
    const label = a.email || a.phone || a.name || a.$id;
    return { userId: a.$id, label };
  } catch {
    return null; // guest
  }
}

// Email: create the account if it doesn't exist, then log in. 409 = exists.
export async function emailAuth(email: string, password: string): Promise<void> {
  try {
    await account.create({ userId: ID.unique(), email, password });
  } catch (e) {
    const code = (e as { code?: number }).code;
    if (code !== 409) throw e;
  }
  await account.createEmailPasswordSession({ email, password });
}

// Phone: request an SMS secret. Returns the userId to verify against.
export async function phoneStart(phone: string): Promise<string> {
  const userId = ID.unique();
  await account.createPhoneToken({ userId, phone });
  return userId;
}

export async function phoneVerify(userId: string, secret: string): Promise<void> {
  await account.createSession({ userId, secret });
}

export async function signOut(): Promise<void> {
  await account.deleteSession({ sessionId: "current" });
}

type BackupPayload = {
  deviceKey: string;
  householdId: string | null;
  medicines: Medicine[];
  contacts: Contact[];
  savedAt: number;
};

// Snapshot this device into a user-owned row (row-level permissions, so only
// the logged-in account can ever read it).
export async function saveBackup(): Promise<void> {
  const info = await getAccountInfo();
  if (!info) throw new Error("not signed in");
  const [medicines, contacts, settings] = await Promise.all([listMedicines(), listContacts(), getSettings()]);
  const payload: BackupPayload = {
    deviceKey: settings.deviceKey,
    householdId: settings.householdId,
    medicines,
    contacts,
    savedAt: Date.now(),
  };
  await tablesDB.createRow({
    databaseId: DATABASE_ID,
    tableId: Collections.backups,
    rowId: ID.unique(),
    data: { userId: info.userId, payload: JSON.stringify(payload) },
    permissions: [
      Permission.read(Role.user(info.userId)),
      Permission.update(Role.user(info.userId)),
      Permission.delete(Role.user(info.userId)),
    ],
  });
}

export async function listBackups(): Promise<{ id: string; savedAt: number; householdId: string | null; medicines: number }[]> {
  const info = await getAccountInfo();
  if (!info) return [];
  const res = await tablesDB.listRows({
    databaseId: DATABASE_ID,
    tableId: Collections.backups,
    queries: [Query.equal("userId", info.userId), Query.limit(20), Query.orderDesc("$createdAt")],
  });
  return (res.rows as unknown as Record<string, unknown>[]).map((r) => {
    const p = JSON.parse(String(r.payload || "{}")) as BackupPayload;
    return { id: String(r.$id), savedAt: p.savedAt || 0, householdId: p.householdId, medicines: (p.medicines || []).length };
  });
}

export type RestoreResult = { householdId: string | null; medicines: number; contacts: number };

// Restore happens in the appwrite lib because it needs the table; it writes
// back through db.ts import helpers so local-first stays intact.
export async function restoreBackup(rowId: string, apply: (payload: BackupPayload) => Promise<RestoreResult>): Promise<RestoreResult> {
  const row = await tablesDB.getRow({ databaseId: DATABASE_ID, tableId: Collections.backups, rowId });
  const payload = JSON.parse(String((row as unknown as Record<string, unknown>).payload || "{}")) as BackupPayload;
  return apply(payload);
}
