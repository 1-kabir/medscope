import { useState } from "react";
import { t, type Lang } from "../../i18n";
import MedicineListScreen from "./MedicineListScreen";
import HistoryScreen from "./HistoryScreen";
import FamilyAlertsScreen from "./FamilyAlertsScreen";
import StockScreen from "./StockScreen";
import SettingsScreen from "./SettingsScreen";

type Tab = "medicines" | "history" | "family" | "stock" | "settings";

const ICONS: Record<Tab, React.ReactNode> = {
  medicines: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="7" width="20" height="6" rx="3" transform="rotate(-45 12 10)" />
      <line x1="8.5" y1="8.5" x2="15.5" y2="15.5" />
    </svg>
  ),
  history: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 14" />
    </svg>
  ),
  family: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
      <circle cx="17.5" cy="9.5" r="2.5" />
      <path d="M16 14.6c2.8.3 5.5 2.3 5.5 5.4" />
    </svg>
  ),
  stock: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 8l-9-5-9 5v8l9 5 9-5V8z" />
      <polyline points="3.3 8.5 12 13 20.7 8.5" />
      <line x1="12" y1="13" x2="12" y2="21" />
    </svg>
  ),
  settings: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
};

export default function FamilyApp({
  lang,
  onLangChange,
}: {
  lang: Lang;
  onLangChange: (l: Lang) => void;
}) {
  const [tab, setTab] = useState<Tab>("medicines");

  const labels: Record<Tab, string> = {
    medicines: t(lang, "medicines"),
    history: t(lang, "history"),
    family: t(lang, "family"),
    stock: t(lang, "navStock"),
    settings: t(lang, "settings"),
  };

  return (
    <div className="min-h-dvh max-w-md mx-auto relative">
      <main key={tab} className="anim-screen pb-28">
        {tab === "medicines" ? (
          <MedicineListScreen lang={lang} onOpenHistory={() => setTab("history")} />
        ) : tab === "history" ? (
          <HistoryScreen lang={lang} onBack={() => setTab("medicines")} />
        ) : tab === "family" ? (
          <FamilyAlertsScreen lang={lang} onBack={() => setTab("medicines")} />
        ) : tab === "stock" ? (
          <StockScreen lang={lang} onBack={() => setTab("medicines")} />
        ) : (
          <SettingsScreen lang={lang} onLangChange={onLangChange} onBack={() => setTab("medicines")} />
        )}
      </main>

      <nav
        className="fixed bottom-0 inset-x-0 max-w-md mx-auto flex border-t border-[var(--color-line)] bg-[var(--color-surface)]"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Main"
      >
        {(Object.keys(labels) as Tab[]).map((id) => {
          const active = tab === id;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              aria-current={active ? "page" : undefined}
              className={`flex-1 flex flex-col items-center gap-1 pt-3 pb-2 transition-colors ${
                active ? "text-[var(--color-accent)]" : "text-[var(--color-ink-tertiary)]"
              }`}
            >
              {ICONS[id]}
              <span className={`text-xs leading-none ${active ? "font-bold" : "font-medium"}`}>{labels[id]}</span>
              <span
                aria-hidden="true"
                className={`h-0.5 w-8 rounded-full ${active ? "bg-[var(--color-accent)]" : "bg-transparent"}`}
              />
            </button>
          );
        })}
      </nav>
    </div>
  );
}
