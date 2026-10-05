import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type DocumentData,
} from "@/lib/firestore";
import { db } from "@/lib/firebase";
import type { WhatsAppSettings } from "@/types/models";
import { COLLECTIONS, toDate } from "./firestore.service";

export const DEFAULT_WHATSAPP_SETTINGS: WhatsAppSettings = {
  enabled: false,
  mode: "mock",
  defaultCountryCode: "91",
  graphApiVersion: "v23.0",
  phoneNumberIdHint: "",
  businessAccountIdHint: "",
  templateLanguage: "en",
  invoiceTemplate: "gym_payment_receipt",
  autoSendInvoice: true,
  renewalTemplate: "gym_membership_expiry",
  paymentDueTemplate: "gym_payment_due",
  birthdayTemplate: "gym_birthday_wish",
  absenceTemplate: "gym_miss_you",
  announcementTemplate: "gym_announcement",
  followUpTemplate: "follow_up_message",
  memberAppTemplate: "gym_member_app",
  autoSendMemberApp: true,
  sender: "cloud",
  gatewayUrl: "",
  gatewaySessionId: "",
  gatewayPhone: "",
  gatewayStatus: "",
  phoneTexts: {},
  gatewayRestriction: "",
  gatewayMode: "",
  gatewayPcSeenAt: null,
};

const map = (d?: DocumentData): WhatsAppSettings => ({
  ...DEFAULT_WHATSAPP_SETTINGS,
  ...(d ?? {}),
  mode: d?.["mode"] === "whatsapp" ? "whatsapp" : "mock",
  sender: d?.["sender"] === "phone" ? "phone" : "cloud",
  phoneTexts: (d?.["phoneTexts"] as Record<string, string> | undefined) ?? {},
  gatewayRestriction: String(d?.["gatewayRestriction"] ?? ""),
  gatewayMode: String(d?.["gatewayMode"] ?? ""),
  gatewayPcSeenAt: d?.["gatewayPcSeenAt"] ? toDate(d["gatewayPcSeenAt"]) : null,
});

/** Sending from the gym's own number (linked phone) rather than the Meta Cloud API. */
export const sendsFromPhone = (s: WhatsAppSettings) =>
  s.mode === "whatsapp" && s.sender === "phone";

/** True when messages go out automatically (Meta Cloud API or the gym's own linked number). */
export const isWhatsAppApiLive = (s: WhatsAppSettings) => s.mode === "whatsapp";

export const getWhatsAppSettings = async () =>
  map((await getDoc(doc(db, COLLECTIONS.settings, "whatsapp"))).data());

export const subscribeWhatsAppSettings = (
  ok: (x: WhatsAppSettings) => void,
  fail: (e: Error) => void,
) => onSnapshot(doc(db, COLLECTIONS.settings, "whatsapp"), (s) => ok(map(s.data())), fail);

/**
 * Saves what the WhatsApp form changes. The linked-phone connection (address, instance, number,
 * state) is saved only by the server after it checked it, so a form left open never undoes it.
 */
export const saveWhatsAppSettings = (settings: WhatsAppSettings) => {
  const {
    gatewayUrl: _u,
    gatewaySessionId: _s,
    gatewayPhone: _p,
    gatewayStatus: _t,
    gatewayRestriction: _r,
    gatewayMode: _m,
    gatewayPcSeenAt: _seen,
    ...rest
  } = settings;
  return setDoc(
    doc(db, COLLECTIONS.settings, "whatsapp"),
    { ...rest, updatedAt: serverTimestamp() },
    { merge: true },
  );
};
