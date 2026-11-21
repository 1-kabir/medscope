// Sarvam speech proxy: the browser never holds the Sarvam key.
//   POST { action: "tts", text, lang }              -> { audio: "<base64 mp3>" }   (Bulbul)
//   POST { action: "stt", audioBase64, mime, lang } -> { transcript: "..." }     (Saaras)
// Zero dependencies; node-16 runtime; node:https only.
const https = require("https");

const API_KEY = process.env.SARVAM_API_KEY || "";

const TTS_LANG = { bn: "bn-IN", hi: "hi-IN", en: "en-IN" };

function request(url, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method, headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8"), buffer: Buffer.concat(chunks) }));
      }
    );
    req.on("error", reject);
    req.setTimeout(25000, () => req.destroy(new Error("timeout")));
    if (body) req.write(body);
    req.end();
  });
}

async function tts(text, lang) {
  const r = await request("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: { "api-subscription-key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs: [text],
      target_language_code: TTS_LANG[lang] || "bn-IN",
      speaker: "priya",
      model: "bulbul:v3",
      speech_sample_rate: 22050,
    }),
  });
  if (r.status < 200 || r.status >= 300) return { error: "tts " + r.status + " " + r.text.slice(0, 150) };
  const parsed = JSON.parse(r.text);
  const audio = parsed.audios && parsed.audios[0];
  if (!audio) return { error: "tts: no audio in response" };
  return { audio };
}

async function stt(audioBase64, mime, lang) {
  const boundary = "----medscope" + Date.now();
  const audioBuf = Buffer.from(audioBase64, "base64");
  const parts = [];
  const field = (name, value) => {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  };
  field("model", "saarika:v2");
  field("language_code", TTS_LANG[lang] || "bn-IN");
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="speech.${mime.split("/")[1] || "webm"}"\r\nContent-Type: ${mime}\r\n\r\n`));
  parts.push(audioBuf);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  const body = Buffer.concat(parts);

  const r = await request("https://api.sarvam.ai/speech-to-text", {
    method: "POST",
    headers: {
      "api-subscription-key": API_KEY,
      "Content-Type": "multipart/form-data; boundary=" + boundary,
      "Content-Length": body.length,
    },
    body,
  });
  if (r.status < 200 || r.status >= 300) return { error: "stt " + r.status + " " + r.text.slice(0, 150) };
  const parsed = JSON.parse(r.text);
  return { transcript: parsed.transcript || "" };
}

module.exports = async ({ req, res, log, error }) => {
  if (req.method !== "POST") return res.json({ error: "POST only" }, 405);
  if (!API_KEY) return res.json({ error: "SARVAM_API_KEY not configured" }, 503);

  let p;
  try {
    p = typeof req.bodyJson === "object" ? req.bodyJson : JSON.parse(req.body || "{}");
  } catch {
    return res.json({ error: "Invalid JSON" }, 400);
  }

  try {
    if (p.action === "tts") {
      const text = String(p.text || "").slice(0, 500);
      if (!text.trim()) return res.json({ error: "text required" }, 400);
      const out = await tts(text, p.lang);
      if (out.error) { error(out.error); return res.json({ error: out.error }, 502); }
      return res.json({ audio: out.audio });
    }
    if (p.action === "stt") {
      const audio = String(p.audioBase64 || "");
      if (!audio) return res.json({ error: "audioBase64 required" }, 400);
      if (audio.length > 8_000_000) return res.json({ error: "audio too large" }, 413);
      const out = await stt(audio, String(p.mime || "audio/webm"), p.lang);
      if (out.error) { error(out.error); return res.json({ error: out.error }, 502); }
      return res.json({ transcript: out.transcript });
    }
    return res.json({ error: "action must be tts or stt" }, 400);
  } catch (e) {
    error("sarvam-speech: " + String(e).slice(0, 200));
    return res.json({ error: "internal" }, 500);
  }
};
