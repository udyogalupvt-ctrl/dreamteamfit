/**
 * Firebase Admin for the Vercel server routes. Works on the free Firebase (Spark) plan: only
 * Firestore and Auth are used, never Cloud Functions.
 *
 * Credentials come from one env var, FIREBASE_SERVICE_ACCOUNT: the service-account JSON
 * (Firebase console → Project settings → Service accounts → Generate new private key), pasted
 * as-is or base64-encoded.
 */
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { isOwnerEmail } from "@/constants/owners";

/** Pulls the three needed fields out of any text that contains them (e.g. JSON whose line breaks got mangled). */
function fieldsFromText(text: string) {
  const grab = (k: string) => new RegExp(`"${k}"\\s*:\\s*"([^"]+)"`).exec(text)?.[1] ?? "";
  const pem = /-----BEGIN PRIVATE KEY-----[\s\S]+?-----END PRIVATE KEY-----/.exec(
    text.replace(/\\n/g, "\n"),
  )?.[0];
  const projectId = grab("project_id");
  const clientEmail = grab("client_email");
  if (!projectId || !clientEmail || !pem) return null;
  // Rebuild a clean PEM: header, base64 body in 64-char lines, footer.
  const body = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/[^A-Za-z0-9+/=]/g, "");
  const privateKey = `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
  return { projectId, clientEmail, privateKey };
}

/**
 * Reads the key however it was pasted: raw JSON (one line or many), base64, with or without
 * surrounding quotes, even with mangled line breaks. Throws a plain message naming what is
 * wrong (never the key itself).
 */
export function credentials() {
  // Also accepted: three separate variables (the usual Vercel way).
  const pk = (process.env["FIREBASE_PRIVATE_KEY"] ?? "").trim();
  if (pk) {
    const f = fieldsFromText(
      `"project_id":"${process.env["FIREBASE_PROJECT_ID"] ?? process.env["VITE_FIREBASE_PROJECT_ID"] ?? ""}","client_email":"${process.env["FIREBASE_CLIENT_EMAIL"] ?? ""}" ${pk}`,
    );
    if (f) return f;
  }
  let raw = (process.env["FIREBASE_SERVICE_ACCOUNT"] ?? "").trim();
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT is not set on the server.");
  // Mangled paste (quotes / line breaks broken): still usable if the fields are all there.
  const direct = fieldsFromText(raw);
  const decoded = /^[A-Za-z0-9+/=\s]+$/.test(raw)
    ? fieldsFromText(Buffer.from(raw.replace(/\s+/g, ""), "base64").toString("utf8"))
    : null;
  if (direct && !raw.startsWith("{")) return direct;
  if (decoded) return decoded;
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))
    raw = raw.slice(1, -1).trim();
  const json = raw.startsWith("{")
    ? raw
    : Buffer.from(raw.replace(/\s+/g, ""), "base64").toString("utf8").trim();
  let parsed: { project_id?: string; client_email?: string; private_key?: string };
  try {
    parsed = JSON.parse(json) as typeof parsed;
  } catch {
    // A JSON value pasted with its quotes escaped (\") is still readable.
    try {
      parsed = JSON.parse(json.replace(/\\"/g, '"')) as typeof parsed;
    } catch {
      if (direct) return direct;
      throw new Error("FIREBASE_SERVICE_ACCOUNT is not valid JSON or base64.");
    }
  }
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key)
    throw new Error("FIREBASE_SERVICE_ACCOUNT is missing project_id, client_email or private_key.");
  return {
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key.replace(/\\n/g, "\n"),
  };
}

/** For /api/health: what is wrong with the server setup, without revealing any secret. */
export async function serverHealth() {
  const out: Record<string, string> = {};
  try {
    const c = credentials();
    out["serviceAccount"] =
      c.projectId === process.env["VITE_FIREBASE_PROJECT_ID"] ||
      !process.env["VITE_FIREBASE_PROJECT_ID"]
        ? "ok"
        : `project mismatch (${c.projectId})`;
    out["privateKey"] = c.privateKey.includes("BEGIN PRIVATE KEY") ? "ok" : "not a PEM key";
  } catch (e) {
    out["serviceAccount"] = (e as Error).message;
    // Shape only (never content), to see how the value was pasted.
    const raw = process.env["FIREBASE_SERVICE_ACCOUNT"] ?? "";
    out["valueLength"] = String(raw.length);
    out["valueLines"] = String(raw.split("\n").length);
    out["startsWith"] = raw.trim().startsWith("{")
      ? "{ (JSON)"
      : /^[A-Za-z0-9+/]/.test(raw.trim())
        ? "letters (base64?)"
        : `other (${JSON.stringify(raw.trim().charAt(0))})`;
    out["hasKeyHeader"] = raw.includes("BEGIN PRIVATE KEY") ? "yes" : "no";
    return out;
  }
  try {
    await db().doc("settings/business").get();
    out["firestore"] = "ok";
  } catch (e) {
    out["firestore"] = String((e as Error).message ?? e).slice(0, 160);
  }
  out["whatsappToken"] = (process.env["WHATSAPP_ACCESS_TOKEN"] ?? "").trim() ? "set" : "missing";
  out["whatsappPhoneNumberId"] = (process.env["WHATSAPP_PHONE_NUMBER_ID"] ?? "").trim()
    ? "set"
    : "missing";
  out["cronSecret"] = (process.env["CRON_SECRET"] ?? "").trim() ? "set" : "missing";
  return out;
}

let app: App | undefined;
function adminApp() {
  // Local testing against the Firebase emulators needs no key.
  const emulator =
    process.env["FIRESTORE_EMULATOR_HOST"] && !process.env["FIREBASE_SERVICE_ACCOUNT"];
  app ??=
    getApps()[0] ??
    (emulator
      ? initializeApp({ projectId: process.env["VITE_FIREBASE_PROJECT_ID"] ?? "demo-rebuild" })
      : initializeApp({ credential: cert(credentials()) }));
  return app;
}

export const db = () => getFirestore(adminApp());
export const adminAuth = () => getAuth(adminApp());

/** Gym time. Plans, reminders and device clocks all use Indian time. */
export const TZ = "Asia/Kolkata";
export const localDate = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/plain" } });

/**
 * Owners and switched-on staff logins only — the same test as isStaff() in firestore.rules. A
 * self-created account (public sign-up) is signed in but gets nothing here either.
 */
export async function requireStaff(request: Request) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const user = await adminAuth()
    .verifyIdToken(token)
    .catch(() => null);
  if (!user) return null;
  if (isOwnerEmail(user.email)) return user;
  const access = await db()
    .doc(`staffAccess/${user.uid}`)
    .get()
    .catch(() => null);
  return access?.exists && access.data()?.["active"] === true ? user : null;
}
