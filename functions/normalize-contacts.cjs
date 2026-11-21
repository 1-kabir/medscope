// Contacts are saved with a country code from now on. This rewrites rows that
// were stored before that, so the checker does not have to guess at send time.
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
    const tmp = path.join(TMP, "phone-body.json");
    fs.writeFileSync(tmp, JSON.stringify(body));
    args.push("--data", `@${tmp}`);
  }
  const out = execSync("curl " + args.map((a) => `"${a}"`).join(" "), { encoding: "utf8", timeout: 60000 });
  try { return JSON.parse(out); } catch { return { raw: out.slice(0, 200) }; }
}

const normalize = (raw) => {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = "91" + d;
  return d;
};

(async () => {
  const list = api("GET", "/tablesdb/medscope/tables/contacts/rows?queries[]=" + encodeURIComponent(JSON.stringify({ method: "limit", values: [100] })));
  for (const c of list.rows || []) {
    const next = normalize(c.whatsapp);
    if (!next || next === c.whatsapp) {
      console.log(`${c.$id} ${c.name}: ${c.whatsapp} (unchanged)`);
      continue;
    }
    const r = api("PATCH", `/tablesdb/medscope/tables/contacts/rows/${c.$id}`, { data: { whatsapp: next } });
    console.log(`${c.$id} ${c.name}: ${c.whatsapp} -> ${r.whatsapp || JSON.stringify(r).slice(0, 120)}`);
  }
})();
