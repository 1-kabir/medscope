import { useEffect, useState } from "react";
import { listContacts, saveContact, pullHousehold, formatPhone, normalizePhone, type Contact } from "../db";
import { t, type Lang } from "../i18n";

// Elder-side emergency contacts. Big inputs, big call buttons, no relation
// jargon the elder doesn't need. Help button calls the first contact.
export default function ElderContactsScreen({ lang, onBack }: { lang: Lang; onBack: () => void }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");

  // The roster is shared with the family phones: pull, then show. Nothing to
  // pull for an elder with no household — their own list is the roster.
  useEffect(() => {
    void pullHousehold()
      .then(() => listContacts())
      .then(setContacts)
      .catch(() => void listContacts().then(setContacts));
  }, []);

  async function add() {
    // Saved with its country code, so the call button and the family alerts use
    // the same number without guessing later.
    if (!name.trim() || normalizePhone(whatsapp).length < 11) return;
    const c: Contact = { id: crypto.randomUUID(), name: name.trim(), relation: "", whatsapp: normalizePhone(whatsapp), synced: false };
    await saveContact(c);
    setContacts(await listContacts());
    setName("");
    setWhatsapp("");
  }

  return (
    <main className="anim-screen min-h-dvh flex flex-col px-6 py-8 max-w-md mx-auto">
      <button onClick={onBack} className="self-start text-lg font-semibold text-[var(--color-accent)] py-2 px-1">
        ← {lang === "en" ? "Back" : lang === "hi" ? "वापस" : "পেছনে"}
      </button>
      <h1 className="text-3xl font-bold mt-2">{t(lang, "help")}</h1>
      <p className="text-lg text-[var(--color-ink-secondary)] mt-2">{t(lang, "elderContactsBody")}</p>

      <div className="mt-6 space-y-3">
        {contacts.length === 0 && (
          <p className="text-lg text-[var(--color-ink-secondary)] py-2">{t(lang, "addFamily")}</p>
        )}
        {contacts.map((c) => (
          <a
            key={c.id}
            href={`tel:${c.whatsapp}`}
            className="flex items-center justify-between px-5 py-5 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-line)]"
          >
            <p className="text-2xl font-semibold">{c.name}</p>
            <p className="text-base text-[var(--color-ink-secondary)]">{formatPhone(c.whatsapp)}</p>
            <span className="text-[var(--color-accent)]">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
            </span>
          </a>
        ))}
      </div>

      <div className="mt-8 space-y-3">
        <label className="block">
          <span className="text-base font-semibold text-[var(--color-ink-secondary)]">{t(lang, "name")}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full text-2xl px-4 py-4 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)]"
          />
        </label>
        <label className="block">
          <span className="text-base font-semibold text-[var(--color-ink-secondary)]">{t(lang, "phoneLabel")}</span>
          <input
            type="tel"
            inputMode="tel"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            className="mt-1 w-full text-2xl px-4 py-4 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)]"
          />
        </label>
        <button
          onClick={() => void add()}
          disabled={!name.trim() || !whatsapp.trim()}
          className="w-full text-xl font-bold py-5 rounded-2xl bg-[var(--color-accent)] text-white disabled:opacity-40"
        >
          {t(lang, "save")}
        </button>
      </div>
    </main>
  );
}
