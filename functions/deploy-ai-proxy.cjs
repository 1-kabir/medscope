// Deploys the ai-proxy function: guest-executable HTTP function that forwards
// vision requests to the OpenAI-compatible endpoint with the server-side key.
// Also pushes OPENAI_* variables from .env when present.

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
    const tmp = path.join(TMP, "body.json");
    fs.writeFileSync(tmp, JSON.stringify(body));
    args.push("--data", `@${tmp}`);
  }
  const out = execSync("curl " + args.map((a) => `"${a}"`).join(" "), { encoding: "utf8", timeout: 120000 });
  try { return JSON.parse(out); } catch { return { raw: out.slice(0, 200) }; }
}

(async () => {
  fs.mkdirSync(TMP, { recursive: true });

  let j = api("POST", "/functions", {
    functionId: "ai-proxy",
    name: "AI vision proxy",
    runtime: "node-16.0",
    execute: ["any"],
    events: [],
    schedule: "",
    timeout: 60,
  });
  console.log("create function:", j.$id ? "created" : j.code === 409 ? "exists" : JSON.stringify(j).slice(0, 200));

  // Push OPENAI_* vars from .env (create or update)
  const env = fs.readFileSync(path.join(root, ".env"), "utf8");  for (const name of ["OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL"]) {
    const m = env.match(new RegExp("^" + name + "=(.*)$", "m"));
    if (!m || !m[1].trim()) { console.log("var", name, "not in .env, skipped"); continue; }
    let v = api("POST", "/functions/ai-proxy/variables", { variableId: name, key: name, value: m[1].trim() });
    if (!v.$id) v = api("PUT", `/functions/ai-proxy/variables/${name}`, { value: m[1].trim() });
    console.log("var", name, v.$id ? "set" : JSON.stringify(v).slice(0, 120));
  }

  const tgzPath = path.join(TMP, "ai-proxy.tar.gz");
  if (fs.existsSync(tgzPath)) fs.unlinkSync(tgzPath);
  const fnDir = path.join(__dirname, "ai-proxy");
  // --force-local keeps GNU tar from reading the Windows drive letter (C:) as
  // a remote host and failing with "Cannot connect to C".
  execSync(`tar -czf "${tgzPath}" -C "${fnDir}" src package.json`, { timeout: 120000, shell: true });

  const up = `-H "X-Appwrite-Project: medscope" -H "X-Appwrite-Key: ${key}"`;
  const deployOut = execSync(
    `curl -s -X POST "${BASE}/functions/ai-proxy/deployments" ${up} -F "entrypoint=src/main.js" -F "activate=true" -F "code=@${tgzPath.replace(/\\/g, "/")};type=application/gzip"`,
    { encoding: "utf8", timeout: 300000 }
  );
  let deploy;
  try { deploy = JSON.parse(deployOut); } catch { deploy = { raw: deployOut.slice(0, 200) }; }
  console.log("deployment:", deploy.$id ? `${deploy.$id} status=${deploy.status}` : JSON.stringify(deploy).slice(0, 250));
})();
