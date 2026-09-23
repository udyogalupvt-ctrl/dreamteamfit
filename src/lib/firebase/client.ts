import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

/**
 * Centralized Firebase initialization.
 * Nothing else in the app should call initializeApp / getAuth / getFirestore.
 * Values come from environment variables with the project defaults as fallback.
 */
const firebaseConfig = {
  apiKey: import.meta.env["VITE_FIREBASE_API_KEY"] as string | undefined,
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
  measurementId: import.meta.env["VITE_FIREBASE_MEASUREMENT_ID"] as string | undefined,
};

export const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

let app: FirebaseApp | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (!isFirebaseConfigured) {
    throw new Error(
      "Firebase is not configured. Set VITE_FIREBASE_API_KEY in the project environment.",
    );
  }
  if (!app) {
    app = getApps().length ? getApp() : initializeApp(firebaseConfig as Record<string, string>);
  }
  return app;
}

export function getFirebaseAuth(): Auth {
  return getAuth(getFirebaseApp());
}

export function getDb(): Firestore {
  return getFirestore(getFirebaseApp());
}
