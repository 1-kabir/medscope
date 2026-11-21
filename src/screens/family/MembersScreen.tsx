import { useEffect, useState } from "react";
import { listMembers, saveMember, deleteMember, formatPhone, normalizePhone, pullHousehold, type Member } from "../../db";
import { t, localizeNumber, type Lang } from "../../i18n";
import { useSpeaker, SpeakerIcon } from "../../speech";

// One screen for every person in the household, in both modes. Elders are the
// people who take medicines; family members are the people who get called.
// Family members are the emergency contacts — there is no separate list.
export default function MembersScreen({
  lang,
  defaultRole = "family",
  onChanged,
}: {
  lang: Lang;
  defaultRole?: Member["role"];
  onChanged?: () => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [adding, setAdding] = useState(false);
  const [role, setRole] = useState<Member["role"]>(defaultRole);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [err, setErr] = useState("");
  const speak = useSpeaker(lang);

  async function refresh() {
    await pullHousehold();
    setMembers(await listMembers());
  }

  useEffect(() => {
    void refresh();
  }, []);

  const elders = members.filter((m) => m.role === "elder");
  const family = members.filter((m) => m.role === "family");

  async function add() {
    if (!name.trim()) return;
    if (role === "family" && normalizePhone(phone).length < 11) {
      setErr(lang === "en" ? "Enter a full phone number" : lang === "hi" ? "पूरा फ़ोन नंबर डालें" : "সম্পূর্ণ ফোন নম্বর দিন");
      return;
    }
    await saveMember({
      id: crypto.randomUUID(),
      householdId: "",
      role,
      name: name.trim(),
      phone: role === "family" ? normalizePhone(phone) : "",
      deviceKey: "",
      pauseUntil: 0,
      synced: false,
    });
    await refresh();
    setName("");
    setPhone("");
    setAdding(false);
    setErr("");
    onChanged?.();
  }

  const RoleChip = ({ r, label }: { r: Member["role"]; label: string }) => (
    <button
      onClick={() => setRole(r)}
      aria-pressed={role === r}
      className={`flex-1 text-lg font-semibold py-4 rounded-xl border-2 ${role === r ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]" : "border-[var(--color-line)] bg-[var(--color-surface)]"}`}
    >
      {label}
    </button>
  );

  const MemberRow = ({ m, call }: { m: Member; call: boolean }) => {
    const body = (
      <>
        <div className="min-w-0">
          <p className="text-xl font-semibold truncate">{m.name || (m.role === "elder" ? t(lang, "elder") : "—")}</p>
          {call && m.phone && <p className="text-base text-[var(--color-ink-secondary)]">{formatPhone(m.phone)}</p>}
          {call && !m.phone && (
            <p className="text-base text-[var(--color-alert)]">{lang === "en" ? "No number yet" : lang === "hi" ? "अभी कोई नंबर नहीं" : "এখনো নম্বর নেই"}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {call && m.phone && (
            <a href={`tel:${m.phone}`} className="text-lg font-bold text-[var(--color-accent)] px-3 py-2" aria-label={`${t(lang, "callFamily")} ${m.name}`}>
              📞
            </a>
          )}
          <button
            aria-label={t(lang, "remove")}
            onClick={(e) => {
              e.stopPropagation();
              void deleteMember(m.id).then(() => { void refresh(); onChanged?.(); });
            }}
            className="text-base text-[var(--color-ink-tertiary)] px-2 py-1"
          >
            ✕
          </button>
        </div>
      </>
    );
    return call ? (
      <div className="flex items-center justify-between px-5 py-4 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-line)]">{body}</div>
    ) : (
      <div className="flex items-center justify-between px-5 py-4 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-line)]">{body}</div>
    );
  };

  return (
    <div className="anim-screen min-h-dvh px-6 pt-8 pb-10 max-w-md mx-auto">
      <h1 className="text-3xl font-bold">{t(lang, "family")}</h1>
      <p className="text-sm text-[var(--color-ink-tertiary)] mt-2">{t(lang, "remindersOnly")}</p>

      <div className="mt-6 space-y-3">
        <p className="text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-tertiary)]">{t(lang, "elder")}</p>
        {elders.length === 0 && <p className="text-base text-[var(--color-ink-tertiary)]">—</p>}
        {elders.map((m) => (
          <MemberRow key={m.id} m={m} call={false} />
        ))}

        <p className="text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-tertiary)] pt-3">{t(lang, "family")}</p>
        {family.length === 0 && (
          <p className="text-base text-[var(--color-ink-tertiary)]">
            {lang === "en" ? "No one to alert yet." : lang === "hi" ? "अभी कोई सूचित करने वाला नहीं।" : "এখনো কেউ জানানোর জন্য নেই।"}
          </p>
        )}
        {family.map((m) => (
          <MemberRow key={m.id} m={m} call />
        ))}
      </div>

      {!adding ? (
        <button onClick={() => setAdding(true)} className="mt-5 w-full text-lg font-bold py-4 rounded-2xl border-2 border-dashed border-[var(--color-line)] text-[var(--color-accent)]">
          {t(lang, "addFamily")}
        </button>
      ) : (
        <div className="mt-5 space-y-4">
          <div className="flex gap-3">
            <RoleChip r="family" label={t(lang, "family")} />
            <RoleChip r="elder" label={t(lang, "elder")} />
          </div>
          <label className="block">
            <span className="text-base font-semibold text-[var(--color-ink-secondary)]">{t(lang, "name")}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full text-xl px-4 py-4 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)]" />
          </label>
          {role === "family" && (
            <label className="block">
              <span className="text-base font-semibold text-[var(--color-ink-secondary)]">{t(lang, "whatsapp")}</span>
              <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1 w-full text-xl px-4 py-4 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)]" />
            </label>
          )}
          {err && <p className="text-base font-semibold text-[var(--color-alert)]" role="status">{err}</p>}
          <div className="flex gap-3">
            <button
              onClick={() => void add()}
              disabled={!name.trim() || busyGuard(role, phone)}
              className="flex-1 text-lg font-bold py-4 rounded-2xl bg-[var(--color-accent)] text-white disabled:opacity-40"
            >
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
      </div>
    </div>
  );
}

function busyGuard(role: Member["role"], phone: string): boolean {
  return role === "family" && normalizePhone(phone).length < 11;
}

export function memberCountLabel(lang: Lang, n: number): string {
  return localizeNumber(n, lang);
}
