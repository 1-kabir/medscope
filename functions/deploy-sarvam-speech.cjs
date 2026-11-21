// Deploys sarvam-speech (TTS + STT proxy; key stays server-side) and pushes
// SARVAM_API_KEY from .env into its function variables.
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
    fs.writeFileSync(path.join(TMP, "body.json"), JSON.stringify(body));
    args.push("--data", `@${path.join(TMP, "body.json")}`);
  }
  return JSON.parse(execSync("curl " + args.map((a) => `"${a}"`).join(" "), { encoding: "utf8", timeout: 120000 }));
}

(async () => {
  fs.mkdirSync(TMP, { recursive: true });
  let j = api("POST", "/functions", {
    functionId: "sarvam-speech",
    name: "Sarvam speech proxy",
    runtime: "node-16.0",
    execute: ["any"],
    events: [],
    schedule: "",
    timeout: 30,
  });
  console.log("create function:", j.$id ? "created/exists" : JSON.stringify(j).slice(0, 200));

  const env = fs.readFileSync(path.join(root, ".env"), "utf8");
  const sarvamKey = (env.match(/^SARVAM_API_KEY=(.*)$/m) || [])[1]?.trim();
  if (sarvamKey) {
    let v = api("POST", "/functions/sarvam-speech/variables", { variableId: "SARVAM_API_KEY", key: "SARVAM_API_KEY", value: sarvamKey });
    if (!v.$id) v = api("PUT", "/functions/sarvam-speech/variables/SARVAM_API_KEY", { value: sarvamKey });
    console.log("var SARVAM_API_KEY:", v.$id ? "set" : JSON.stringify(v).slice(0, 120));
  } else {
    console.log("var SARVAM_API_KEY: NOT IN .env — add it before use");
  }

  const tgz = path.join(TMP, "sarvam-speech.tar.gz");
  if (fs.existsSync(tgz)) fs.unlinkSync(tgz);
  execSync(`tar -czf "${tgz}" -C "${path.join(__dirname, "sarvam-speech")}" src package.json`, { timeout: 120000, shell: true });
  const up = `-H "X-Appwrite-Project: medscope" -H "X-Appwrite-Key: ${key}"`;
  const out = execSync(`curl -s -X POST "${BASE}/functions/sarvam-speech/deployments" ${up} -F "entrypoint=src/main.js" -F "activate=true" -F "code=@${tgz.replace(/\\/g, "/")};type=application/gzip"`, { encoding: "utf8", timeout: 300000 });
  const d = JSON.parse(out);
  console.log("deployment:", d.$id ? d.$id + " status=" + d.status : JSON.stringify(d).slice(0, 200));
})();
