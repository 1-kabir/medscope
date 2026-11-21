import { useState } from "react";
import { createHousehold, joinHousehold } from "../../db";
import { t, type Lang } from "../../i18n";
import { useSpeaker, SpeakerIcon } from "../../speech";

// Family-side linking: create a fresh household or join the elder's by code.
export default function LinkScreen({ lang, onLinked }: { lang: Lang; onLinked: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);
  const speak = useSpeaker(lang);

  return (
    <main className="anim-screen min-h-dvh flex flex-col px-6 py-10 max-w-md mx-auto">
      <h1 className="text-3xl font-bold">{t(lang, "linkTitle")}</h1>
      <p className="text-lg text-[var(--color-ink-secondary)] mt-3 leading-relaxed">{t(lang, "linkBody")}</p>

      <div className="flex-1 flex flex-col justify-center gap-8">
        <div className="flex flex-col gap-4">
          <p className="text-xl font-semibold">{t(lang, "joinHousehold")}</p>
          <input
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
              setError(false);
            }}
            inputMode="numeric"
            placeholder={lang === "en" ? "123456" : "১২৩৪৫৬"}
            aria-label={t(lang, "enterCode")}
            className="w-full text-3xl tracking-[0.3em] text-center px-4 py-5 rounded-2xl bg-[var(--color-surface)] border-2 border-[var(--color-line)]"
          />
          {error && <p className="text-lg font-semibold text-[var(--color-alert)]">{t(lang, "invalidCode")}</p>}
          <div className="flex gap-3">
            <button
              onClick={async () => {
                const ok = await joinHousehold(code);
                if (ok) onLinked();
                else setError(true);
              }}
              disabled={code.length !== 6}
              className="flex-1 text-xl font-bold py-5 rounded-2xl bg-[var(--color-accent)] text-white disabled:opacity-40 active:bg-[var(--color-accent-strong)]"
            >
              {t(lang, "linkBtn")}
            </button>
            <button
              aria-label="Hear this button"
              onClick={() => speak(t(lang, "joinHousehold"))}
              className="px-6 rounded-2xl bg-[var(--color-surface-muted)] text-[var(--color-ink-secondary)]"
            >
              <SpeakerIcon size={24} />
            </button>
          </div>
        </div>

        <div className="border-t border-[var(--color-line)] pt-8">
          <p className="text-xl font-semibold">{t(lang, "createHousehold")}</p>
          <p className="text-base text-[var(--color-ink-secondary)] mt-1">{t(lang, "createHouseholdBody")}</p>
          <button
            onClick={() => void createHousehold().then(onLinked)}
            className="mt-4 w-full text-xl font-bold py-5 rounded-2xl border-2 border-[var(--color-line)] bg-[var(--color-surface)] active:bg-[var(--color-surface-muted)]"
          >
            {t(lang, "createHouseholdBtn")}
          </button>
        </div>
      </div>

      <p className="text-sm text-[var(--color-ink-tertiary)]">{t(lang, "remindersOnly")}</p>
    </main>
  );
}
