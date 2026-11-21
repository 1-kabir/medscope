import { useEffect, useState } from "react";
import {
  getSettings,
  setSetting,
  createHousehold,
  registerDevice,
  joinHousehold,
  pullHousehold,
  listMembers,
  setMyMemberId,
  unclaimedElders,
  type Member,
} from "./db";
import { t, type Lang } from "./i18n";
import LanguageScreen from "./screens/LanguageScreen";
import ModeScreen from "./screens/ModeScreen";
import ElderDoseScreen from "./screens/ElderDoseScreen";
import FamilyApp from "./screens/family/FamilyApp";
import LinkScreen from "./screens/family/LinkScreen";

type View = "language" | "mode" | "link" | "elder-join" | "elder" | "family";

// Elder-side join: enter the family code, then claim one of the unclaimed
// elder members the family phone added (e.g. "Dad"). This is how a second —
// or first — elder joins an existing family instead of making a new household.
function ElderJoinScreen({ lang, onJoined }: { lang: Lang; onJoined: () => void }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<Member[] | null>(null);

  const L = (en: string, hi: string, bn: string) => (lang === "en" ? en : lang === "hi" ? hi : bn);

  async function check() {
    setBusy(true);
    setErr("");
    const ok = await joinHousehold(code);
    if (!ok) {
      setErr(t(lang, "invalidCode"));
      setBusy(false);
      return;
    }
    await pullHousehold();
    const unclaimed = await (async () => {
      const members = await listMembers();
      const mine = members.filter((m) => m.role === "elder" && (!m.deviceKey || m.deviceKey === ""));
      // fall back to locally-known unclaimed elders
      return mine.length ? mine : await unclaimedElders(code);
    })();
    if (unclaimed.length === 0) {
      // Household exists but no elder member listed yet — create one for this phone.
      await claim({ id: crypto.randomUUID(), householdId: code, role: "elder", name: "", phone: "", deviceKey: "", pauseUntil: 0, synced: false });
      return;
    }
    if (unclaimed.length === 1) {
      await claim(unclaimed[0]);
      return;
    }
    setCandidates(unclaimed);
    setBusy(false);
  }

  async function claim(member: Member) {
    await setMyMemberId(member.id);
    await registerDevice("elder");
    if (member.name) await setSetting("deviceName", member.name);
    onJoined();
  }

  async function createOwnFamily() {
    await createHousehold();
    // A brand-new household has no member rows yet — this phone's elder is the first.
    await claim({ id: crypto.randomUUID(), householdId: code || "new", role: "elder", name: "", phone: "", deviceKey: "", pauseUntil: 0, synced: false });
  }

  return (
    <main className="anim-screen min-h-dvh flex flex-col px-6 py-10 max-w-md mx-auto">
      <h1 className="text-3xl font-bold">{t(lang, "joinHousehold")}</h1>
      <p className="text-lg text-[var(--color-ink-secondary)] mt-3 leading-relaxed">{t(lang, "linkBody")}</p>

      {!candidates ? (
        <>
          <input
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
              setErr("");
            }}
            inputMode="numeric"
            aria-label={t(lang, "enterCode")}
            className="mt-8 w-full text-3xl tracking-[0.3em] text-center px-4 py-5 rounded-2xl bg-[var(--color-surface)] border-2 border-[var(--color-line)]"
          />
          {err && <p className="mt-3 text-lg font-semibold text-[var(--color-alert)]" role="status">{err}</p>}
          <button
            onClick={() => void check()}
            disabled={code.length !== 6 || busy}
            className="mt-6 w-full text-xl font-bold py-5 rounded-2xl bg-[var(--color-accent)] text-white disabled:opacity-40 active:bg-[var(--color-accent-strong)]"
          >
            {t(lang, "linkBtn")}
          </button>
          <div className="my-6 border-t border-[var(--color-line)]" />
          <p className="text-lg font-semibold">{t(lang, "createHousehold")}</p>
          <p className="text-base text-[var(--color-ink-secondary)] mt-1">{t(lang, "createHouseholdBody")}</p>
          <button
            onClick={() => void createOwnFamily()}
            disabled={busy}
            className="mt-4 w-full text-xl font-bold py-5 rounded-2xl border-2 border-[var(--color-line)] bg-[var(--color-surface)] active:bg-[var(--color-surface-muted)]"
          >
            {t(lang, "createHouseholdBtn")}
          </button>
        </>
      ) : (
        <div className="mt-8 space-y-3">
          <p className="text-xl font-semibold">{t(lang, "whoTakes")}</p>
          {candidates.map((m) => (
            <button
              key={m.id}
              onClick={() => void claim(m)}
              className="w-full text-2xl font-semibold px-5 py-6 rounded-2xl border-2 border-[var(--color-line)] bg-[var(--color-surface)] active:bg-[var(--color-surface-muted)]"
            >
              {m.name || L("Unnamed elder", "बेनाम बुज़ुर्ग", "বেনাম বয়স্ক")}
            </button>
          ))}
        </div>
      )}
    </main>
  );
}

export default function App() {
  const [view, setView] = useState<View>("language");
  const [lang, setLang] = useState<Lang>("bn");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void getSettings().then((s) => {
      setLang(s.lang);
      // Returning device: straight into its mode. Unlinked family: link first.
      if (s.mode === "family" && !s.householdId) setView("link");
      else setView(s.mode ?? "language");
      setReady(true);
    });
  }, []);

  if (!ready) return null;

  if (view === "language") {
    return (
      <LanguageScreen
        lang={lang}
        onSelect={(l) => {
          setLang(l);
          void setSetting("lang", l);
        }}
        onContinue={() => setView("mode")}
      />
    );
  }

  if (view === "mode") {
    return (
      <ModeScreen
        lang={lang}
        onSelect={async (mode) => {
          void setSetting("mode", mode);
          const s = await getSettings();
          if (!s.householdId) {
            // Elder devices create their own household — or join one by code.
            if (mode === "elder") {
              setView("elder-join");
              return;
            }
            setView("link");
            return;
          }
          setView(mode);
        }}
      />
    );
  }

  if (view === "link") {
    return (
      <LinkScreen
        lang={lang}
        onLinked={() => {
          void setSetting("mode", "family");
          void registerDevice("family");
          setView("family");
        }}
      />
    );
  }

  if (view === "elder-join") {
    return (
      <ElderJoinScreen
        lang={lang}
        onJoined={() => setView("elder")}
      />
    );
  }

  if (view === "elder") return <ElderDoseScreen lang={lang} onLangChange={(l) => { setLang(l); void setSetting("lang", l); }} />;

  return <FamilyApp lang={lang} onLangChange={(l) => { setLang(l); void setSetting("lang", l); }} />;
}

// Keep the localizeNumber import used: the join screen shows codes in Bengali digits.