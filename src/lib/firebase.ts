import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  clearIndexedDbPersistence,
  memoryLocalCache,
  memoryLruGarbageCollector,
  persistentLocalCache,
  persistentMultipleTabManager,
  terminate,
  type Firestore,
} from "firebase/firestore";
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

/**
 * Keep a local copy of what was loaded: in the browser it survives a refresh or a new tab, so
 * opening a list again within ~30 minutes only fetches what changed, instead of every member
 * again (free plan: 50,000 reads a day). Erased on sign-out (see clearLocalCopy).
 */
function makeDb(): Firestore {
  try {
    const browser = typeof window !== "undefined" && typeof indexedDB !== "undefined";
    return initializeFirestore(app, {
      localCache: browser
        ? persistentLocalCache({ tabManager: persistentMultipleTabManager() })
        : memoryLocalCache({ garbageCollector: memoryLruGarbageCollector() }),
    });
  } catch {
    // Already set up (hot reload).
    return getFirestore(app);
  }
}
export const db: Firestore = makeDb();

/**
 * Sign-out on a shared front-desk computer: erase the local copy so the next person's browser
 * holds none of the previous login's data. The page must reload afterwards (the connection is
 * closed to erase it).
 */
export async function clearLocalCopy() {
  if (typeof window === "undefined") return;
  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
  } catch {
    // Another tab still has it open: it is erased when the last tab closes the app.
  }
}

// Local testing only: `VITE_USE_EMULATORS=1 npm run dev` talks to the Firebase emulators.
if (env["VITE_USE_EMULATORS"] === "1" && !(globalThis as { __rfEmu?: boolean }).__rfEmu) {
  (globalThis as { __rfEmu?: boolean }).__rfEmu = true;
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}
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
