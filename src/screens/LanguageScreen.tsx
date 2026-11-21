import { useEffect } from "react";
import { LANGUAGES, t, type Lang } from "../i18n";
import { prefetchTTS, speak, speakLines, stopSpeaking } from "../speech";

export default function LanguageScreen({
  lang,
  onSelect,
  onContinue,
}: {
  lang: Lang;
  onSelect: (l: Lang) => void;
  onContinue: () => void;
}) {
  // The elder may not read any of these scripts. The screen says itself aloud:
  // the question, then each language's own name in its own voice.
  useEffect(() => {
    const lines = [
      { text: t(lang as Lang, "chooseLanguage"), lang },
      ...LANGUAGES.map((l) => ({ text: l.label, lang: l.id })),
    ];
    speakLines(lines);
    // And warm the cache so a tap plays instantly — Sarvam needs a round trip
    // per line, which is why clicking otherwise stayed silent too long.
    prefetchTTS(lines);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="anim-screen min-h-dvh flex flex-col px-6 py-10 max-w-md mx-auto">
      <h1 className="text-4xl font-bold mb-8">MedscopeOne</h1>
      <div className="flex-1 flex flex-col gap-4 stagger">
        {LANGUAGES.map((l) => (
          <button
            key={l.id}
            onClick={() => {
              // Choosing is also a confirmation they can hear, in that language.
              // Stop the intro queue first so the tap is heard immediately.
              stopSpeaking();
              speak(l.label, l.id);
              onSelect(l.id);
            }}
            aria-pressed={lang === l.id}
            className={`flex items-center justify-between w-full text-3xl font-semibold px-6 py-6 rounded-2xl border-2 ${
              lang === l.id ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]" : "border-[var(--color-line)] bg-[var(--color-surface)]"
            }`}
          >
            <span>{l.label}</span>
            {lang === l.id && (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>
        ))}
      </div>
      <button
        onClick={() => {
          stopSpeaking();
          onContinue();
        }}
        className="mt-10 w-full text-2xl font-bold py-6 rounded-2xl bg-[var(--color-accent)] text-white active:bg-[var(--color-accent-strong)]"
      >
        {t(lang, "continue")}
      </button>
    </main>
  );
}
