// Sends the three messages the app can produce, to one number, using the same
// text-then-template logic as the checker. Usage: node functions/send-examples.cjs [number]
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const env = fs.readFileSync(path.join(root, ".env"), "utf8");
const val = (n) => (env.match(new RegExp("^" + n + "=(.*)$", "m")) || [])[1]?.trim();
const token = val("WHATSAPP_TOKEN");
const phoneId = val("WHATSAPP_PHONE_NUMBER_ID");
const templateName = val("WHATSAPP_TEMPLATE_NAME");
const templateLang = val("WHATSAPP_TEMPLATE_LANG") || "en_US";
const to = String(process.argv[2] || "919123313155").replace(/\D/g, "");

if (!token || !phoneId) { console.log("missing WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID in .env"); process.exit(1); }

function send(body) {
  const tmp = path.join(root, "scratchpad-tmp", "wa-send.json");
  fs.writeFileSync(tmp, JSON.stringify(body));
  const out = execSync(
    `curl -s -X POST "https://graph.facebook.com/v23.0/${phoneId}/messages" -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" --data "@${tmp}"`,
    { encoding: "utf8", timeout: 30000 }
  );
  try { return JSON.parse(out); } catch { return { raw: out.slice(0, 200) }; }
}

const examples = [
  "MedscopeOne reminder: Amlodipine 5mg at 08:00. One tablet, with water.",
  "MedscopeOne: the 08:00 dose of Amlodipine was not taken today. Please check on Kabir.",
  "MedscopeOne: Amlodipine has about 2 days of tablets left. Please buy more.",
];

(async () => {
  for (const [i, text] of examples.entries()) {
    let via = "text";
    let r;
    // A configured template goes first: free-form text is silently dropped
    // outside the 24-hour window even though Meta returns a message id.
    if (templateName) {
      via = "template";
      r = send({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: templateLang },
          components: [{ type: "body", parameters: [{ type: "text", text }, { type: "text", text: "example" }] }],
        },
      });
    }
    if (!r || !r.messages) {
      via = "text";
      r = send({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: text } });
    }
    console.log(`#${i + 1} via ${via}:`, r.messages ? `sent id=${r.messages[0].id}${r.messages[0].message_status ? " status=" + r.messages[0].message_status : ""}` : JSON.stringify(r).slice(0, 160));
    await new Promise((res) => setTimeout(res, 800));
  }
})();
