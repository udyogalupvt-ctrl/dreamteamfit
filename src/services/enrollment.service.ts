import {
  addDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentData,
} from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { addDaysISO, formatDateISO, normalizePhone, todayISO } from "@/lib/format";
import {
  calculateInvoiceTotals,
  createPublicToken,
  derivePaymentStatus,
} from "@/lib/invoice-utils";
import { adapterFor } from "@/lib/biometric-adapters";
import type {
  BiometricDevice,
  BusinessBillingSettings,
  Client,
  Enrollment,
  GymPackage,
  PaymentMethod,
  PtPackage,
  ShareType,
  Trainer,
} from "@/types/models";
import type { ClientInput } from "./clients.service";
import { claimMemberId, mapClient } from "./clients.service";
import { allocatePayment, cashOpenFrom } from "./finance.service";
import { oldPaymentData } from "./old-money.service";
import { saleMoneyDay } from "@/lib/late-sales";
import { currentRow, pickCurrent } from "@/lib/current-plan";
import { conflictMessage, overlapConflict, overlapPlan } from "@/lib/plan-overlap";
import { checkOldRows, defaultOldRows, oldRowsTotal, type OldPayRow } from "@/lib/old-money";
import { col, COLLECTIONS, toDate } from "./firestore.service";
import { mapInvoice } from "./invoices.service";
import { calculateEndDate } from "./memberships.service";
import { calculateShare, ptPackageLabel } from "./pt.service";

export const mapEnrollment = (id: string, d: DocumentData): Enrollment => ({
  id,
  clientId: d["clientId"] ?? "",
  clientNameSnapshot: d["clientNameSnapshot"] ?? "",
  status: d["status"] ?? "draft",
  membershipId: d["membershipId"] ?? null,
  ptAssignmentId: d["ptAssignmentId"] ?? null,
  invoiceId: d["invoiceId"] ?? "",
  paymentId: d["paymentId"] ?? null,
  biometricDeviceId: d["biometricDeviceId"] ?? "",
  biometricUserId: d["biometricUserId"] ?? "",
  firstThumbRegistered: Boolean(d["firstThumbRegistered"]),
  lastError: d["lastError"] ?? "",
  invoiceSharedAt: d["invoiceSharedAt"] ? toDate(d["invoiceSharedAt"]) : null,
  createdAt: toDate(d["createdAt"]),
  updatedAt: toDate(d["updatedAt"]),
});

export const subscribeEnrollment = (
  id: string,
  ok: (x: Enrollment | null) => void,
  fail: (e: Error) => void,
) =>
  onSnapshot(
    doc(db, COLLECTIONS.enrollments, id),
    (s) => ok(s.exists() ? mapEnrollment(s.id, s.data()) : null),
    fail,
  );

/** A member whose joining is not finished: paid, but the first thumb is not on the device yet. */
export const isSetupPending = (c: Pick<Client, "firstThumbRegistered" | "enrollmentId">) =>
  !c.firstThumbRegistered && Boolean(c.enrollmentId);

export interface EnrollmentInput {
  client: ClientInput;
  whatsappOptIn: boolean;
  existingClient: Client | null;
  inquiryId: string | null;
  gymPackage: GymPackage | null;
  pt: {
    pkg: PtPackage;
    trainer: Trainer;
    shareType: ShareType;
    shareValue: number;
    /**
     * ₹ off the PT package only (its own discount; the bill's `discount` is for the rest). The PT
     * line on the bill and the trainer share are worked out on the price after it.
     */
    discount?: number;
    /** The PT plan's own dates; left out = the sale's start date, for the PT package's length. */
    startDate?: string;
    endDate?: string;
  } | null;
  startDate: string;
  discount: number;
  amountPaid: number;
  method: PaymentMethod;
  /**
   * The money counts on the plan's first day when the plan started before today (the member paid
   * then; it was typed in later). true = the member paid today (counted today).
   */
  paidToday?: boolean;
  /**
   * The day the member paid, chosen by staff ("Paid on"): the money counts that day (from the
   * 1st of last month to today). Left out = the rule above. Not for upgrades (paid today).
   */
  paidOn?: string;
  notes: string;
  settings: BusinessBillingSettings;
  staff: { uid: string; name: string };
  /** Staff member who counselled the member (incentives, sales per person). */
  counsellor: { id: string; name: string } | null;
  /** When a balance is left: the day the member promised to pay (WhatsApp reminder that morning). */
  nextPaymentDate: string | null;
  /** New member's ID (a free number, also used on the fingerprint machine). */
  memberId: string;
  /**
   * Upgrade: the running plan ends today and its unused days are credited on this bill. null =
   * a normal joining / renewal (a renewal simply starts after the running plan).
   */
  upgrade: UpgradeInput | null;
  /**
   * A member moving from the old software whose plan was paid there: no money is taken or
   * counted today (no payment, no day-book entry, no trainer payout). Only a balance still owed
   * gets a bill, to collect later as usual.
   */
  oldSoftware?: {
    balance: number;
    /** What they paid there (kept on the plan; never counted as money here). */
    paid?: number;
    /** The old software's bill number, when known. */
    billNo?: string;
    /**
     * When it was paid there (part payments: one row each). Left out = all of `paid` on the start
     * day. Counted in Collected on those days, never in today's cash.
     */
    rows?: OldPayRow[];
    /**
     * The old plan's own last day, when it is still running there: the plan here ends the same
     * day (the thumb works until then; they renew here after).
     */
    end?: string;
    /**
     * Staff checked the balance is still owed: its bill gets the daily WhatsApp balance reminders.
     * Left out = no reminders (old records were often not updated when the balance was paid there).
     */
    remind?: boolean;
  } | null;
}

export interface UpgradeInput {
  membershipId: string;
  fromPackage: string;
  unusedDays: number;
  /** ₹ taken off this bill for the unused days (staff can adjust it). */
  credit: number;
}

/** ₹ taken off the PT package by its own discount (never more than its price). */
export function ptDiscountOf(pt: Pick<NonNullable<EnrollmentInput["pt"]>, "pkg" | "discount">) {
  return Math.min(Math.max(0, Math.round(Number(pt.discount) || 0)), Math.max(0, pt.pkg.price));
}
/** The PT price after its own discount: what the bill's PT line and the trainer share use. */
export function ptNetPrice(pt: Pick<NonNullable<EnrollmentInput["pt"]>, "pkg" | "discount">) {
  return Math.max(0, pt.pkg.price - ptDiscountOf(pt));
}
/** Most the PT discount may be: the PT package's maximum (Packages), else its price. */
export function maxPtDiscount(pkg: Pick<PtPackage, "price" | "maxDiscount">) {
  const limit = pkg.maxDiscount;
  return limit !== null && limit !== undefined && Number.isFinite(Number(limit))
    ? Math.min(Number(limit), Math.max(0, pkg.price))
    : Math.max(0, pkg.price);
}

/**
 * Highest discount allowed for this checkout (the maximums set in Packages); null = no package
 * here has a maximum. With a membership and PT together, each package's own maximum counts; one
 * without a maximum can be discounted up to its price (so the other's limit still holds).
 */
export function maxDiscountFor(input: Pick<EnrollmentInput, "gymPackage" | "pt">) {
  const parts = [
    input.gymPackage
      ? { limit: input.gymPackage.maxDiscount, price: input.gymPackage.price }
      : null,
    // What is left of the PT maximum after the PT discount.
    input.pt
      ? {
          limit:
            input.pt.pkg.maxDiscount === null || input.pt.pkg.maxDiscount === undefined
              ? input.pt.pkg.maxDiscount
              : Math.max(0, Number(input.pt.pkg.maxDiscount) - ptDiscountOf(input.pt)),
          price: ptNetPrice(input.pt),
        }
      : null,
  ].filter((p): p is { limit: number | null; price: number } => p !== null);
  const limited = (x: number | null | undefined): x is number =>
    x !== null && x !== undefined && Number.isFinite(Number(x));
  if (!parts.some((p) => limited(p.limit))) return null;
  return parts.reduce(
    (n, p) => n + (limited(p.limit) ? Number(p.limit) : Math.max(0, Number(p.price) || 0)),
    0,
  );
}

export function enrollmentTotals(
  input: Pick<EnrollmentInput, "gymPackage" | "pt" | "discount" | "amountPaid" | "settings"> & {
    upgrade?: UpgradeInput | null;
  },
) {
  const items: { quantity: number; unitPrice: number }[] = [];
  if (input.gymPackage) items.push({ quantity: 1, unitPrice: input.gymPackage.price });
  if (input.pt) items.push({ quantity: 1, unitPrice: ptNetPrice(input.pt) });
  const share = input.pt
    ? calculateShare(ptNetPrice(input.pt), input.pt.shareType, input.pt.shareValue)
    : null;
  return {
    // The upgrade credit is taken off like a discount, but it is not limited by "max discount".
    ...calculateInvoiceTotals(
      items,
      input.discount + Math.max(0, input.upgrade?.credit ?? 0),
      input.settings,
      input.amountPaid,
    ),
    upgradeCredit: Math.max(0, input.upgrade?.credit ?? 0),
    share,
  };
}

/**
 * One confirmed checkout creates everything once: client (if new), membership,
 * PT assignment, ONE payment, invoice + public link, trainer payout, enrollment record.
 */
export async function enrollMember(given: EnrollmentInput) {
  if (!given.gymPackage && !given.pt) throw new Error("Select a gym package or a PT package.");
  const old = given.oldSoftware ?? null;
  // Paid in the old software: its amounts are what was paid there, no discount here.
  const input: EnrollmentInput =
    old && given.pt ? { ...given, pt: { ...given.pt, discount: 0 } } : given;
  if (input.pt && ptDiscountOf(input.pt) > maxPtDiscount(input.pt.pkg))
    throw new Error(
      `PT discount can be at most ₹${maxPtDiscount(input.pt.pkg).toLocaleString("en-IN")} on this PT package.`,
    );
  // A member already in the app (Excel import, thumb first) may still be moving over, and so may
  // one with plans here before or after it (an older plan that ended, or the renewal entered while
  // the old plan still runs). A plan here running on its first day means it was paid here.
  if (old && input.existingClient) {
    // Gym plans against gym plans, PT against PT (a PT plan here doesn't stop the gym plan).
    const [plansHere, ptHere] = await Promise.all([
      input.gymPackage
        ? getDocs(
            query(col(COLLECTIONS.memberships), where("clientId", "==", input.existingClient.id)),
          )
        : null,
      input.pt
        ? getDocs(
            query(col(COLLECTIONS.ptAssignments), where("clientId", "==", input.existingClient.id)),
          )
        : null,
    ]);
    if (
      [...(plansHere?.docs ?? []), ...(ptHere?.docs ?? [])].some(
        (d) =>
          d.data()["status"] !== "cancelled" &&
          String(d.data()["startDate"] ?? "") <= input.startDate &&
          String(d.data()["endDate"] ?? "") >= input.startDate,
      )
    )
      throw new Error(
        "This member already has a plan in this app from that day: a renewal here is paid here, not in the old software.",
      );
  }
  const oldBalance = old ? Math.max(0, Math.round(old.balance || 0)) : 0;
  // Paid there in parts: the parts are what was paid.
  const oldRows = old
    ? old.rows?.length
      ? old.rows
      : defaultOldRows(input.startDate, Math.max(0, Math.round(old.paid || 0)), todayISO())
    : [];
  if (old?.rows?.length) {
    const bad = checkOldRows(old.rows, todayISO());
    if (bad) throw new Error(bad);
  } else if (oldRows.some((r) => !r.date))
    // A plan that starts later has no start day to count it on (never "today").
    throw new Error(
      "This plan starts after today: give the day it was paid in the old software (Paid in parts or on another day?).",
    );
  const oldPaid = old
    ? old.rows?.length
      ? oldRowsTotal(old.rows)
      : Math.max(0, Math.round(old.paid || 0))
    : 0;
  const oldFields = old
    ? {
        paidInOldSoftware: true,
        oldSoftwarePaid: oldPaid,
        oldSoftwareBalance: oldBalance,
        ...(old.billNo ? { oldSoftwareBillNo: String(old.billNo).slice(0, 40) } : {}),
      }
    : {};
  const totals = enrollmentTotals(old ? { ...input, discount: 0, amountPaid: 0 } : input);
  if (!old && input.amountPaid > totals.total)
    throw new Error("Amount paid cannot exceed the total.");
  const maxDiscount = maxDiscountFor(input);
  if (!old && maxDiscount !== null && input.discount > maxDiscount)
    throw new Error(
      `Discount can be at most ₹${maxDiscount.toLocaleString("en-IN")} on this package.`,
    );
  const balanceLeft = old
    ? oldBalance > 0
    : totals.total - Math.min(input.amountPaid, totals.total) > 0;
  if (balanceLeft && !input.nextPaymentDate)
    throw new Error("Pick the date the member will pay the balance.");
  const dueDate = balanceLeft && input.nextPaymentDate ? input.nextPaymentDate : todayISO();
  const counsellor = {
    counsellorId: input.counsellor?.id ?? "",
    counsellorName: input.counsellor?.name ?? "",
  };
  const phoneN = normalizePhone(input.client.phone);
  if (!input.existingClient) {
    const dup = await getDocs(
      query(col(COLLECTIONS.clients), where("phoneNormalized", "==", phoneN)),
    );
    if (!dup.empty)
      throw new Error(
        `A member with this phone already exists (${dup.docs[0]!.data()["fullName"]}).`,
      );
  }
  const existingBio =
    input.existingClient?.biometricStatus === "active" &&
    input.existingClient.firstThumbRegistered !== false &&
    input.existingClient.biometricUserId;
  const needsBiometric = !existingBio;
  let prevActive: string[] = [];
  let memberPlans: { id: string; data: Record<string, unknown> }[] = [];
  if (input.existingClient && input.gymPackage) {
    const ms = await getDocs(
      query(col(COLLECTIONS.memberships), where("clientId", "==", input.existingClient.id)),
    );
    memberPlans = ms.docs.map((d) => ({ id: d.id, data: d.data() }));
    // A renewal that starts later queues behind the running plan instead of cutting it short.
    prevActive =
      input.startDate > todayISO()
        ? []
        : ms.docs
            .filter((d) => d.data()["status"] === "active" && d.id !== input.upgrade?.membershipId)
            .map((d) => d.id);
  }

  const clientRef = input.existingClient
    ? doc(db, COLLECTIONS.clients, input.existingClient.id)
    : doc(col(COLLECTIONS.clients));
  const membershipRef = input.gymPackage ? doc(col(COLLECTIONS.memberships)) : null;
  const ptRef = input.pt ? doc(col(COLLECTIONS.ptAssignments)) : null;
  // Paid in the old software: a bill only for a balance still owed.
  const invoiceRef = !old || oldBalance > 0 ? doc(col(COLLECTIONS.invoices)) : null;
  const paymentRef = !old && totals.amountPaid > 0 ? doc(col(COLLECTIONS.payments)) : null;
  const enrollmentRef = doc(col(COLLECTIONS.enrollments));
  const payoutRef = input.pt && !old ? doc(col(COLLECTIONS.trainerPayouts)) : null;
  const token = createPublicToken();
  const counterRef = doc(db, COLLECTIONS.settings, "counters");
  const inquiryRef = input.inquiryId ? doc(db, COLLECTIONS.inquiries, input.inquiryId) : null;
  const today = todayISO();
  // A plan typed in after it started: its money counts on the plan's first day (see late-sales.ts).
  const ruleDay = saleMoneyDay({
    startDate: input.startDate,
    today,
    openFrom: cashOpenFrom(today),
    upgrade: !!input.upgrade,
    paidToday: !!input.paidToday,
  });
  // Staff chose the day it was paid: it stays that day (the owner's late-sales tool never moves it).
  const paidOn = !input.upgrade && input.paidOn ? input.paidOn : "";
  if (paidOn) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) throw new Error("Pick the day it was paid.");
    if (paidOn > today) throw new Error("The day it was paid can't be after today.");
    if (paidOn < cashOpenFrom(today))
      throw new Error(`Pick a paid day from ${formatDateISO(cashOpenFrom(today))} on.`);
  }
  const moneyDay = paidOn || ruleDay;
  const fullName = input.existingClient?.fullName ?? input.client.fullName.trim();
  const phone = input.existingClient?.phone ?? input.client.phone.trim();
  const email = input.existingClient?.email ?? input.client.email.trim();
  // The plan runs from the date staff chose with the member, whether or not the thumb is
  // registered yet; the thumb only opens the door.
  const oldEnd = old?.end && /^\d{4}-\d{2}-\d{2}$/.test(old.end) ? old.end : "";
  if (oldEnd && oldEnd < input.startDate)
    throw new Error("The old plan ends before it starts: check the old software's dates.");
  // The PT plan's own dates (staff may change them); by default from the sale's start date. A PT
  // plan carried over alone from the old software keeps its own last day there.
  const isDay = (x: string | undefined): x is string => !!x && /^\d{4}-\d{2}-\d{2}$/.test(x);
  const ptStart = input.pt && isDay(input.pt.startDate) ? input.pt.startDate : input.startDate;
  const ptEnd = input.pt
    ? isDay(input.pt.endDate)
      ? input.pt.endDate
      : oldEnd && !input.gymPackage
        ? oldEnd
        : calculateEndDate(ptStart, input.pt.pkg.durationDays)
    : "";
  if (input.pt && ptEnd < ptStart)
    throw new Error("The PT plan ends before it starts: check the PT dates.");
  const planEnd = input.gymPackage
    ? oldEnd || calculateEndDate(input.startDate, input.gymPackage.durationDays)
    : "";
  // An old plan whose dates are all past is saved as ended (it never becomes the current plan).
  const membershipStatus =
    planEnd && planEnd < today ? "expired" : input.startDate > today ? "pending" : "active";
  // Two gym plans for the same days: one is a copy, and both would count their money.
  if (input.gymPackage) {
    const all = memberPlans.map((p) => overlapPlan(p.id, p.data));
    // An upgrade takes over the upgraded plan's days: only days beyond what that plan already
    // shared with another plan count (e.g. one an older-style renewal ended).
    const upgraded = all.find((p) => p.id === input.upgrade?.membershipId) ?? null;
    const clash = overlapConflict(
      { startDate: input.startDate, endDate: planEnd },
      all,
      today,
      input.upgrade ? [input.upgrade.membershipId] : [],
      upgraded,
    );
    if (clash) throw new Error(conflictMessage(clash));
  }
  // The member's current plan after this sale, by the one rule (current-plan.ts): the plans it
  // ends or cuts short as they will be, plus the new one.
  const upgradeEnd = input.upgrade ? addDaysISO(input.startDate, -1) : "";
  const planSummary =
    membershipRef && input.gymPackage
      ? pickCurrent(
          [
            ...memberPlans.map((p) => {
              const r = currentRow(p.id, p.data);
              if (prevActive.includes(p.id)) return { ...r, status: "expired" };
              if (p.id === input.upgrade?.membershipId)
                return {
                  ...r,
                  endDate: upgradeEnd,
                  status: input.startDate <= today ? "expired" : r.status,
                };
              return r;
            }),
            {
              id: membershipRef.id,
              name: input.gymPackage.name,
              startDate: input.startDate,
              endDate: planEnd,
              status: membershipStatus,
            },
          ],
          today,
        ).summary
      : null;

  await runTransaction(db, async (tx) => {
    const counter = await tx.get(counterRef);
    const inq = inquiryRef ? await tx.get(inquiryRef) : null;
    if (inq?.exists() && inq.data()["convertedToClient"])
      throw new Error("This lead has already been converted.");
    const idClaim = input.existingClient
      ? null
      : await claimMemberId(tx, input.memberId, clientRef.id);
    const upgradeRef = input.upgrade
      ? doc(db, COLLECTIONS.memberships, input.upgrade.membershipId)
      : null;
    const upgraded = upgradeRef ? await tx.get(upgradeRef) : null;
    if (
      upgraded &&
      (!upgraded.exists() ||
        upgraded.data()["clientId"] !== input.existingClient?.id ||
        ["cancelled", "expired"].includes(String(upgraded.data()["status"])))
    )
      throw new Error("The plan being upgraded has already ended. Refresh and try again.");
    if (upgraded && String(upgraded.data()!["endDate"] ?? "") < input.startDate)
      throw new Error("The upgrade date is after the current plan ends. Use Renew instead.");
    const c = counter.data() ?? {};
    const year = new Date(`${today}T00:00:00`).getFullYear();
    const invKey = `invoiceSeq${year}`;
    // No bill (paid in the old software): no bill number is used up.
    const invSeq = Number(c[invKey] ?? 0) + (invoiceRef ? 1 : 0);
    const invoiceNumber = `${input.settings.invoicePrefix}-${year}-${String(invSeq).padStart(6, "0")}`;
    const counterPatch: Record<string, unknown> = {
      [invKey]: invSeq,
      updatedAt: serverTimestamp(),
    };
    const now = serverTimestamp();

    if (idClaim) {
      idClaim.write();
      tx.set(clientRef, {
        ...input.client,
        fullName,
        phone,
        email,
        phoneNormalized: phoneN,
        clientCode: idClaim.id,
        inquiryId: input.inquiryId,
        currentMembership: planSummary,
        biometricUserId: "",
        biometricDeviceId: "",
        biometricStatus: "not_enrolled",
        firstThumbRegistered: false,
        enrollmentId: enrollmentRef.id,
        whatsappOptIn: input.whatsappOptIn,
        whatsappPhone: phone,
        photoUploadToken: input.client.profilePhotoUrl ? "" : createPublicToken(),
        whatsappStatus: input.whatsappOptIn ? "ready" : "opted_out",
        lastWhatsappMessageAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }
    tx.set(counterRef, counterPatch, { merge: true });

    let endDate = "";
    if (membershipRef && input.gymPackage) {
      endDate = oldEnd || calculateEndDate(input.startDate, input.gymPackage.durationDays);
      // Stamped with this plan: removing it (added by mistake) makes them run again.
      prevActive.forEach((id) =>
        tx.update(doc(db, COLLECTIONS.memberships, id), {
          status: "expired",
          endedBy: membershipRef.id,
          statusBeforeSale: "active",
          updatedAt: now,
        }),
      );
      if (upgradeRef && upgraded && input.upgrade)
        // The old plan runs until the day before the new one starts (today → ended); its unused
        // days after that became the credit on this bill.
        tx.update(upgradeRef, {
          ...(input.startDate <= today ? { status: "expired" } : {}),
          upgradeFrom: input.startDate,
          endDate: addDaysISO(input.startDate, -1),
          originalEndDate: upgraded.data()!["endDate"] ?? "",
          upgradedTo: membershipRef.id,
          upgradeCredit: input.upgrade.credit,
          updatedAt: now,
        });
      tx.set(membershipRef, {
        clientId: clientRef.id,
        packageId: input.gymPackage.id,
        packageNameSnapshot: input.gymPackage.name,
        priceSnapshot: input.gymPackage.price,
        durationDaysSnapshot: input.gymPackage.durationDays,
        startDate: input.startDate,
        endDate,
        status: membershipStatus,
        invoiceId: invoiceRef?.id ?? "",
        enrollmentId: enrollmentRef.id,
        ...oldFields,
        ...counsellor,
        createdAt: now,
        updatedAt: now,
      });
    }
    const share = totals.share;
    if (ptRef && input.pt && share) {
      tx.set(ptRef, {
        clientId: clientRef.id,
        clientNameSnapshot: fullName,
        ptPackageId: input.pt.pkg.id,
        ptPackageNameSnapshot: ptPackageLabel(input.pt.pkg),
        trainerId: input.pt.trainer.id,
        trainerNameSnapshot: input.pt.trainer.name,
        ...share,
        // Before the discount: ptPrice (in `share`) is what is charged for PT on this bill.
        ...(ptDiscountOf(input.pt) > 0
          ? { ptListPrice: input.pt.pkg.price, ptDiscount: ptDiscountOf(input.pt) }
          : {}),
        startDate: ptStart,
        endDate: ptEnd,
        status: ptEnd < today ? "completed" : ptStart > today ? "pending" : "active",
        invoiceId: invoiceRef?.id ?? "",
        enrollmentId: enrollmentRef.id,
        ...oldFields,
        ...counsellor,
        createdAt: now,
        updatedAt: now,
      });
    }
    if (payoutRef && ptRef && input.pt && share) {
      tx.set(payoutRef, {
        trainerId: input.pt.trainer.id,
        trainerNameSnapshot: input.pt.trainer.name,
        clientId: clientRef.id,
        clientNameSnapshot: fullName,
        ptAssignmentId: ptRef.id,
        ptPackageNameSnapshot: ptPackageLabel(input.pt.pkg),
        invoiceId: invoiceRef?.id ?? "",
        grossAmount: share.ptPrice,
        trainerShareAmount: share.trainerShareAmount,
        gymShareAmount: share.gymShareAmount,
        paymentDate: moneyDay,
        status: "pending",
        paidAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }
    const planName = [input.gymPackage?.name, input.pt ? `PT: ${ptPackageLabel(input.pt.pkg)}` : ""]
      .filter(Boolean)
      .join(" + ");
    const items = old
      ? [
          {
            name: `Balance from the old software · ${planName}`,
            description: "Plan paid in the old software; this part was still due",
            quantity: 1,
            unitPrice: oldBalance,
            total: oldBalance,
            packageId: null,
          },
        ]
      : [
          ...(input.gymPackage
            ? [
                {
                  name: input.gymPackage.name,
                  description: `Gym membership · ${input.gymPackage.durationDays} days`,
                  quantity: 1,
                  unitPrice: input.gymPackage.price,
                  total: input.gymPackage.price,
                  packageId: input.gymPackage.id,
                },
              ]
            : []),
          ...(input.pt
            ? [
                {
                  name: `PT: ${ptPackageLabel(input.pt.pkg)}`,
                  description: `Personal training with ${input.pt.trainer.name}${
                    ptDiscountOf(input.pt) > 0
                      ? ` · ₹${input.pt.pkg.price.toLocaleString("en-IN")} less ₹${ptDiscountOf(input.pt).toLocaleString("en-IN")} PT discount`
                      : ""
                  }`,
                  quantity: 1,
                  unitPrice: ptNetPrice(input.pt),
                  total: ptNetPrice(input.pt),
                  packageId: null,
                },
              ]
            : []),
        ];
    const { share: _s, upgradeCredit: _u, ...plainMoney } = totals;
    const money = old
      ? {
          subtotal: oldBalance,
          discount: 0,
          tax: 0,
          total: oldBalance,
          amountPaid: 0,
          balanceDue: oldBalance,
          upgradeCredit: 0,
        }
      : { ...plainMoney, upgradeCredit: totals.upgradeCredit };
    const breakdown = old
      ? {
          membershipGross: input.gymPackage ? oldBalance : 0,
          ptGross: input.gymPackage ? 0 : oldBalance,
          trainerShareTotal: 0,
        }
      : {
          membershipGross: input.gymPackage?.price ?? 0,
          ptGross: input.pt ? ptNetPrice(input.pt) : 0,
          trainerShareTotal: share?.trainerShareAmount ?? 0,
        };
    const paymentStatus = derivePaymentStatus(money.total, money.amountPaid);
    if (invoiceRef)
      tx.set(invoiceRef, {
        invoiceNumber,
        clientId: clientRef.id,
        clientNameSnapshot: fullName,
        clientPhoneSnapshot: phone,
        clientEmailSnapshot: email,
        membershipId: membershipRef?.id ?? null,
        packageId: input.gymPackage?.id ?? null,
        ptAssignmentId: ptRef?.id ?? null,
        paymentId: paymentRef?.id ?? null,
        enrollmentId: enrollmentRef.id,
        items,
        ...money,
        ...breakdown,
        ...(old ? { remindOldBalance: old.remind === true } : {}),
        paymentsTracked: true,
        paymentStatus,
        paymentMethod: input.method,
        invoiceDate: today,
        dueDate,
        notes: [
          input.upgrade
            ? `Upgrade from ${input.upgrade.fromPackage}: ₹${input.upgrade.credit.toLocaleString("en-IN")} credit for ${input.upgrade.unusedDays} unused days`
            : "",
          old ? "Moved from the old software (plan paid there)" : "",
          input.notes,
        ]
          .filter(Boolean)
          .join(" · "),
        ...counsellor,
        pdfUrl: "",
        publicToken: token,
        createdBy: input.staff.name,
        createdByUid: input.staff.uid,
        createdAt: now,
        updatedAt: now,
      });
    if (invoiceRef)
      tx.set(doc(db, COLLECTIONS.publicInvoices, token), {
        publicToken: token,
        invoiceNumber,
        clientName: fullName,
        clientPhone: phone,
        clientEmail: email,
        items,
        ...money,
        paymentStatus,
        paymentMethod: input.method,
        invoiceDate: today,
        dueDate,
        pdfUrl: "",
        business: input.settings,
        updatedAt: now,
      });
    if (paymentRef && invoiceRef) {
      tx.set(paymentRef, {
        clientId: clientRef.id,
        clientNameSnapshot: fullName,
        invoiceId: invoiceRef.id,
        invoiceNumber,
        membershipId: membershipRef?.id ?? null,
        ptAssignmentId: ptRef?.id ?? null,
        amount: money.amountPaid,
        method: input.method,
        paymentDate: moneyDay,
        // Staff said a plan that had started was paid today: that day stays (owner tool too).
        ...(input.paidToday && input.startDate < today ? { paidToday: true } : {}),
        ...(paidOn ? { paidOnChosen: true } : {}),
        kind: "initial",
        ...allocatePayment(
          { total: money.total, subtotal: money.subtotal, discount: money.discount, ...breakdown },
          money.amountPaid,
        ),
        ...counsellor,
        createdBy: input.staff.name,
        createdByUid: input.staff.uid,
        createdAt: now,
        updatedAt: now,
      });
    }
    // Paid in the old software: counted on the day(s) it was paid there, never in today's cash.
    if (old && oldRows.length) {
      const link = {
        clientId: clientRef.id,
        clientName: fullName,
        membershipId: membershipRef?.id ?? null,
        ptAssignmentId: ptRef?.id ?? null,
        billNo: old.billNo ? String(old.billNo) : "",
        basis: {
          gym: input.gymPackage ? { price: input.gymPackage.price } : null,
          pt: share ? { price: share.ptPrice, trainerShare: share.trainerShareAmount } : null,
        },
      };
      const sorted = [...oldRows].sort((a, b) => a.date.localeCompare(b.date));
      sorted.forEach((r, i) =>
        tx.set(doc(col(COLLECTIONS.payments)), oldPaymentData(r, link, i === 0, input.staff)),
      );
    }
    tx.set(enrollmentRef, {
      clientId: clientRef.id,
      clientNameSnapshot: fullName,
      status: needsBiometric ? "biometric_pending" : "active",
      membershipId: membershipRef?.id ?? null,
      ptAssignmentId: ptRef?.id ?? null,
      invoiceId: invoiceRef?.id ?? "",
      paymentId: paymentRef?.id ?? null,
      paymentStatus: invoiceRef ? paymentStatus : "paid",
      ...oldFields,
      biometricDeviceId: input.existingClient?.biometricDeviceId ?? "",
      biometricUserId: input.existingClient?.biometricUserId ?? "",
      firstThumbRegistered: !needsBiometric,
      lastError: "",
      invoiceSharedAt: null,
      ...counsellor,
      createdAt: now,
      updatedAt: now,
    });
    if (input.existingClient) {
      const clientPatch: Record<string, unknown> = { updatedAt: now };
      // Only a member still waiting for a thumb points at this enrollment, so the profile can resume it.
      if (needsBiometric) clientPatch["enrollmentId"] = enrollmentRef.id;
      // (An upgrade from a later date: the running plan, now ending the day before it.)
      if (planSummary) {
        clientPatch["currentMembership"] = planSummary;
        if (planSummary.status === "active") clientPatch["status"] = "active";
      }
      if (input.whatsappOptIn && !input.existingClient.whatsappOptIn) {
        clientPatch["whatsappOptIn"] = true;
        clientPatch["whatsappStatus"] = "ready";
      }
      tx.update(clientRef, clientPatch);
    }
    if (inquiryRef)
      tx.update(inquiryRef, {
        status: "converted",
        convertedToClient: true,
        clientId: clientRef.id,
        nextFollowUpDate: null,
        updatedAt: now,
      });
  });

  if (input.inquiryId)
    await closeOpenFollowUps("inquiryId", input.inquiryId, "Joined").catch(() => undefined);

  const invoice = invoiceRef
    ? mapInvoice(invoiceRef.id, (await getDoc(invoiceRef)).data() ?? {})
    : null;
  // No file upload here: confirming a payment never waits on a PDF.
  return {
    clientId: clientRef.id,
    enrollmentId: enrollmentRef.id,
    invoice,
    needsBiometric,
  };
}

/** Marks every still-pending follow-up call for a lead / member as done. */
export async function closeOpenFollowUps(
  field: "inquiryId" | "clientId",
  id: string,
  outcome: string,
) {
  const snap = await getDocs(query(col(COLLECTIONS.followups), where(field, "==", id)));
  const open = snap.docs.filter((d) => d.data()["status"] === "pending");
  if (!open.length) return 0;
  const batch = writeBatch(db);
  open.forEach((d) =>
    batch.update(d.ref, {
      status: "completed",
      outcome,
      lastContactDate: todayISO(),
      updatedAt: serverTimestamp(),
    }),
  );
  await batch.commit();
  return open.length;
}

/**
 * The machine ID to suggest for a member: their member ID when nobody else has it (on the
 * machine, e.g. from the old software, or in the app), otherwise the lowest free number.
 * Members stay below 9000 (staff start at 9001).
 */
export async function freeMachineId(deviceId: string, preferred: string, clientId: string) {
  const [clients, onMachine] = await Promise.all([
    getDocs(col(COLLECTIONS.clients)),
    deviceId
      ? getDocs(query(col(COLLECTIONS.deviceUsers), where("deviceId", "==", deviceId))).catch(
          () => null,
        )
      : Promise.resolve(null),
  ]);
  const taken = new Set<string>();
  clients.docs.forEach((d) => {
    if (d.id === clientId) return;
    const p = String(d.data()["biometricUserId"] ?? "");
    if (p) taken.add(p);
    // Another member's ID stays theirs for their own thumb.
    const code = String(d.data()["clientCode"] ?? "");
    if (code) taken.add(code);
  });
  onMachine?.docs.forEach((d) => {
    const u = d.data();
    if (u["removed"] !== true && u["linkId"] !== clientId) taken.add(String(u["pin"] ?? ""));
  });
  if (preferred && !taken.has(preferred)) return preferred;
  let next = 1;
  while (taken.has(String(next))) next += 1;
  return String(next);
}

/** Suggests the next free numeric biometric user ID (device PINs are numeric). */
export async function suggestBiometricUserId() {
  const snap = await getDocs(col(COLLECTIONS.clients));
  const max = snap.docs.reduce(
    (n, d) => Math.max(n, Number.parseInt(String(d.data()["biometricUserId"] ?? ""), 10) || 0),
    0,
  );
  return String(max + 1);
}

/** Device names are ASCII and short; tabs / newlines would break the device command. */
const deviceName = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24) || "Member";

async function assertPinFree(clientId: string, device: BiometricDevice, pin: string) {
  const clash = await getDocs(query(col(COLLECTIONS.clients), where("biometricUserId", "==", pin)));
  const other = clash.docs.find(
    (d) =>
      d.id !== clientId &&
      (d.data()["biometricDeviceId"] === device.id || !d.data()["biometricDeviceId"]),
  );
  if (other)
    throw new Error(`Biometric ID ${pin} already belongs to ${String(other.data()["fullName"])}.`);
  // Someone the old software put on this machine under the same number.
  const onMachine = await getDoc(
    doc(db, COLLECTIONS.deviceUsers, `${device.id}_${pin.replace(/[^a-zA-Z0-9_-]/g, "_")}`),
  ).catch(() => null);
  const u = onMachine?.data();
  if (u && u["removed"] !== true && u["linkId"] !== clientId)
    throw new Error(
      `Machine ID ${pin} is already used on the machine${u["name"] ? ` by ${String(u["name"])}` : ""}. Use another ID, or link that machine user under Fingerprint devices.`,
    );
}

export type FingerprintRequestResult =
  /** requestId: the enroll command, so the screen follows exactly this request. */
  | { mode: "device"; message: string; requestId: string }
  | { mode: "adapter"; ok: boolean; message: string };

/**
 * Starts first-thumb registration. For cloud-connected (ADMS) devices this queues the
 * "create user" + "enroll fingerprint" commands; the device prompts the member, and the
 * member is activated by the cloud endpoint only when the device reports the fingerprint.
 * Nothing here marks a member active on its own.
 */
export async function requestFingerprint(input: {
  clientId: string;
  enrollmentId: string | null;
  device: BiometricDevice;
  biometricUserId: string;
}): Promise<FingerprintRequestResult> {
  const pin = input.biometricUserId.trim();
  const clientRef = doc(db, COLLECTIONS.clients, input.clientId);
  const cSnap = await getDoc(clientRef);
  if (!cSnap.exists()) throw new Error("Member not found.");
  const client = mapClient(cSnap.id, cSnap.data());
  const eRef = input.enrollmentId ? doc(db, COLLECTIONS.enrollments, input.enrollmentId) : null;

  if (input.device.integrationType === "adms") {
    if (!/^\d{1,9}$/.test(pin)) throw new Error("Biometric ID must be a number (up to 9 digits).");
    if (!input.device.serialNumber)
      throw new Error("Add the device serial number in Biometric devices first.");
    await assertPinFree(client.id, input.device, pin);
    // Withdraw any earlier request that is still waiting, so the device prompts only once.
    const earlier = await getDocs(
      query(col(COLLECTIONS.biometricCommands), where("clientId", "==", client.id)),
    );
    const batch = writeBatch(db);
    const now = serverTimestamp();
    earlier.docs
      .filter((d) => d.data()["status"] === "pending" && d.data()["door"] !== true)
      .forEach((d) => batch.update(d.ref, { status: "cancelled", updatedAt: now }));
    batch.update(clientRef, {
      biometricUserId: pin,
      biometricDeviceId: input.device.id,
      updatedAt: now,
    });
    if (eRef)
      batch.update(eRef, {
        biometricDeviceId: input.device.id,
        biometricUserId: pin,
        lastError: "",
        updatedAt: now,
      });
    const base = {
      deviceId: input.device.id,
      serialNumber: input.device.serialNumber,
      clientId: client.id,
      enrollmentId: input.enrollmentId,
      biometricUserId: pin,
      status: "pending",
      cmdNo: null,
      returnCode: null,
      error: "",
      sentAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    batch.set(doc(col(COLLECTIONS.biometricCommands)), {
      ...base,
      type: "user_upsert",
      order: 1,
      command: `DATA UPDATE USERINFO PIN=${pin}\tName=${deviceName(client.fullName)}\tPri=0\tPasswd=\tCard=\tGrp=1\tTZ=0000000100000000\tVerify=0`,
    });
    // FID 5 = right thumb in the ZKTeco finger index.
    const enrollRef = doc(col(COLLECTIONS.biometricCommands));
    batch.set(enrollRef, {
      ...base,
      type: "enroll_fp",
      order: 2,
      command: `ENROLL_FP PIN=${pin}\tFID=5\tRETRY=3\tOVERWRITE=1`,
    });
    await batch.commit();
    return {
      mode: "device",
      message:
        "Sent to the device. Ask the member to place the right thumb on the scanner 3 times.",
      requestId: enrollRef.id,
    };
  }

  // Other integration types go through their adapter; activation happens only on a confirmed ok.
  let result: { ok: boolean; message: string };
  try {
    result = await adapterFor(input.device).enrollFingerprint(pin, client.fullName);
  } catch (err) {
    result = {
      ok: false,
      message: (err as Error).message || "Biometric hardware integration is not configured.",
    };
  }
  if (!result.ok) {
    if (eRef)
      await writeBatch(db)
        .update(eRef, {
          biometricDeviceId: input.device.id,
          biometricUserId: pin,
          lastError: result.message,
          updatedAt: serverTimestamp(),
        })
        .commit();
    return { mode: "adapter", ...result };
  }
  await activateAfterConfirmedThumb(client, input.enrollmentId, input.device, pin);
  return { mode: "adapter", ...result };
}

export async function cancelFingerprintRequest(clientId: string) {
  const snap = await getDocs(
    query(col(COLLECTIONS.biometricCommands), where("clientId", "==", clientId)),
  );
  const batch = writeBatch(db);
  snap.docs
    .filter(
      (d) => d.data()["door"] !== true && ["pending", "sent"].includes(String(d.data()["status"])),
    )
    .forEach((d) => batch.update(d.ref, { status: "cancelled", updatedAt: serverTimestamp() }));
  await batch.commit();
}

/** Same activation the cloud endpoint performs, for adapters that confirm in the browser. */
async function activateAfterConfirmedThumb(
  client: Client,
  enrollmentId: string | null,
  device: BiometricDevice,
  pin: string,
) {
  const batch = writeBatch(db),
    now = serverTimestamp();
  const clientRef = doc(db, COLLECTIONS.clients, client.id);
  batch.update(clientRef, {
    biometricUserId: pin,
    biometricDeviceId: device.id,
    biometricStatus: "active",
    firstThumbRegistered: true,
    status: "active",
    updatedAt: now,
  });
  if (enrollmentId) {
    const eRef = doc(db, COLLECTIONS.enrollments, enrollmentId);
    const e = mapEnrollment(enrollmentId, (await getDoc(eRef)).data() ?? {});
    const mSnap = e.membershipId
      ? await getDoc(doc(db, COLLECTIONS.memberships, e.membershipId))
      : null;
    // Plans now run from their start date on their own; only an old-style plan that was still
    // waiting for the thumb is started here.
    if (mSnap?.exists() && mSnap.data()["status"] === "biometric_pending") {
      const m = mSnap.data() ?? {};
      const today = todayISO();
      const status = String(m["startDate"] ?? today) > today ? "pending" : "active";
      const others = await getDocs(
        query(col(COLLECTIONS.memberships), where("clientId", "==", client.id)),
      );
      const ended = new Set(
        status === "active"
          ? others.docs
              .filter((d) => d.id !== e.membershipId && d.data()["status"] === "active")
              .map((d) => d.id)
          : [],
      );
      others.docs
        .filter((d) => ended.has(d.id))
        .forEach((d) => batch.update(d.ref, { status: "expired", updatedAt: now }));
      batch.update(mSnap.ref, { status, updatedAt: now });
      // The member's current plan by the one rule (current-plan.ts), with these changes.
      const { summary } = pickCurrent(
        others.docs.map((d) => {
          const r = currentRow(d.id, d.data());
          return d.id === e.membershipId
            ? { ...r, status }
            : ended.has(d.id)
              ? { ...r, status: "expired" }
              : r;
        }),
        today,
      );
      if (summary) batch.update(clientRef, { currentMembership: summary });
    }
    if (e.ptAssignmentId) {
      const pt = await getDoc(doc(db, COLLECTIONS.ptAssignments, e.ptAssignmentId));
      if (
        pt.data()?.["status"] === "pending" &&
        String(pt.data()?.["startDate"] ?? "") <= todayISO()
      )
        batch.update(pt.ref, { status: "active", updatedAt: now });
    }
    batch.update(eRef, {
      status: "active",
      biometricDeviceId: device.id,
      biometricUserId: pin,
      firstThumbRegistered: true,
      lastError: "",
      updatedAt: now,
    });
  }
  await batch.commit();
}

/** Creates a biometric-only enrollment for members added before the joining flow existed. */
export async function ensureEnrollmentForClient(client: Client) {
  if (client.enrollmentId) return client.enrollmentId;
  const ref = await addDoc(col(COLLECTIONS.enrollments), {
    clientId: client.id,
    clientNameSnapshot: client.fullName,
    status: "biometric_pending",
    membershipId: null,
    ptAssignmentId: null,
    invoiceId: "",
    paymentId: null,
    biometricDeviceId: client.biometricDeviceId,
    biometricUserId: client.biometricUserId,
    firstThumbRegistered: false,
    lastError: "",
    invoiceSharedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await writeBatch(db)
    .update(doc(db, COLLECTIONS.clients, client.id), {
      enrollmentId: ref.id,
      updatedAt: serverTimestamp(),
    })
    .commit();
  return ref.id;
}
