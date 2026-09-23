import {
  browserLocalPersistence,
  browserSessionPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase/client";
import type { AppUser } from "@/types";

export function mapUser(user: User | null): AppUser | null {
  if (!user) return null;
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName ?? user.email?.split("@")[0] ?? "Staff",
    photoURL: user.photoURL,
  };
}

export function subscribeToAuth(cb: (user: AppUser | null) => void) {
  return onAuthStateChanged(getFirebaseAuth(), (user) => cb(mapUser(user)));
}

export async function loginWithEmail(email: string, password: string, remember: boolean) {
  const auth = getFirebaseAuth();
  await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  return mapUser(credential.user);
}

export async function logout() {
  await signOut(getFirebaseAuth());
}

/** Human-readable messages for Firebase auth error codes. */
export function authErrorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code ?? "";
  switch (code) {
    case "auth/invalid-email":
      return "That email address doesn't look right.";
    case "auth/user-disabled":
      return "This account has been disabled. Contact an administrator.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Incorrect email or password.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    case "auth/network-request-failed":
      return "Network error. Check your connection and try again.";
    default:
      return (error as Error)?.message || "Something went wrong while signing in.";
  }
}
