import { LANGUAGES, t, type Lang } from "../../i18n";
import { setSetting, getSettings } from "../../db";

export default function SettingsScreen({
  lang,
  onLangChange,
  onBack,
}: {
  lang: Lang;
  onLangChange: (l: Lang) => void;
  onBack: () => void;
}) {
  return (
    <div className="anim-push min-h-dvh px-6 py-8 max-w-md mx-auto">
      <button onClick={onBack} className="text-lg font-semibold text-[var(--color-accent)] py-2 px-1">
        ← {lang === "en" ? "Back" : lang === "hi" ? "वापस" : "পেছনে"}
      </button>
      <h1 className="text-3xl font-bold mt-4">{t(lang, "settings")}</h1>

      <section className="mt-8">
        <p className="text-base font-semibold text-[var(--color-ink-secondary)] mb-3">{t(lang, "language")}</p>
        <div className="flex flex-wrap gap-3">
          {LANGUAGES.map((l) => (
            <button
              key={l.id}
              aria-pressed={lang === l.id}
              onClick={() => {
                onLangChange(l.id);
                void setSetting("lang", l.id);
              }}
              className={`text-xl px-5 py-4 rounded-xl border-2 font-semibold ${lang === l.id ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]" : "border-[var(--color-line)] bg-[var(--color-surface)]"}`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <p className="text-base font-semibold text-[var(--color-ink-secondary)] mb-3">{t(lang, "phoneFor")}</p>
        <button
          onClick={() => {
            void getSettings().then((s) => {
              void setSetting("mode", null).then(() => window.location.reload());
              void s;
            });
          }}
          className="text-lg font-semibold text-[var(--color-accent)] py-3 px-4 rounded-xl bg-[var(--color-surface-muted)]"
        >
          {t(lang, "cancel")} / {t(lang, "whoUsesPhone")}
        </button>
        <p className="text-sm text-[var(--color-ink-tertiary)] mt-2">
          {lang === "en" ? "Tap to choose again on next launch." : lang === "hi" ? "अगली बार खोलने पर फिर चुनने के लिए दबाएँ।" : "পরের বার খুললে আবার বেছে নিতে দেবে।"}
        </p>
      </section>

      <section className="mt-8">
        <p className="text-base font-semibold text-[var(--color-ink-secondary)] mb-2">{t(lang, "about")}</p>
        <p className="text-lg leading-relaxed">{t(lang, "aboutBody")}</p>
        <p className="text-sm text-[var(--color-ink-tertiary)] mt-3">{t(lang, "remindersOnly")}</p>
      </section>
    </div>
  );
}
