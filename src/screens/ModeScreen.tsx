import { useEffect } from "react";
import { t, type Lang } from "../i18n";
import { speakLines, prefetchTTS } from "../speech";

export default function ModeScreen({
  lang,
  onSelect,
}: {
  lang: Lang;
  onSelect: (mode: "elder" | "family") => void;
}) {
  const options = [
    { id: "elder" as const, label: t(lang, "myself") },
    { id: "family" as const, label: t(lang, "familyMember") },
  ];

  // Reads the question and both choices once, so the screen is usable without
  // reading it. No extra button — the choices stay the only things to tap.
  useEffect(() => {
    const lines = [
      { text: t(lang, "whoUsesPhone"), lang },
      ...options.map((o) => ({ text: o.label, lang })),
    ];
    speakLines(lines);
    prefetchTTS(lines);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="anim-screen min-h-dvh flex flex-col px-6 py-10 max-w-md mx-auto">
      <h1 className="text-3xl font-bold mb-10 leading-snug">{t(lang, "whoUsesPhone")}</h1>
      <div className="flex flex-col gap-4 stagger">
        {options.map((o) => (
          <button
            key={o.id}
            onClick={() => onSelect(o.id)}
            className="w-full text-3xl font-semibold px-6 py-8 rounded-2xl border-2 border-[var(--color-line)] bg-[var(--color-surface)] active:bg-[var(--color-surface-muted)]"
          >
            {o.label}
          </button>
        ))}
      </div>
    </main>
  );
}
