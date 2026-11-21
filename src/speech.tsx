import { useCallback } from "react";
import { functions, ExecutionMethod } from "./lib/appwrite";
import { speechLocale, type Lang } from "./i18n";

// All spoken audio comes from Sarvam Bulbul (native Bengali/Hindi/English),
// routed through the sarvam-speech function so the key stays server-side.
// Web Speech Synthesis remains as the offline fallback.

let audioEl: HTMLAudioElement | null = null;
const ttsCache = new Map<string, string>(); // text+lang -> data URL

export function stopSpeaking(): void {
  try {
    if (audioEl) {
      audioEl.pause();
      audioEl = null;
    }
  } catch { /* nothing playing */ }
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

async function sarvamTTS(text: string, lang: Lang): Promise<string | null> {
  const key = text + "|" + lang;
  const cached = ttsCache.get(key);
  if (cached) return cached;
  try {
    const exec = await functions.createExecution({
      functionId: "sarvam-speech",
      method: ExecutionMethod.POST,
      body: JSON.stringify({ action: "tts", text, lang }),
    });
    if (exec.status !== "completed") return null;
    const outer = JSON.parse(exec.responseBody || "{}");
    if (!outer.audio) return null;
    const dataUrl = "data:audio/mp3;base64," + outer.audio;
    if (ttsCache.size > 60) ttsCache.clear();
    ttsCache.set(key, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}

// Warm the cache for lines the user is about to tap or hear. Sarvam TTS takes
// a round trip; fetching ahead means a tap plays instantly instead of after
// the request resolves.
export function prefetchTTS(lines: { text: string; lang: Lang }[]): void {
  for (const line of lines) void sarvamTTS(line.text, line.lang);
}

function webSpeak(text: string, lang: Lang): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = speechLocale(lang);
  utter.rate = 0.9;
  const voices = window.speechSynthesis.getVoices();
  const match = voices.find((v) => v.lang.startsWith(utter.lang.slice(0, 2)));
  if (match) utter.voice = match;
  window.speechSynthesis.speak(utter);
}

// Say one line in the elder's language. Sarvam first; webspeech if offline.
export async function speak(text: string, lang: Lang): Promise<void> {
  stopSpeaking();
  const audio = await sarvamTTS(text, lang);
  if (audio) {
    audioEl = new Audio(audio);
    await audioEl.play().catch(() => webSpeak(text, lang));
    return;
  }
  webSpeak(text, lang);
}

// Say several lines back to back. Each line keeps its own language, so a screen
// can read its question in the elder's language and still pronounce a language
// name correctly. De-duplicated: a double render is not a double request.
let lastSignature = "";
let lastSpokenAt = 0;

export async function speakLines(lines: { text: string; lang: Lang }[]): Promise<void> {
  const signature = lines.map((l) => `${l.lang}:${l.text}`).join(">>");
  const now = Date.now();
  if (signature === lastSignature && now - lastSpokenAt < 1000) return;
  lastSignature = signature;
  lastSpokenAt = now;
  stopSpeaking();
  for (const line of lines) {
    const audio = await sarvamTTS(line.text, line.lang);
    if (audio) {
      await new Promise<void>((resolve) => {
        audioEl = new Audio(audio);
        audioEl.onended = () => resolve();
        audioEl.onerror = () => resolve();
        audioEl.play().catch(() => {
          webSpeak(line.text, line.lang);
          resolve();
        });
      });
    } else {
      webSpeak(line.text, line.lang);
    }
  }
}

export function useSpeaker(lang: Lang) {
  return useCallback((text: string) => { void speak(text, lang); }, [lang]);
}

// Speaker icon: tap to hear the label.
export function SpeakerIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}
