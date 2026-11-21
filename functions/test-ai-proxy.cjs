// Polls the latest ai-proxy deployment until built, then smoke-tests POST
// with a real image (a repo screenshot) through the same REST shape the
// client SDK uses: { body: "<stringified function payload>" }.
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const key = fs.readFileSync(path.join(root, ".env"), "utf8").match(/APPWRITE_API_KEY=(.+)/)[1].trim();
const BASE = "https://appwrite.kabirstudios.com/v1";

function api(method, urlPath, body) {
  const args = ["-s", "-X", method, `${BASE}${urlPath}`, "-H", "X-Appwrite-Project: medscope", "-H", `X-Appwrite-Key: ${key}`, "-H", "Content-Type: application/json"];
  if (body) {
    const tmp = path.join(root, "scratchpad-tmp", "body.json");
    fs.writeFileSync(tmp, JSON.stringify(body));
    args.push("--data", `@${tmp}`);
  }
  return JSON.parse(execSync("curl " + args.map((a) => `"${a}"`).join(" "), { encoding: "utf8", timeout: 120000 }));
}

(async () => {
  for (let i = 0; i < 40; i++) {
    const list = api("GET", "/functions/ai-proxy/deployments?queries[]=" + encodeURIComponent(JSON.stringify({ method: "orderDesc", values: ["createdAt"] })) + "&queries[]=" + encodeURIComponent(JSON.stringify({ method: "limit", values: [1] })));
    const d = (list.deployments || [])[0];
    console.log("deploy status:", d.status);
    if (d.status === "ready") break;
    if (d.status === "failed" || d.status === "error") { console.log("BUILD FAILED"); process.exit(1); }
    await new Promise((r) => setTimeout(r, 5000));
  }

  // Real image → data URL
  const imgPath = path.join(root, "ui-fonts.png");
  const b64 = fs.readFileSync(imgPath).toString("base64");
  const payload = { imageDataUrl: `data:image/png;base64,${b64}`, lang: "en" };

  const exec = api("POST", "/functions/ai-proxy/executions", { body: JSON.stringify(payload) });
  console.log("execution:", exec.$id, "status:", exec.status);
  if (exec.responseBody) {
    console.log("response:", String(exec.responseBody).slice(0, 400));
    try {
      const outer = JSON.parse(exec.responseBody);
      const inner = JSON.parse(/({[\s\S]*})/.exec(outer.content || "{}")[1]);
      console.log("parsed fields:", JSON.stringify({ nickname: inner.nickname, name: inner.name, strength: inner.strength, times: inner.times, dosePerSlot: inner.dosePerSlot }));
    } catch (e) {
      console.log("content not JSON-parseable:", String(e).slice(0, 120));
    }
  }
})();
