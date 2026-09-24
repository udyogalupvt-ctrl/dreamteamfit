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

function credentials() {
  const raw = (process.env["FIREBASE_SERVICE_ACCOUNT"] ?? "").trim();
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT is not set on the server.");
  const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  const parsed = JSON.parse(json) as {
    project_id: string;
    client_email: string;
    private_key: string;
  };
  return {
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key.replace(/\\n/g, "\n"),
  };
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
