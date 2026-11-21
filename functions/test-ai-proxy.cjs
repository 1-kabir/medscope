// Polls the latest ai-proxy deployment until built, then smoke-tests POST.
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const key = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8").match(/APPWRITE_API_KEY=(.+)/)[1].trim();
const BASE = "https://appwrite.kabirstudios.com/v1";

function api(method, urlPath, body) {
  const args = ["-s", "-X", method, `${BASE}${urlPath}`, "-H", "X-Appwrite-Project: medscope", "-H", `X-Appwrite-Key: ${key}`, "-H", "Content-Type: application/json"];
  if (body) {
    const tmp = path.join(__dirname, "..", "scratchpad-tmp", "body.json");
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

  // Guest smoke test: no API key header, just the project header
  const tmp = path.join(__dirname, "..", "scratchpad-tmp", "smoke.json");
  fs.writeFileSync(tmp, JSON.stringify({ imageDataUrl: "data:image/png;base64,iVBORw0KGgo=", lang: "en" }));
  const out = execSync(
    `curl -s -X POST "${BASE}/functions/ai-proxy/executions" -H "X-Appwrite-Project: medscope" -H "Content-Type: application/json" --data "@${tmp}"`,
    { encoding: "utf8", timeout: 120000 }
  );
  const j = JSON.parse(out);
  console.log("smoke:", j.status, String(j.responseBody || "").slice(0, 200));
})();
