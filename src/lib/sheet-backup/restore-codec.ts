/**
 * The restore copy: one Firestore record <-> one sheet row, so the app can be rebuilt from the
 * hidden `_data_<collection>` tabs. A row is [id, updatedAt, json chunk 1, json chunk 2, ...]; the
 * JSON holds the whole record with the special Firestore values tagged so they come back exactly
 * ({"__ts": ISO} for a Timestamp, {"__geo": [lat, lng]}, {"__ref": "path"}, {"__b64": "..."}).
 *
 * Pure (no firebase-admin): the restore script passes the real constructors to decodeValue.
 * Timestamps are kept to the millisecond (all the app's own are).
 */

/** A sheet cell holds at most 50,000 characters; stay well under. */
export const CELL_LIMIT = 45000;

/** Root collections that never go in the sheet: secrets, logs, queues and things the app regenerates. */
export const EXCLUDED_COLLECTIONS: ReadonlySet<string> = new Set([
  "serverSecrets",
  "staffPrivate",
  "loginVault",
  "pushSubscriptions",
  "oldSoftwareMoveSeals",
  "auditLogs",
  "deviceLog",
  "biometricCommands",
  "whatsappMessages",
  "whatsappWebhookEvents",
  "whatsappWebhookStatus",
  "waChats",
  "automationActivities",
  "notifications",
  "renewalNotifications",
  "birthdayNotifications",
  "absenceNotifications",
  "paymentDueNotifications",
  "expenseActivities",
  "leadLogs",
  "cfoBriefs",
  "cfoReports",
]);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;
const hasFn = (v: Obj, name: string) => typeof v[name] === "function";

/** Firestore value -> JSON-safe value (see the file header for the tags). */
export function encodeValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") {
    if (Number.isFinite(v)) return v;
    return { __num: Number.isNaN(v) ? "NaN" : v > 0 ? "Infinity" : "-Infinity" };
  }
  if (typeof v !== "object") return v; // string, boolean
  if (v instanceof Date) return { __ts: v.toISOString() };
  if (v instanceof Uint8Array) return { __b64: Buffer.from(v).toString("base64") };
  if (Array.isArray(v)) return v.map(encodeValue);
  const o = v as Obj;
  if (hasFn(o, "toDate")) return { __ts: (o["toDate"] as () => Date)().toISOString() };
  // A Timestamp that went through JSON: {_seconds, _nanoseconds} or {seconds, nanoseconds}.
  const secs = o["_seconds"] ?? o["seconds"];
  const nanos = o["_nanoseconds"] ?? o["nanoseconds"];
  if (typeof secs === "number" && typeof nanos === "number" && Object.keys(o).length === 2)
    return { __ts: new Date(secs * 1000 + Math.floor(nanos / 1e6)).toISOString() };
  const lat = o["latitude"] ?? o["_latitude"];
  const lng = o["longitude"] ?? o["_longitude"];
  if (typeof lat === "number" && typeof lng === "number" && hasFn(o, "isEqual"))
    return { __geo: [lat, lng] };
  if (typeof o["path"] === "string" && isObj(o["firestore"])) return { __ref: o["path"] };
  const out: Obj = {};
  for (const [k, x] of Object.entries(o)) if (x !== undefined) out[k] = encodeValue(x);
  return out;
}

/** The inverse of encodeValue. `make` supplies the admin constructors so this file stays pure. */
export function decodeValue(
  v: unknown,
  make: {
    ts: (d: Date) => unknown;
    geo: (lat: number, lng: number) => unknown;
    ref: (path: string) => unknown;
    bytes: (b64: string) => unknown;
  },
): unknown {
  if (Array.isArray(v)) return v.map((x) => decodeValue(x, make));
  if (!isObj(v)) return v;
  const keys = Object.keys(v);
  if (keys.length === 1) {
    const k = keys[0]!;
    const x = v[k];
    if (k === "__ts" && typeof x === "string") return make.ts(new Date(x));
    if (k === "__geo" && Array.isArray(x) && x.length === 2)
      return make.geo(Number(x[0]), Number(x[1]));
    if (k === "__ref" && typeof x === "string") return make.ref(x);
    if (k === "__b64" && typeof x === "string") return make.bytes(x);
    if (k === "__num" && typeof x === "string") return Number(x);
  }
  const out: Obj = {};
  for (const [k, x] of Object.entries(v)) out[k] = decodeValue(x, make);
  return out;
}

/** Cut a string into pieces of at most `limit` characters, never between the two halves of an emoji. */
function chunk(text: string, limit: number): string[] {
  const out: string[] = [];
  let at = 0;
  while (at < text.length) {
    let end = Math.min(at + limit, text.length);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    out.push(text.slice(at, end));
    at = end;
  }
  return out.length ? out : [""];
}

/** One record -> one sheet row: [id, updatedAt (ISO), json chunk 1, json chunk 2, ...]. */
export function recordToRow(id: string, data: Record<string, unknown>): string[] {
  const encoded = encodeValue(data) as Obj;
  const stamp = (encoded["updatedAt"] ?? encoded["createdAt"]) as unknown;
  const updatedAt = isObj(stamp) && typeof stamp["__ts"] === "string" ? stamp["__ts"] : "";
  return [id, updatedAt, ...chunk(JSON.stringify(encoded), CELL_LIMIT)];
}

/**
 * A row back to { id, data }. `data` is still the tagged JSON: run it through decodeValue to get
 * Timestamps etc. Throws, naming the id, when the JSON is broken.
 */
export function rowToRecord(row: string[]): { id: string; data: Record<string, unknown> } {
  const id = String(row[0] ?? "");
  const json = row.slice(2).join("");
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error(`Backup row "${id}" has broken JSON`);
  }
  if (!isObj(data) || Array.isArray(data)) throw new Error(`Backup row "${id}" is not a record`);
  return { id, data };
}
