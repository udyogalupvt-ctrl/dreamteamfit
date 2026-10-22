/**
 * UPI pay links on the desk (src/lib/pay-links.ts). The server makes the links and records "I've
 * paid" (src/server/pay-links.ts); the desk confirms through Collect / Renew (finance.service.ts,
 * enrollment.service.ts) or marks a payment Not received here. The gym's UPI ID is owner-only.
 */
import {
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
} from "@/lib/firestore";
import { auth, db } from "@/lib/firebase";
import { PAY_LIMITS, validateUpiSettings } from "@/lib/pay-links";
import { col, COLLECTIONS, subscribeQuery, toDate } from "./firestore.service";
import type { PayLink, UpiSettings } from "@/types/models";

const who = () => auth.currentUser?.displayName || auth.currentUser?.email || "Staff";
const when = (v: unknown) => (v ? toDate(v) : null);
const upiRef = () => doc(db, COLLECTIONS.settings, "upi");

export function subscribeUpiSettings(
  onData: (s: UpiSettings) => void,
  onError: (e: Error) => void,
) {
  return onSnapshot(
    upiRef(),
    (snap) => {
      const d = snap.data() ?? {};
      onData({
        upiId: String(d["upiId"] ?? ""),
        payeeName: String(d["payeeName"] ?? ""),
        updatedBy: String(d["updatedBy"] ?? ""),
      });
    },
    onError,
  );
}

/** Owner only (firestore.rules). An empty UPI ID switches online pay off. */
export async function saveUpiSettings(input: { upiId: string; payeeName: string }) {
  const v = validateUpiSettings(input);
  if (!v.ok) throw new Error(v.error);
  await setDoc(upiRef(), {
    upiId: v.upiId,
    payeeName: v.upiId ? v.payeeName : "",
    updatedAt: serverTimestamp(),
    updatedBy: who(),
  });
}

const toPayLink = (id: string, d: DocumentData): PayLink => ({
  id,
  clientId: String(d["clientId"] ?? ""),
  clientName: String(d["clientName"] ?? ""),
  memberCode: String(d["memberCode"] ?? ""),
  kind: d["kind"] === "renewal" ? "renewal" : "balance",
  invoiceId: String(d["invoiceId"] ?? ""),
  invoiceNumber: String(d["invoiceNumber"] ?? ""),
  invoiceToken: String(d["invoiceToken"] ?? ""),
  packageId: String(d["packageId"] ?? ""),
  packageName: String(d["packageName"] ?? ""),
  planSeq: Number(d["planSeq"] ?? 0),
  amount: Number(d["amount"] ?? 0),
  status: d["status"] as PayLink["status"],
  closedReason: String(d["closedReason"] ?? ""),
  utr: String(d["utr"] ?? ""),
  utrSeenBefore: d["utrSeenBefore"] === true,
  memberAmount: Number(d["memberAmount"] ?? 0),
  memberPaidAt: when(d["memberPaidAt"]),
  deskNote: String(d["deskNote"] ?? ""),
  paymentIds: Array.isArray(d["paymentIds"]) ? d["paymentIds"].map(String) : [],
  saleBillId: String(d["saleBillId"] ?? ""),
  checkedBy: String(d["checkedBy"] ?? ""),
  checkedAt: when(d["checkedAt"]),
  createdAt: when(d["createdAt"]),
});

/** Members who said they paid, oldest first (sorted here, so no index is needed). */
export function subscribeLinksToConfirm(
  onData: (links: PayLink[]) => void,
  onError: (e: Error) => void,
) {
  return subscribeQuery(
    query(col(COLLECTIONS.payLinks), where("status", "==", "member_paid")),
    toPayLink,
    (links) =>
      onData(
        links.sort((a, b) => (a.memberPaidAt?.getTime() ?? 0) - (b.memberPaidAt?.getTime() ?? 0)),
      ),
    onError,
  );
}

/** The money isn't in the gym's account: the link opens again with a note for the member. */
export async function markNotReceived(
  link: PayLink,
  note: string,
  staff: { uid: string; name: string },
) {
  const deskNote = note.replace(/\s+/g, " ").trim().slice(0, PAY_LIMITS.deskNote);
  if (!deskNote) throw new Error("Write a short note for the member.");
  await updateDoc(doc(db, COLLECTIONS.payLinks, link.id), {
    status: "open",
    deskNote,
    utr: "",
    utrSeenBefore: false,
    memberAmount: 0,
    memberPaidAt: null,
    checkedBy: staff.name,
    checkedByUid: staff.uid,
    checkedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
