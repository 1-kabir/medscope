import { useEffect, useState } from "react";
import { listMedicines, logsByDate, type Medicine, type DoseLog } from "../../db";
import { t, localizeNumber, type Lang } from "../../i18n";
import { useSpeaker, SpeakerIcon } from "../../speech";
import AddMedicineFlow from "./AddMedicineFlow";
import MedicineDetail from "./MedicineDetail";

function daysUntilEmpty(m: Medicine): number | null {
  const perDay = m.times.length;
  if (perDay === 0) return null;
  return Math.floor(m.tabletsLeft / perDay);
}

export default function MedicineListScreen({
  lang,
  onOpenHistory,
}: {
  lang: Lang;
  onOpenHistory: () => void;
}) {
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [missed, setMissed] = useState<DoseLog[]>([]);
  const [adding, setAdding] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const speak = useSpeaker(lang);

  useEffect(() => {
    void listMedicines().then(setMedicines);
    void logsByDate(new Date().toISOString().slice(0, 10)).then((l) => setMissed(l.filter((x) => x.status === "missed")));
  }, [adding, detailId]);

  if (adding) return <AddMedicineFlow lang={lang} onDone={() => setAdding(false)} />;
  if (detailId) return <MedicineDetail lang={lang} id={detailId} onBack={() => setDetailId(null)} />;

  return (
    <div className="pb-28">
      <header className="px-6 pt-8 pb-4 flex items-center justify-between">
        <h1 className="text-3xl font-bold">{t(lang, "medicines")}</h1>
        <button onClick={onOpenHistory} className="text-lg font-semibold text-[var(--color-accent)] px-4 py-3 rounded-xl">
          {t(lang, "history")}
        </button>
      </header>

      {missed.length > 0 && (
        <button
          onClick={onOpenHistory}
          className="mx-6 mb-4 flex items-center gap-3 px-5 py-4 rounded-2xl bg-[var(--color-alert-soft)] text-[var(--color-alert)] font-semibold text-lg"
        >
          <span className="w-3 h-3 rounded-full bg-[var(--color-alert)]" aria-hidden="true" />
          {t(lang, "missedToday", { n: localizeNumber(missed.length, lang) })}
        </button>
      )}

      <div className="px-6 divide-y divide-[var(--color-line)]">
        {medicines.length === 0 && (
          <p className="text-xl text-[var(--color-ink-secondary)] py-8">{t(lang, "welcomeBody")}</p>
        )}
        {medicines.map((m) => {
          const days = daysUntilEmpty(m);
          const low = days !== null && days <= 3;
          return (
            <button
              key={m.id}
              onClick={() => setDetailId(m.id)}
              className="w-full text-left py-5 flex items-start justify-between gap-4"
            >
              <div>
                <p className="text-2xl font-semibold">{m.nickname}</p>
                <p className="text-base text-[var(--color-ink-secondary)]">{m.name}</p>
                <p className="text-lg mt-1 text-[var(--color-ink-secondary)]">
                  {m.times.map((s) => localizeNumber(s, lang)).join(" · ")}
                </p>
                <p className={`text-base mt-1 font-medium ${low ? "text-[var(--color-alert)]" : "text-[var(--color-ink-secondary)]"}`}>
                  {m.tabletsLeft <= 0
                    ? t(lang, "outOfStock")
                    : days !== null
                      ? t(lang, "daysLeft", { n: localizeNumber(days, lang) })
                      : ""}
                  {low ? " ⚠" : ""}
                </p>
              </div>
              <span className="text-[var(--color-ink-tertiary)] pt-2" aria-hidden="true">›</span>
            </button>
          );
        })}
      </div>

      <div className="fixed bottom-24 inset-x-0 px-6 max-w-md mx-auto">
        <div className="flex gap-3">
          <button
            onClick={() => setAdding(true)}
            className="flex-1 text-xl font-bold py-5 rounded-2xl bg-[var(--color-accent)] text-white active:bg-[var(--color-accent-strong)]"
          >
            {t(lang, "addMedicine")}
          </button>
          <button
            aria-label="Hear this button"
            onClick={() => speak(t(lang, "addMedicine"))}
            className="px-6 rounded-2xl bg-[var(--color-surface-muted)] text-[var(--color-ink-secondary)]"
          >
            <SpeakerIcon size={24} />
          </button>
        </div>
      </div>
    </div>
  );
}
