import { useEffect, useRef, useState } from "react";
import { saveMedicine, listDevices, getSettings, getMyName, pullHousehold, type Medicine } from "../../db";
import { t, localizeNumber, type Lang } from "../../i18n";
import { useSpeaker, SpeakerIcon } from "../../speech";
import { readMedicineImage, type MedicineReading } from "../../lib/prescription";

type Step = 0 | 1 | 2 | 3; // photo | reading | confirm | stock

const DEFAULT_SLOTS = ["08:00", "14:00", "21:00"];
const DOSE_PRESETS = [0.25, 0.5, 1, 2];

function normalizeSlot(raw: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export default function AddMedicineFlow({ lang, onDone }: { lang: Lang; onDone: () => void }) {
  const [step, setStep] = useState<Step>(0);
  const [nickname, setNickname] = useState("");
  const [name, setName] = useState("");
  const [strength, setStrength] = useState("");
  const [times, setTimes] = useState<string[]>([DEFAULT_SLOTS[0]]);
  const [newTime, setNewTime] = useState("");
  const [tablets, setTablets] = useState(30);
  const [dosePerSlot, setDosePerSlot] = useState(1);
  const [aiName, setAiName] = useState(false);
  const [aiError, setAiError] = useState("");
  // Which elder in the household takes this medicine. A family phone may hold
  // several elders' schedules, so the medicine has to say whose it is.
  const [elders, setElders] = useState<{ id: string; name: string }[]>([]);
  const [elderId, setElderId] = useState("");
  const speak = useSpeaker(lang);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastFile = useRef<File | null>(null);

  useEffect(() => {
    void (async () => {
      await pullHousehold();
      const [s, devices, myName] = await Promise.all([getSettings(), listDevices(), getMyName()]);
      const label = t(lang, "thisPhone");
      const opts: { id: string; name: string }[] = [];
      const me = devices.find((d) => d.id === s.deviceKey);
      const iAmElder = !me || me.role === "elder";
      // This phone first when it is the one taking the medicine.
      if (iAmElder) opts.push({ id: s.deviceKey, name: myName ? `${myName} (${label})` : label });
      for (const d of devices) {
        if (d.role !== "elder" || d.id === s.deviceKey) continue;
        opts.push({ id: d.id, name: d.name || `${t(lang, "elder")} ${opts.length + 1}` });
      }
      setElders(opts);
      setElderId((prev) => prev || (iAmElder ? s.deviceKey : opts[0]?.id || ""));
    })();
  }, [lang]);

  function applyReading(r: MedicineReading) {
    setNickname((prev) => prev || r.nickname || "");
    setName((prev) => prev || r.name || "");
    setStrength((prev) => prev || r.strength || "");
    if (r.times?.length) setTimes(r.times);
    // Any quarter-tablet amount, not only the four presets.
    if (typeof r.dosePerSlot === "number" && r.dosePerSlot > 0) setDosePerSlot(r.dosePerSlot);
    if (typeof r.tabletsInStrip === "number") setTablets(r.tabletsInStrip);
    setAiName(true);
    setStep(2);
  }

  // The photo is read by the vision model, and only by the vision model. There
  // is no on-device OCR fallback: a lower-quality guess presented as a reading
  // is worse than an honest "couldn't read it, try again or type it in".
  async function runAI(file: File) {
    lastFile.current = file;
    setAiError("");
    setStep(1);
    try {
      const reading = await readMedicineImage(file, lang);
      applyReading(reading);
    } catch (e) {
      const message = String((e as { message?: string }).message || e).slice(0, 200);
      setAiError(message);
      setStep(2);
    }
  }

  function toggleTime(slot: string) {
    setTimes((prev) => (prev.includes(slot) ? prev.filter((s) => s !== slot) : [...prev, slot].sort()));
  }

  function addCustomTime() {
    const slot = normalizeSlot(newTime);
    if (!slot) return;
    if (!times.includes(slot)) setTimes((prev) => [...prev, slot].sort());
    setNewTime("");
  }

  async function save() {
    const m: Medicine = {
      id: crypto.randomUUID(),
      nickname: nickname || name || "Medicine",
      name,
      strength,
      instruction: t(lang, "withWater"),
      times: times.length ? times : [DEFAULT_SLOTS[0]],
      elderId: elderId || undefined,
      dosePerSlot,
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
              if (f) void runAI(f);
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
          {aiName && (
            <p className="text-sm font-semibold text-[var(--color-accent)]">
              {lang === "en" ? "Auto-filled from the photo. Check every field." : lang === "hi" ? "फोटो से भरा गया। हर जानकारी जाँचें।" : "ছবি থেকে ভরা হয়েছে। সব তথ্য দেখে নিন।"}
            </p>
          )}
          {aiError && (
            <div className="text-sm text-[var(--color-ink-secondary)] bg-[var(--color-alert-soft)] rounded-xl p-4">
              <p className="font-semibold" role="status">{t(lang, "photoUnread")}</p>
              <button
                onClick={() => {
                  const file = lastFile.current;
                  if (file) void runAI(file);
                }}
                disabled={!lastFile.current}
                className="mt-3 w-full text-base font-bold py-3 rounded-xl bg-[var(--color-accent)] text-white disabled:opacity-40"
              >
                {t(lang, "tryAgain")}
              </button>
              <details className="mt-2">
                <summary className="cursor-pointer text-[var(--color-ink-tertiary)]">Details</summary>
                <p className="mt-1 break-words text-[var(--color-ink-tertiary)]">{aiError}</p>
              </details>
            </div>
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

          {elders.length > 1 && (
            <div>
              <span className="text-base font-semibold text-[var(--color-ink-secondary)]">{t(lang, "whoTakes")}</span>
              <div className="flex flex-wrap gap-3 mt-2">
                {elders.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => setElderId(e.id)}
                    aria-pressed={elderId === e.id}
                    className={`text-lg px-5 py-4 rounded-xl border-2 font-semibold ${elderId === e.id ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]" : "border-[var(--color-line)] bg-[var(--color-surface)]"}`}
                  >
                    {e.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <span className="text-base font-semibold text-[var(--color-ink-secondary)]">{t(lang, "timesLabel")}</span>
            <div className="flex flex-wrap gap-3 mt-2">
              {times.map((slot) => (
                <button
                  key={slot}
                  onClick={() => toggleTime(slot)}
                  aria-pressed={true}
                  aria-label={`${localizeNumber(slot, lang)} — ${t(lang, "remove")}`}
                  className="text-xl px-5 py-4 rounded-xl border-2 border-[var(--color-accent)] bg-[var(--color-accent-soft)] font-semibold"
                >
                  {localizeNumber(slot, lang)}
                </button>
              ))}
              {DEFAULT_SLOTS.filter((s) => !times.includes(s)).map((slot) => (
                <button
                  key={slot}
                  onClick={() => toggleTime(slot)}
                  aria-pressed={false}
                  className="text-xl px-5 py-4 rounded-xl border-2 border-dashed border-[var(--color-line)] text-[var(--color-ink-secondary)] font-semibold"
                >
                  + {localizeNumber(slot, lang)}
                </button>
              ))}
            </div>
            <div className="flex gap-3 mt-3">
              <input
                type="time"
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                aria-label={t(lang, "addTime")}
                className="flex-1 min-w-0 text-xl px-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)]"
              />
              <button
                onClick={addCustomTime}
                disabled={!normalizeSlot(newTime)}
                className="shrink-0 text-lg font-bold px-5 rounded-xl bg-[var(--color-surface-muted)] disabled:opacity-40"
              >
                {t(lang, "addBtn")}
              </button>
            </div>
          </div>

          <div>
            <span className="text-base font-semibold text-[var(--color-ink-secondary)]">{t(lang, "dosePerSlotLabel")}</span>
            <div className="flex flex-wrap gap-3 mt-2">
              {DOSE_PRESETS.map((u) => (
                <button
                  key={u}
                  onClick={() => setDosePerSlot(u)}
                  aria-pressed={dosePerSlot === u}
                  className={`text-xl px-5 py-4 rounded-xl border-2 font-semibold ${dosePerSlot === u ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]" : "border-[var(--color-line)] bg-[var(--color-surface)]"}`}
                >
                  {localizeNumber(u, lang)}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-3 mt-3">
              <span className="text-base text-[var(--color-ink-secondary)]">{t(lang, "customDose")}</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.25"
                min="0.25"
                max="20"
                value={dosePerSlot}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v >= 0.25 && v <= 20) setDosePerSlot(v);
                }}
                className="w-24 text-xl px-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)]"
              />
            </label>
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
