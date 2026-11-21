// Receives Sarvam Voice Agent call-outcome webhooks and records them in the
// alerts table so the family surface (and the checker's retry logic) can see
// whether the elder confirmed on the call. Guest-executable POST; zero deps.
//
// Sarvam POSTs the attempt payload to this URL (configured per-call via
// webhook_config.url). We persist whatever arrives, keyed by attempt_id when
// present, so outcomes are idempotent.
const https = require("https");

const ENDPOINT = process.env.APPWRITE_FUNCTION_API_ENDPOINT || process.env.APPWRITE_ENDPOINT || "https://appwrite.kabirstudios.com/v1";
const PROJECT = process.env.APPWRITE_FUNCTION_PROJECT_ID || "medscope";
const API_KEY = process.env.APPWRITE_API_KEY;
const DB = "medscope";

const HEADERS = {
  "X-Appwrite-Project": PROJECT,
  "X-Appwrite-Key": API_KEY,
  "Content-Type": "application/json",
};

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
    req.setTimeout(15000, () => req.destroy(new Error("timeout")));
    if (body) req.write(body);
    req.end();
  });
}

function rowIdFor(attemptId) {
  const crypto = require("crypto");
  return "vo_" + crypto.createHash("sha1").update(String(attemptId)).digest("hex").slice(0, 28);
}

// Best-effort extraction: Sarvam's webhook payload carries the attempt id and
// outcome fields; accept a few common shapes so a schema drift doesn't drop it.
function extract(body) {
  const b = body || {};
  const attemptId =
    b.attempt_id || b.attemptId || b.data?.attempt_id || b.data?.attemptId || b.metadata?.attempt_id || null;
  const status =
    b.status || b.call_status || b.outcome || b.data?.status || b.data?.outcome || "unknown";
  const confirmed =
    b.confirmed ??
    b.data?.confirmed ??
    /confirm|taken|খেয়ে|খেয়েছি/i.test(JSON.stringify(b.data || b));
  return { attemptId, status: String(status).slice(0, 32), confirmed: Boolean(confirmed) };
}

module.exports = async ({ req, res, log, error }) => {
  if (req.method !== "POST") return res.json({ error: "POST only" }, 405);

  let body;
  try {
    body = typeof req.bodyJson === "object" ? req.bodyJson : JSON.parse(req.body || "{}");
  } catch {
    return res.json({ error: "Invalid JSON" }, 400);
  }

  const { attemptId, status, confirmed } = extract(body);
  if (!attemptId) {
    log("webhook without attempt_id: " + JSON.stringify(body).slice(0, 300));
    return res.json({ ok: true, ignored: true });
  }

  const meta = body.metadata || body.data?.metadata || {};
  const rowId = rowIdFor(attemptId);
  const r = await request(`${ENDPOINT}/tablesdb/${DB}/tables/alerts/rows/${rowId}`, {
    method: "PATCH",
    headers: HEADERS,
    body: JSON.stringify({
      data: {
        channel: "call",
        status: confirmed ? "confirmed" : "completed",
        message: `voice agent outcome: ${status} (confirmed=${confirmed})`,
        at: Date.now(),
        ...(meta.householdId ? { householdId: meta.householdId } : {}),
        ...(meta.medicineId ? { medicineId: meta.medicineId } : {}),
      },
    }),
  }).catch((e) => ({ status: 0, text: String(e).slice(0, 150) }));

  if (r.status !== 200) {
    // The alert row may not exist (checker created it under a different id, or
    // the call outlived today's row): write a standalone outcome row instead.
    const c = await request(`${ENDPOINT}/tablesdb/${DB}/tables/alerts/rows`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({
        rowId,
        data: {
          elderId: meta.elderId || "",
          medicineId: meta.medicineId || "",
          channel: "call",
          status: confirmed ? "confirmed" : "completed",
          message: `voice agent outcome: ${status} attempt=${attemptId}`,
          at: Date.now(),
          attempts: 1,
          householdId: meta.householdId || "",
        },
      }),
    }).catch((e) => ({ status: 0, text: String(e).slice(0, 150) }));
    if (c.status !== 201 && c.status !== 409) {
      error("could not record outcome: " + c.text);
      return res.json({ ok: false }, 500);
    }
  }

  log("outcome recorded: " + attemptId + " status=" + status);
  return res.json({ ok: true });
};

function rowIdFor(attemptId) {
  const crypto = require("crypto");
  return "vo_" + crypto.createHash("sha1").update(String(attemptId)).digest("hex").slice(0, 28);
}
