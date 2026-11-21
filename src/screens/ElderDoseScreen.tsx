import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listMedicines, logDose, undoDose, listContacts, logsByDate, setSetting, getSettings, setPause, pullHousehold, getMyName, setMyName, type Medicine, type DoseLog } from "../db";
import { t, localizeNumber, LANGUAGES, type Lang } from "../i18n";
import { stopSpeaking, useSpeaker } from "../speech";
import AddMedicineFlow from "./family/AddMedicineFlow";
import MembersScreen from "./family/MembersScreen";
import { scheduleDoseAlarms } from "../lib/alarms";

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

function dateLocale(lang: Lang): string {
  return lang === "bn" ? "bn-BD" : lang === "hi" ? "hi-IN" : "en-IN";
}

function GearIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function PhoneIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export default function ElderDoseScreen({ lang, onLangChange }: { lang: Lang; onLangChange: (l: Lang) => void }) {
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [logs, setLogs] = useState<DoseLog[]>([]);
  const [contacts, setContacts] = useState<{ id: string; name: string; whatsapp: string }[]>([]);
  const [deferringUntil, setDeferringUntil] = useState<number | null>(null);
  const [justTaken, setJustTaken] = useState<{ logId: string; remaining: number } | null>(null);
  const [listening, setListening] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [addingMedicine, setAddingMedicine] = useState(false);
  const [managingContacts, setManagingContacts] = useState(false);
  const [householdCode, setHouseholdCode] = useState<string | null>(null);
  const [pauseUntil, setPauseUntil] = useState<number | null>(null);
  const [myName, setMyNameState] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [editingName, setEditingName] = useState(false);

  useEffect(() => {
    void getMyName().then((n) => {
      setMyNameState(n);
      setNameDraft(n);
    });
    void getSettings().then((s) => {
      setHouseholdCode(s.householdId);
      if (s.pauseUntil && Date.now() < s.pauseUntil) setPauseUntil(s.pauseUntil);
      // Expired while the app was closed: drop the stale setting, not just the UI.
      else if (s.pauseUntil) void setPause(null);
    });
  }, []);
  const spokeFor = useRef<string | null>(null);
  const speak = useSpeaker(lang);

  useEffect(() => {
    void refresh();
    // Pull first so contacts the family added on their phone are already here;
    // with no household this returns immediately and the local list is used.
    void pullHousehold()
      .then(() => listContacts())
      .then(setContacts)
      .catch(() => void listContacts().then(setContacts));
  }, []);

  // Native dose alarms: re-derived from the current schedule on every open and
  // after every log change, so a taken dose never buzzes later.
  useEffect(() => {
    if (!medicines.length) return;
    void scheduleDoseAlarms(medicines);
  }, [medicines]);

  async function refresh() {
    const s = await getSettings();
    const all = await listMedicines();
    // One household can hold several elders. This phone only speaks for the
    // doses assigned to it — otherwise it would announce another elder's
    // medicines. Rows with no elderId predate the distinction and stay visible.
    setMedicines(all.filter((m) => !m.elderId || m.elderId === s.deviceKey));
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

  // Paused: skip spoken reminders entirely.
  const paused = pauseUntil !== null && Date.now() < pauseUntil;

  // A pause is a deadline, not a switch — when it passes the phone wakes up on
  // its own, without a reload and without leaving a stale bar on screen.
  useEffect(() => {
    if (!pauseUntil) return;
    const remaining = pauseUntil - Date.now();
    if (remaining <= 0) {
      setPauseUntil(null);
      void setPause(null);
      return;
    }
    const timer = setTimeout(() => {
      setPauseUntil(null);
      void setPause(null);
    }, remaining);
    return () => clearTimeout(timer);
  }, [pauseUntil]);

  // Spoken reminder: speak on due entry, then re-speak every 3 min until answered.
  // Also schedules a Web Notification per due dose (fires even when the screen
  // is off or the browser is backgrounded) and holds a WakeLock while the
  // dose screen is on, so the phone does not sleep mid-reminder.
  useEffect(() => {
    if (state !== "due" || !dose || paused) return;
    const key = dose.med.id + dose.slot;
    if (spokeFor.current === key) return;
    spokeFor.current = key;
    const line = `${t(lang, "timeFor")}: ${dose.med.nickname}`;
    speak(line);
    const repeat = setInterval(() => {
      if (spokeFor.current === key) speak(line);
    }, 3 * 60_000);

    if ("Notification" in window && Notification.permission === "granted") {
      try {
        const n = new Notification(line, { tag: key, requireInteraction: true });
        n.onclick = () => window.focus();
      } catch {
        /* notification construction can throw in some webviews */
      }
    }

    let wakeLock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } };
    if (nav.wakeLock?.request) {
      nav.wakeLock.request("screen").then((wl) => (wakeLock = wl)).catch(() => {});
    }

    return () => {
      clearInterval(repeat);
      wakeLock?.release().catch(() => {});
    };
  }, [state, dose, lang, speak, paused]);

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
      navigator.vibrate?.(35); // confirmation you can feel, not only see and hear
      const logId = crypto.randomUUID();
      await logDose({
        id: logId,
        medicineId: d.med.id,
        nickname: d.med.nickname,
        slot: d.slot,
        date: today(),
        status: "taken",
        units: d.med.dosePerSlot ?? 1,
        at: Date.now(),
        synced: false,
      });
      spokeFor.current = null;
      setDeferringUntil(null);
      setJustTaken({ logId, remaining: remainingToday - 1 });
      await refresh();
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
        units: 0,
        at: Date.now(),
        synced: false,
      });
      await refresh();
    },
    []
  );

  // Voice input via Sarvam Saaras STT (through the sarvam-speech proxy):
  // press the mic, speak, press again — the transcript decides taken vs later.
  // Falls back to on-device Web Speech Recognition when the proxy is offline.
  const micRef = useRef<{ start: () => void; stop: () => void } | null>(null);

  function heard(text: string, d: Dose) {
    const t = text.toLowerCase();
    if (/খেয়েছি|খেয়ে|निगल|took|take|ले लिया/.test(t)) void take(d);
    else if (/পরে|later|बाद|defer/.test(t)) void defer(d);
  }

  function toggleMic() {
    if (!dose) return;
    if (listening) {
      micRef.current?.stop();
      return;
    }
    const md = (navigator as Navigator & { mediaDevices?: MediaDevices }).mediaDevices;
    if (!md?.getUserMedia) { legacyMic(); return; }
    setListening(true);
    let recorder: MediaRecorder;
    (async () => {
      try {
        const stream = await md.getUserMedia({ audio: true });
        recorder = new MediaRecorder(stream);
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => chunks.push(e.data);
        const stop = () => {
          if (recorder.state !== "inactive") recorder.stop();
        };
        micRef.current = { start: () => recorder.start(), stop };
        // Auto-stop after 5s: one utterance is all the decision needs.
        const autoStop = setTimeout(stop, 5000);
        recorder.onstop = async () => {
          clearTimeout(autoStop);
          stream.getTracks().forEach((t) => t.stop());
          setListening(false);
          const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
          const audioBase64 = await new Promise<string>((resolve) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).split(",")[1] || "");
            r.readAsDataURL(blob);
          });
          try {
            const { functions, ExecutionMethod } = await import("../lib/appwrite");
            const exec = await functions.createExecution({
              functionId: "sarvam-speech",
              method: ExecutionMethod.POST,
              body: JSON.stringify({ action: "stt", audioBase64, mime: blob.type, lang }),
            });
            const outer = JSON.parse(exec.responseBody || "{}");
            if (outer.transcript) heard(outer.transcript, dose);
          } catch {
            legacyMic(); // proxy offline: on-device recognition instead
          }
        };
        recorder.start();
      } catch {
        setListening(false);
        legacyMic();
      }
    })();
  }

  // On-device fallback: browser Speech Recognition, no network needed.
  function legacyMic() {
    const SR = (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;
    if (!SR || !dose) return;
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
    rec.onresult = (e) => heard(e.results[0][0].transcript, dose);
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    micRef.current = rec;
    setListening(true);
    rec.start();
  }

  async function resume() {
    await setPause(null);
    setPauseUntil(null);
  }

  async function pauseThreeDays() {
    const until = Date.now() + 3 * 86400_000;
    await setPause(until);
    setPauseUntil(until);
  }

  // Sub-screens. Each owns the whole window so the elder never has two
  // competing ideas of "where am I".
  if (addingMedicine) {
    return <AddMedicineFlow lang={lang} onDone={() => { setAddingMedicine(false); void refresh(); }} />;
  }

  if (managingContacts) {
    return <MembersScreen lang={lang} defaultRole="family" onChanged={() => { void refresh(); }} />;
  }

  // Your name: the other phones label this person's medicines with it, so the
  // family is not reading "Elder 1". One field, one save button.
  if (editingName) {
    return (
      <main className="anim-screen min-h-dvh flex flex-col px-6 py-6 max-w-md mx-auto">
        <button onClick={() => setEditingName(false)} className="self-start text-lg font-semibold text-[var(--color-accent)] py-2 px-1">
          ← {lang === "en" ? "Back" : lang === "hi" ? "वापस" : "পেছনে"}
        </button>
        <h1 className="text-3xl font-bold mt-2">{t(lang, "yourName")}</h1>
        <input
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          autoFocus
          className="mt-6 w-full text-3xl font-semibold px-5 py-5 rounded-2xl bg-[var(--color-surface)] border-2 border-[var(--color-line)]"
        />
        <button
          onClick={() => {
            const clean = nameDraft.trim();
            void setMyName(clean).then(() => {
              setMyNameState(clean);
              setEditingName(false);
              void speak(t(lang, "nameSaved"));
            });
          }}
          disabled={!nameDraft.trim()}
          className="mt-6 w-full text-2xl font-bold py-6 rounded-2xl bg-[var(--color-accent)] text-white disabled:opacity-40 active:bg-[var(--color-accent-strong)]"
        >
          {t(lang, "save")}
        </button>
      </main>
    );
  }

  // Taken confirmation — one clear outcome, and a quiet way back.
  if (justTaken !== null) {
    return (
      <main className="anim-screen min-h-dvh flex flex-col items-center justify-center bg-[var(--color-accent-soft)] px-6 text-center">
        <p className="sr-only" role="status" aria-live="polite">{t(lang, "takenDone")}</p>
        <svg className="check-pop check-draw" width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <p className="text-4xl font-bold mt-6 text-[var(--color-ink)]">{t(lang, "takenDone")}</p>
        {justTaken.remaining > 0 && (
          <p className="text-2xl mt-2 text-[var(--color-ink-secondary)]">
            {t(lang, "remainingToday", { n: localizeNumber(justTaken.remaining, lang) })}
          </p>
        )}
        <button
          onClick={() => setJustTaken(null)}
          className="mt-10 w-full text-2xl font-bold py-6 rounded-2xl bg-[var(--color-accent)] text-white active:bg-[var(--color-accent-strong)]"
        >
          {t(lang, "done")}
        </button>
        <button
          onClick={() => { void undoDose(justTaken.logId).then(() => { setJustTaken(null); void refresh(); }); }}
          className="mt-3 text-lg font-semibold text-[var(--color-ink-secondary)] py-3 px-4"
        >
          {t(lang, "undo")}
        </button>
      </main>
    );
  }

  // Setup: a short list with one obvious primary action.
  if (setupOpen) {
    return (
      <main
        className="anim-screen min-h-dvh flex flex-col px-6 py-5 max-w-md mx-auto"
        role="dialog"
        aria-modal="true"
        aria-label={t(lang, "setup")}
      >
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{t(lang, "setup")}</h1>
          <button
            onClick={() => setSetupOpen(false)}
            aria-label={t(lang, "close")}
            className="p-3 -mr-3 text-[var(--color-ink-secondary)]"
          >
            <CloseIcon />
          </button>
        </div>

        <button
          onClick={() => setAddingMedicine(true)}
          className="mt-5 w-full text-2xl font-bold py-5 rounded-2xl bg-[var(--color-accent)] text-white active:bg-[var(--color-accent-strong)]"
        >
          {t(lang, "addMedicine")}
        </button>

        <button
          onClick={() => setManagingContacts(true)}
          className="mt-3 w-full flex items-center justify-between px-5 py-5 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-line)]"
        >
          <span className="text-xl font-semibold">{t(lang, "contactsLabel")}</span>
          {contacts.length > 0 && (
            <span className="text-xl text-[var(--color-ink-secondary)]">{localizeNumber(contacts.length, lang)}</span>
          )}
        </button>

        <button
          onClick={() => {
            setNameDraft(myName);
            setEditingName(true);
          }}
          className="mt-3 w-full flex items-center justify-between px-5 py-5 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-line)]"
        >
          <span className="text-xl font-semibold">{t(lang, "yourName")}</span>
          {myName && <span className="text-xl text-[var(--color-ink-secondary)]">{myName}</span>}
        </button>

        {householdCode && (
          <div className="mt-4 px-5 py-4 rounded-2xl bg-[var(--color-surface-muted)]">
            <p className="text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-tertiary)]">
              {t(lang, "yourCode")}
            </p>
            <p className="text-3xl font-bold tracking-[0.2em] mt-1">{localizeNumber(householdCode, lang)}</p>
            <p className="text-sm text-[var(--color-ink-tertiary)] mt-1">{t(lang, "yourCodeBody")}</p>
          </div>
        )}

        <div className="mt-4 space-y-2">
          {"Notification" in window && Notification.permission === "default" && (
            <button
              onClick={() => void Notification.requestPermission()}
              className="w-full text-left text-lg font-semibold py-4 px-5 rounded-xl bg-[var(--color-surface-muted)]"
            >
              {lang === "en" ? "Turn on dose notifications" : lang === "hi" ? "डोज़ सूचना चालू करें" : "ডোজের নোটিফিকেশন চালু করুন"}
            </button>
          )}
          <button
            onClick={() => { void (paused ? resume() : pauseThreeDays()); }}
            className="w-full text-left text-lg font-semibold py-4 px-5 rounded-xl bg-[var(--color-surface-muted)]"
          >
            {paused ? t(lang, "resumeBtn") : t(lang, "pause3")}
          </button>
        </div>

        <div className="mt-5">
          <p className="text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-tertiary)]">{t(lang, "language")}</p>
          <div className="flex gap-2 mt-2">
            {LANGUAGES.map((l) => (
              <button
                key={l.id}
                onClick={() => onLangChange(l.id)}
                aria-pressed={lang === l.id}
                className={`flex-1 text-lg font-semibold py-3 rounded-xl border-2 ${
                  lang === l.id ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]" : "border-[var(--color-line)]"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={() => { void setSetting("mode", null).then(() => window.location.reload()); }}
          className="mt-auto pt-6 pb-1 self-center text-base font-semibold text-[var(--color-ink-tertiary)] underline underline-offset-4"
        >
          {t(lang, "switchFamily")}
        </button>
      </main>
    );
  }

  const firstContact = contacts[0];

  // One sentence that always describes what the phone is waiting for, so a
  // screen reader user does not have to infer it from the layout.
  const announcement = paused
    ? t(lang, "pauseTitle")
    : !dose
      ? t(lang, "allDone")
      : state === "due"
        ? `${t(lang, "timeFor")}: ${dose.med.nickname}`
        : t(lang, "nextDose", { name: dose.med.nickname, time: localizeNumber(dose.slot, lang) });

  const deferMinutes = deferringUntil ? Math.ceil((deferringUntil - Date.now()) / 60000) : 0;

  return (
    <main className="anim-screen min-h-dvh flex flex-col px-6 pt-6 pb-8 max-w-md mx-auto">
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>

      {/* Two controls only: settings, and the one person to call. */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setSetupOpen(true)}
          aria-label={t(lang, "setup")}
          className="p-3 -ml-3 text-[var(--color-ink-secondary)]"
        >
          <GearIcon />
        </button>
        {firstContact ? (
          <a
            href={`tel:${firstContact.whatsapp}`}
            className="flex items-center gap-2 px-5 py-3 rounded-full bg-[var(--color-alert-soft)] text-[var(--color-alert)] font-bold text-lg"
          >
            <PhoneIcon size={20} />
            {t(lang, "help")}
          </a>
        ) : (
          <button
            onClick={() => setManagingContacts(true)}
            className="flex items-center gap-2 px-5 py-3 rounded-full bg-[var(--color-surface-muted)] text-[var(--color-ink-secondary)] font-semibold text-base"
          >
            <PhoneIcon size={18} />
            {t(lang, "addFamily")}
          </button>
        )}
      </div>

      {paused && (
        <div className="mt-4 flex items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-[var(--color-surface-muted)]">
          <p className="text-lg font-semibold text-[var(--color-ink-secondary)] whitespace-nowrap">
            {t(lang, "pausedUntil", {
              n: localizeNumber(
                new Date(pauseUntil ?? Date.now()).toLocaleDateString(dateLocale(lang), { day: "numeric", month: "short" }),
                lang
              ),
            })}
          </p>
          <button onClick={() => void resume()} className="text-base font-bold text-[var(--color-accent)] px-2 py-1 shrink-0">
            {t(lang, "resumeBtn")}
          </button>
        </div>
      )}

      <div className="flex-1 flex flex-col justify-center py-6">
        {medicines.length === 0 ? (
          <div className="text-center">
            <p className="text-3xl font-semibold leading-snug" onClick={() => speak(t(lang, "noMedicines"))}>
              {t(lang, "noMedicines")}
            </p>
            <button
              onClick={() => setAddingMedicine(true)}
              className="mt-8 w-full text-2xl font-bold py-6 rounded-2xl bg-[var(--color-accent)] text-white active:bg-[var(--color-accent-strong)]"
            >
              {t(lang, "addMedicine")}
            </button>
          </div>
        ) : state === "alldone" || !dose ? (
          <p className="text-3xl font-semibold text-center leading-snug" onClick={() => speak(t(lang, "allDone"))}>
            {t(lang, "allDone")}
          </p>
        ) : (
          <div onClick={() => speak(`${t(lang, "timeFor")}. ${dose.med.nickname}, ${dose.med.instruction || t(lang, "withWater")}`)}>
            <p className="text-xl text-[var(--color-ink-secondary)] text-center">{t(lang, "timeFor")}</p>
            <h1 className="text-5xl font-bold text-center mt-3 leading-tight">{dose.med.nickname}</h1>
            <p className="text-4xl font-semibold text-center mt-2">{localizeNumber(dose.slot, lang)}</p>
            <p className="text-lg text-center mt-2 text-[var(--color-ink-secondary)]">
              {dose.med.instruction || t(lang, "withWater")}
            </p>
          </div>
        )}
      </div>

      {/* One dominant action. Everything else is visibly smaller. */}
      {dose && medicines.length > 0 && (
        <div className="space-y-3">
          <button
            onClick={() => void take(dose)}
            className="w-full text-3xl font-bold py-7 rounded-2xl active:brightness-90"
            style={{
              background: state === "due" ? "var(--color-accent)" : "var(--color-surface-muted)",
              color: state === "due" ? "white" : "var(--color-ink)",
            }}
          >
            {t(lang, "taken")}
          </button>

          <div className="flex items-center gap-3">
            <button
              onClick={() => void defer(dose)}
              className="flex-1 text-xl font-bold py-4 rounded-xl active:brightness-90"
              style={{ background: "var(--color-defer)", color: "var(--color-defer-strong)" }}
            >
              {state === "deferring" && deferMinutes > 0
                ? `${localizeNumber(deferMinutes, lang)} ${lang === "en" ? "min" : lang === "hi" ? "मिनट" : "মিনিট"}`
                : t(lang, "remindLater")}
            </button>
            <button
              onClick={toggleMic}
              aria-pressed={listening}
              aria-label={t(lang, "voiceInput")}
              className={`w-14 h-14 shrink-0 flex items-center justify-center rounded-xl ${
                listening ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]" : "bg-[var(--color-surface-muted)] text-[var(--color-ink-tertiary)]"
              }`}
            >
              <MicIcon />
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
