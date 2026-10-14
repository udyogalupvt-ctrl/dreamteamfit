// Restore business records from the backup Google Sheet into Firestore. ONLY RUN ON THE OWNER'S WORD.
//
//   node --experimental-strip-types scripts/restore-from-sheet.mjs <keyFile> <sheetId> <collection|all> \
//        [--doc <id>] [--apply] [--confirm <projectId>]
//
// - Reads the hidden `_data_<collection>` tabs with a READ-ONLY Sheets scope, decodes every row back
//   into the exact Firestore values (Timestamps, GeoPoints, references, bytes), and compares them with
//   what Firestore holds now. Prints per collection "new N · different N · same N" with up to 20 ids each.
// - Without --apply it writes NOTHING.
// - With --apply it writes the "new" and "different" records (batches of 400). It never deletes anything
//   and refuses the collections that are never copied to the sheet (secrets, logs, queues).
// - Against production (FIRESTORE_EMULATOR_HOST not set) --apply also needs --confirm <projectId>, the
//   same project_id as in the key file, so a wrong key file cannot write to the wrong project.
// - Test switches (never needed for real use): FIRESTORE_EMULATOR_HOST, SHEETS_API_BASE, GOOGLE_TOKEN_URL.
//
// The key and the access token are never printed.
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXCLUDED_COLLECTIONS,
  decodeValue,
  rowToRecord,
} from "../src/lib/sheet-backup/restore-codec.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const REAL_TOKEN_URL = "https://oauth2.googleapis.com/token";
const BATCH = 400;
const SHOW = 20;
const PREFIX = "_data_";

const USAGE =
  "Usage: node --experimental-strip-types scripts/restore-from-sheet.mjs <keyFile> <sheetId> <collection|all> [--doc <id>] [--apply] [--confirm <projectId>]";

class Refuse extends Error {}
const refuse = (msg) => {
  throw new Refuse(msg);
};

/* ------------------------------------------------------------------ arguments */

function parseArgs(argv) {
  const pos = [];
  const opt = { apply: false, doc: null, confirm: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") opt.apply = true;
    else if (a === "--doc" || a === "--confirm") {
      const v = argv[++i];
      if (!v || v.startsWith("--")) refuse(`${a} needs a value.\n${USAGE}`);
      opt[a.slice(2)] = v;
    } else if (a.startsWith("--")) refuse(`Unknown option ${a}.\n${USAGE}`);
    else pos.push(a);
  }
  if (pos.length !== 3) refuse(USAGE);
  return { keyFile: pos[0], sheetId: pos[1], target: pos[2], ...opt };
}

/* ------------------------------------------------------------- Sheets (read only) */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sheetsReader(key, sheetId) {
  const base = (process.env.SHEETS_API_BASE ?? "https://sheets.googleapis.com").replace(/\/+$/, "");
  const tokenUrl = process.env.GOOGLE_TOKEN_URL ?? REAL_TOKEN_URL;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: key.client_email,
    scope: SCOPE,
    aud: REAL_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(key.private_key).toString("base64url");
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token)
    throw new Error(
      `Google sign-in failed (${res.status}): ${String(body.error_description ?? body.error ?? "no token").slice(0, 160)}`,
    );
  const token = body.access_token;
  const root = `${base}/v4/spreadsheets/${encodeURIComponent(sheetId)}`;

  async function get(path) {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(`${root}${path}`, { headers: { authorization: `Bearer ${token}` } });
      if (r.ok) return r.json();
      const wait = [1500, 4000, 9000][attempt];
      if ((r.status === 429 || r.status >= 500) && wait !== undefined) {
        await sleep(wait);
        continue;
      }
      const err = await r.json().catch(() => ({}));
      throw new Error(`Google Sheets ${r.status}: ${String(err.error?.message ?? r.statusText).slice(0, 200)}`);
    }
  }

  return {
    async tabTitles() {
      const j = await get("?fields=sheets(properties(title))");
      return (j.sheets ?? []).map((s) => s.properties.title);
    },
    async readTab(title) {
      const range = encodeURIComponent(`'${title.replace(/'/g, "''")}'`);
      const j = await get(`/values/${range}?valueRenderOption=UNFORMATTED_VALUE`);
      return j.values ?? [];
    },
  };
}

/* ------------------------------------------------------------------- comparing */

function equal(a, b, F) {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return Number.isNaN(a) && Number.isNaN(b);
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  // The copy keeps Timestamps to the millisecond (all the app's own are).
  if (a instanceof F.Timestamp || b instanceof F.Timestamp)
    return a instanceof F.Timestamp && b instanceof F.Timestamp && a.toMillis() === b.toMillis();
  if (a instanceof F.GeoPoint || b instanceof F.GeoPoint)
    return a instanceof F.GeoPoint && b instanceof F.GeoPoint && a.isEqual(b);
  if (a instanceof F.DocumentReference || b instanceof F.DocumentReference)
    return a instanceof F.DocumentReference && b instanceof F.DocumentReference && a.path === b.path;
  if (a instanceof Uint8Array || b instanceof Uint8Array)
    return a instanceof Uint8Array && b instanceof Uint8Array && Buffer.from(a).equals(Buffer.from(b));
  if (Array.isArray(a) || Array.isArray(b))
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => equal(x, b[i], F));
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && equal(a[k], b[k], F));
}

const differingFields = (want, have, F) =>
  [...new Set([...Object.keys(want), ...Object.keys(have)])]
    .filter((k) => !(Object.hasOwn(want, k) && Object.hasOwn(have, k) && equal(want[k], have[k], F)))
    .sort();

const list = (ids) =>
  ids.slice(0, SHOW).join(", ") + (ids.length > SHOW ? `, … and ${ids.length - SHOW} more` : "");

/* ------------------------------------------------------------------------ main */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const all = args.target === "all";

  // Refusals first: nothing below this block runs when one of them fires.
  if (!all && EXCLUDED_COLLECTIONS.has(args.target))
    refuse(`"${args.target}" is never copied to the sheet (secrets, logs, queues), so it cannot be restored from it.`);
  if (!all && args.target.includes("/")) refuse("Give a root collection name, for example payments.");

  let key;
  try {
    key = JSON.parse(readFileSync(args.keyFile, "utf8"));
  } catch {
    refuse(`Cannot read the key file "${args.keyFile}" (it must be the service account JSON).`);
  }
  if (!key?.project_id || !key?.client_email || !key?.private_key)
    refuse("The key file is not a service account JSON (project_id, client_email and private_key are needed).");

  const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
  if (emulator && !process.env.SHEETS_API_BASE)
    refuse("Refusing to read the real Google Sheet while FIRESTORE_EMULATOR_HOST is set.");
  if (args.apply && !emulator) {
    if (!args.confirm)
      refuse(
        `--apply writes to the LIVE Firestore of project "${key.project_id}". Add --confirm ${key.project_id} to go ahead (and only on the owner's word).`,
      );
    if (args.confirm !== key.project_id)
      refuse(
        `--confirm "${args.confirm}" does not match the key file's project "${key.project_id}". Nothing was written.`,
      );
  }

  const require = createRequire(join(REPO, "package.json"));
  const { initializeApp, cert } = require("firebase-admin/app");
  const F = require("firebase-admin/firestore");
  initializeApp({ credential: cert(key), projectId: key.project_id });
  const db = F.getFirestore();
  const make = {
    ts: (d) => F.Timestamp.fromDate(d),
    geo: (lat, lng) => new F.GeoPoint(lat, lng),
    ref: (path) => db.doc(path),
    bytes: (b64) => Buffer.from(b64, "base64"),
  };

  console.log(
    `${args.apply ? "APPLY" : "Dry run"} · project ${key.project_id}${emulator ? " (emulator)" : ""} · ${all ? "all collections" : args.target}${args.doc ? ` · doc ${args.doc}` : ""}`,
  );

  const sheets = await sheetsReader(key, args.sheetId);
  const titles = await sheets.tabTitles();
  let collections;
  if (all) {
    collections = titles.filter((t) => t.startsWith(PREFIX)).map((t) => t.slice(PREFIX.length));
    for (const c of collections.filter((c) => EXCLUDED_COLLECTIONS.has(c)))
      console.log(`Skipping _data_${c}: never restored.`);
    collections = collections.filter((c) => !EXCLUDED_COLLECTIONS.has(c)).sort();
    if (!collections.length) refuse("The sheet has no _data_ tabs.");
  } else {
    if (!titles.includes(PREFIX + args.target)) refuse(`The sheet has no tab "${PREFIX}${args.target}".`);
    collections = [args.target];
  }

  const totals = { new: 0, different: 0, same: 0, wrote: 0 };
  for (const col of collections) {
    const rows = (await sheets.readTab(PREFIX + col)).slice(1); // row 1 is the header
    const want = new Map();
    for (const row of rows) {
      if (!row.length || String(row[0] ?? "") === "") continue; // a cleared row
      const rec = rowToRecord(row.map((c) => (c === undefined || c === null ? "" : String(c))));
      if (args.doc && rec.id !== args.doc) continue;
      want.set(rec.id, decodeValue(rec.data, make));
    }

    let have = new Map();
    if (args.doc) {
      const s = await db.collection(col).doc(args.doc).get();
      if (s.exists) have.set(s.id, s.data());
    } else {
      const snap = await db.collection(col).get();
      have = new Map(snap.docs.map((d) => [d.id, d.data()]));
    }

    const fresh = [];
    const changed = [];
    let same = 0;
    for (const [id, data] of [...want].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const now = have.get(id);
      if (!now) fresh.push(id);
      else if (equal(data, now, F)) same++;
      else changed.push({ id, fields: differingFields(data, now, F) });
    }
    console.log(`\n${col}: new ${fresh.length} · different ${changed.length} · same ${same}`);
    if (fresh.length) console.log(`  new: ${list(fresh)}`);
    if (changed.length)
      console.log(
        `  different: ${list(changed.map((c) => `${c.id} (${c.fields.slice(0, 6).join(", ")}${c.fields.length > 6 ? ", …" : ""})`))}`,
      );
    totals.new += fresh.length;
    totals.different += changed.length;
    totals.same += same;

    if (args.apply) {
      const ids = [...fresh, ...changed.map((c) => c.id)];
      for (let i = 0; i < ids.length; i += BATCH) {
        const batch = db.batch();
        for (const id of ids.slice(i, i + BATCH)) batch.set(db.collection(col).doc(id), want.get(id));
        await batch.commit();
      }
      totals.wrote += ids.length;
      if (ids.length) console.log(`  wrote ${ids.length} to ${col}: ${list(ids)}`);
    }
  }

  console.log(
    `\nTotal: new ${totals.new} · different ${totals.different} · same ${totals.same}`,
  );
  console.log(
    args.apply
      ? `Wrote ${totals.wrote} record${totals.wrote === 1 ? "" : "s"}. Nothing was deleted.`
      : "Dry run: nothing was written. Add --apply to restore the new and different records.",
  );
}

main().catch((e) => {
  console.error(e instanceof Refuse ? `Refused: ${e.message}` : `Failed: ${e?.message ?? e}`);
  process.exit(e instanceof Refuse ? 2 : 1);
});
