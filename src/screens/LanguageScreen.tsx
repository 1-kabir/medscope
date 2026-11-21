import { LANGUAGES, t, type Lang } from "../i18n";
import { useSpeaker, SpeakerIcon } from "../speech";

export default function LanguageScreen({
  lang,
  onSelect,
  onContinue,
}: {
  lang: Lang;
  onSelect: (l: Lang) => void;
  onContinue: () => void;
}) {
  const speak = useSpeaker("en");
  return (
    <main className="anim-screen min-h-dvh flex flex-col px-6 py-10 max-w-md mx-auto">
      <h1 className="text-4xl font-bold mb-8">MedscopeOne</h1>
      <div className="flex-1 flex flex-col gap-4 stagger">
        {LANGUAGES.map((l) => (
          <button
            key={l.id}
            onClick={() => onSelect(l.id)}
            aria-pressed={lang === l.id}
            className={`flex items-center justify-between w-full text-3xl font-semibold px-6 py-6 rounded-2xl border-2 ${
              lang === l.id ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]" : "border-[var(--color-line)] bg-[var(--color-surface)]"
            }`}
          >
            <span>{l.label}</span>
            {lang === l.id && (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-label="selected">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>
        ))}
      </div>
      <div className="mt-10 flex gap-3">
        <button
          onClick={onContinue}
          className="flex-1 text-2xl font-bold py-5 rounded-2xl bg-[var(--color-accent)] text-white active:bg-[var(--color-accent-strong)]"
        >
          {t(lang, "continue")}
        </button>
        <button
          aria-label="Hear this button"
          onClick={() => speak(t(lang, "continue"))}
          className="px-6 rounded-2xl bg-[var(--color-surface-muted)] text-[var(--color-ink-secondary)]"
        >
          <SpeakerIcon size={26} />
        </button>
      </div>
    </main>
  );
}
