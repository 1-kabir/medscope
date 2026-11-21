import { useEffect, useMemo, useState } from "react";
import { logsSince, listMembers, logDose, deleteLog, listMedicines, isPaused, type DoseLog, type Member } from "../../db";
import { t, localizeNumber, type Lang } from "../../i18n";

// A tab, not a pushed screen: the navbar is the way back, so no Back arrow.
export default function HistoryScreen({ lang }: { lang: Lang }) {
  const [range, setRange] = useState<"today" | "week">("today");
  const [logs, setLogs] = useState<DoseLog[]>([]);
  const [members, setMembers] = useState<Member[]>([]);

  useEffect(() => {
    void logsSince(7).then(setLogs);
    void listMembers().then(setMembers);
    void isPaused().then(setPausedState);
  }, []);

  async function takeLate(log: DoseLog) {
    const medicines = await listMedicines();
    const med = medicines.find((m) => m.id === log.medicineId);
    await logDose({
      id: crypto.randomUUID(),
      medicineId: log.medicineId,
      nickname: log.nickname,
      slot: log.slot,
      date: log.date,
      status: "taken",
      units: med?.dosePerSlot ?? 1,
      at: Date.now(),
      synced: false,
    });
    await deleteLog(log.id);
  }

  const multiElder = new Set(logs.map((l) => l.elderId)).size > 1;
  // Logs may reference the member id (new) or the elder's deviceKey (legacy);
  // the migrated member row carries both.
  const elderName = (id?: string) =>
    id ? members.find((m) => m.id === id || m.deviceKey === id)?.name : undefined;

  const shown = useMemo(() => {
    if (range === "today") {
      const key = new Date().toISOString().slice(0, 10);
      return logs.filter((l) => l.date === key);
    }
    return logs;
  }, [logs, range]);

  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [paused, setPausedState] = useState(false);

  async function refresh() {
    setLogs(await logsSince(7));
  }

  const days = useMemo(() => {
    const map = new Map<string, DoseLog[]>();
    for (const l of shown) {
      const arr = map.get(l.date) ?? [];
      arr.push(l);
      map.set(l.date, arr);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [shown]);

  return (
    <div className="anim-screen min-h-dvh px-6 pt-8 pb-6 max-w-md mx-auto">
      <h1 className="text-3xl font-bold">{t(lang, "history")}</h1>

      <div className="flex gap-3 mt-5">
        {(["today", "week"] as const).map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            aria-pressed={range === r}
            className={`text-lg px-5 py-3 rounded-xl border-2 font-semibold ${range === r ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]" : "border-[var(--color-line)]"}`}
          >
            {t(lang, r)}
          </button>
        ))}
      </div>

      {paused && (
        <div className="mt-5 p-4 rounded-2xl bg-[var(--color-alert-soft)] text-[var(--color-alert)] font-semibold text-lg text-center">
          {t(lang, "pauseTitle")}
        </div>
      )}

      <div className="mt-6 space-y-6">
        {days.length === 0 && (
          <p className="text-lg text-[var(--color-ink-secondary)] py-6">{t(lang, "noHistory")}</p>
        )}
        {days.map(([date, dayLogs]) => (
          <div key={date}>
            <p className="text-base font-semibold text-[var(--color-ink-secondary)] mb-2">
              {localizeNumber(
                new Date(date + "T00:00:00").toLocaleDateString(
                  lang === "bn" ? "bn-BD" : lang === "hi" ? "hi-IN" : "en-IN",
                  { day: "numeric", month: "short" }
                ),
                lang
              )}
            </p>
            <div className="space-y-2">
              {dayLogs.map((l) => (
                <div key={l.id} className="flex items-center justify-between py-3 border-b border-[var(--color-line)]">
                  <div>
                    <p className="text-xl font-semibold">{l.nickname}</p>
                    {multiElder && elderName(l.elderId) && (
                      <p className="text-sm font-semibold text-[var(--color-accent)]">{elderName(l.elderId)}</p>
                    )}
                    <p className="text-base text-[var(--color-ink-secondary)]">{localizeNumber(l.slot, lang)}</p>
                  </div>
                  <span className={`text-lg font-semibold ${l.status === "taken" ? "text-[var(--color-accent)]" : "text-[var(--color-alert)]"}`}>
                    {l.status === "taken" ? (
                      `✓ ${localizeNumber(new Date(l.at).toTimeString().slice(0, 5), lang)}`
                    ) : confirmId === l.id ? (
                      <span className="flex gap-2">
                        <button onClick={() => void takeLate(l).then(() => { setConfirmId(null); void refresh(); })} className="px-3 py-1 rounded-lg bg-[var(--color-accent)] text-white text-base">
                          {t(lang, "tookLate")}
                        </button>
                        <button onClick={() => setConfirmId(null)} className="px-3 py-1 rounded-lg bg-[var(--color-surface-muted)] text-base">
                          ✕
                        </button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmId(l.id)}>{t(lang, "missed")}</button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-8 text-sm text-[var(--color-ink-tertiary)]">{t(lang, "remindersOnly")}</p>
    </div>
  );
}
