import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listMedicines, logDose, listContacts, logsByDate, setSetting, getSettings, type Medicine, type DoseLog } from "../db";
import { t, localizeNumber, type Lang } from "../i18n";
import { stopSpeaking, SpeakerIcon, useSpeaker } from "../speech";

type Dose = { med: Medicine; slot: string };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function minutesOf(slot: string): number {
  const [h, m] = slot.split(":").map(Number);
  return h * 60 + m;
}

function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export default function ElderDoseScreen({ lang }: { lang: Lang }) {
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [logs, setLogs] = useState<DoseLog[]>([]);
  const [contacts, setContacts] = useState<{ id: string; name: string; whatsapp: string }[]>([]);
  const [deferringUntil, setDeferringUntil] = useState<number | null>(null);
  const [justTaken, setJustTaken] = useState<number | null>(null);
  const [listening, setListening] = useState(false);
  const [confirmingSetup, setConfirmingSetup] = useState(false);
  const [householdCode, setHouseholdCode] = useState<string | null>(null);

  useEffect(() => {
    void getSettings().then((s) => setHouseholdCode(s.householdId));
  }, []);
  const spokeFor = useRef<string | null>(null);
  const speak = useSpeaker(lang);

  useEffect(() => {
    void refresh();
    void listContacts().then(setContacts);
  }, []);

  async function refresh() {
    setMedicines(await listMedicines());
    setLogs(await logsByDate(today()));
  }

  // Dose computation: all slots today, next = earliest not-yet-logged slot at/after now, else earliest overall
  const { dose, state, remainingToday } = useMemo(() => {
    const takenKeys = new Set(logs.filter((l) => l.status === "taken").map((l) => l.medicineId + l.slot));
    const all: Dose[] = medicines.flatMap((med) => med.times.map((slot) => ({ med, slot })));
    const remaining = all.filter((d) => !takenKeys.has(d.med.id + d.slot)).length;
    const now = nowMinutes();
    const upcoming = all
      .filter((d) => !takenKeys.has(d.med.id + d.slot) && minutesOf(d.slot) >= now)
      .sort((a, b) => minutesOf(a.slot) - minutesOf(b.slot));
    const overdue = all
      .filter((d) => !takenKeys.has(d.med.id + d.slot) && minutesOf(d.slot) < now)
      .sort((a, b) => minutesOf(a.slot) - minutesOf(b.slot));
    const next = overdue[0] ?? upcoming[0] ?? null;
    let s: "due" | "early" | "deferring" | "alldone";
    if (!next) s = "alldone";
    else if (deferringUntil && Date.now() < deferringUntil) s = "deferring";
    else if (overdue.length > 0 || minutesOf(next.slot) === now) s = "due";
    else s = "early";
    return { dose: next, state: s, remainingToday: remaining };
  }, [medicines, logs, deferringUntil]);

  // Spoken reminder loop: when due, speak once per state entry
  useEffect(() => {
    if (state !== "due" || !dose) return;
    const key = dose.med.id + dose.slot;
    if (spokeFor.current === key) return;
    spokeFor.current = key;
    speak(`${t(lang, "timeFor")}: ${dose.med.nickname}`);
  }, [state, dose, lang, speak]);

  // Countdown tick while deferring
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (state !== "deferring") return;
    const i = setInterval(() => forceTick((x) => x + 1), 1000);
    return () => clearInterval(i);
  }, [state]);

  const take = useCallback(
    async (d: Dose) => {
      stopSpeaking();
      await logDose({
        id: crypto.randomUUID(),
        medicineId: d.med.id,
        nickname: d.med.nickname,
        slot: d.slot,
        date: today(),
        status: "taken",
        at: Date.now(),
        synced: false,
      });
      spokeFor.current = null;
      setDeferringUntil(null);
      setJustTaken(remainingToday - 1);
      await refresh();
      setTimeout(() => setJustTaken(null), 3000);
    },
    [remainingToday, lang, speak]
  );

  const defer = useCallback(
    async (d: Dose) => {
      stopSpeaking();
      setDeferringUntil(Date.now() + 10 * 60_000);
      await logDose({
        id: crypto.randomUUID(),
        medicineId: d.med.id,
        nickname: d.med.nickname,
        slot: d.slot,
        date: today(),
        status: "deferred",
        at: Date.now(),
        synced: false,
      });
      await refresh();
    },
    []
  );

  // Voice input: "I took it" / "later"
  const micRef = useRef<{ start: () => void; stop: () => void } | null>(null);
  function toggleMic() {
    const SR = (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;
    if (!SR || !dose) return;
    if (listening) {
      micRef.current?.stop();
      return;
    }
    const rec = new (SR as new () => {
      lang: string;
      interimResults: boolean;
      onresult: (e: { results: { 0: { 0: { transcript: string } } } }) => void;
      onend: () => void;
      onerror: () => void;
      start: () => void;
      stop: () => void;
    })();
    rec.lang = lang === "bn" ? "bn-IN" : lang === "hi" ? "hi-IN" : "en-IN";
    rec.interimResults = false;
    rec.onresult = (e) => {
      const text = e.results[0][0].transcript.toLowerCase();
      if (/খেয়েছি|খেয়ে|took|ले लिया/.test(text)) void take(dose);
      else if (/পরে|later|बाद/.test(text)) void defer(dose);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    micRef.current = rec;
    setListening(true);
    rec.start();
  }

  // Taken confirmation transient
  if (justTaken !== null) {
    return (
      <main className="anim-screen min-h-dvh flex flex-col items-center justify-center bg-[var(--color-accent-soft)] px-6 text-center" onClick={() => setJustTaken(null)}>
        <svg className="check-pop check-draw" width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <p className="text-4xl font-bold mt-6 text-[var(--color-ink)]">{t(lang, "takenDone")}</p>
        {justTaken > 0 && <p className="text-2xl mt-2 text-[var(--color-ink-secondary)]">{t(lang, "remainingToday", { n: localizeNumber(justTaken, lang) })}</p>}
      </main>
    );
  }

  // Setup switch confirmation — the elder's only way out, guarded by a confirm
  if (confirmingSetup) {
    return (
      <main className="anim-screen min-h-dvh flex flex-col items-center justify-center px-6 text-center max-w-md mx-auto" role="dialog" aria-modal="true" aria-label={t(lang, "phoneFor")}>
        <p className="text-2xl font-semibold leading-snug">{t(lang, "phoneFor")} — {t(lang, "myself")}?</p>
        <p className="text-lg text-[var(--color-ink-secondary)] mt-3">{lang === "en" ? "Switch to family setup to add medicines and contacts." : lang === "hi" ? "दवाएँ और संपर्क जोड़ने के लिए परिवार सेटअप पर जाएँ।" : "ওষুধ ও পরিবারের তথ্য যোগ করতে পরিবারের সেটআপে যান।"}</p>
        {householdCode && (
          <div className="mt-6 px-8 py-5 rounded-2xl bg-[var(--color-surface-muted)]">
            <p className="text-base font-semibold text-[var(--color-ink-secondary)]">{t(lang, "yourCode")}</p>
            <p className="text-4xl font-bold tracking-[0.25em] mt-1">{localizeNumber(householdCode, lang)}</p>
            <p className="text-sm text-[var(--color-ink-tertiary)] mt-2">{t(lang, "yourCodeBody")}</p>
          </div>
        )}
        <div className="flex flex-col gap-3 w-full mt-8">
          <button
            onClick={() => { void setSetting("mode", null).then(() => window.location.reload()); }}
            className="w-full text-xl font-bold py-5 rounded-2xl bg-[var(--color-accent)] text-white active:bg-[var(--color-accent-strong)]"
          >
            {lang === "en" ? "Switch to family setup" : lang === "hi" ? "परिवार सेटअप खोलें" : "পরিবারের সেটআপ খুলুন"}
          </button>
          <button onClick={() => setConfirmingSetup(false)} className="w-full text-xl font-bold py-5 rounded-2xl bg-[var(--color-surface-muted)]">
            {t(lang, "cancel")}
          </button>
        </div>
      </main>
    );
  }

  const firstContact = contacts[0];

  return (
    <main className="anim-screen min-h-dvh flex flex-col px-6 py-8 max-w-md mx-auto">
      <div className="flex items-start justify-between">
        <button
          onClick={() => setConfirmingSetup(true)}
          aria-label={lang === "en" ? "Setup" : lang === "hi" ? "सेटअप" : "সেটআপ"}
          className="p-3 -m-3 text-[var(--color-ink-tertiary)]"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        {firstContact ? (
        <a
          href={`tel:${firstContact.whatsapp}`}
          className="self-end flex items-center gap-2 px-4 py-3 rounded-full bg-[var(--color-alert-soft)] text-[var(--color-alert)] font-bold text-lg"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
          {t(lang, "help")}
        </a>
        ) : <span />}
      </div>

      <div className="flex-1 flex flex-col justify-center">
        {state === "alldone" || !dose ? (
          <p className="text-3xl font-semibold text-center leading-snug" onClick={() => speak(t(lang, "allDone"))}>
            {t(lang, "allDone")}
          </p>
        ) : (
          <>
            <p className="text-2xl text-[var(--color-ink-secondary)] text-center" onClick={() => speak(t(lang, "timeFor"))}>
              {t(lang, "timeFor")}
            </p>
            <h1
              className="text-5xl font-bold text-center mt-4 leading-tight"
              onClick={() => speak(dose.med.nickname)}
            >
              {dose.med.nickname}
            </h1>
            <p className="text-4xl font-semibold text-center mt-3 text-[var(--color-ink)]" onClick={() => speak(localizeNumber(dose.slot, lang))}>
              {localizeNumber(dose.slot, lang)}
            </p>
            <p className="text-xl text-center mt-2 text-[var(--color-ink-secondary)]" onClick={() => speak(dose.med.instruction)}>
              {dose.med.instruction || t(lang, "withWater")}
            </p>
          </>
        )}
      </div>

      {/* Actions — thumb zone */}
      {dose && state !== "alldone" && state !== "deferring" && (
        <div className="flex flex-col gap-4 pb-4">
          <div className="flex gap-3">
            <button
              onClick={() => void take(dose)}
              className="flex-1 text-3xl font-bold py-7 rounded-2xl active:brightness-90"
              style={{ background: state === "due" ? "var(--color-accent)" : "var(--color-surface-muted)", color: state === "due" ? "white" : "var(--color-ink-secondary)" }}
            >
              {t(lang, "taken")}
            </button>
            <button
              aria-label="Hear this button"
              onClick={() => speak(t(lang, "taken"))}
              className="px-6 rounded-2xl bg-[var(--color-surface-muted)] text-[var(--color-ink-secondary)]"
            >
              <SpeakerIcon size={24} />
            </button>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => void defer(dose)}
              className="flex-1 text-2xl font-bold py-5 rounded-2xl active:brightness-90"
              style={{ background: "var(--color-defer)", color: "var(--color-defer-strong)" }}
            >
              {t(lang, "remindLater")}
            </button>
            <button
              aria-label="Hear this button"
              onClick={() => speak(t(lang, "remindLater"))}
              className="px-6 rounded-2xl bg-[var(--color-surface-muted)] text-[var(--color-ink-secondary)]"
            >
              <SpeakerIcon size={24} />
            </button>
          </div>
          <button
            onClick={toggleMic}
            aria-pressed={listening}
            className="self-center flex items-center gap-2 text-lg text-[var(--color-ink-secondary)] px-5 py-3 rounded-full bg-[var(--color-surface-muted)]"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
            </svg>
            {listening ? "..." : ""}
          </button>
        </div>
      )}

      {state === "deferring" && dose && deferringUntil && (
        <p className="text-center text-2xl font-semibold py-8 text-[var(--color-defer-strong)]" onClick={() => speak(t(lang, "notNow"))}>
          {t(lang, "remindLater")} · {localizeNumber(Math.ceil((deferringUntil - Date.now()) / 60000), lang)}
        </p>
      )}
    </main>
  );
}
