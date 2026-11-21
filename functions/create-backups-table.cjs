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
  const out = execSync("curl " + args.map((a) => `"${a}"`).join(" "), { encoding: "utf8", timeout: 120000 });
  try { return JSON.parse(out); } catch { return { raw: out.slice(0, 200) }; }
}

(async () => {
  let r = api("POST", "/tablesdb/medscope/tables", { tableId: "backups", name: "backups" });
  console.log("table backups:", r.$id ? "created" : r.code === 409 ? "exists" : JSON.stringify(r).slice(0, 150));
  await new Promise((res) => setTimeout(res, 1500));

  // userId is indexed; payload holds the whole snapshot (large string)
  for (const c of [
    { key: "userId", type: "varchar", size: 64 },
    { key: "payload", type: "string", size: 2000000 },
  ]) {
    r = api("POST", "/tablesdb/medscope/tables/backups/columns/string", { key: c.key, size: c.size, required: false });
    console.log("col", c.key, r.$id || r.code === 409 ? "ok" : JSON.stringify(r).slice(0, 120));
    await new Promise((res) => setTimeout(res, 800));
  }
  r = api("POST", "/tablesdb/medscope/tables/backups/indexes", { key: "userId", type: "key", columns: ["userId"] });
  console.log("idx userId:", r.$id || r.code === 409 ? "ok" : JSON.stringify(r).slice(0, 120));
})();
