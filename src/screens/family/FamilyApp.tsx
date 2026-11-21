import { useState } from "react";
import { t, type Lang } from "../../i18n";
import { useSpeaker, SpeakerIcon } from "../../speech";
import MedicineListScreen from "./MedicineListScreen";
import HistoryScreen from "./HistoryScreen";
import FamilyAlertsScreen from "./FamilyAlertsScreen";
import StockScreen from "./StockScreen";
import SettingsScreen from "./SettingsScreen";

type Tab = "medicines" | "history" | "family";
type Stack = null | "stock" | "settings";

export default function FamilyApp({
  lang,
  onLangChange,
}: {
  lang: Lang;
  onLangChange: (l: Lang) => void;
}) {
  const [tab, setTab] = useState<Tab>("medicines");
  const [stack, setStack] = useState<Stack>(null);
  const speak = useSpeaker(lang);

  if (stack === "settings") {
    return <SettingsScreen lang={lang} onLangChange={onLangChange} onBack={() => setStack(null)} />;
  }

  return (
    <div className="min-h-dvh max-w-md mx-auto relative">
      <main className="pb-28">
        {stack === "stock" ? (
          <StockScreen lang={lang} onBack={() => setStack(null)} />
        ) : tab === "medicines" ? (
          <MedicineListScreen lang={lang} onOpenHistory={() => setTab("history")} />
        ) : tab === "history" ? (
          <HistoryScreen lang={lang} onBack={() => setTab("medicines")} />
        ) : (
          <FamilyAlertsScreen lang={lang} onBack={() => setTab("medicines")} />
        )}
      </main>

      {/* Bottom bar: Medicines / History / Family, plus stock + settings entries */}
      <nav
        className="fixed bottom-0 inset-x-0 max-w-md mx-auto flex border-t border-[var(--color-line)] bg-[var(--color-surface)]"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Main"
      >
        {(
          [
            { id: "medicines", label: t(lang, "medicines") },
            { id: "history", label: t(lang, "history") },
            { id: "family", label: t(lang, "family") },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            onClick={() => {
              setStack(null);
              setTab(item.id);
            }}
            aria-current={tab === item.id && stack === null ? "page" : undefined}
            className={`flex-1 py-4 text-base font-semibold ${tab === item.id && stack === null ? "text-[var(--color-accent)]" : "text-[var(--color-ink-secondary)]"}`}
          >
            {item.label}
          </button>
        ))}
        <button
          onClick={() => setStack("stock")}
          aria-label={t(lang, "stockTitle")}
          className={`px-5 py-4 text-base font-semibold ${stack === "stock" ? "text-[var(--color-accent)]" : "text-[var(--color-ink-secondary)]"}`}
        >
          ⚠
        </button>
        <button
          onClick={() => setStack("settings")}
          aria-label={t(lang, "settings")}
          className="px-5 py-4 text-base font-semibold text-[var(--color-ink-secondary)]"
        >
          ⚙
        </button>
        <button
          aria-label="Hear current screen"
          onClick={() => speak(t(lang, "welcomeTitle"))}
          className="px-5 py-4 text-[var(--color-ink-secondary)]"
        >
          <SpeakerIcon size={22} />
        </button>
      </nav>
    </div>
  );
}
