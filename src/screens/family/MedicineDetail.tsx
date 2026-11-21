import { useEffect, useState } from "react";
import { listMedicines, deleteMedicine, saveMedicine, logsSince, type Medicine, type DoseLog } from "../../db";
import { t, localizeNumber, type Lang } from "../../i18n";
import { useSpeaker, SpeakerIcon } from "../../speech";

export default function MedicineDetail({ lang, id, onBack }: { lang: Lang; id: string; onBack: () => void }) {
  const [med, setMed] = useState<Medicine | null>(null);
  const [logs, setLogs] = useState<DoseLog[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [newTime, setNewTime] = useState("");

  function patch(update: Partial<Medicine>) {
    if (!med) return;
    const updated = { ...med, ...update, synced: false };
    setMed(updated);
    void saveMedicine(updated);
  }

  function addTime() {
    const m = /^(\d{1,2}):(\d{2})$/.exec(newTime.trim());
    if (!m) return;
    const slot = `${String(Math.min(23, Number(m[1]))).padStart(2, "0")}:${m[2]}`;
    if (!med || med.times.includes(slot)) return;
    patch({ times: [...med.times, slot].sort() });
    setNewTime("");
  }
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
      <div className="mt-6 px-5 py-4 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-line)]">
        <div className="flex items-center justify-between">
          <p className="text-base font-semibold text-[var(--color-ink-secondary)]">{t(lang, "stockTitle")}</p>
          <div className="flex items-center gap-4">
            <button
              onClick={() => { const u = { ...med, tabletsLeft: Math.max(0, med.tabletsLeft - 1), synced: false }; setMed(u); void saveMedicine(u); }}
              className="w-12 h-12 rounded-xl bg-[var(--color-surface-muted)] text-2xl font-bold"
              aria-label="minus"
            >
              −
            </button>
            <p className="text-3xl font-bold w-16 text-center">{localizeNumber(med.tabletsLeft, lang)}</p>
            <button
              onClick={() => { const u = { ...med, tabletsLeft: med.tabletsLeft + 1, synced: false }; setMed(u); void saveMedicine(u); }}
              className="w-12 h-12 rounded-xl bg-[var(--color-surface-muted)] text-2xl font-bold"
              aria-label="plus"
            >
              +
            </button>
          </div>
        </div>
      </div>

      <div className="mt-8">
        <p className="text-base font-semibold text-[var(--color-ink-secondary)] mb-3">{t(lang, "dosePerSlotLabel")}</p>
        <div className="flex flex-wrap gap-3">
          {[0.25, 0.5, 1, 2].map((u) => (
            <button
              key={u}
              onClick={() => patch({ dosePerSlot: u })}
              aria-pressed={(med.dosePerSlot ?? 1) === u}
              className={`text-xl px-5 py-4 rounded-xl border-2 font-semibold ${(med.dosePerSlot ?? 1) === u ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]" : "border-[var(--color-line)]"}`}
            >
              {localizeNumber(u, lang)}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-3 mt-3">
          <span className="text-base text-[var(--color-ink-secondary)]">{t(lang, "customDose")}</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.25"
            min="0.25"
            max="20"
            value={med.dosePerSlot ?? 1}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= 0.25 && v <= 20) patch({ dosePerSlot: v });
            }}
            className="w-24 text-xl px-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)]"
          />
        </label>
      </div>

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
          {med.times.map((slot) => (
            <button
              key={slot}
              aria-pressed={true}
              aria-label={`${localizeNumber(slot, lang)} — ${t(lang, "remove")}`}
              onClick={() => patch({ times: med.times.filter((s) => s !== slot) })}
              className="text-xl px-5 py-4 rounded-xl border-2 border-[var(--color-accent)] bg-[var(--color-accent-soft)] font-semibold"
            >
              {localizeNumber(slot, lang)}
            </button>
          ))}
          {["08:00", "14:00", "21:00"]
            .filter((s) => !med.times.includes(s))
            .map((slot) => (
              <button
                key={slot}
                aria-pressed={false}
                onClick={() => patch({ times: [...med.times, slot].sort() })}
                className="text-xl px-5 py-4 rounded-xl border-2 border-dashed border-[var(--color-line)] text-[var(--color-ink-secondary)] font-semibold"
              >
                + {localizeNumber(slot, lang)}
              </button>
            ))}
        </div>
        <div className="flex gap-3">
          <input
            type="time"
            value={newTime}
            onChange={(e) => setNewTime(e.target.value)}
            aria-label={t(lang, "addTime")}
            className="flex-1 min-w-0 text-xl px-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)]"
          />
          <button
            onClick={addTime}
            disabled={!/^\d{1,2}:\d{2}$/.test(newTime.trim())}
            className="shrink-0 text-lg font-bold px-5 rounded-xl bg-[var(--color-surface-muted)] disabled:opacity-40"
          >
            {t(lang, "addBtn")}
          </button>
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
