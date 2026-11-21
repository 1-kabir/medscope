const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const key = fs.readFileSync(".env", "utf8").match(/APPWRITE_API_KEY=(.+)/)[1].trim();
const BASE = "https://appwrite.kabirstudios.com/v1";

function api(method, urlPath, body) {
  const args = ["-s", "-X", method, `${BASE}${urlPath}`, "-H", "X-Appwrite-Project: medscope", "-H", `X-Appwrite-Key: ${key}`, "-H", "Content-Type: application/json"];
  if (body) {
    const tmp = path.join(__dirname, "..", "..", "scratchpad-tmp", "body.json");
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(body));
    args.push("--data", `@${tmp}`);
  }
  const out = execSync("curl " + args.map((a) => `"${a}"`).join(" "), { encoding: "utf8", timeout: 120000 });
  try { return JSON.parse(out); } catch { return { raw: out.slice(0, 200) }; }
}

(async () => {
  // Wait for the latest deployment to build
  for (let i = 0; i < 40; i++) {
    const list = api("GET", "/functions/checker/deployments?queries[]=" + encodeURIComponent(JSON.stringify({ method: "orderDesc", values: ["createdAt"] })) + "&queries[]=" + encodeURIComponent(JSON.stringify({ method: "limit", values: [1] })));
    const d = (list.deployments || [])[0];
    if (!d) { console.log("no deployments"); process.exit(1); }
    console.log(`deploy ${d.$id} status=${d.status}`);
    if (d.status === "ready" || d.status === "activated") break;
    if (d.status === "failed" || d.status === "error") {
      const logs = api("GET", `/functions/checker/deployments/${d.$id}`);
      console.log("FAILED:", JSON.stringify(logs).slice(0, 500));
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }

  // Trigger
  const run = api("POST", "/functions/checker/executions", { async: false });
  console.log("execution:", run.$id ? `${run.$id} status=${run.status}` : JSON.stringify(run).slice(0, 200));
  console.log("response:", String(run.responseBody || "").slice(0, 400));
  if (run.errors) console.log("errors:", String(run.errors).slice(0, 400));
})();
