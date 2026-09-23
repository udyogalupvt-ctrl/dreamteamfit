import {
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  type DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { createInvoiceSchema, type CreateInvoiceInput } from "@/lib/invoice-validation";
import {
  calculateInvoiceTotals,
  createPublicToken,
  derivePaymentStatus,
} from "@/lib/invoice-utils";
import { calculateEndDate } from "./memberships.service";
import { col, COLLECTIONS, subscribeCollection, subscribeQuery, toDate } from "./firestore.service";
import type {
  BusinessBillingSettings,
  Client,
  GymPackage,
  Invoice,
  PublicInvoice,
} from "@/types/models";

export const mapInvoice = (id: string, d: DocumentData): Invoice => ({
  id,
  invoiceNumber: d["invoiceNumber"] ?? "",
  clientId: d["clientId"] ?? "",
  clientNameSnapshot: d["clientNameSnapshot"] ?? "",
  clientPhoneSnapshot: d["clientPhoneSnapshot"] ?? "",
  clientEmailSnapshot: d["clientEmailSnapshot"] ?? "",
  membershipId: d["membershipId"] ?? null,
  packageId: d["packageId"] ?? null,
  items: Array.isArray(d["items"]) ? d["items"] : [],
  subtotal: Number(d["subtotal"] ?? 0),
  discount: Number(d["discount"] ?? 0),
  tax: Number(d["tax"] ?? 0),
  total: Number(d["total"] ?? 0),
  amountPaid: Number(d["amountPaid"] ?? 0),
  balanceDue: Number(d["balanceDue"] ?? 0),
  paymentStatus: d["paymentStatus"] ?? "pending",
  paymentMethod: d["paymentMethod"] ?? "Other",
  invoiceDate: d["invoiceDate"] ?? "",
  dueDate: d["dueDate"] ?? "",
  notes: d["notes"] ?? "",
  pdfUrl: d["pdfUrl"] ?? "",
  publicToken: d["publicToken"] ?? "",
  createdBy: d["createdBy"] ?? "Staff",
  createdByUid: d["createdByUid"] ?? "",
  ptAssignmentId: d["ptAssignmentId"] ?? null,
  paymentId: d["paymentId"] ?? null,
  enrollmentId: d["enrollmentId"] ?? null,
  membershipGross: Number(d["membershipGross"] ?? 0),
  ptGross: Number(d["ptGross"] ?? 0),
  trainerShareTotal: Number(d["trainerShareTotal"] ?? 0),
  paymentsTracked: Boolean(d["paymentsTracked"]),
  createdAt: toDate(d["createdAt"]),
  updatedAt: toDate(d["updatedAt"]),
});
export const mapPublicInvoice = (token: string, d: DocumentData): PublicInvoice => ({
  publicToken: token,
  invoiceNumber: d["invoiceNumber"] ?? "",
  clientName: d["clientName"] ?? "",
  clientPhone: d["clientPhone"] ?? "",
  clientEmail: d["clientEmail"] ?? "",
  items: Array.isArray(d["items"]) ? d["items"] : [],
  subtotal: Number(d["subtotal"] ?? 0),
  discount: Number(d["discount"] ?? 0),
  tax: Number(d["tax"] ?? 0),
  total: Number(d["total"] ?? 0),
  amountPaid: Number(d["amountPaid"] ?? 0),
  balanceDue: Number(d["balanceDue"] ?? 0),
  paymentStatus: d["paymentStatus"] ?? "pending",
  paymentMethod: d["paymentMethod"] ?? "Other",
  invoiceDate: d["invoiceDate"] ?? "",
  dueDate: d["dueDate"] ?? "",
  pdfUrl: d["pdfUrl"] ?? "",
  business: d["business"],
  updatedAt: toDate(d["updatedAt"]),
});
export function subscribeInvoices(ok: (v: Invoice[]) => void, fail: (e: Error) => void) {
  return subscribeCollection(
    COLLECTIONS.invoices,
    mapInvoice,
    ok,
    fail,
    orderBy("createdAt", "desc"),
  );
}
export function subscribeClientInvoices(
  clientId: string,
  ok: (v: Invoice[]) => void,
  fail: (e: Error) => void,
) {
  return subscribeQuery(
    query(col(COLLECTIONS.invoices), where("clientId", "==", clientId)),
    mapInvoice,
    (v) => ok(v.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())),
    fail,
  );
}
export function subscribeInvoice(
  id: string,
  ok: (v: Invoice | null) => void,
  fail: (e: Error) => void,
) {
  return onSnapshot(
    doc(db, COLLECTIONS.invoices, id),
    (s) => ok(s.exists() ? mapInvoice(s.id, s.data()) : null),
    fail,
  );
}
export function subscribePublicInvoice(
  token: string,
  ok: (v: PublicInvoice | null) => void,
  fail: (e: Error) => void,
) {
  return onSnapshot(
    doc(db, COLLECTIONS.publicInvoices, token),
    (s) => ok(s.exists() ? mapPublicInvoice(token, s.data()) : null),
    fail,
  );
}

export async function createInvoice(
  input: CreateInvoiceInput,
  context: {
    client: Client;
    packages: GymPackage[];
    settings: BusinessBillingSettings;
    staff: { uid: string; name: string };
  },
) {
  const data = createInvoiceSchema.parse(input),
    totals = calculateInvoiceTotals(data.items, data.discount, context.settings, data.amountPaid);
  if (data.amountPaid > totals.total) throw new Error("Amount paid cannot exceed invoice total.");
  const invoiceRef = doc(col(COLLECTIONS.invoices)),
    token = createPublicToken(),
    publicRef = doc(db, COLLECTIONS.publicInvoices, token),
    counterRef = doc(db, COLLECTIONS.settings, "counters");
  let invoiceNumber = "",
    membershipId: string | null = null;
  await runTransaction(db, async (tx) => {
    const counter = await tx.get(counterRef);
    const year = new Date(`${data.invoiceDate}T00:00:00`).getFullYear();
    const key = `invoiceSeq${year}`;
    const next = Number(counter.data()?.[key] ?? 0) + 1;
    invoiceNumber = `${context.settings.invoicePrefix}-${year}-${String(next).padStart(6, "0")}`;
    const packageItem = data.items.find((i) => i.packageId);
    const pkg = packageItem ? context.packages.find((p) => p.id === packageItem.packageId) : null;
    if (data.createMembership && pkg) {
      const membershipRef = doc(col(COLLECTIONS.memberships));
      membershipId = membershipRef.id;
      const endDate = calculateEndDate(data.membershipStartDate, pkg.durationDays),
        status = data.membershipStartDate > data.invoiceDate ? "pending" : "active";
      tx.set(membershipRef, {
        clientId: context.client.id,
        packageId: pkg.id,
        packageNameSnapshot: pkg.name,
        priceSnapshot: pkg.price,
        durationDaysSnapshot: pkg.durationDays,
        startDate: data.membershipStartDate,
        endDate,
        status,
        invoiceId: invoiceRef.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      if (status === "active")
        tx.update(doc(db, COLLECTIONS.clients, context.client.id), {
          currentMembership: {
            membershipId: membershipRef.id,
            packageName: pkg.name,
            startDate: data.membershipStartDate,
            endDate,
            status,
          },
          status: "active",
          updatedAt: serverTimestamp(),
        });
    }
    if (data.createMembership && context.client.currentMembership?.membershipId) {
      tx.update(doc(db, COLLECTIONS.memberships, context.client.currentMembership.membershipId), {
        status: data.previousAction,
        updatedAt: serverTimestamp(),
      });
    }
    const items = data.items.map((i) => ({ ...i, total: i.quantity * i.unitPrice }));
    const payload = {
      invoiceNumber,
      clientId: context.client.id,
      clientNameSnapshot: context.client.fullName,
      clientPhoneSnapshot: context.client.phone,
      clientEmailSnapshot: context.client.email,
      membershipId,
      packageId: data.items.find((i) => i.packageId)?.packageId ?? null,
      items,
      ...totals,
      paymentStatus: derivePaymentStatus(totals.total, totals.amountPaid),
      paymentMethod: data.paymentMethod,
      invoiceDate: data.invoiceDate,
      dueDate: data.dueDate,
      notes: data.notes,
      pdfUrl: "",
      publicToken: token,
      createdBy: context.staff.name,
      createdByUid: context.staff.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    tx.set(counterRef, { [key]: next, updatedAt: serverTimestamp() }, { merge: true });
    const paymentRef = totals.amountPaid > 0 ? doc(col(COLLECTIONS.payments)) : null;
    const membershipGross = items.filter((i) => i.packageId).reduce((n, i) => n + i.total, 0);
    Object.assign(payload, {
      paymentId: paymentRef?.id ?? null,
      ptAssignmentId: null,
      enrollmentId: null,
      membershipGross,
      ptGross: 0,
      trainerShareTotal: 0,
      paymentsTracked: true,
    });
    tx.set(invoiceRef, payload);
    if (paymentRef) {
      const ratio = totals.total ? totals.amountPaid / totals.total : 0,
        mem = Math.round(membershipGross * ratio * 100) / 100;
      tx.set(paymentRef, {
        clientId: context.client.id,
        clientNameSnapshot: context.client.fullName,
        invoiceId: invoiceRef.id,
        invoiceNumber,
        membershipId,
        ptAssignmentId: null,
        amount: totals.amountPaid,
        method: data.paymentMethod,
        paymentDate: data.invoiceDate,
        kind: "initial",
        trainerShareAmount: 0,
        gymAmount: totals.amountPaid,
        membershipGymAmount: Math.min(mem, totals.amountPaid),
        ptGymAmount: 0,
        otherGymAmount: Math.max(0, totals.amountPaid - mem),
        createdBy: context.staff.name,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    tx.set(publicRef, {
      publicToken: token,
      invoiceNumber,
      clientName: context.client.fullName,
      clientPhone: context.client.phone,
      clientEmail: context.client.email,
      items,
      ...totals,
      paymentStatus: payload.paymentStatus,
      paymentMethod: data.paymentMethod,
      invoiceDate: data.invoiceDate,
      dueDate: data.dueDate,
      pdfUrl: "",
      business: context.settings,
      updatedAt: serverTimestamp(),
    });
  });
  const snap = await getDoc(invoiceRef);
  // The PDF is built on demand (browser download / invoicePdf function), never uploaded.
  return mapInvoice(invoiceRef.id, snap.data() ?? {});
}
