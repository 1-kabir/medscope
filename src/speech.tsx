import { useCallback } from "react";
import { speechLocale, type Lang } from "./i18n";

// Web Speech Synthesis — Bengali first, silent failure on unsupported browsers.

export function speak(text: string, lang: Lang): void {
  speakLines([{ text, lang }]);
}

// Say several lines back to back. Each line keeps its own language, so a screen
// can read its question in the elder's language and still pronounce a language
// name correctly. Queued rather than cancelled, so lines don't cut each other off.
let lastSignature = "";
let lastSpokenAt = 0;

export function speakLines(lines: { text: string; lang: Lang }[]): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    // The same lines twice in a row is a double render (React StrictMode), not
    // a request — say it once so a screen never repeats itself.
    const signature = lines.map((l) => `${l.lang}:${l.text}`).join(">>");
    const now = Date.now();
    if (signature === lastSignature && now - lastSpokenAt < 1000) return;
    lastSignature = signature;
    lastSpokenAt = now;
    window.speechSynthesis.cancel();
    const voices = window.speechSynthesis.getVoices();
    for (const line of lines) {
      const utter = new SpeechSynthesisUtterance(line.text);
      utter.lang = speechLocale(line.lang);
      utter.rate = 0.9;
      const match = voices.find((v) => v.lang.startsWith(utter.lang.slice(0, 2)));
      if (match) utter.voice = match;
      window.speechSynthesis.speak(utter);
    }
  } catch {
    /* speech is best-effort */
  }
}

export function stopSpeaking(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

// Speaker icon: tap to hear the label. 24px glyph + label announced via TTS.
export function SpeakerIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}

export function useSpeaker(lang: Lang) {
  return useCallback((text: string) => speak(text, lang), [lang]);
}
