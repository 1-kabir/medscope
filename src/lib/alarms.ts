import { LocalNotifications } from "@capacitor/local-notifications";
import type { Medicine } from "../db";

// Dose alarms that fire with the app closed. Native local notifications are
// scheduled as exact timestamps for the NEXT occurrence of each dose slot
// (today if still ahead, else tomorrow) and re-scheduled every time the app
// opens or a dose is taken — so a dose already marked taken never buzzes, and
// an APK never needs rebuilding just because the schedule changed.

const CHANNEL_ID = "dose-alarms";

let registered = false;

async function ensureChannel() {
  if (registered) return;
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: "Dose reminders",
      importance: 5, // high: heads-up + sound
      visibility: 1, // public — shows on the lock screen
      sound: "bell.wav",
    });
    registered = true;
  } catch {
    // Web fallback (no channels); notifications still work on desktop browsers
    registered = true;
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const res = await LocalNotifications.requestPermissions();
    return res.display === "granted";
  } catch {
    return false;
  }
}

export async function requestSystemNotificationPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    const res = await Notification.requestPermission();
    return res === "granted";
  } catch {
    return false;
  }
}

function nextOccurrence(slot: string): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(slot);
  if (!m) return null;
  const now = new Date();
  const at = new Date(now);
  at.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return at;
}

export async function scheduleDoseAlarms(medicines: Medicine[]): Promise<void> {
  if (!medicines.length) return;
  await ensureChannel();
  const perm = await LocalNotifications.checkPermissions();
  if (perm.display !== "granted") {
    const req = await LocalNotifications.requestPermissions();
    if (req.display !== "granted") return;
  }

  // Cancel previous dose alarms and re-derive from the current schedule, so a
  // taken dose, an edited time, or a pause is respected on the next open.
  const pending = await LocalNotifications.getPending();
  const stale = pending.notifications.filter((n) => n.extra?.kind === "dose");
  if (stale.length) {
    await LocalNotifications.cancel({ notifications: stale.map(({ id, ...rest }) => ({ id, ...rest })) });
  }

  const notifications = medicines.flatMap((med) =>
    med.times
      .map((slot) => ({ slot, at: nextOccurrence(slot) }))
      .filter((x): x is { slot: string; at: Date } => x.at !== null)
      .map(({ slot, at }) => ({
        id: hashId(med.id + slot),
        title: med.nickname,
        body: med.instruction || "Time for your medicine",
        schedule: { at, allowWhileIdle: true },
        channelId: CHANNEL_ID,
        extra: { kind: "dose", medicineId: med.id, slot },
      }))
  );

  if (notifications.length) {
    await LocalNotifications.schedule({ notifications });
  }
}

export async function cancelDoseAlarms(): Promise<void> {
  try {
    const pending = await LocalNotifications.getPending();
    const dose = pending.notifications.filter((n) => n.extra?.kind === "dose");
    if (dose.length) await LocalNotifications.cancel({ notifications: dose.map(({ id, ...rest }) => ({ id, ...rest })) });
  } catch {
    /* nothing pending, or web */
  }
}

function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 2_000_000_000;
}

// Tap handler: opening the app when a dose notification is tapped.
export function onNotificationTap(cb: (medicineId?: string) => void): void {
  LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
    cb(action.notification.extra?.medicineId);
  });
}
