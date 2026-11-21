// Registers web platforms on the Appwrite project so browsers on those
// origins can call the API (without this, CORS blocks everything on Vercel).
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
  const existing = api("GET", "/projects/medscope/platforms");
  const have = new Set((existing.platforms || []).map((p) => p.hostname));
  console.log("already registered:", [...have].join(", ") || "none");

  for (const hostname of ["medscope-rosy.vercel.app", "localhost", "127.0.0.1"]) {
    if (have.has(hostname)) { console.log(hostname, "exists"); continue; }
    const r = api("POST", "/projects/medscope/platforms", { platformId: "web_" + hostname.replace(/[^a-zA-Z0-9]/g, "_"), type: "web", name: hostname, hostname });
    console.log(hostname, r.$id ? "registered" : JSON.stringify(r).slice(0, 150));
  }
})();
