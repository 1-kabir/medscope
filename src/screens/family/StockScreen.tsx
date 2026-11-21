import { useEffect, useState } from "react";
import { listMedicines, type Medicine } from "../../db";
import { t, localizeNumber, type Lang } from "../../i18n";
import { useSpeaker, SpeakerIcon } from "../../speech";

function daysUntilEmpty(m: Medicine): number | null {
  const dailyUnits = m.times.length * (m.dosePerSlot ?? 1);
  if (dailyUnits <= 0) return null;
  return Math.floor(m.tabletsLeft / dailyUnits);
}

// 1mg search deep link — we hand off and stop. No fake checkout.
function oneMgUrl(name: string): string {
  return `https://www.1mg.com/search/all?name=${encodeURIComponent(name)}`;
}

export default function StockScreen({ lang, onBack }: { lang: Lang; onBack: () => void }) {
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const speak = useSpeaker(lang);

  useEffect(() => {
    void listMedicines().then(setMedicines);
  }, []);

  return (
    <div className="anim-push min-h-dvh px-6 py-8 max-w-md mx-auto pb-10">
      <button onClick={onBack} className="text-lg font-semibold text-[var(--color-accent)] py-2 px-1">
        ← {lang === "en" ? "Back" : lang === "hi" ? "वापस" : "পেছনে"}
      </button>
      <h1 className="text-3xl font-bold mt-4">{t(lang, "stockTitle")}</h1>

      <div className="mt-6 space-y-4">
        {medicines.length === 0 && <p className="text-lg text-[var(--color-ink-secondary)]">—</p>}
        {medicines.map((m) => {
          const days = daysUntilEmpty(m);
          const low = days !== null && days <= 3;
          const statement =
            m.tabletsLeft <= 0
              ? `${m.nickname}: ${t(lang, "outOfStock")}`
              : `${m.nickname}: ${localizeNumber(m.tabletsLeft, lang)} · ${t(lang, "daysLeft", { n: localizeNumber(days ?? 0, lang) })}`;
          return (
            <div
              key={m.id}
              className={`px-5 py-4 rounded-2xl border ${low ? "border-[var(--color-alert)] bg-[var(--color-alert-soft)]" : "border-[var(--color-line)] bg-[var(--color-surface)]"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <p className={`text-xl font-semibold leading-snug ${low ? "text-[var(--color-alert)]" : ""}`}>
                  {low ? "⚠ " : ""}{statement}
                </p>
                <button aria-label="Hear this" onClick={() => speak(statement)} className="p-2 shrink-0 text-[var(--color-ink-secondary)]">
                  <SpeakerIcon />
                </button>
              </div>
              {low && (
                <a
                  href={oneMgUrl(m.name || m.nickname)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-block text-lg font-bold px-5 py-3 rounded-xl bg-[var(--color-accent)] text-white"
                >
                  {t(lang, "reorder")}
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
