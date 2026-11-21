import { useEffect, useState } from "react";
import { getSettings, setSetting, createHousehold, registerDevice } from "./db";
import type { Lang } from "./i18n";
import LanguageScreen from "./screens/LanguageScreen";
import ModeScreen from "./screens/ModeScreen";
import ElderDoseScreen from "./screens/ElderDoseScreen";
import FamilyApp from "./screens/family/FamilyApp";
import LinkScreen from "./screens/family/LinkScreen";

type View = "language" | "mode" | "link" | "elder" | "family";

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
            // Elder devices always have a household. Family devices link by code.
            if (mode === "elder") {
              await createHousehold();
              await registerDevice("elder");
            } else {
              setView("link");
              return;
            }
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

  if (view === "elder") return <ElderDoseScreen lang={lang} onLangChange={(l) => { setLang(l); void setSetting("lang", l); }} />;

  return <FamilyApp lang={lang} onLangChange={(l) => { setLang(l); void setSetting("lang", l); }} />;
}
