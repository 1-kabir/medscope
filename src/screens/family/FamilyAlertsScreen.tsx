import { useEffect, useState } from "react";
import { listContacts, saveContact, type Contact } from "../../db";
import { t, type Lang } from "../../i18n";
import { useSpeaker, SpeakerIcon } from "../../speech";

export default function FamilyAlertsScreen({ lang, onBack }: { lang: Lang; onBack: () => void }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [alertsOn, setAlertsOn] = useState(true);
  const speak = useSpeaker(lang);

  useEffect(() => {
    void listContacts().then(setContacts);
  }, []);

  async function add() {
    if (!name.trim() || !whatsapp.trim()) return;
    const c: Contact = { id: crypto.randomUUID(), name: name.trim(), relation: relation.trim(), whatsapp: whatsapp.trim(), synced: false };
    await saveContact(c);
    setContacts(await listContacts());
    setName("");
    setRelation("");
    setWhatsapp("");
    setAdding(false);
  }

  return (
    <div className="min-h-dvh px-6 py-8 max-w-md mx-auto pb-10">
      <button onClick={onBack} className="self-start text-lg font-semibold text-[var(--color-accent)] py-2 px-1">
        ← {lang === "en" ? "Back" : lang === "hi" ? "वापस" : "পেছনে"}
      </button>
      <h1 className="text-3xl font-bold mt-4">{t(lang, "family")}</h1>

      <div className="mt-6 space-y-3">
        {contacts.map((c) => (
          <div key={c.id} className="flex items-center justify-between px-5 py-4 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-line)]">
            <div>
              <p className="text-xl font-semibold">{c.name}</p>
              <p className="text-base text-[var(--color-ink-secondary)]">{c.relation}</p>
            </div>
            <p className="text-lg">{c.whatsapp}</p>
          </div>
        ))}
        {!adding && (
          <button onClick={() => setAdding(true)} className="w-full text-lg font-bold py-4 rounded-2xl border-2 border-dashed border-[var(--color-line)] text-[var(--color-accent)]">
            {t(lang, "addFamily")}
          </button>
        )}
      </div>

      {adding && (
        <div className="mt-4 space-y-4">
          {[
            { label: t(lang, "name"), value: name, set: setName, type: "text" },
            { label: t(lang, "relation"), value: relation, set: setRelation, type: "text" },
            { label: t(lang, "whatsapp"), value: whatsapp, set: setWhatsapp, type: "tel" },
          ].map((f) => (
            <label key={f.label} className="block">
              <span className="text-base font-semibold text-[var(--color-ink-secondary)]">{f.label}</span>
              <input
                type={f.type}
                value={f.value}
                onChange={(e) => f.set(e.target.value)}
                className="mt-1 w-full text-xl px-4 py-4 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)]"
              />
            </label>
          ))}
          <div className="flex gap-3">
            <button onClick={() => void add()} className="flex-1 text-lg font-bold py-4 rounded-2xl bg-[var(--color-accent)] text-white">
              {t(lang, "save")}
            </button>
            <button onClick={() => setAdding(false)} className="flex-1 text-lg font-bold py-4 rounded-2xl bg-[var(--color-surface-muted)]">
              {t(lang, "cancel")}
            </button>
          </div>
        </div>
      )}

      <div className="mt-8 p-5 rounded-2xl bg-[var(--color-surface-muted)]">
        <p className="text-lg leading-relaxed">{t(lang, "escalation")}</p>
        <div className="flex justify-end">
          <button aria-label="Hear this" onClick={() => speak(t(lang, "escalation"))} className="p-2 text-[var(--color-ink-secondary)]">
            <SpeakerIcon />
          </button>
        </div>
        <label className="mt-3 flex items-center justify-between">
          <span className="text-lg font-semibold">{lang === "en" ? "Alerts on" : lang === "hi" ? "सूचना चालू" : "সতর্কতা চালু"}</span>
          <input type="checkbox" checked={alertsOn} onChange={(e) => setAlertsOn(e.target.checked)} className="w-6 h-6 accent-[var(--color-accent)]" />
        </label>
      </div>
    </div>
  );
}
