// Demo setup: creates a loginable account for the demo phone, seeds members
// and demo medicines into household 740384, and sets a short grace period so
// escalation fires during the demo.
//   - medicine A: slot ~3 minutes in the future  (notification + TTS on phone)
//   - medicine B: slot ~40 minutes in the past    (instant WhatsApp on check)
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const key = fs.readFileSync(path.join(root, ".env"), "utf8").match(/APPWRITE_API_KEY=(.+)/)[1].trim();
const BASE = "https://appwrite.kabirstudios.com/v1";
const TMP = path.join(root, "scratchpad-tmp");
const HOUSEHOLD = "740384";
const DEMO_PHONE = "919123313155";
const DEMO_PASSWORD = "medscope-demo-2026";

function api(method, urlPath, body) {
  const args = ["-s", "-X", method, `${BASE}${urlPath}`, "-H", "X-Appwrite-Project: medscope", "-H", `X-Appwrite-Key: ${key}`, "-H", "Content-Type: application/json"];
  if (body) {
    fs.mkdirSync(TMP, { recursive: true });
    fs.writeFileSync(path.join(TMP, "body.json"), JSON.stringify(body));
    args.push("--data", `@${path.join(TMP, "body.json")}`);
  }
  return JSON.parse(execSync("curl " + args.map((a) => `"${a}"`).join(" "), { encoding: "utf8", timeout: 120000 }));
}

(async () => {
  fs.mkdirSync(TMP, { recursive: true });

  // 1. Account for the demo phone (number-mapped email, same rule as the app)
  const email = DEMO_PHONE + "@phone.medscope.in";
  let u = api("POST", "/users", { userId: "demo_" + DEMO_PHONE, email, password: DEMO_PASSWORD, name: "Demo (Kabir)" });
  if (u.$id) console.log("account created:", email, "password:", DEMO_PASSWORD);
  else if (u.code === 409) console.log("account exists:", email);
  else console.log("account:", JSON.stringify(u).slice(0, 150));

  // 2. Members: elder + family (the demo phone number)
  const crypto = require("crypto");
  const memberId = (p, s) => p + "_" + crypto.createHash("sha1").update(s).digest("hex").slice(0, 24);
  const elder = { rowId: memberId("eld", "demo-elder"), data: { role: "elder", name: "Dad (demo)", phone: DEMO_PHONE, deviceKey: "", pauseUntil: 0, lang: "bn", householdId: HOUSEHOLD } };
  const family = { rowId: memberId("fam", "demo-family"), data: { role: "family", name: "Kabir (family)", phone: DEMO_PHONE, deviceKey: "", pauseUntil: 0, lang: "bn", householdId: HOUSEHOLD } };
  for (const m of [elder, family]) {
    let r = api("POST", "/tablesdb/medscope/tables/members/rows", { rowId: m.rowId, data: m.data });
    if (r.code === 409) r = api("PATCH", `/tablesdb/medscope/tables/members/rows/${m.rowId}`, { data: m.data });
    console.log("member", m.data.role, ":", r.$id ? "seeded" : JSON.stringify(r).slice(0, 120));
  }

  // 3. Medicines: one due soon, one already overdue (no elderId → shows on any elder phone)
  const slotFuture = new Date(Date.now() + 3 * 60000);
  const slotPast = new Date(Date.now() - 40 * 60000);
  const slot = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const meds = [
    { rowId: "demo_med_soon", data: { nickname: "শুগারের বড়ি (demo)", name: "Metformin 500mg", strength: "500mg", instruction: "১টি, খাবারের পরে", times: JSON.stringify([slot(slotFuture)]), dosePerSlot: 1, tabletsLeft: 14, createdAt: Date.now(), deviceId: "demo", householdId: HOUSEHOLD } },
    { rowId: "demo_med_late", data: { nickname: "প্রেশারের বড়ি (demo)", name: "Telmisartan 40mg", strength: "40mg", instruction: "১টি, পানির সাথে", times: JSON.stringify([slot(slotPast)]), dosePerSlot: 1, tabletsLeft: 9, createdAt: Date.now(), deviceId: "demo", householdId: HOUSEHOLD } },
  ];
  for (const m of meds) {
    let r = api("POST", "/tablesdb/medscope/tables/medicines/rows", { rowId: m.rowId, data: m.data });
    if (r.code === 409) r = api("PATCH", `/tablesdb/medscope/tables/medicines/rows/${m.rowId}`, { data: m.data });
    console.log("medicine:", r.$id ? "seeded (slot " + JSON.parse(m.data.times)[0] + ")" : JSON.stringify(r).slice(0, 120));
  }

  // 4. Short grace period on the checker so escalation fires within the demo
  let v = api("POST", "/functions/checker/variables", { variableId: "ESCALATION_GRACE_MINUTES", key: "ESCALATION_GRACE_MINUTES", value: "2" });
  if (!v.$id) v = api("PUT", "/functions/checker/variables/ESCALATION_GRACE_MINUTES", { value: "2" });
  console.log("checker grace:", v.$id ? "set to 2 minutes" : JSON.stringify(v).slice(0, 120));

  // 5. Redeploy checker for the new variables
  const tgz = path.join(TMP, "checker.tar.gz");
  execSync(`tar -czf "${tgz}" -C "${path.join(__dirname, "checker")}" src package.json`, { timeout: 120000, shell: true });
  const up = `-H "X-Appwrite-Project: medscope" -H "X-Appwrite-Key: ${key}"`;
  const out = execSync(`curl -s -X POST "${BASE}/functions/checker/deployments" ${up} -F "entrypoint=src/main.js" -F "activate=true" -F "code=@${tgz.replace(/\\/g, "/")};type=application/gzip"`, { encoding: "utf8", timeout: 300000 });
  const d = JSON.parse(out);
  console.log("checker deployment:", d.$id ? d.$id + " " + d.status : JSON.stringify(d).slice(0, 150));
})();
