// Deploys the checker function to Appwrite: create function, set schedule,
// upload code zip, activate. Uses curl for every call (node fetch dies on
// the second request in this environment).

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const key = fs.readFileSync(".env", "utf8").match(/APPWRITE_API_KEY=(.+)/)[1].trim();
const BASE = "https://appwrite.kabirstudios.com/v1";
const TMP = path.join(__dirname, "..", "..", "scratchpad-tmp");

function api(method, urlPath, body) {
  const args = ["-s", "-X", method, `${BASE}${urlPath}`, "-H", "X-Appwrite-Project: medscope", "-H", `X-Appwrite-Key: ${key}`, "-H", "Content-Type: application/json"];
  if (body) {
    const tmp = path.join(TMP, "body.json");
    fs.writeFileSync(tmp, JSON.stringify(body));
    args.push("--data", `@${tmp}`);
  }
  const out = execSync("curl " + args.map((a) => `"${a}"`).join(" "), { encoding: "utf8", timeout: 120000 });
  try { return JSON.parse(out); } catch { return { raw: out.slice(0, 200) }; }
}

(async () => {
  fs.mkdirSync(TMP, { recursive: true });

  // 1. Create function (idempotent)
  let j = api("POST", "/functions", {
    functionId: "checker",
    name: "Missed-dose checker",
    runtime: "node-16.0",
    execute: [],
    events: [],
    schedule: "*/10 * * * *",
    timeout: 60,
  });
  console.log("create function:", j.status === 201 ? "created" : j.code === 409 ? "exists" : JSON.stringify(j).slice(0, 200));

  // 2. Package the function directory as tar.gz (bsdtar handles it on Windows)
  const tgzPath = path.join(TMP, "checker.tar.gz");
  if (fs.existsSync(tgzPath)) fs.unlinkSync(tgzPath);
  const fnDir = path.join(__dirname, "checker");
  execSync(`tar -czf "${tgzPath}" -C "${fnDir}" src package.json`, { timeout: 120000, shell: true });
  console.log("tar.gz:", fs.statSync(tgzPath).size, "bytes");

  // 3. Create + activate deployment
  const up = `-H "X-Appwrite-Project: medscope" -H "X-Appwrite-Key: ${key}"`;
  const deployOut = execSync(
    `curl -s -X POST "${BASE}/functions/checker/deployments" ${up} -F "entrypoint=src/main.js" -F "activate=true" -F "code=@${tgzPath.replace(/\\/g, "/")};type=application/gzip"`,
    { encoding: "utf8", timeout: 300000 }
  );
  let deploy;
  try { deploy = JSON.parse(deployOut); } catch { deploy = { raw: deployOut.slice(0, 300) }; }
  console.log("deployment:", deploy.$id ? `${deploy.$id} status=${deploy.status}` : JSON.stringify(deploy).slice(0, 300));

  // 4. Manual trigger to verify
  const run = api("POST", "/functions/checker/executions", { async: false });
  console.log("execution:", run.$id ? `${run.$id} status=${run.status} response=${JSON.stringify(run.responseBody || "").slice(0, 300)}` : JSON.stringify(run).slice(0, 300));
})();
