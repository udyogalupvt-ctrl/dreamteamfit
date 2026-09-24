import { doc, onSnapshot, serverTimestamp, setDoc, type DocumentData } from "@/lib/firestore";
import { db } from "@/lib/firebase";
import type { WhatsAppSettings } from "@/types/models";
import { COLLECTIONS } from "./firestore.service";

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
  birthdayTemplate: "gym_birthday_wish",
  absenceTemplate: "gym_miss_you",
  followUpTemplate: "follow_up_message",
};

const map = (d?: DocumentData): WhatsAppSettings => ({
  ...DEFAULT_WHATSAPP_SETTINGS,
  ...(d ?? {}),
  mode: d?.["mode"] === "whatsapp" ? "whatsapp" : "mock",
});

/** True when bills can be delivered automatically through the WhatsApp Cloud API. */
export const isWhatsAppApiLive = (s: WhatsAppSettings) => s.mode === "whatsapp";

export const subscribeWhatsAppSettings = (
  ok: (x: WhatsAppSettings) => void,
  fail: (e: Error) => void,
) => onSnapshot(doc(db, COLLECTIONS.settings, "whatsapp"), (s) => ok(map(s.data())), fail);

export const saveWhatsAppSettings = (settings: WhatsAppSettings) =>
  setDoc(
    doc(db, COLLECTIONS.settings, "whatsapp"),
    { ...settings, updatedAt: serverTimestamp() },
    { merge: true },
  );
