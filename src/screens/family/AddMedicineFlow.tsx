import { useRef, useState } from "react";
import Tesseract from "tesseract.js";
import { saveMedicine, type Medicine } from "../../db";
import { t, localizeNumber, type Lang } from "../../i18n";
import { useSpeaker, SpeakerIcon } from "../../speech";

type Step = 0 | 1 | 2 | 3; // photo | reading | confirm | stock

const DEFAULT_SLOTS = ["08:00", "14:00", "21:00"];

export default function AddMedicineFlow({ lang, onDone }: { lang: Lang; onDone: () => void }) {
  const [step, setStep] = useState<Step>(0);
  const [ocrText, setOcrText] = useState("");
  const [nickname, setNickname] = useState("");
  const [name, setName] = useState("");
  const [strength, setStrength] = useState("");
  const [times, setTimes] = useState<string[]>([DEFAULT_SLOTS[0]]);
  const [tablets, setTablets] = useState(30);
  const speak = useSpeaker(lang);
  const fileRef = useRef<HTMLInputElement>(null);

  async function runOCR(file: File) {
    setStep(1);
    try {
      const result = await Tesseract.recognize(file, "eng+ben");
      setOcrText(result.data.text.trim());
      // Best-effort: first non-empty line as the name
      const firstLine = result.data.text.split("\n").map((l) => l.trim()).find((l) => l.length > 2);
      if (firstLine && !name) setName(firstLine);
    } finally {
      setStep(2);
    }
  }

  function toggleTime(slot: string) {
    setTimes((prev) => (prev.includes(slot) ? prev.filter((s) => s !== slot) : [...prev, slot].sort()));
  }

  async function save() {
    const m: Medicine = {
      id: crypto.randomUUID(),
      nickname: nickname || name || "Medicine",
      name,
      strength,
      instruction: t(lang, "withWater"),
      times: times.length ? times : [DEFAULT_SLOTS[0]],
      tabletsLeft: tablets,
      createdAt: Date.now(),
      synced: false,
    };
    await saveMedicine(m);
    onDone();
  }

  return (
    <div className="anim-push min-h-dvh flex flex-col px-6 py-8 max-w-md mx-auto">
      <button onClick={() => (step === 0 ? onDone() : setStep((step - 1) as Step))} className="self-start text-lg font-semibold text-[var(--color-accent)] py-2 px-1">
        ← {lang === "en" ? "Back" : lang === "hi" ? "वापस" : "পেছনে"}
      </button>

      <p className="text-lg text-[var(--color-ink-tertiary)] mt-4">{t(lang, "stepOf", { n: localizeNumber(Math.max(step, 1) + (step >= 2 ? 1 : 0), lang) })}</p>

      {step === 0 && (
        <div className="flex-1 flex flex-col justify-center gap-4">
          <p className="text-2xl font-semibold leading-snug">{t(lang, "photoStrip")}</p>
          <div className="flex gap-3">
            <button onClick={() => fileRef.current?.click()} className="flex-1 text-xl font-bold py-6 rounded-2xl bg-[var(--color-accent)] text-white active:bg-[var(--color-accent-strong)]">
              {t(lang, "takePhoto")}
            </button>
            <button aria-label="Hear this button" onClick={() => speak(t(lang, "photoStrip"))} className="px-6 rounded-2xl bg-[var(--color-surface-muted)] text-[var(--color-ink-secondary)]">
              <SpeakerIcon size={24} />
            </button>
          </div>
          <button onClick={() => setStep(2)} className="self-center text-lg font-semibold text-[var(--color-accent)] py-3 px-4">
            {t(lang, "addManually")}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void runOCR(f);
            }}
          />
        </div>
      )}

      {step === 1 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="w-10 h-10 border-4 border-[var(--color-line)] border-t-[var(--color-accent)] rounded-full animate-spin" aria-hidden="true" />
          <p className="text-2xl font-semibold">{t(lang, "readingStrip")}</p>
        </div>
      )}

      {step === 2 && (
        <div className="flex-1 flex flex-col gap-5 mt-2">
          <h2 className="text-2xl font-bold">{t(lang, "confirmDetails")}</h2>
          {ocrText && (
            <details className="text-sm text-[var(--color-ink-tertiary)] bg-[var(--color-surface-muted)] rounded-xl p-3">
              <summary className="cursor-pointer">{t(lang, "readText")}</summary>
              <p className="whitespace-pre-wrap mt-2">{ocrText}</p>
            </details>
          )}
          {[
            { label: t(lang, "nickname"), value: nickname, set: setNickname, placeholder: t(lang, "nicknamePh") },
            { label: t(lang, "medName"), value: name, set: setName, placeholder: t(lang, "medNamePh") },
            { label: t(lang, "strength"), value: strength, set: setStrength, placeholder: "500mg" },
          ].map((f) => (
            <label key={f.label} className="block">
              <span className="text-base font-semibold text-[var(--color-ink-secondary)]">{f.label}</span>
              <input
                value={f.value}
                onChange={(e) => f.set(e.target.value)}
                placeholder={f.placeholder}
                className="mt-1 w-full text-xl px-4 py-4 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)]"
              />
            </label>
          ))}
          <div>
            <span className="text-base font-semibold text-[var(--color-ink-secondary)]">{t(lang, "timesLabel")}</span>
            <div className="flex flex-wrap gap-3 mt-2">
              {DEFAULT_SLOTS.map((slot) => (
                <button
                  key={slot}
                  onClick={() => toggleTime(slot)}
                  aria-pressed={times.includes(slot)}
                  className={`text-xl px-5 py-4 rounded-xl border-2 font-semibold ${times.includes(slot) ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]" : "border-[var(--color-line)] bg-[var(--color-surface)]"}`}
                >
                  {slot}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={() => setStep(3)}
            disabled={!name && !nickname}
            className="mt-auto text-xl font-bold py-5 rounded-2xl bg-[var(--color-accent)] text-white disabled:opacity-40 active:bg-[var(--color-accent-strong)]"
          >
            {t(lang, "nextBtn")}
          </button>
        </div>
      )}

      {step === 3 && (
        <div className="flex-1 flex flex-col gap-6 mt-2">
          <h2 className="text-2xl font-bold">{t(lang, "stockQ")}</h2>
          <div className="flex items-center justify-center gap-6">
            <button onClick={() => setTablets((x) => Math.max(0, x - 1))} className="w-16 h-16 rounded-2xl bg-[var(--color-surface-muted)] text-3xl font-bold" aria-label="minus">−</button>
            <p className="text-5xl font-bold w-24 text-center">{localizeNumber(tablets, lang)}</p>
            <button onClick={() => setTablets((x) => x + 1)} className="w-16 h-16 rounded-2xl bg-[var(--color-surface-muted)] text-3xl font-bold" aria-label="plus">+</button>
          </div>
          <button
            onClick={() => void save()}
            className="mt-auto text-xl font-bold py-5 rounded-2xl bg-[var(--color-accent)] text-white active:bg-[var(--color-accent-strong)]"
          >
            {t(lang, "saveMedicine")}
          </button>
        </div>
      )}
    </div>
  );
}
