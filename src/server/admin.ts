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

/**
 * Reads the key however it was pasted: raw JSON (one line or many), base64, with or without
 * surrounding quotes. Throws a plain message naming what is wrong (never the key itself).
 */
function credentials() {
  let raw = (process.env["FIREBASE_SERVICE_ACCOUNT"] ?? "").trim();
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT is not set on the server.");
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

/** Signed-in staff only (same rule as Firestore: any signed-in account is staff). */
export async function requireStaff(request: Request) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  return adminAuth()
    .verifyIdToken(token)
    .catch(() => null);
}
