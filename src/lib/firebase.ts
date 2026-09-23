import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import type { Analytics } from "firebase/analytics";

/** Single source of Firebase config — every value comes from Vite env vars. */
const env = import.meta.env;
export const firebaseConfig = {
  apiKey: env["VITE_FIREBASE_API_KEY"] as string | undefined,
  authDomain: env["VITE_FIREBASE_AUTH_DOMAIN"] as string | undefined,
  projectId: env["VITE_FIREBASE_PROJECT_ID"] as string | undefined,
  storageBucket: env["VITE_FIREBASE_STORAGE_BUCKET"] as string | undefined,
  messagingSenderId: env["VITE_FIREBASE_MESSAGING_SENDER_ID"] as string | undefined,
  appId: env["VITE_FIREBASE_APP_ID"] as string | undefined,
  measurementId: env["VITE_FIREBASE_MEASUREMENT_ID"] as string | undefined,
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId,
);

// Initialize exactly once (safe across HMR reloads).
export const app: FirebaseApp = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig as Record<string, string>);

export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app);
export const storage: FirebaseStorage = getStorage(app);

/** Analytics only runs in supported browsers; resolves null elsewhere (SSR, blocked). */
let analyticsPromise: Promise<Analytics | null> | null = null;
export function getAnalyticsInstance(): Promise<Analytics | null> {
  if (typeof window === "undefined" || !firebaseConfig.measurementId) return Promise.resolve(null);
  analyticsPromise ??= import("firebase/analytics").then(async (m) =>
    (await m.isSupported()) ? m.getAnalytics(app) : null,
  );
  return analyticsPromise;
}
export const analytics = getAnalyticsInstance();
