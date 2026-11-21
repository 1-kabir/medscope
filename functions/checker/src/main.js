// MedscopeOne — missed-dose escalation checker.
// Runs on a 10-minute schedule (node-16 runtime): for every household,
//   slot + 30 min, no taken log  -> log "missed" + WhatsApp every family contact
//   slot + 60 min, still nothing -> Sarvam voice call speaking the alert in Bengali
// Delivery is retried on later runs until it succeeds (or the attempt cap), so a
// failed send or a skipped cycle does not quietly drop the alert.
// Zero dependencies; uses node:https (node-16 has no global fetch).

const https = require("https");
const crypto = require("crypto");

const ENDPOINT = process.env.APPWRITE_FUNCTION_API_ENDPOINT || process.env.APPWRITE_ENDPOINT || "https://appwrite.kabirstudios.com/v1";
const PROJECT = process.env.APPWRITE_FUNCTION_PROJECT_ID || "medscope";
const API_KEY = process.env.APPWRITE_API_KEY;
const DB = "medscope";

// Each alert is attempted at most this many times, once per run. Six runs is
// about an hour of retries: long enough to ride out a transient failure, short
// enough that a permanently invalid number cannot buzz forever.
const MAX_ATTEMPTS = Number(process.env.ESCALATION_MAX_ATTEMPTS || 6);

// Escalation timing, all customizable:
//   graceMinutes      — how late a dose may go before the family is texted
//   callAfterMinutes  — when the elder's Sarvam voice call goes out
//   secondWarnMinutes — when family gets the second warning if still untaken
//                       (floored at 120: minimum 2 hours from the dose time)
const GRACE_MINUTES = Number(process.env.ESCALATION_GRACE_MINUTES || 30);
const CALL_AFTER_MINUTES = Number(process.env.ESCALATION_CALL_AFTER_MINUTES || 45);
const SECOND_WARN_MINUTES = Math.max(120, Number(process.env.ESCALATION_SECOND_WARN_MINUTES || 120));

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

async function updateRow(tableId, rowId, data) {
  const r = await request(`${ENDPOINT}/tablesdb/${DB}/tables/${tableId}/rows/${rowId}`, {
    method: "PATCH",
    headers: HEADERS,
    body: JSON.stringify({ data }),
  });
  return r.status === 200;
}

// Doses are scheduled in the elder's local time. The function container runs in
// UTC, so comparing UTC clock minutes against an IST "08:00" slot made every
// reminder look 5½ hours late (or never due). Pin the household timezone.
const TZ = process.env.CHECKER_TIMEZONE || "Asia/Kolkata";

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

function minutesOf(slot) {
  const [h, m] = slot.split(":").map(Number);
  return h * 60 + m;
}

function nowMinutes() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour").value) % 24;
  const m = Number(parts.find((p) => p.type === "minute").value);
  return h * 60 + m;
}

// Numbers are stored as full international digits by the app. Older rows may
// still hold a bare 10-digit local number, so normalise defensively — but stop
// inventing a country code: an unusable row is skipped and reported instead.
function waNumber(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = "91" + d; // legacy rows only
  return /^\d{11,15}$/.test(d) ? d : "";
}

// Appwrite row IDs are capped at 36 characters, so a readable
// `miss_<uuid>_<slot>_<date>` form is rejected with a 400. Hash to a fixed,
// stable ID — the same dose/contact always maps to the same alert row, which is
// what makes retrying safe.
function rowId(prefix, parts) {
  const digest = crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 28);
  return `${prefix}_${digest}`;
}

function messageStatus(text) {
  try {
    return JSON.parse(text).messages?.[0]?.message_status || null;
  } catch {
    return null;
  }
}

async function sendWhatsApp(to, text, slotHint) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) return { skipped: "credentials not set" };

  // An approved template goes first. Outside the 24-hour customer service
  // window Meta does NOT reject free-form text — it accepts it, returns a
  // wamid, and drops the message, so a "text first, template on error" order
  // loses alerts silently. A template always delivers.
  if (process.env.WHATSAPP_TEMPLATE_NAME) {
    const tpl = await sendTemplate(to, text, slotHint, token, phoneId);
    if (tpl.ok) return tpl;
  }

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
    return { ok: true, via: "text", status: textRes.status, messageStatus: messageStatus(textRes.text) };
  }

  // Last resort: the pre-approved hello_world template. It delivers, but it
  // cannot carry the alert text — configure WHATSAPP_TEMPLATE_NAME for real
  // alert content.
  return sendTemplate(to, text, slotHint, token, phoneId, true);
}

async function sendTemplate(to, text, slotHint, token, phoneId, forceHelloWorld) {
  const templateName = (forceHelloWorld ? "hello_world" : process.env.WHATSAPP_TEMPLATE_NAME) || "hello_world";
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
  if (!forceHelloWorld && process.env.WHATSAPP_TEMPLATE_NAME) {
    message.template.components = [
      { type: "body", parameters: [{ type: "text", text: text }, { type: "text", text: slotHint }] },
    ];
  }

  const r = await request(`https://graph.facebook.com/v23.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
  return {
    ok: r.status >= 200 && r.status < 300,
    via: "template",
    status: r.status,
    messageStatus: messageStatus(r.text),
    template: templateName,
    body: r.text.slice(0, 200),
  };
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

// Sarvam Voice Agent: instant outbound call to the ELDER. The agent speaks the
// reminder in the elder's language and waits for a spoken confirmation; the
// call outcome arrives at the voice-webhook function. Requires the agent to be
// deployed on the rented number (see README). Falls back to the plain call API
// when the Voice Agent env block is not configured.
const VA = {
  orgId: process.env.SARVAM_VA_ORG_ID || "",
  workspaceId: process.env.SARVAM_VA_WORKSPACE_ID || "",
  apiKey: process.env.SARVAM_VA_API_KEY || "",
  appId: process.env.SARVAM_VA_APP_ID || "",
  appVersion: Number(process.env.SARVAM_VA_APP_VERSION || 1),
  connectionId: process.env.SARVAM_VA_CONNECTION_ID || "",
  agentPhone: process.env.SARVAM_VA_AGENT_PHONE || "",
  webhookUrl: process.env.VOICE_WEBHOOK_URL || "",
};
const VA_CONFIGURED = Boolean(VA.orgId && VA.workspaceId && VA.apiKey && VA.appId && VA.connectionId && VA.agentPhone);

const SPOKEN_LANG = { bn: "Bengali", hi: "Hindi", en: "English" };

function elderGreeting(lang, elderName, medicine) {
  const name = elderName ? elderName + ", " : "";
  if (lang === "hi") return `${name}${medicine} लेने का समय हो गया। क्या आपने दवा ले ली? कृपया अब दवा ले लीजिए।`;
  if (lang === "en") return `${name}it is time for your ${medicine}. Have you taken it? Please take it now.`;
  return `${name}${medicine} খাওয়ার সময় হয়েছে। আপনি কি ওষুধ খেয়ে নিয়েছেন? অনুগ্রহ করে এখন ওষুধটি খেয়ে নিন।`;
}

async function voiceAgentCall(to, opts) {
  if (!VA_CONFIGURED) return sarvamCall(to, opts.greeting);
  const body = {
    app_config: {
      app_id: VA.appId,
      app_version: VA.appVersion,
      connection_config: { connection_id: VA.connectionId, agent_phone_number: VA.agentPhone },
      agent_variables: { elder_name: opts.elderName || "", medicine: opts.medicine, slot: opts.slot },
      app_overrides: {
        initial_bot_message: opts.greeting,
        ...(SPOKEN_LANG[opts.lang] ? { initial_language_name: SPOKEN_LANG[opts.lang] } : {}),
      },
    },
    user_config: { user_phone_number: to },
    ...(VA.webhookUrl ? { webhook_config: { url: VA.webhookUrl, metadata: { medicineId: opts.medicineId, slot: opts.slot, date: opts.date, householdId: opts.householdId, elderPhone: to } } } : {}),
  };
  const r = await request(`${"https://apps.sarvam.ai/api/outbounds/v1/orgs/" + VA.orgId + "/workspaces/" + VA.workspaceId + "/outbounds"}`, {
    method: "POST",
    headers: { "X-API-Key": VA.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let attemptId = null;
  try { attemptId = JSON.parse(r.text).attempt_id || null; } catch { /* keep null */ }
  return { ok: r.status >= 200 && r.status < 300, status: r.status, attemptId, via: "voice-agent", body: r.text.slice(0, 200) };
}

// One delivery attempt for one contact and channel, keyed by a stable alert ID.
// Already-sent alerts are left alone; failed or skipped ones are tried again on
// this run, and the attempt count is carried in the alert row.
async function deliver({ alertsById, summary, id, channel, number, text, hint, data, send, log, error }) {
  const prev = alertsById.get(id);
  if (prev && prev.status === "sent") return;
  const attempts = Number(prev && prev.attempts) || 0;
  if (attempts >= MAX_ATTEMPTS) {
    summary.gaveUp++;
    log(`gave up ${channel} ${number} after ${attempts} attempts (${id})`);
    return;
  }
  if (prev) summary.retried++;

  const result = await send();
  if (result.ok) summary[channel === "whatsapp" ? "whatsapp" : "calls"]++;
  else if (channel === "whatsapp") summary.whatsappFailed++;
  if (!result.ok) error(`${channel} ${number} ${result.status || result.skipped}: ${result.body || ""}`);
  if (result.messageStatus) log(`${channel} ${number}: message_status=${result.messageStatus} via ${result.via}${result.template ? " (" + result.template + ")" : ""}`);
  if (result.via === "text") log(`warning: ${channel} ${number} sent as free-form text — outside the 24h window Meta drops these silently; set WHATSAPP_TEMPLATE_NAME`);

  const row = {
    ...data,
    channel,
    status: result.ok ? "sent" : result.skipped ? "skipped" : "failed",
    at: Date.now(),
    attempts: attempts + 1,
  };
  const saved = prev ? await updateRow("alerts", id, row) : await createRow("alerts", id, row);
  if (!saved) error(`could not record ${channel} alert ${id}`);
  alertsById.set(id, { $id: id, ...row });
  return result;
}

module.exports = async ({ req, res, log, error }) => {
  const summary = { households: 0, checked: 0, missed: 0, whatsapp: 0, whatsappFailed: 0, calls: 0, retried: 0, gaveUp: 0, noNumber: 0, paused: 0 };
  const date = today();
  const now = nowMinutes();

  try {
    // Members are the single people directory: elders own medicines (and can
    // be paused), family members are the escalation targets. The contacts and
    // devices tables are legacy and no longer read here.
    const [allMembers, allMedicines, todayLogs] = await Promise.all([
      listRows("members", [{ method: "limit", values: [500] }]),
      listRows("medicines", [{ method: "limit", values: [500] }]),
      listRows("taken_logs", [{ method: "equal", attribute: "date", values: [date] }, { method: "limit", values: [1000] }]).catch(() => []),
    ]);

    // A household is whoever is actually in the data.
    const households = [
      ...new Set(
        [...allMembers.map((m) => m.householdId), ...allMedicines.map((m) => m.householdId)]
          .filter(Boolean)
      ),
    ];
    summary.households = households.length;
    log("households: " + households.length);

    // A paused elder is away (wedding, hospital) — no missed log, no message,
    // no call. The app already hides reminders; escalation has to match it.
    // pauseUntil lives on the elder's member row.
    const pausedMembers = new Set(allMembers.filter((m) => Number(m.pauseUntil || 0) > Date.now()).map((m) => m.$id));
    log("paused members: " + pausedMembers.size);

    for (const householdId of households) {
      const medicines = allMedicines.filter((m) => m.householdId === householdId);
      const logs = todayLogs.filter((l) => l.householdId === householdId);
      // Every family member with a number, not just one: someone may be asleep,
      // abroad, or simply not the person who can go check.
      const numbers = [
        ...new Set(
          allMembers
            .filter((m) => m.householdId === householdId && m.role === "family")
            .map((m) => waNumber(m.phone))
            .filter(Boolean)
        ),
      ];
      summary.checked += medicines.length;

      const alerts = await listRows("alerts", [{ method: "equal", attribute: "householdId", values: [householdId] }, { method: "limit", values: [1000] }]).catch(() => []);
      const alertsById = new Map(alerts.map((a) => [a.$id, a]));

      if (!numbers.length) {
        summary.noNumber++;
        log(`household ${householdId}: no usable family number (${medicines.length} medicines unchecked for alerts)`);
      }

      const takenKeys = new Set(logs.filter((l) => l.status === "taken").map((l) => l.medicineId + "|" + l.slot));
      // The elder's own phone number: the voice agent calls THEM, not family.
      const elderNumbers = (hid) =>
        [...new Set(allMembers.filter((m) => m.householdId === hid && m.role === "elder").map((m) => waNumber(m.phone)).filter(Boolean))];

      for (const med of medicines) {
        if (med.elderId && pausedMembers.has(med.elderId)) {
          summary.paused++;
          continue;
        }
        let times = [];
        try {
          times = JSON.parse(med.times || "[]");
        } catch {
          error("bad times for " + med.$id);
        }
        for (const slot of times) {
          const overdue = now - minutesOf(slot);
          if (overdue < GRACE_MINUTES) continue;
          // A dose taken late stops the retries: the alert is no longer true.
          if (takenKeys.has(med.$id + "|" + slot)) continue;

          const created = await createRow("taken_logs", rowId("miss", [med.$id, slot, date]), {
            elderId: med.elderId || "",
            medicineId: med.$id,
            nickname: med.nickname,
            slot: slot,
            date: date,
            status: "missed",
            units: 0,
            at: Date.now(),
            deviceId: "checker",
            householdId: householdId,
          }).catch((e) => {
            error("missed log: " + String(e).slice(0, 150));
            return false;
          });
          if (created) summary.missed++;

          const text = `MedscopeOne: ${med.nickname} (${med.name}) - the ${slot} dose was not taken today. Please check on them.`;
          for (const number of numbers) {
            await deliver({
              alertsById,
              summary,
              id: rowId("wa", [med.$id, slot, date, number]),
              channel: "whatsapp",
              number,
              text,
              hint: `${date} ${slot}`,
              data: { elderId: med.elderId || "", medicineId: med.$id, message: `${med.nickname} ${slot} missed -> ${number}`, householdId },
              send: () => sendWhatsApp(number, text, `${date} ${slot}`),
              log,
              error,
            });
          }

          // The elder's phone gets the voice-agent call: it speaks the reminder
          // in the elder's language and waits for a spoken confirmation. The
          // call outcome arrives at the voice-webhook; the app is the other
          // confirmation path.
          if (overdue >= CALL_AFTER_MINUTES) {
            const elderMember = allMembers.find((m) => m.id === med.elderId || m.deviceKey === med.elderId);
            const elderLang = elderMember?.lang || "bn";
            const greeting = elderGreeting(elderLang, elderMember?.name || "", med.nickname);
            for (const number of elderNumbers(householdId)) {
              const outcome = await deliver({
                alertsById,
                summary,
                id: rowId("call", [med.$id, slot, date, number]),
                channel: "call",
                number,
                text: greeting,
                hint: `${date} ${slot}`,
                data: { elderId: med.elderId || "", medicineId: med.$id, message: `${med.nickname} ${slot} voice-agent call -> ${number}`, householdId },
                send: () => voiceAgentCall(number, {
                  greeting,
                  lang: elderLang,
                  elderName: elderMember?.name || "",
                  medicine: med.nickname,
                  slot,
                  date,
                  householdId,
                  medicineId: med.$id,
                }),
                log,
                error,
              });
              if (outcome && outcome.attemptId) {
                await updateRow("alerts", rowId("call", [med.$id, slot, date, number]), { message: `${med.nickname} ${slot} call attempt ${outcome.attemptId}` }).catch(() => {});
              }
            }
          }

          // Second family warning: at least 2 hours after the dose time, and
          // only if the elder still hasn't confirmed on the app or by voice.
          if (overdue >= SECOND_WARN_MINUTES) {
            const again = `MedscopeOne: STILL not taken — ${med.nickname} (${med.name}), the ${slot} dose. It has been ${Math.floor(overdue / 60)}+ hours. Please check on them now.`;
            for (const number of numbers) {
              await deliver({
                alertsById,
                summary,
                id: rowId("wa2", [med.$id, slot, date, number]),
                channel: "whatsapp",
                number,
                text: again,
                hint: `${date} ${slot}`,
                data: { elderId: med.elderId || "", medicineId: med.$id, message: `${med.nickname} ${slot} STILL missed -> ${number}`, householdId },
                send: () => sendWhatsApp(number, again, `${date} ${slot}`),
                log,
                error,
              });
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
