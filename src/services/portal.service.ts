/**
 * Front-desk side of the member app and trainer app. Logins are made on the server
 * (src/server/portal.ts); these calls ask it as the signed-in staff member.
 */
import { doc, serverTimestamp, updateDoc } from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { callServer } from "@/lib/server-api";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp-phone";
import { PORTAL_PATH, type PortalKind } from "@/constants/portal";
import type { Client } from "@/types/models";
import { COLLECTIONS } from "./firestore.service";

export const portalUrl = (kind: PortalKind, code: string) =>
  `${window.location.origin}${PORTAL_PATH[kind]}${code}`;

export type MemberAppAction = "ensure" | "reset" | "off" | "on" | "delete";

/**
 * Makes the member's app link if they don't have one yet (password = date of birth).
 * Fails with "Add the member's date of birth first…" when the date of birth is missing.
 */
export const ensureMemberApp = (clientId: string) =>
  callServer<{ code: string; created: boolean }>("/api/portal/member-access", {
    clientId,
    action: "ensure",
  });

export const memberAppAction = (clientId: string, action: MemberAppAction) =>
  callServer<{ ok?: boolean; code?: string }>("/api/portal/member-access", { clientId, action });

/** After a manual "Share on WhatsApp", so the profile shows the link went out. */
export const markMemberAppShared = (clientId: string) =>
  updateDoc(doc(db, COLLECTIONS.clients, clientId), {
    portalSentAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

export const memberAppMessage = (name: string, gym: string, url: string) =>
  `Hi ${name.split(" ")[0] || name}, your ${gym} member app is ready. See your package, visits, payments and workout plan here: ${url}\nPassword: your date of birth as DDMMYYYY (born 25 Aug 1995 → 25081995).`;

/** wa.me link that opens WhatsApp on this phone with the message ready. */
export function whatsAppShareUrl(phone: string, text: string, countryCode = "91") {
  const p = normalizeWhatsAppPhone(phone, countryCode);
  return `https://wa.me/${p.ok ? p.value : ""}?text=${encodeURIComponent(text)}`;
}

export const memberHasApp = (c: Pick<Client, "portalCode">) => !!c.portalCode;

// ------------------------------------------------------------------ trainer app (owner)

export type TrainerAccessAction = "create" | "password" | "off" | "on" | "reveal";
export const trainerAccess = (trainerId: string, action: TrainerAccessAction, password?: string) =>
  callServer<{ code?: string; password?: string; ok?: boolean }>("/api/portal/trainer-access", {
    trainerId,
    action,
    ...(password ? { password } : {}),
  });

/** The staff login's saved password ("" = saved before the password safe existed). */
export const staffSavedPassword = (staffId: string) =>
  callServer<{ password: string }>("/api/staff/password", { staffId });

/** An easy-to-type password: 6 digits. */
export const suggestPassword = () =>
  String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0]! % 900000));
