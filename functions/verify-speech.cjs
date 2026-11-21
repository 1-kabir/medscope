// Verifies sarvam-speech end-to-end: deployment ready? variable set? does a
// real TTS execution return audio?
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
  // 1. deployment status
  const list = api("GET", "/functions/sarvam-speech/deployments?queries[]=" + encodeURIComponent(JSON.stringify({ method: "orderDesc", values: ["createdAt"] })) + "&queries[]=" + encodeURIComponent(JSON.stringify({ method: "limit", values: [1] })));
  const d = (list.deployments || [])[0];
  console.log("deployment:", d ? d.status : "none", d && d.status !== "ready" ? "!!!" : "");

  // 2. variable present?
  const vars = api("GET", "/functions/sarvam-speech/variables");
  console.log("variables:", (vars.variables || []).map((v) => v.key + (v.value ? " (value hidden)" : " (EMPTY)")).join(", ") || "none");

  // 3. live TTS execution
  const payload = { body: JSON.stringify({ action: "tts", text: "এখন ওষুধ খাওয়ার সময়", lang: "bn" }) };
  const exec = api("POST", "/functions/sarvam-speech/executions", payload);
  console.log("execution:", exec.status);
  const out = JSON.parse(exec.responseBody || "{}");
  if (out.audio) {
    console.log("TTS OK — audio length (base64 chars):", out.audio.length);
    fs.writeFileSync(path.join(root, "scratchpad-tmp", "tts-sample.b64"), out.audio);
  } else {
    console.log("TTS FAILED:", JSON.stringify(out).slice(0, 300));
    if (exec.errors) console.log("function errors:", String(exec.errors).slice(0, 300));
  }
})();
