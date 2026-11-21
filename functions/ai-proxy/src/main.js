// MedscopeOne — AI vision proxy.
// POST { imageDataUrl, lang } -> forwards to the OpenAI-compatible endpoint
// with the server-side key, returns { content: "<model text>" }.
// The API key never leaves this function. Zero dependencies (node-16 runtime).

const https = require("https");

const BASE_URL = (process.env.OPENAI_BASE_URL || "").replace(/\/+$/, "");
const API_KEY = process.env.OPENAI_API_KEY || "";
const MODEL = process.env.OPENAI_MODEL || "";

const LANG_NAME = { bn: "Bengali", hi: "Hindi", en: "English" };

function request(url, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method, headers },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, text: data }));
      }
    );
    req.on("error", reject);
    req.setTimeout(60000, () => req.destroy(new Error("timeout")));
    if (body) req.write(body);
    req.end();
  });
}

module.exports = async ({ req, res, log, error }) => {
  if (req.method !== "POST") {
    return res.json({ error: "POST only" }, 405);
  }
  if (!BASE_URL || !API_KEY || !MODEL) {
    return res.json({ error: "AI credentials not configured" }, 503);
  }

  let payload;
  try {
    payload = typeof req.bodyJson === "object" ? req.bodyJson : JSON.parse(req.body || "{}");
  } catch {
    return res.json({ error: "Invalid JSON" }, 400);
  }

  const imageDataUrl = String(payload.imageDataUrl || "");
  const lang = ["bn", "hi", "en"].includes(payload.lang) ? payload.lang : "en";
  if (!/^data:image\/(png|jpe?g|webp);base64,/.test(imageDataUrl)) {
    return res.json({ error: "imageDataUrl must be a base64 image data URL" }, 400);
  }
  // ~6MB base64 ceiling — phone cameras at full res can exceed it
  if (imageDataUrl.length > 6_000_000) {
    return res.json({ error: "Image too large" }, 413);
  }

  const system =
    "You read photos of medicine strips, blister packs and prescriptions for an app that schedules doses for elderly patients. " +
    "Extract exactly one medicine per image. Prefer what is printed; infer conservatively. " +
    `Write nickname and instruction in ${LANG_NAME[lang]}. Times must be 24h HH:MM. ` +
    'Reply with ONLY a JSON object: {"nickname":string,"name":string,"strength":string,"instruction":string,"times":string[],"dosePerSlot":0.25|0.5|1|2,"tabletsInStrip":number|null}';

  const upstream = await request(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "text", text: "Read this medicine image and fill the schedule fields." },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
      max_tokens: 500,
    }),
  });

  if (upstream.status < 200 || upstream.status >= 300) {
    error("upstream " + upstream.status + ": " + upstream.text.slice(0, 200));
    return res.json({ error: "Upstream error", status: upstream.status }, 502);
  }

  try {
    const parsed = JSON.parse(upstream.text);
    const choice = parsed.choices?.[0];
    const content = choice?.message?.content ?? "";
    // Debug fields help diagnose empty/blocked responses; harmless to keep.
    return res.json({
      content,
      debug: {
        finish_reason: choice?.finish_reason ?? null,
        model: parsed.model ?? null,
        usage: parsed.usage ?? null,
        choices_len: (parsed.choices || []).length,
      },
    });
  } catch (e) {
    error("parse: " + String(e).slice(0, 150));
    return res.json({ error: "Bad upstream response" }, 502);
  }
};
