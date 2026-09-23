import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getFirebasePublicConfig } from "./config.functions";

/**
 * Centralized Firebase initialization — the only place initializeApp is called.
 * Static values live here; the API key + measurement ID come from project secrets
 * (or VITE_ env overrides) and are loaded once via initFirebase().
 */
const baseConfig = {
  authDomain:
    (import.meta.env["VITE_FIREBASE_AUTH_DOMAIN"] as string | undefined) ??
    "leadsmanage-1f7cd.firebaseapp.com",
  projectId:
    (import.meta.env["VITE_FIREBASE_PROJECT_ID"] as string | undefined) ?? "leadsmanage-1f7cd",
  storageBucket:
    (import.meta.env["VITE_FIREBASE_STORAGE_BUCKET"] as string | undefined) ??
    "leadsmanage-1f7cd.firebasestorage.app",
  messagingSenderId:
    (import.meta.env["VITE_FIREBASE_MESSAGING_SENDER_ID"] as string | undefined) ??
    "1019581568447",
  appId:
    (import.meta.env["VITE_FIREBASE_APP_ID"] as string | undefined) ??
    "1:1019581568447:web:ee97dfa623591f017d3d0a",
};

let app: FirebaseApp | null = null;
let initPromise: Promise<boolean> | null = null;
export let isFirebaseConfigured = false;

/** Initializes Firebase exactly once. Resolves true when ready. */
export function initFirebase(): Promise<boolean> {
  if (!initPromise) {
    initPromise = (async () => {
      let apiKey = import.meta.env["VITE_FIREBASE_API_KEY"] as string | undefined;
      let measurementId = import.meta.env["VITE_FIREBASE_MEASUREMENT_ID"] as string | undefined;
      if (!apiKey) {
        const remote = await getFirebasePublicConfig();
        apiKey = remote.apiKey ?? undefined;
        measurementId = measurementId ?? remote.measurementId ?? undefined;
      }
      if (!apiKey) return false;
      const config = { ...baseConfig, apiKey, ...(measurementId ? { measurementId } : {}) };
      app = getApps().length ? getApp() : initializeApp(config);
      isFirebaseConfigured = true;
      return true;
    })().catch((err) => {
      console.error("Firebase init failed", err);
      initPromise = null;
      return false;
    });
  }
  return initPromise;
}

export function getFirebaseApp(): FirebaseApp {
  if (!app) throw new Error("Firebase is not initialized. Call initFirebase() first.");
  return app;
}

export function getFirebaseAuth(): Auth {
  return getAuth(getFirebaseApp());
}

export function getDb(): Firestore {
  return getFirestore(getFirebaseApp());
}
