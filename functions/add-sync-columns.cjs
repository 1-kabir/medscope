// Adds the columns the app already writes but the schema was missing.
// Without them every medicine/log sync is rejected with
// "Invalid document structure: Unknown attribute", so nothing reaches the
// database and the escalation checker has nothing to check.
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const key = fs.readFileSync(path.join(root, ".env"), "utf8").match(/APPWRITE_API_KEY=(.+)/)[1].trim();
const BASE = "https://appwrite.kabirstudios.com/v1";
const TMP = path.join(root, "scratchpad-tmp");

function api(method, urlPath, body) {
  const args = ["-s", "-X", method, `${BASE}${urlPath}`, "-H", "X-Appwrite-Project: medscope", "-H", `X-Appwrite-Key: ${key}`, "-H", "Content-Type: application/json"];
  if (body) {
    fs.mkdirSync(TMP, { recursive: true });
    const tmp = path.join(TMP, "colbody.json");
    fs.writeFileSync(tmp, JSON.stringify(body));
    args.push("--data", `@${tmp}`);
  }
  const out = execSync("curl " + args.map((a) => `"${a}"`).join(" "), { encoding: "utf8", timeout: 120000 });
  try { return JSON.parse(out); } catch { return { raw: out.slice(0, 200) }; }
}

(async () => {
  const plan = [
    { table: "medicines", type: "float", key: "dosePerSlot", body: { key: "dosePerSlot", required: false, default: 1, min: 0, max: 100 } },
    { table: "taken_logs", type: "float", key: "units", body: { key: "units", required: false, default: 0, min: 0, max: 100 } },
    // Retry bookkeeping: how many delivery attempts an alert has had.
    { table: "alerts", type: "integer", key: "attempts", body: { key: "attempts", required: false, default: 0, min: 0, max: 1000 } },
  ];
  for (const c of plan) {
    let r = api("POST", `/tablesdb/medscope/tables/${c.table}/columns/${c.type}`, c.body);
    if (r.code === 400 || r.code === 404) {
      // Older builds name the float column type differently; try `double`.
      r = api("POST", `/tablesdb/medscope/tables/${c.table}/columns/double`, c.body);
      if (r.$id) r.note = "created as double";
    }
    console.log(`${c.table}.${c.key}:`, r.$id ? "ok " + (r.note || "") : r.code === 409 ? "already exists" : JSON.stringify(r).slice(0, 200));
    await new Promise((res) => setTimeout(res, 1200));
  }
})();
