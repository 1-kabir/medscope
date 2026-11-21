import { useEffect, useState } from "react";
import { listMedicines, type Medicine } from "../../db";
import { t, localizeNumber, type Lang } from "../../i18n";
import { useSpeaker, SpeakerIcon } from "../../speech";

function daysUntilEmpty(m: Medicine): number | null {
  const dailyUnits = m.times.length * (m.dosePerSlot ?? 1);
  if (dailyUnits <= 0) return null;
  return Math.floor(m.tabletsLeft / dailyUnits);
}

// Tablets mean little on their own once doses can be halves or quarters.
function dosesLeft(m: Medicine): number {
  const per = m.dosePerSlot ?? 1;
  return per > 0 ? Math.floor(m.tabletsLeft / per) : 0;
}

// 1mg search deep link — we hand off and stop. No fake checkout.
function oneMgUrl(name: string): string {
  return `https://www.1mg.com/search/all?name=${encodeURIComponent(name)}`;
}

function WarningIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 mt-0.5">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

// A tab, not a pushed screen: the navbar is the way back, so no Back arrow.
export default function StockScreen({ lang }: { lang: Lang }) {
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const speak = useSpeaker(lang);

  useEffect(() => {
    void listMedicines().then(setMedicines);
  }, []);

  return (
    <div className="anim-screen min-h-dvh px-6 pt-8 pb-10 max-w-md mx-auto">
      <h1 className="text-3xl font-bold">{t(lang, "stockTitle")}</h1>

      <div className="mt-6 space-y-4">
        {medicines.length === 0 && (
          <p className="text-lg text-[var(--color-ink-secondary)] py-6">{t(lang, "noMedicines")}</p>
        )}
        {medicines.map((m) => {
          const days = daysUntilEmpty(m);
          const out = m.tabletsLeft <= 0;
          const low = !out && days !== null && days <= 3;
          const statement = out
            ? `${m.nickname}: ${t(lang, "outOfStock")}`
            : `${m.nickname}: ${localizeNumber(m.tabletsLeft, lang)} · ${t(lang, "dosesLeft", { n: localizeNumber(dosesLeft(m), lang) })} · ${t(lang, "daysLeft", { n: localizeNumber(days ?? 0, lang) })}`;
          return (
            <div
              key={m.id}
              className={`px-5 py-4 rounded-2xl border ${low || out ? "border-[var(--color-alert)] bg-[var(--color-alert-soft)]" : "border-[var(--color-line)] bg-[var(--color-surface)]"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                  {(low || out) && <span className="text-[var(--color-alert)] pt-0.5"><WarningIcon /></span>}
                  <div>
                    <p className={`text-xl font-semibold leading-snug ${low || out ? "text-[var(--color-alert)]" : ""}`}>
                      {m.nickname}
                    </p>
                    <p className="text-base text-[var(--color-ink-secondary)] mt-0.5">
                      {out
                        ? t(lang, "outOfStock")
                        : `${localizeNumber(m.tabletsLeft, lang)} · ${t(lang, "dosesLeft", { n: localizeNumber(dosesLeft(m), lang) })} · ${t(lang, "daysLeft", { n: localizeNumber(days ?? 0, lang) })}`}
                    </p>
                  </div>
                </div>
                <button aria-label={statement} onClick={() => speak(statement)} className="p-2 shrink-0 text-[var(--color-ink-secondary)]">
                  <SpeakerIcon />
                </button>
              </div>
              {(low || out) && (
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
