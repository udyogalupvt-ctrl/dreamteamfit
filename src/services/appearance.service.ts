import { doc, onSnapshot, serverTimestamp, setDoc } from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { cleanColorTheme, type ColorTheme } from "@/lib/theme-colors";
import { COLLECTIONS } from "./firestore.service";

/** The gym's colour theme for every login (Settings → Appearance → Everyone). null = default. */
export const subscribeGymColorTheme = (
  ok: (t: ColorTheme | null) => void,
  fail: (e: Error) => void,
) =>
  onSnapshot(
    doc(db, COLLECTIONS.settings, "appearance"),
    (s) =>
      ok(s.exists() && s.data()["colorTheme"] ? cleanColorTheme(s.data()["colorTheme"]) : null),
    fail,
  );

export async function saveGymColorTheme(t: ColorTheme) {
  await setDoc(
    doc(db, COLLECTIONS.settings, "appearance"),
    { colorTheme: cleanColorTheme(t), updatedAt: serverTimestamp() },
    { merge: true },
  );
}
