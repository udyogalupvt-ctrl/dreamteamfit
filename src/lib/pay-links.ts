/**
 * UPI pay links (spec 2026-10-22-five-features-design.md, A): the rules the server, the pay page,
 * the member app and the desk share. A link never marks anything paid: the member says they paid,
 * the desk confirms through the normal Collect / Renew paths.
 */
import type { BusinessBillingSettings } from "@/types/models";
import { calculateInvoiceTotals } from "./invoice-utils.ts";

export type PayLinkKind = "balance" | "renewal";
export type PayLinkStatus = "open" | "member_paid" | "confirmed" | "cancelled";
/** Why an open link closed itself (shown to the member). */
export type PayCloseReason = "paid" | "bill" | "package" | "changed" | "expired";

export const PAY_LIMITS = {
  upiId: 100,
  payeeName: 50,
  /** The UPI app's note (tn). */
  note: 50,
  /** "Not received" note the member sees. */
  deskNote: 200,
  /** "I've paid" taps per link in 24 hours. */
  paidPerDay: 6,
  /** An open link is good for this many days (a new one is made on the next tap). */
  openDays: 30,
  /** Renew online shows once the plan ends within this many days. */
  renewWithinDays: 7,
} as const;

export const CLOSED_TEXT: Record<PayCloseReason, string> = {
  paid: "Nothing is left to pay on this bill. Thank you!",
  bill: "This bill can't be paid online. Please contact the gym.",
  package: "This package can't be renewed online now. Please renew at the gym.",
  changed: "Your plan was updated at the gym, so this link is closed.",
  expired: "This link has expired. Open your bill or the member app again for a new one.",
};

export const NOT_RECEIVED_NOTE =
  "We couldn't find this payment in our account. Please check the UPI reference, or pay at the desk.";

const upiIdShape = /^[a-z0-9][a-z0-9._-]{1,98}@[a-z][a-z0-9]{1,63}$/;
const payeeShape = /^[\p{L}\p{N} &.'-]+$/u;

/**
 * The gym's UPI ID (name@bank) and the name members see. An empty UPI ID switches the feature off.
 */
export function validateUpiSettings(input: {
  upiId: unknown;
  payeeName: unknown;
}):
  | { ok: true; upiId: string; payeeName: string }
  | { ok: false; field: "upiId" | "payeeName"; error: string } {
  const upiId = String(input.upiId ?? "")
    .trim()
    .toLowerCase();
  const payeeName = String(input.payeeName ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!upiId) return { ok: true, upiId: "", payeeName };
  if (upiId.length > PAY_LIMITS.upiId || !upiIdShape.test(upiId))
    return { ok: false, field: "upiId", error: "Enter a UPI ID like gymname@okhdfcbank." };
  if (!payeeName)
    return { ok: false, field: "payeeName", error: "Enter the name members see when they pay." };
  if (payeeName.length > PAY_LIMITS.payeeName)
    return {
      ok: false,
      field: "payeeName",
      error: `Keep the name under ${PAY_LIMITS.payeeName} characters.`,
    };
  if (!payeeShape.test(payeeName))
    return {
      ok: false,
      field: "payeeName",
      error: "Use letters, numbers, spaces and . & ' - only.",
    };
  return { ok: true, upiId, payeeName };
}

/** The UPI app's note: letters, digits, spaces and dashes only, 50 at most. */
export function upiNote(parts: string[]): string {
  return parts
    .join(" ")
    .replace(/[^A-Za-z0-9 -]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PAY_LIMITS.note)
    .trim();
}

const enc = (v: string) => encodeURIComponent(v).replace(/%40/g, "@");

/** The upi:// link the "Pay with a UPI app" button and the QR open. */
export function upiUri(p: { upiId: string; payeeName: string; amount: number; note: string }) {
  const parts: [string, string][] = [
    ["pa", p.upiId],
    ["pn", p.payeeName],
    ["am", p.amount.toFixed(2)],
    ["cu", "INR"],
    ["tn", p.note],
  ];
  return `upi://pay?${parts
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${k}=${enc(v)}`)
    .join("&")}`;
}

/** The UPI reference (UTR) the member typed: spaces and dashes dropped; "" = none given. */
export function cleanUtr(v: unknown): { utr: string } | { error: string } {
  const utr = String(v ?? "")
    .replace(/[\s-]/g, "")
    .toUpperCase();
  if (!utr) return { utr: "" };
  if (!/^[A-Z0-9]{6,35}$/.test(utr))
    return {
      error: "The UPI reference is the 12-digit number in your UPI app's payment details.",
    };
  return { utr };
}

/** 24 URL-safe random characters (18 random bytes). */
export function newPayToken(): string {
  const bytes = new Uint8Array(18);
  globalThis.crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}
export const isPayToken = (t: string) => /^[A-Za-z0-9_-]{24}$/.test(t);
/** A bill's public token (invoice-utils createPublicToken; bills brought over may differ). */
export const isBillToken = (t: string) => /^[A-Za-z0-9_-]{16,80}$/.test(t);

/** At most 6 "I've paid" taps in any 24 hours per link (`times` = earlier taps, ms). */
export function paidRateOk(times: number[], now: number) {
  return times.filter((t) => now - t < 86_400_000).length < PAY_LIMITS.paidPerDay;
}

export function addDaysIso(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** What a renewal costs today: the package price with the gym's tax (as a new bill would). */
export function renewalAmount(
  price: number,
  settings: Pick<BusinessBillingSettings, "taxEnabled" | "taxRate">,
) {
  return calculateInvoiceTotals([{ quantity: 1, unitPrice: price }], 0, settings, 0).total;
}

/**
 * The package to offer for online renewal: the latest plan's, while no plan is queued after today
 * and that plan ends within 7 days (or has ended). null = renew at the desk.
 */
export function renewalOffer(
  plans: { packageId: string; startDate: string; endDate: string; status: string }[],
  today: string,
): string | null {
  const kept = plans.filter((p) => p.status !== "cancelled");
  if (kept.some((p) => p.startDate > today)) return null;
  const latest = [...kept].sort(
    (a, b) => b.endDate.localeCompare(a.endDate) || b.startDate.localeCompare(a.startDate),
  )[0];
  if (!latest?.packageId) return null;
  if (latest.endDate > addDaysIso(today, PAY_LIMITS.renewWithinDays)) return null;
  return latest.packageId;
}

/**
 * Why an open link should close now ("" = it stays). Balance: the bill's balance now (null = the
 * bill is gone or can't take money). Renewal: the package is still sold and the member's plans
 * haven't changed since the link was made. A link waiting for the desk never closes by itself.
 */
export function closeReason(
  link: { kind: PayLinkKind; status: PayLinkStatus; expiresOn: string; planSeq: number },
  now: { today: string; billOwed?: number | null; packageSold?: boolean; planSeq?: number },
): PayCloseReason | "" {
  if (link.status !== "open") return "";
  if (link.kind === "balance") {
    if (now.billOwed === null || now.billOwed === undefined) return "bill";
    if (now.billOwed <= 0) return "paid";
  } else {
    if (!now.packageSold) return "package";
    if (now.planSeq !== link.planSeq) return "changed";
  }
  if (link.expiresOn && link.expiresOn < now.today) return "expired";
  return "";
}
