// Creates the members table — the single directory of people in a household.
// Members replace the contacts table (family numbers) and the directory role
// of the devices table (names, roles, pause).
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
  const out = execSync("curl " + args.map((a) => `"${a}"`).join(" "), { encoding: "utf8", timeout: 120000 });
  try { return JSON.parse(out); } catch { return { raw: out.slice(0, 200) }; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let r = api("POST", "/tablesdb/medscope/tables", {
    tableId: "members",
    name: "members",
    permissions: ['read("any")', 'create("any")', 'update("any")', 'delete("any")'],
  });
  console.log("table members:", r.$id ? "created" : r.code === 409 ? "exists" : JSON.stringify(r).slice(0, 150));
  await sleep(1500);

  const columns = [
    { key: "role", type: "enum", elements: ["elder", "family"] },
    { key: "name", type: "varchar", size: 128 },
    { key: "phone", type: "varchar", size: 32 },
    { key: "deviceKey", type: "varchar", size: 64 },
    { key: "pauseUntil", type: "integer" },
    { key: "householdId", type: "varchar", size: 64 },
  ];
  for (const c of columns) {
    const body = c.type === "enum"
      ? { key: c.key, elements: c.elements, required: false }
      : c.type === "integer"
        ? { key: c.key, required: false }
        : { key: c.key, size: c.size, required: false };
    r = api("POST", "/tablesdb/medscope/tables/members/columns/" + c.type, body);
    console.log("col", c.key, r.$id || r.code === 409 ? "ok" : JSON.stringify(r).slice(0, 120));
    await sleep(800);
  }
  r = api("POST", "/tablesdb/medscope/tables/members/indexes", { key: "householdId", type: "key", columns: ["householdId"] });
  console.log("idx householdId:", r.$id || r.code === 409 ? "ok" : JSON.stringify(r).slice(0, 120));
})();
