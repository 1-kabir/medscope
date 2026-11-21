// MedscopeOne — missed-dose escalation checker.
// Runs on a 10-minute schedule (node-16 runtime): for every household,
//   slot + 30 min, no taken log  -> log "missed" + WhatsApp the family (Meta test number)
//   slot + 60 min, still nothing -> Sarvam voice call speaking the alert in Bengali
// Zero dependencies; uses node:https (node-16 has no global fetch).

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
    req.setTimeout(20000, () => req.destroy(new Error("timeout")));
    if (body) req.write(body);
    req.end();
  });
}

function qs(queries) {
  const p = new URLSearchParams();
  for (const q of queries || []) p.append("queries[]", JSON.stringify(q));
  return p.toString();
}

async function listRows(tableId, queries) {
  const r = await request(`${ENDPOINT}/tablesdb/${DB}/tables/${tableId}/rows?${qs(queries)}`, { headers: HEADERS });
  if (r.status !== 200) throw new Error(`listRows ${tableId} ${r.status}`);
  return JSON.parse(r.text).rows || [];
}

async function createRow(tableId, rowId, data) {
  const r = await request(`${ENDPOINT}/tablesdb/${DB}/tables/${tableId}/rows`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ rowId, data }),
  });
  if (r.status !== 201 && r.status !== 409) throw new Error(`createRow ${tableId} ${r.status} ${r.text.slice(0, 120)}`);
  return r.status === 201;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function minutesOf(slot) {
  const [h, m] = slot.split(":").map(Number);
  return h * 60 + m;
}

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

async function sendWhatsApp(to, text, slotHint) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) return { skipped: "credentials not set" };

  // Try a personalized plain text first — it works when the recipient has
  // messaged us within 24h (open customer service window). If the window is
  // closed, the API rejects it and we fall back to a template message
  // (hello_world by default, or a custom one via WHATSAPP_TEMPLATE_NAME).
  const textBody = JSON.stringify({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { body: text },
  });
  const textRes = await request(`https://graph.facebook.com/v23.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: textBody,
  });
  if (textRes.status >= 200 && textRes.status < 300) {
    return { ok: true, via: "text", status: textRes.status };
  }

  const templateName = process.env.WHATSAPP_TEMPLATE_NAME || "hello_world";
  const templateLang = process.env.WHATSAPP_TEMPLATE_LANG || "en_US";
  const message = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: { name: templateName, language: { code: templateLang } },
  };
  // Custom templates can carry body variables: {{1}} medicine, {{2}} date+time.
  // hello_world has none, so components are only sent for custom ones.
  if (process.env.WHATSAPP_TEMPLATE_NAME) {
    message.template.components = [
      { type: "body", parameters: [{ type: "text", text: text }, { type: "text", text: slotHint }] },
    ];
  }

  const r = await request(`https://graph.facebook.com/v23.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
  return { ok: r.status >= 200 && r.status < 300, via: "template", status: r.status, body: r.text.slice(0, 200) };
}

async function sarvamCall(to, spokenText) {
  const key = process.env.SARVAM_API_KEY;
  if (!key) return { skipped: "credentials not set" };
  const r = await request("https://api.sarvam.ai/v1/call", {
    method: "POST",
    headers: { "api-subscription-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ to, message: spokenText, language: "bn-IN" }),
  });
  return { ok: r.status >= 200 && r.status < 300, status: r.status, body: r.text.slice(0, 200) };
}

module.exports = async ({ req, res, log, error }) => {
  const summary = { checked: 0, missed: 0, whatsapp: 0, calls: 0 };
  const date = today();
  const now = nowMinutes();

  try {
    const devices = await listRows("devices", []);
    const households = [...new Set(devices.map((d) => d.householdId).filter(Boolean))];
    log("households: " + households.length);

    for (const householdId of households) {
      const [medicines, logs, contacts] = await Promise.all([
        listRows("medicines", [{ method: "equal", attribute: "householdId", values: [householdId] }, { method: "limit", values: [100] }]),
        listRows("taken_logs", [{ method: "equal", attribute: "householdId", values: [householdId] }, { method: "equal", attribute: "date", values: [date] }, { method: "limit", values: [100] }]),
        listRows("contacts", [{ method: "equal", attribute: "householdId", values: [householdId] }, { method: "limit", values: [50] }]),
      ]);
      summary.checked += medicines.length;

      const takenKeys = new Set(logs.filter((l) => l.status === "taken").map((l) => l.medicineId + "|" + l.slot));
      const familyNumber = contacts[0] && contacts[0].whatsapp;

      for (const med of medicines) {
        const times = JSON.parse(med.times || "[]");
        for (const slot of times) {
          const overdue = now - minutesOf(slot);
          if (overdue < 30) continue;
          if (takenKeys.has(med.$id + "|" + slot)) continue;

          const safeId = `miss_${med.$id}_${slot}_${date}`.replace(/[^a-zA-Z0-9._-]/g, "_");
          const created = await createRow("taken_logs", safeId, {
            elderId: med.elderId || "",
            medicineId: med.$id,
            nickname: med.nickname,
            slot: slot,
            date: date,
            status: "missed",
            at: Date.now(),
            deviceId: "checker",
            householdId: householdId,
          }).catch((e) => {
            error("missed log: " + String(e).slice(0, 150));
            return false;
          });
          if (created) summary.missed++;

          if (familyNumber) {
            const waId = `wa_${med.$id}_${slot}_${date}`.replace(/[^a-zA-Z0-9._-]/g, "_");
            const wa = await sendWhatsApp(familyNumber, `MedscopeOne: ${med.nickname} (${med.name}) - the ${slot} dose was not taken today. Please check on them.`, `${date} ${slot}`);
            if (wa.ok) summary.whatsapp++;
            await createRow("alerts", waId, {
              elderId: med.elderId || "",
              medicineId: med.$id,
              channel: "whatsapp",
              status: wa.ok ? "sent" : wa.skipped ? "skipped" : "failed",
              message: med.nickname + " " + slot + " missed",
              at: Date.now(),
              householdId: householdId,
            }).catch(() => {});

            if (overdue >= 60) {
              const callId = `call_${med.$id}_${slot}_${date}`.replace(/[^a-zA-Z0-9._-]/g, "_");
              const call = await sarvamCall(familyNumber, `সাবধানবার্তা। ${med.nickname} খাওয়া হয়নি। অনুগ্রহ করে দেখুন।`);
              if (call.ok) summary.calls++;
              await createRow("alerts", callId, {
                elderId: med.elderId || "",
                medicineId: med.$id,
                channel: "call",
                status: call.ok ? "sent" : call.skipped ? "skipped" : "failed",
                message: med.nickname + " " + slot + " missed, 60 min",
                at: Date.now(),
                householdId: householdId,
              }).catch(() => {});
            }
          }
        }
      }
    }
  } catch (e) {
    error("checker: " + String(e).slice(0, 300));
  }

  log("summary: " + JSON.stringify(summary));
  return res.json(summary);
};
