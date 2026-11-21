import { useEffect, useState } from "react";
import { listContacts, saveContact, type Contact } from "../db";
import { t, type Lang } from "../i18n";
import { useSpeaker, SpeakerIcon } from "../speech";

// Elder-side emergency contacts. Big inputs, big call buttons, no relation
// jargon the elder doesn't need. Help button calls the first contact.
export default function ElderContactsScreen({ lang, onBack }: { lang: Lang; onBack: () => void }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const speak = useSpeaker(lang);

  useEffect(() => {
    void listContacts().then(setContacts);
  }, []);

  async function add() {
    if (!name.trim() || !whatsapp.trim()) return;
    const c: Contact = { id: crypto.randomUUID(), name: name.trim(), relation: "", whatsapp: whatsapp.trim(), synced: false };
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
        {contacts.map((c) => (
          <a
            key={c.id}
            href={`tel:${c.whatsapp}`}
            className="flex items-center justify-between px-5 py-5 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-line)]"
          >
            <p className="text-2xl font-semibold">{c.name}</p>
            <span className="text-xl font-bold text-[var(--color-accent)]">📞</span>
          </a>
        ))}
      </div>

      <div className="mt-8 space-y-4">
        <label className="block">
          <span className="text-base font-semibold text-[var(--color-ink-secondary)]">{t(lang, "name")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full text-2xl px-4 py-5 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)]" />
        </label>
        <label className="block">
          <span className="text-base font-semibold text-[var(--color-ink-secondary)]">{t(lang, "phoneLabel")}</span>
          <input type="tel" inputMode="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className="mt-1 w-full text-2xl px-4 py-5 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)]" />
        </label>
        <div className="flex gap-3">
          <button onClick={() => void add()} disabled={!name.trim() || !whatsapp.trim()} className="flex-1 text-xl font-bold py-5 rounded-2xl bg-[var(--color-accent)] text-white disabled:opacity-40">
            {t(lang, "save")}
          </button>
          <button aria-label="Hear this button" onClick={() => speak(t(lang, "save"))} className="px-6 rounded-2xl bg-[var(--color-surface-muted)] text-[var(--color-ink-secondary)]">
            <SpeakerIcon size={24} />
          </button>
        </div>
      </div>
    </main>
  );
}
