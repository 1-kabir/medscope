import { useEffect, useState } from "react";
import { LANGUAGES, t, type Lang } from "../../i18n";
import { setSetting, applyBackup, getMyName, setMyName } from "../../db";
import {
  getAccountInfo,
  emailAuth,
  phoneAuth,
  signOut,
  saveBackup,
  listBackups,
  restoreBackup,
  type AccountInfo,
} from "../../lib/auth";

type Mode = "closed" | "phone" | "email";

// A tab, not a pushed screen: the navbar is the way back, so no Back arrow.
export default function SettingsScreen({
  lang,
  onLangChange,
}: {
  lang: Lang;
  onLangChange: (l: Lang) => void;
}) {
  const [authMode, setAuthMode] = useState<Mode>("closed");
  const [acct, setAcct] = useState<AccountInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // phone flow (number + password — this server cannot send SMS)
  const [phone, setPhone] = useState("");
  const [phonePassword, setPhonePassword] = useState("");
  // email flow
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // backups
  const [backups, setBackups] = useState<{ id: string; savedAt: number; medicines: number }[]>([]);
  const [restored, setRestored] = useState("");
  const [myName, setMyNameDraft] = useState("");
  const [nameSaved, setNameSaved] = useState(false);

  const L = (en: string, hi: string, bn: string) => (lang === "en" ? en : lang === "hi" ? hi : bn);

  async function refreshAuth() {
    const info = await getAccountInfo();
    setAcct(info);
    if (info) setBackups(await listBackups());
  }

  useEffect(() => {
    void refreshAuth();
    void getMyName().then(setMyNameDraft);
  }, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr("");
    try {
      await fn();
      await refreshAuth();
      setAuthMode("closed");
    } catch (e) {
      setErr(String((e as { message?: string }).message || e).slice(0, 140));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="anim-screen min-h-dvh px-6 pt-8 pb-6 max-w-md mx-auto">
      <h1 className="text-3xl font-bold">{t(lang, "settings")}</h1>

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
        <p className="text-base font-semibold text-[var(--color-ink-secondary)] mb-1">{t(lang, "yourName")}</p>
        <p className="text-sm text-[var(--color-ink-tertiary)] mb-3">
          {L(
            "Shown on the other phones in this household.",
            "इस परिवार के दूसरे फ़ोन पर दिखता है।",
            "পরিবারের অন্য ফোনে দেখা যায়।"
          )}
        </p>
        <div className="flex gap-3">
          <input
            value={myName}
            onChange={(e) => {
              setMyNameDraft(e.target.value);
              setNameSaved(false);
            }}
            placeholder={L("e.g. Kabir", "जैसे: कबीर", "যেমন: কবির")}
            className="flex-1 min-w-0 text-xl px-4 py-4 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)]"
          />
          <button
            onClick={() => {
              void setMyName(myName).then(() => setNameSaved(true));
            }}
            disabled={!myName.trim()}
            className="shrink-0 text-lg font-bold px-5 rounded-xl bg-[var(--color-accent)] text-white disabled:opacity-40"
          >
            {t(lang, "save")}
          </button>
        </div>
        {nameSaved && <p className="mt-2 text-base font-semibold text-[var(--color-accent)]">{t(lang, "nameSaved")}</p>}
      </section>

      {/* Backup & restore — optional, never shown during onboarding */}
      <section className="mt-8">
        <p className="text-base font-semibold text-[var(--color-ink-secondary)] mb-1">{L("Backup & restore", "बैकअप और रीस्टोर", "ব্যাকআপ ও রিস্টোর")}</p>
        <p className="text-sm text-[var(--color-ink-tertiary)] mb-3">
          {L("Optional. Sign in to move this device's data to another phone.", "वैकल्पिक। दूसरे फ़ोन पर डेटा ले जाने के लिए साइन इन करें।", "ঐচ্ছিক। অন্য ফোনে ডেটা নিতে সাইন ইন করুন।")}
        </p>

        {!acct ? (
          authMode === "closed" ? (
            <div className="space-y-3">
              <button onClick={() => setAuthMode("phone")} className="w-full text-lg font-bold py-4 rounded-2xl bg-[var(--color-accent)] text-white">
                {L("Sign in with phone", "फ़ोन से साइन इन", "ফোন দিয়ে সাইন ইন")}
              </button>
              <button onClick={() => setAuthMode("email")} className="w-full text-lg font-bold py-4 rounded-2xl border-2 border-[var(--color-line)]">
                Email
              </button>
            </div>
          ) : authMode === "phone" ? (
            <div className="space-y-3">
              <input
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91…"
                className="w-full text-xl px-4 py-4 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)]"
              />
              <input
                type="password"
                value={phonePassword}
                onChange={(e) => setPhonePassword(e.target.value)}
                placeholder={L("password (8+ characters)", "पासवर्ड (8+ अक्षर)", "পাসওয়ার্ড (৮+ অক্ষর)")}
                className="w-full text-xl px-4 py-4 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)]"
              />
              <p className="text-sm text-[var(--color-ink-tertiary)]">
                {L(
                  "No SMS code is needed. Use the same number and password on your other phone.",
                  "कोई एसएमएस कोड नहीं चाहिए। दूसरे फ़ोन पर यही नंबर और पासवर्ड डालें।",
                  "কোনো এসএমএস কোড লাগবে না। অন্য ফোনে একই নম্বর ও পাসওয়ার্ড দিন।"
                )}
              </p>
              <button
                onClick={() => void run(() => phoneAuth(phone, phonePassword))}
                disabled={!phone.trim() || phonePassword.length < 8 || busy}
                className="w-full text-lg font-bold py-4 rounded-2xl bg-[var(--color-accent)] text-white disabled:opacity-40"
              >
                {L("Sign in / Sign up", "साइन इन / साइन अप", "সাইন ইন / সাইন আপ")}
              </button>
              <button onClick={() => setAuthMode("closed")} className="w-full text-base py-2 text-[var(--color-ink-secondary)]">
                {t(lang, "cancel")}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email"
                className="w-full text-xl px-4 py-4 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)]"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={L("password", "पासवर्ड", "পাসওয়ার্ড")}
                className="w-full text-xl px-4 py-4 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)]"
              />
              <button
                onClick={() => void run(() => emailAuth(email, password))}
                disabled={!email.trim() || password.length < 8 || busy}
                className="w-full text-lg font-bold py-4 rounded-2xl bg-[var(--color-accent)] text-white disabled:opacity-40"
              >
                {L("Sign in / Sign up", "साइन इन / साइन अप", "সাইন ইন / সাইন আপ")}
              </button>
            </div>
          )
        ) : (
          <div className="space-y-4">
            <p className="text-lg font-semibold">✓ {acct.label}</p>

            <button
              onClick={() => void run(() => saveBackup())}
              disabled={busy}
              className="w-full text-lg font-bold py-4 rounded-2xl bg-[var(--color-accent)] text-white disabled:opacity-40"
            >
              {L("Save backup of this phone", "इस फ़ोन का बैकअप सेव करें", "এই ফোনের ব্যাকআপ সেভ করুন")}
            </button>

            {backups.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-[var(--color-ink-secondary)]">{L("Restore a backup", "बैकअप रीस्टोर करें", "ব্যাকআপ রিস্টোর করুন")}</p>
                {backups.map((b) => (
                  <button
                    key={b.id}
                    onClick={() =>
                      void run(async () => {
                        const r = await restoreBackup(b.id, applyBackup);
                        setRestored(`${r.medicines} ${L("medicines", "दवाएँ", "ওষুধ")}`);
                        setTimeout(() => window.location.reload(), 1500);
                      })
                    }
                    className="w-full flex items-center justify-between px-5 py-4 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-line)] text-left"
                  >
                    <span className="text-base">{new Date(b.savedAt).toLocaleString()}</span>
                    <span className="text-base text-[var(--color-ink-secondary)]">{b.medicines} ⤵</span>
                  </button>
                ))}
                {restored && <p className="text-base font-semibold text-[var(--color-accent)]">{restored} — {L("reloading…", "रीलोड हो रहा है…", "রিলোড হচ্ছে…")}</p>}
              </div>
            )}

            <button
              onClick={() => void run(() => signOut())}
              className="w-full text-base font-semibold py-3 rounded-2xl bg-[var(--color-surface-muted)] text-[var(--color-ink-secondary)]"
            >
              {L("Sign out", "साइन आउट", "সাইন আউট")}
            </button>
          </div>
        )}

        {err && <p className="mt-3 text-base font-semibold text-[var(--color-alert)]">{err}</p>}
      </section>

      <section className="mt-10">
        <p className="text-base font-semibold text-[var(--color-ink-secondary)] mb-3">{t(lang, "phoneFor")}</p>
        <button
          onClick={() => {
            void setSetting("mode", null).then(() => window.location.reload());
          }}
          className="w-full text-lg font-semibold text-[var(--color-accent)] py-4 px-4 rounded-xl bg-[var(--color-surface-muted)]"
        >
          {t(lang, "whoUsesPhone")}
        </button>
      </section>

      <section className="mt-10">
        <p className="text-base font-semibold text-[var(--color-ink-secondary)] mb-2">{t(lang, "about")}</p>
        <p className="text-lg leading-relaxed">{t(lang, "aboutBody")}</p>
        <p className="text-sm text-[var(--color-ink-tertiary)] mt-3">{t(lang, "remindersOnly")}</p>
      </section>
    </div>
  );
}
