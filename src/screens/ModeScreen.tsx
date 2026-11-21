import { t, type Lang } from "../i18n";
import { useSpeaker, SpeakerIcon } from "../speech";

export default function ModeScreen({
  lang,
  onSelect,
}: {
  lang: Lang;
  onSelect: (mode: "elder" | "family") => void;
}) {
  const speak = useSpeaker(lang);
  const options = [
    { id: "elder" as const, label: t(lang, "myself") },
    { id: "family" as const, label: t(lang, "familyMember") },
  ];
  return (
    <main className="anim-screen min-h-dvh flex flex-col px-6 py-10 max-w-md mx-auto">
      <h1 className="text-3xl font-bold mb-10">{t(lang, "whoUsesPhone")}</h1>
      <div className="flex-1 flex flex-col gap-4 stagger">
        {options.map((o) => (
          <div key={o.id} className="flex gap-3">
            <button
              onClick={() => onSelect(o.id)}
              className="flex-1 text-3xl font-semibold px-6 py-8 rounded-2xl border-2 border-[var(--color-line)] bg-[var(--color-surface)] active:bg-[var(--color-surface-muted)]"
            >
              {o.label}
            </button>
            <button
              aria-label="Hear this option"
              onClick={() => speak(o.label)}
              className="px-6 rounded-2xl bg-[var(--color-surface-muted)] text-[var(--color-ink-secondary)]"
            >
              <SpeakerIcon size={26} />
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}
