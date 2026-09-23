// Compatibility layer — all initialization lives in src/lib/firebase.ts.
import { app, auth, db, isFirebaseConfigured } from "../firebase";

export { isFirebaseConfigured };
export const getFirebaseApp = () => app;
export const getFirebaseAuth = () => auth;
export const getDb = () => db;
