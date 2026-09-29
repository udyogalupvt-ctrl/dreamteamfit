/**
 * Firebase for the member app and trainer app: a second Firebase "app" with its own sign-in,
 * so a member signing in on the front-desk phone never signs the staff out (and the other way
 * round). It writes with plain Firestore: portal writes are not staff changes, so they skip the
 * staff activity-log wrapper in src/lib/firestore.ts.
 */
import { getApp, getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { portalEmail, type PortalKind } from "@/constants/portal";
import { firebaseConfig } from "@/lib/firebase";

const NAME = "portal";
const app = getApps().some((a) => a.name === NAME)
  ? getApp(NAME)
  : initializeApp(firebaseConfig as Record<string, string>, NAME);

export const portalAuth = getAuth(app);
export const portalDb = getFirestore(app);

if (
  import.meta.env["VITE_USE_EMULATORS"] === "1" &&
  !(globalThis as { __rfPortalEmu?: boolean }).__rfPortalEmu
) {
  (globalThis as { __rfPortalEmu?: boolean }).__rfPortalEmu = true;
  connectAuthEmulator(portalAuth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(portalDb, "127.0.0.1", 8080);
}

/** Signed in with this link (another link's login on the same phone doesn't count). */
export const signedInAs = (kind: PortalKind, code: string) =>
  portalAuth.currentUser?.email === portalEmail(kind, code);

export async function portalSignIn(kind: PortalKind, code: string, password: string) {
  await setPersistence(portalAuth, browserLocalPersistence);
  await signInWithEmailAndPassword(portalAuth, portalEmail(kind, code), password);
}

export const portalSignOut = () => signOut(portalAuth);

/** Calls the app's server as the signed-in member / trainer. */
export async function portalCall<T>(path: string, body?: unknown): Promise<T> {
  const token = await portalAuth.currentUser?.getIdToken();
  if (!token) throw new Error("Please sign in again.");
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    const err = new Error(data.error ?? `Server error ${response.status}`) as Error & {
      status?: number;
    };
    err.status = response.status;
    throw err;
  }
  return data;
}

/** Plain words for sign-in errors. */
export function portalSignInError(error: unknown) {
  const code = String((error as { code?: string })?.code ?? "");
  if (code.includes("too-many-requests"))
    return "Too many wrong tries. Please wait a few minutes and try again.";
  if (code.includes("user-disabled")) return "This login is switched off. Please contact the gym.";
  if (code.includes("network")) return "No internet. Check your connection and try again.";
  if (
    code.includes("invalid-credential") ||
    code.includes("wrong-password") ||
    code.includes("user-not-found") ||
    code.includes("invalid-login")
  )
    return "Wrong password. Try again.";
  return "Couldn't sign in. Please try again.";
}
