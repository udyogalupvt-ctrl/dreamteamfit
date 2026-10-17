/** Machine IDs: letters and digits only (old software used IDs like IIFM12). */
export const pinOk = (pin: string) => /^[A-Za-z0-9]{1,24}$/.test(pin);

// The commands the app may queue from the browser (firestore.rules checks the same text), plus
// the forms the server itself makes for those types: the door restore sends the same user
// record for old-software IDs, and a thumb registration may be retried as ENROLL_BIO.
const APP_TEXT: Record<string, (pin: string) => RegExp[]> = {
  user_upsert: (pin) => [
    new RegExp(
      `^DATA UPDATE USERINFO PIN=${pin}\\tName=[^\\t\\r\\n]{0,40}\\tPri=0\\tPasswd=\\tCard=\\tGrp=1\\tTZ=0000000100000000\\tVerify=0$`,
    ),
  ],
  enroll_fp: (pin) => [
    new RegExp(`^ENROLL_FP PIN=${pin}\\tFID=5\\tRETRY=3\\tOVERWRITE=1$`),
    new RegExp(`^ENROLL_BIO TYPE=1\\tPIN=${pin}\\tRETRY=3\\tOVERWRITE=1$`),
  ],
};

/**
 * Last check before a command goes to the machine. Nothing with a line break (one line = one
 * command). Types the app may queue must be exactly the app's own text for that record's PIN
 * (never a machine admin, never another person's ID); every other type is written only by the
 * server (firestore.rules refuses them from the app).
 */
export function commandOk(d: { type?: unknown; command?: unknown; biometricUserId?: unknown }) {
  const command = String(d.command ?? "");
  if (/[\r\n]/.test(command)) return false;
  const app = APP_TEXT[String(d.type)];
  if (!app) return true;
  const pin = String(d.biometricUserId ?? "");
  return pinOk(pin) && app(pin).some((re) => re.test(command));
}
