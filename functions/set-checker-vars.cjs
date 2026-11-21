// Sets WhatsApp/Sarvam variables on the checker function from .env, then
// redeploys. Run after filling .env: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID,
// WHATSAPP_TEMPLATE_NAME (optional custom template), WHATSAPP_TEMPLATE_LANG,
// SARVAM_API_KEY.
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
    fs.writeFileSync(path.join(TMP, "body.json"), JSON.stringify(body));
    args.push("--data", `@${path.join(TMP, "body.json")}`);
  }
  return JSON.parse(execSync("curl " + args.map((a) => `"${a}"`).join(" "), { encoding: "utf8", timeout: 120000 }));
}

(async () => {
  fs.mkdirSync(TMP, { recursive: true });
  const env = fs.readFileSync(path.join(root, ".env"), "utf8");
  for (const name of ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_TEMPLATE_NAME", "WHATSAPP_TEMPLATE_LANG", "SARVAM_API_KEY"]) {
    const m = env.match(new RegExp("^" + name + "=(.*)$", "m"));
    if (!m || !m[1].trim()) { console.log("var", name, "skipped (not in .env)"); continue; }
    let v = api("POST", "/functions/checker/variables", { variableId: name, key: name, value: m[1].trim() });
    if (!v.$id) v = api("PUT", `/functions/checker/variables/${name}`, { value: m[1].trim() });
    console.log("var", name, v.$id ? "set" : JSON.stringify(v).slice(0, 100));
  }

  // Redeploy so the new variables take effect
  const tgz = path.join(TMP, "checker.tar.gz");
  const fnDir = path.join(__dirname, "checker");
  execSync(`tar -czf "${tgz}" -C "${fnDir}" src package.json`, { timeout: 120000, shell: true });
  const up = `-H "X-Appwrite-Project: medscope" -H "X-Appwrite-Key: ${key}"`;
  const out = execSync(`curl -s -X POST "${BASE}/functions/checker/deployments" ${up} -F "entrypoint=src/main.js" -F "activate=true" -F "code=@${tgz.replace(/\\/g, "/")};type=application/gzip"`, { encoding: "utf8", timeout: 300000 });
  const d = JSON.parse(out);
  console.log("deployment:", d.$id ? d.$id + " status=" + d.status : JSON.stringify(d).slice(0, 200));
})();
