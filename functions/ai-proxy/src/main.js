// MedscopeOne — AI vision proxy.
// POST { imageDataUrl, lang } -> forwards to the OpenAI-compatible endpoint
// with the server-side key, returns { content: "<model text>" }.
// The API key never leaves this function. Zero dependencies (node-16 runtime).

const https = require("https");

const BASE_URL = (process.env.OPENAI_BASE_URL || "").replace(/\/+$/, "");
const API_KEY = process.env.OPENAI_API_KEY || "";
const MODEL = process.env.OPENAI_MODEL || "";
// If the primary model answers with nothing usable, one different model gets a
// turn before the caller is told the photo could not be read.
const FALLBACK_MODEL = process.env.OPENAI_FALLBACK_MODEL || "google/gemini-3.8-flash";

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
    // Appwrite kills a synchronous execution at 30s, so give up well before that
    // and answer the caller with an error it can show.
    // Two attempts must both fit inside Appwrite's 30s synchronous ceiling.
    req.setTimeout(12500, () => req.destroy(new Error("timeout")));
    if (body) req.write(body);
    req.end();
  });
}

// The model occasionally gets cut off mid-object (finish_reason=length, usually
// because it spent the budget thinking). Close the open string/brackets so a
// nearly-complete answer is still usable instead of thrown away.
function repairJson(text) {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let out = text.slice(start);
  const end = out.lastIndexOf("}");
  if (end > 0) {
    try {
      return out.slice(0, end + 1);
    } catch {
      /* fall through to repair */
    }
  }
  if ((out.match(/"/g) || []).length % 2 === 1) out = out.slice(0, out.lastIndexOf("\""));
  out = out.replace(/[,:]\s*$/, "");
  const arrays = (out.match(/\[/g) || []).length - (out.match(/\]/g) || []).length;
  const objects = (out.match(/\{/g) || []).length - (out.match(/\}/g) || []).length;
  out += "]".repeat(Math.max(0, arrays)) + "}".repeat(Math.max(0, objects));
  try {
    JSON.parse(out);
    return out;
  } catch {
    return null;
  }
}

async function post(model, imageDataUrl, system, maxTokens, reasoningOff) {
  return request(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: maxTokens,
      // Some models spend the entire budget on hidden reasoning tokens and
      // return finish_reason=length with empty content — which looked like
      // "the AI failed". Turning reasoning off makes them answer directly.
      ...(reasoningOff ? { reasoning_effort: "off" } : {}),
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
    }),
  });
}

async function callModel(model, imageDataUrl, system, maxTokens) {
  let upstream = await post(model, imageDataUrl, system, maxTokens, true);
  // A provider that does not accept the parameter says so; retry plainly
  // instead of failing the reading over an optional field.
  if (upstream.status === 400 && /reasoning_effort/i.test(upstream.text)) {
    upstream = await post(model, imageDataUrl, system, maxTokens, false);
  }
  if (upstream.status < 200 || upstream.status >= 300) {
    return { error: "upstream " + upstream.status, body: upstream.text.slice(0, 300) };
  }
  let parsed;
  try {
    parsed = JSON.parse(upstream.text);
  } catch {
    return { error: "bad upstream JSON", body: upstream.text.slice(0, 200) };
  }
  const choice = (parsed.choices || [])[0] || {};
  return {
    content: String(choice.message?.content || ""),
    finish: choice.finish_reason ?? null,
    usage: parsed.usage ?? null,
    model: parsed.model ?? null,
  };
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
  // ~6MB base64 ceiling — the client downscales well below this
  if (imageDataUrl.length > 6_000_000) {
    return res.json({ error: "Image too large" }, 413);
  }

  const system =
    "You read photos of medicine strips, blister packs and prescriptions for an app that schedules doses for elderly patients. " +
    "Extract exactly one medicine per image. Prefer what is printed; infer conservatively. " +
    `Write nickname and instruction in ${LANG_NAME[lang]}. Times must be 24h HH:MM. ` +
    "dosePerSlot is the number of tablets per dose exactly as prescribed (0.25, 0.5, 1, 1.5, 2, 3...); use 1 if unclear. " +
    'Reply with ONLY a JSON object: {"nickname":string,"name":string,"strength":string,"instruction":string,"times":string[],"dosePerSlot":number,"tabletsInStrip":number|null}';

  // Primary model, then one different model: a single provider hiccup should
  // not leave the family with an unreadable strip.
  const plans = [{ model: MODEL, max: 1200 }];
  if (FALLBACK_MODEL && FALLBACK_MODEL !== MODEL) plans.push({ model: FALLBACK_MODEL, max: 1200 });

  let last = null;
  for (let attempt = 1; attempt <= plans.length; attempt++) {
    const plan = plans[attempt - 1];
    let out;
    try {
      out = await callModel(plan.model, imageDataUrl, system, plan.max);
    } catch (e) {
      last = { error: "upstream call failed", body: String(e).slice(0, 160) };
      log(`attempt ${attempt}: ${last.error} ${last.body}`);
      continue;
    }
    if (out.error) {
      last = out;
      error(`attempt ${attempt}: ${out.error} ${out.body}`);
      continue;
    }
    const repaired = out.content.trim() ? repairJson(out.content) : null;
    if (repaired) {
      return res.json({
        content: repaired,
        debug: { model: out.model, finish_reason: out.finish, usage: out.usage, attempt, repaired: repaired !== out.content.trim() },
      });
    }
    last = { error: "no JSON in reply", body: out.content.slice(0, 200) };
    error(`attempt ${attempt}: ${last.error} finish=${out.finish} usage=${JSON.stringify(out.usage)}`);
  }

  // Nothing usable: say so clearly. The app shows this instead of quietly
  // substituting on-device OCR, which produced worse readings with no warning.
  return res.json({ error: "Could not read the image", detail: last && last.error, finish_reason: last && last.body }, 502);
};
