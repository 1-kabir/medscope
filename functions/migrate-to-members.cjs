// One-time migration: contacts + devices rows become members rows.
//  - contacts        -> members(role=family, phone=normalized whatsapp)
//  - devices(elders) -> members(role=elder, deviceKey=device row id, name, pauseUntil)
// Idempotent: member row ids are hashed from the source row id, so re-running
// updates in place instead of duplicating.
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
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

function list(tableId, queries) {
  const p = new URLSearchParams();
  for (const q of queries || []) p.append("queries[]", JSON.stringify(q));
  const r = api("GET", `/tablesdb/medscope/tables/${tableId}/rows?${p.toString()}`);
  return r.rows || [];
}

function memberId(prefix, sourceId) {
  return prefix + "_" + crypto.createHash("sha1").update(sourceId).digest("hex").slice(0, 28);
}

function normalizePhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = "91" + d;
  return /^\d{11,15}$/.test(d) ? d : "";
}

(async () => {
  const [contacts, devices] = await Promise.all([
    list("contacts", [{ method: "limit", values: [500] }]),
    list("devices", [{ method: "limit", values: [500] }]),
  ]);

  let created = 0, updated = 0;
  for (const c of contacts) {
    const phone = normalizePhone(c.whatsapp);
    if (!phone) { console.log("skip contact (no usable number):", c.$id); continue; }
    const id = memberId("fam", c.$id);
    const data = {
      role: "family",
      name: String(c.name || "Family"),
      phone,
      deviceKey: "",
      householdId: String(c.householdId || ""),
    };
    const existing = api("GET", `/tablesdb/medscope/tables/members/rows/${id}`);
    if (existing.$id) {
      api("PATCH", `/tablesdb/medscope/tables/members/rows/${id}`, { data });
      updated++;
    } else {
      const r = api("POST", "/tablesdb/medscope/tables/members/rows", { rowId: id, data });
      if (r.$id) created++; else console.log("ERR contact", c.$id, JSON.stringify(r).slice(0, 120));
    }
  }

  for (const d of devices) {
    if (d.role !== "elder") continue; // family devices already have a member via contacts
    const id = memberId("eld", d.$id);
    const data = {
      role: "elder",
      name: String(d.name || ""),
      phone: "",
      deviceKey: String(d.$id),
      pauseUntil: Number(d.pauseUntil || 0),
      householdId: String(d.householdId || ""),
    };
    const existing = api("GET", `/tablesdb/medscope/tables/members/rows/${id}`);
    if (existing.$id) {
      api("PATCH", `/tablesdb/medscope/tables/members/rows/${id}`, { data });
      updated++;
    } else {
      const r = api("POST", "/tablesdb/medscope/tables/members/rows", { rowId: id, data });
      if (r.$id) created++; else console.log("ERR device", d.$id, JSON.stringify(r).slice(0, 120));
    }
  }

  console.log(`migration done: ${created} members created, ${updated} updated`);
})();
