import { useEffect, useState } from "react";
import { listMedicines, logsByDate, pullHousehold, listDevices, setDeviceName, type Medicine, type DoseLog, type DeviceInfo } from "../../db";
import { t, localizeNumber, type Lang } from "../../i18n";
import { useSpeaker, SpeakerIcon } from "../../speech";
import AddMedicineFlow from "./AddMedicineFlow";
import MedicineDetail from "./MedicineDetail";

function daysUntilEmpty(m: Medicine): number | null {
  const dailyUnits = m.times.length * (m.dosePerSlot ?? 1);
  if (dailyUnits <= 0) return null;
  return Math.floor(m.tabletsLeft / dailyUnits);
}

export default function MedicineListScreen({
  lang,
  onOpenHistory,
}: {
  lang: Lang;
  onOpenHistory: () => void;
}) {
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [missed, setMissed] = useState<DoseLog[]>([]);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [adding, setAdding] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const speak = useSpeaker(lang);

  useEffect(() => {
    void (async () => {
      await pullHousehold();
      setMedicines(await listMedicines());
      setDevices(await listDevices());
      const key = new Date().toISOString().slice(0, 10);
      setMissed((await logsByDate(key)).filter((x) => x.status === "missed"));
    })();
  }, [adding, detailId]);

  // Group medicines per elder, in stable order of first appearance
  const groups: { elderId: string; name: string; meds: Medicine[] }[] = [];
  for (const m of medicines) {
    const elderId = m.elderId ?? "unknown";
    let g = groups.find((x) => x.elderId === elderId);
    if (!g) {
      const dev = devices.find((d) => d.id === elderId);
      const idx = groups.length + 1;
      const fallback = `${lang === "en" ? "Elder" : lang === "hi" ? "बुज़ुर्ग" : "বয়স্ক"} ${idx}`;
      g = { elderId, name: dev?.name || fallback, meds: [] };
      groups.push(g);
    }
    g.meds.push(m);
  }

  if (adding) return <AddMedicineFlow lang={lang} onDone={() => setAdding(false)} />;
  if (detailId) return <MedicineDetail lang={lang} id={detailId} onBack={() => setDetailId(null)} />;

  return (
    <div className="pb-28">
      {/* History is a tab; a second History button here only added noise. */}
      <header className="px-6 pt-8 pb-4">
        <h1 className="text-3xl font-bold">{t(lang, "medicines")}</h1>
      </header>

      {missed.length > 0 && (
        <button
          onClick={onOpenHistory}
          className="mx-6 mb-4 flex items-center gap-3 px-5 py-4 rounded-2xl bg-[var(--color-alert-soft)] text-[var(--color-alert)] font-semibold text-lg"
        >
          <span className="w-3 h-3 rounded-full bg-[var(--color-alert)]" aria-hidden="true" />
          {t(lang, "missedToday", { n: localizeNumber(missed.length, lang) })}
        </button>
      )}

      <div className="px-6 divide-y divide-[var(--color-line)]">
        {medicines.length === 0 && (
          <p className="text-xl text-[var(--color-ink-secondary)] py-8">{t(lang, "welcomeBody")}</p>
        )}
        {groups.map((g) => (
          <section key={g.elderId} className="py-2">
            <div className="flex items-center justify-between pt-3 pb-1">
              <h2 className="text-base font-bold uppercase tracking-wide text-[var(--color-ink-tertiary)]">{g.name}</h2>
              <button
                onClick={() => {
                  const name = window.prompt(lang === "en" ? "Name this elder" : lang === "hi" ? "बुज़ुर्ग का नाम" : "বয়স্কের নাম", g.name);
                  if (name && name.trim()) {
                    void setDeviceName(g.elderId, name.trim()).then(() => setDevices([...devices, { id: g.elderId, householdId: "", role: "elder", name: name.trim() }]));
                  }
                }}
                className="text-[var(--color-accent)] px-2 py-2 -mr-1"
                aria-label={t(lang, "rename")}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
                </svg>
              </button>
            </div>
            {g.meds.map((m) => {
              const days = daysUntilEmpty(m);
              const low = days !== null && days <= 3;
              return (
                <button
                  key={m.id}
                  onClick={() => setDetailId(m.id)}
                  className="w-full text-left py-4 flex items-start justify-between gap-4 border-t border-[var(--color-line)]"
                >
                  <div>
                    <p className="text-2xl font-semibold">{m.nickname}</p>
                    <p className="text-base text-[var(--color-ink-secondary)]">{m.name}</p>
                    <p className="text-lg mt-1 text-[var(--color-ink-secondary)]">
                      {m.times.map((s) => localizeNumber(s, lang)).join(" · ")}
                    </p>
                    <p className={`text-base mt-1 font-medium ${low ? "text-[var(--color-alert)]" : "text-[var(--color-ink-secondary)]"}`}>
                      {m.tabletsLeft <= 0
                        ? t(lang, "outOfStock")
                        : days !== null
                          ? t(lang, "daysLeft", { n: localizeNumber(days, lang) })
                          : ""}
                      {low && (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="inline-block ml-1 -mt-0.5">
                          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                          <line x1="12" y1="9" x2="12" y2="13" />
                          <line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                      )}
                    </p>
                  </div>
                  <span className="text-[var(--color-ink-tertiary)] pt-2" aria-hidden="true">›</span>
                </button>
              );
            })}
          </section>
        ))}
      </div>

      <div className="fixed bottom-24 inset-x-0 px-6 max-w-md mx-auto">
        <div className="flex gap-3">
          <button
            onClick={() => setAdding(true)}
            className="flex-1 text-xl font-bold py-5 rounded-2xl bg-[var(--color-accent)] text-white active:bg-[var(--color-accent-strong)]"
          >
            {t(lang, "addMedicine")}
          </button>
          <button
            aria-label="Hear this button"
            onClick={() => speak(t(lang, "addMedicine"))}
            className="px-6 rounded-2xl bg-[var(--color-surface-muted)] text-[var(--color-ink-secondary)]"
          >
            <SpeakerIcon size={24} />
          </button>
        </div>
      </div>
    </div>
  );
}
