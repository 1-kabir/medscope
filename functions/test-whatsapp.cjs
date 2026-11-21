// Direct WhatsApp send test: hello_world template to a given number.
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const env = fs.readFileSync(path.join(root, ".env"), "utf8");
const val = (n) => (env.match(new RegExp("^" + n + "=(.*)$", "m")) || [])[1]?.trim();
const token = val("WHATSAPP_TOKEN");
const phoneId = val("WHATSAPP_PHONE_NUMBER_ID");
const to = process.argv[2] || "919123313155";

if (!token || !phoneId) { console.log("missing WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID in .env"); process.exit(1); }

const body = JSON.stringify({
  messaging_product: "whatsapp",
  recipient_type: "individual",
  to,
  type: "template",
  template: { name: "hello_world", language: { code: "en_US" } },
});
fs.writeFileSync(path.join(root, "scratchpad-tmp", "wa.json"), body);
const out = execSync(
  `curl -s -X POST "https://graph.facebook.com/v23.0/${phoneId}/messages" -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" --data "@${path.join(root, "scratchpad-tmp", "wa.json")}"`,
  { encoding: "utf8", timeout: 30000 }
);
console.log(out);
