// Verifies the checker's WhatsApp creds by executing it and reporting the
// result. If no dose is overdue it reports zeros — still proof creds load.
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
  // wait for deployment
  for (let i = 0; i < 40; i++) {
    const list = api("GET", "/functions/checker/deployments?queries[]=" + encodeURIComponent(JSON.stringify({ method: "orderDesc", values: ["createdAt"] })) + "&queries[]=" + encodeURIComponent(JSON.stringify({ method: "limit", values: [1] })));
    const d = (list.deployments || [])[0];
    console.log("deploy:", d.status);
    if (d.status === "ready") break;
    if (d.status === "failed") { console.log("BUILD FAILED"); process.exit(1); }
    await new Promise((r) => setTimeout(r, 5000));
  }
  const run = api("POST", "/functions/checker/executions", { async: false });
  console.log("execution status:", run.status);
  console.log("response:", String(run.responseBody || "").slice(0, 300));
  if (run.errors) console.log("errors:", String(run.errors).slice(0, 400));
})();
