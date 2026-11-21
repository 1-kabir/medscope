import { useEffect, useMemo, useState } from "react";
import { logsSince, listDevices, type DoseLog, type DeviceInfo } from "../../db";
import { t, localizeNumber, type Lang } from "../../i18n";

export default function HistoryScreen({ lang, onBack }: { lang: Lang; onBack: () => void }) {
  const [range, setRange] = useState<"today" | "week">("today");
  const [logs, setLogs] = useState<DoseLog[]>([]);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);

  useEffect(() => {
    void logsSince(7).then(setLogs);
    void listDevices().then(setDevices);
  }, []);

  const multiElder = new Set(logs.map((l) => l.elderId)).size > 1;
  const elderName = (id?: string) => (id ? devices.find((d) => d.id === id)?.name : undefined);

  const shown = useMemo(() => {
    if (range === "today") {
      const key = new Date().toISOString().slice(0, 10);
      return logs.filter((l) => l.date === key);
    }
    return logs;
  }, [logs, range]);

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
    <div className="min-h-dvh px-6 py-8 max-w-md mx-auto">
      <button onClick={onBack} className="self-start text-lg font-semibold text-[var(--color-accent)] py-2 px-1">
        ← {lang === "en" ? "Back" : lang === "hi" ? "वापस" : "পেছনে"}
      </button>
      <h1 className="text-3xl font-bold mt-4">{t(lang, "history")}</h1>

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

      <div className="mt-6 space-y-6">
        {days.length === 0 && <p className="text-lg text-[var(--color-ink-secondary)]">—</p>}
        {days.map(([date, dayLogs]) => (
          <div key={date}>
            <p className="text-base font-semibold text-[var(--color-ink-secondary)] mb-2">{date.slice(5)}</p>
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
                    {l.status === "taken" ? `✓ ${localizeNumber(new Date(l.at).toTimeString().slice(0, 5), lang)}` : t(lang, "missed")}
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
