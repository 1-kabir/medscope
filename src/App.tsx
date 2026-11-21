import { useEffect, useState } from "react";
import { getSettings, setSetting } from "./db";
import type { Lang } from "./i18n";
import LanguageScreen from "./screens/LanguageScreen";
import ModeScreen from "./screens/ModeScreen";
import ElderDoseScreen from "./screens/ElderDoseScreen";

type View = "language" | "mode" | "elder" | "family";

export default function App() {
  const [view, setView] = useState<View>("language");
  const [lang, setLang] = useState<Lang>("bn");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void getSettings().then((s) => {
      setLang(s.lang);
      // Returning device: straight into its mode. First run: language.
      setView(s.mode ?? "language");
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
        onSelect={(mode) => {
          void setSetting("mode", mode);
          setView(mode);
        }}
      />
    );
  }

  if (view === "elder") return <ElderDoseScreen lang={lang} />;

  // family surface lands in the next pass
  return null;
}
