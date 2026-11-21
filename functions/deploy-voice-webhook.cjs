// Deploys voice-webhook (guest-execute POST; receives Sarvam call outcomes)
// and prints the public URL to configure as the Voice Agent webhook.
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
  let j = api("POST", "/functions", {
    functionId: "voice-webhook",
    name: "Voice agent call outcomes",
    runtime: "node-16.0",
    execute: ["any"],
    events: [],
    schedule: "",
    timeout: 30,
  });
  console.log("create function:", j.$id ? "created/exists" : JSON.stringify(j).slice(0, 200));

  const tgz = path.join(TMP, "voice-webhook.tar.gz");
  execSync(`tar -czf "${tgz}" -C "${path.join(__dirname, "voice-webhook")}" src package.json`, { timeout: 120000, shell: true });
  const up = `-H "X-Appwrite-Project: medscope" -H "X-Appwrite-Key: ${key}"`;
  const out = execSync(`curl -s -X POST "${BASE}/functions/voice-webhook/deployments" ${up} -F "entrypoint=src/main.js" -F "activate=true" -F "code=@${tgz.replace(/\\/g, "/")};type=application/gzip"`, { encoding: "utf8", timeout: 300000 });
  const d = JSON.parse(out);
  console.log("deployment:", d.$id ? d.$id + " status=" + d.status : JSON.stringify(d).slice(0, 200));
  console.log("\nWebhook URL for the Sarvam Voice Agent:\n  " + BASE + "/functions/voice-webhook/executions");
})();
