import { useEffect, useState } from "react";
import { listMedicines, deleteMedicine, saveMedicine, logsSince, type Medicine, type DoseLog } from "../../db";
import { t, localizeNumber, type Lang } from "../../i18n";
import { useSpeaker, SpeakerIcon } from "../../speech";

export default function MedicineDetail({ lang, id, onBack }: { lang: Lang; id: string; onBack: () => void }) {
  const [med, setMed] = useState<Medicine | null>(null);
  const [logs, setLogs] = useState<DoseLog[]>([]);
  const [confirming, setConfirming] = useState(false);
  const speak = useSpeaker(lang);

  useEffect(() => {
    void listMedicines().then((ms) => setMed(ms.find((m) => m.id === id) ?? null));
    void logsSince(7).then(setLogs);
  }, [id]);

  if (!med) return null;

  const sevenDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const key = d.toISOString().slice(0, 10);
    const dayLogs = logs.filter((l) => l.date === key && l.medicineId === med.id);
    const taken = dayLogs.filter((l) => l.status === "taken").length;
    return { key, taken, total: med.times.length, dayLogs };
  });

  return (
    <div className="anim-push min-h-dvh flex flex-col px-6 py-8 max-w-md mx-auto">
      <button onClick={onBack} className="self-start text-lg font-semibold text-[var(--color-accent)] py-2 px-1">
        ← {lang === "en" ? "Back" : lang === "hi" ? "वापस" : "পেছনে"}
      </button>

      <h1 className="text-3xl font-bold mt-4">{med.nickname}</h1>
      <p className="text-lg text-[var(--color-ink-secondary)]">{med.name} {med.strength}</p>
      <p className="text-xl mt-3">
        {med.times.map((s) => localizeNumber(s, lang)).join(" · ")}
      </p>
      <p className="text-lg mt-1 text-[var(--color-ink-secondary)]">
        {localizeNumber(med.tabletsLeft, lang)} · {t(lang, "stockTitle").toLowerCase()}
      </p>

      {/* 7-day adherence strip */}
      <div className="mt-8">
        <p className="text-base font-semibold text-[var(--color-ink-secondary)] mb-3">{t(lang, "week")}</p>
        <div className="space-y-2">
          {sevenDays.map((d) => {
            const missed = d.total - d.taken;
            const label = d.taken === d.total ? "✓" : missed > 0 ? t(lang, "missed") : "—";
            return (
              <div key={d.key} className="flex items-center justify-between text-lg">
                <span className="text-[var(--color-ink-secondary)]">{d.key.slice(5)}</span>
                <span className={missed > 0 ? "text-[var(--color-alert)] font-semibold" : ""}>{label}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-auto flex flex-col gap-3 pb-2">
        <label className="text-base font-semibold text-[var(--color-ink-secondary)]">{t(lang, "editTimes")}</label>
        <div className="flex flex-wrap gap-3">
          {["08:00", "14:00", "21:00"].map((slot) => (
            <button
              key={slot}
              aria-pressed={med.times.includes(slot)}
              onClick={() => {
                const next = med.times.includes(slot) ? med.times.filter((s) => s !== slot) : [...med.times, slot].sort();
                const updated = { ...med, times: next, synced: false };
                setMed(updated);
                void saveMedicine(updated);
              }}
              className={`text-xl px-5 py-4 rounded-xl border-2 font-semibold ${med.times.includes(slot) ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]" : "border-[var(--color-line)]"}`}
            >
              {slot}
            </button>
          ))}
        </div>

        {!confirming ? (
          <button
            onClick={() => setConfirming(true)}
            className="mt-6 text-lg font-semibold py-4 rounded-2xl bg-[var(--color-alert-soft)] text-[var(--color-alert)]"
          >
            {t(lang, "remove")}
          </button>
        ) : (
          <div className="mt-6 flex flex-col gap-3">
            <p className="text-xl font-semibold text-center">{t(lang, "removeConfirm")}</p>
            <div className="flex gap-3">
              <button onClick={() => void deleteMedicine(med.id).then(onBack)} className="flex-1 py-4 rounded-2xl bg-[var(--color-alert)] text-white font-bold">
                {t(lang, "removeYes")}
              </button>
              <button onClick={() => setConfirming(false)} className="flex-1 py-4 rounded-2xl bg-[var(--color-surface-muted)] font-bold">
                {t(lang, "cancel")}
              </button>
            </div>
          </div>
        )}
        <div className="flex justify-end">
          <button aria-label="Hear this screen" onClick={() => speak(`${med.nickname}. ${med.times.join(", ")}`)} className="p-3 text-[var(--color-ink-secondary)]">
            <SpeakerIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
