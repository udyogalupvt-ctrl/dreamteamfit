import {
  addDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { normalizePhone, todayISO } from "@/lib/format";
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
import { mapClient } from "./clients.service";
import { allocatePayment } from "./finance.service";
import { col, COLLECTIONS, toDate } from "./firestore.service";
import { mapInvoice } from "./invoices.service";
import { calculateEndDate } from "./memberships.service";
import { calculateShare } from "./pt.service";

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
  pt: { pkg: PtPackage; trainer: Trainer; shareType: ShareType; shareValue: number } | null;
  startDate: string;
  discount: number;
  amountPaid: number;
  method: PaymentMethod;
  notes: string;
  settings: BusinessBillingSettings;
  staff: { uid: string; name: string };
}

export function enrollmentTotals(
  input: Pick<EnrollmentInput, "gymPackage" | "pt" | "discount" | "amountPaid" | "settings">,
) {
  const items: { quantity: number; unitPrice: number }[] = [];
  if (input.gymPackage) items.push({ quantity: 1, unitPrice: input.gymPackage.price });
  if (input.pt) items.push({ quantity: 1, unitPrice: input.pt.pkg.price });
  const share = input.pt
    ? calculateShare(input.pt.pkg.price, input.pt.shareType, input.pt.shareValue)
    : null;
  return {
    ...calculateInvoiceTotals(items, input.discount, input.settings, input.amountPaid),
    share,
  };
}

/**
 * One confirmed checkout creates everything once: client (if new), membership,
 * PT assignment, ONE payment, invoice + public link, trainer payout, enrollment record.
 */
export async function enrollMember(input: EnrollmentInput) {
  if (!input.gymPackage && !input.pt) throw new Error("Select a gym package or a PT package.");
  const totals = enrollmentTotals(input);
  if (input.amountPaid > totals.total) throw new Error("Amount paid cannot exceed the total.");
  const phoneN = normalizePhone(input.client.phone);
  if (!input.existingClient) {
    const dup = await getDocs(
      query(col(COLLECTIONS.clients), where("phoneNormalized", "==", phoneN)),
    );
    if (!dup.empty)
      throw new Error(
        `A client with this phone already exists (${dup.docs[0]!.data()["fullName"]}).`,
      );
  }
  const existingBio =
    input.existingClient?.biometricStatus === "active" &&
    input.existingClient.firstThumbRegistered !== false &&
    input.existingClient.biometricUserId;
  const needsBiometric = !existingBio;
  let prevActive: string[] = [];
  if (input.existingClient && !needsBiometric && input.gymPackage) {
    const ms = await getDocs(
      query(col(COLLECTIONS.memberships), where("clientId", "==", input.existingClient.id)),
    );
    // A renewal that starts later queues behind the running plan instead of cutting it short.
    prevActive =
      input.startDate > todayISO()
        ? []
        : ms.docs.filter((d) => d.data()["status"] === "active").map((d) => d.id);
  }

  const clientRef = input.existingClient
    ? doc(db, COLLECTIONS.clients, input.existingClient.id)
    : doc(col(COLLECTIONS.clients));
  const membershipRef = input.gymPackage ? doc(col(COLLECTIONS.memberships)) : null;
  const ptRef = input.pt ? doc(col(COLLECTIONS.ptAssignments)) : null;
  const invoiceRef = doc(col(COLLECTIONS.invoices));
  const paymentRef = totals.amountPaid > 0 ? doc(col(COLLECTIONS.payments)) : null;
  const enrollmentRef = doc(col(COLLECTIONS.enrollments));
  const payoutRef = input.pt ? doc(col(COLLECTIONS.trainerPayouts)) : null;
  const token = createPublicToken();
  const counterRef = doc(db, COLLECTIONS.settings, "counters");
  const inquiryRef = input.inquiryId ? doc(db, COLLECTIONS.inquiries, input.inquiryId) : null;
  const today = todayISO();
  const fullName = input.existingClient?.fullName ?? input.client.fullName.trim();
  const phone = input.existingClient?.phone ?? input.client.phone.trim();
  const email = input.existingClient?.email ?? input.client.email.trim();
  const membershipStatus = needsBiometric
    ? "biometric_pending"
    : input.startDate > today
      ? "pending"
      : "active";

  await runTransaction(db, async (tx) => {
    const counter = await tx.get(counterRef);
    const inq = inquiryRef ? await tx.get(inquiryRef) : null;
    if (inq?.exists() && inq.data()["convertedToClient"])
      throw new Error("This lead has already been converted.");
    const c = counter.data() ?? {};
    const year = new Date(`${today}T00:00:00`).getFullYear();
    const invKey = `invoiceSeq${year}`;
    const invSeq = Number(c[invKey] ?? 0) + 1;
    const invoiceNumber = `${input.settings.invoicePrefix}-${year}-${String(invSeq).padStart(6, "0")}`;
    const counterPatch: Record<string, unknown> = {
      [invKey]: invSeq,
      updatedAt: serverTimestamp(),
    };
    const now = serverTimestamp();

    if (!input.existingClient) {
      const seq = Number(c["clientSeq"] ?? 0) + 1;
      counterPatch["clientSeq"] = seq;
      tx.set(clientRef, {
        ...input.client,
        fullName,
        phone,
        email,
        phoneNormalized: phoneN,
        clientCode: `CL-${String(seq).padStart(6, "0")}`,
        inquiryId: input.inquiryId,
        currentMembership: null,
        biometricUserId: "",
        biometricDeviceId: "",
        biometricStatus: "not_enrolled",
        firstThumbRegistered: false,
        enrollmentId: enrollmentRef.id,
        whatsappOptIn: input.whatsappOptIn,
        whatsappPhone: phone,
        whatsappStatus: input.whatsappOptIn ? "ready" : "opted_out",
        lastWhatsappMessageAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }
    tx.set(counterRef, counterPatch, { merge: true });

    let endDate = "";
    if (membershipRef && input.gymPackage) {
      endDate = calculateEndDate(input.startDate, input.gymPackage.durationDays);
      prevActive.forEach((id) =>
        tx.update(doc(db, COLLECTIONS.memberships, id), { status: "expired", updatedAt: now }),
      );
      tx.set(membershipRef, {
        clientId: clientRef.id,
        packageId: input.gymPackage.id,
        packageNameSnapshot: input.gymPackage.name,
        priceSnapshot: input.gymPackage.price,
        durationDaysSnapshot: input.gymPackage.durationDays,
        startDate: input.startDate,
        endDate,
        status: membershipStatus,
        invoiceId: invoiceRef.id,
        enrollmentId: enrollmentRef.id,
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
        ptPackageNameSnapshot: input.pt.pkg.name,
        trainerId: input.pt.trainer.id,
        trainerNameSnapshot: input.pt.trainer.name,
        ...share,
        startDate: input.startDate,
        endDate: calculateEndDate(input.startDate, input.pt.pkg.durationDays),
        status: needsBiometric ? "pending" : "active",
        invoiceId: invoiceRef.id,
        enrollmentId: enrollmentRef.id,
        createdAt: now,
        updatedAt: now,
      });
      tx.set(payoutRef!, {
        trainerId: input.pt.trainer.id,
        trainerNameSnapshot: input.pt.trainer.name,
        clientId: clientRef.id,
        clientNameSnapshot: fullName,
        ptAssignmentId: ptRef.id,
        ptPackageNameSnapshot: input.pt.pkg.name,
        invoiceId: invoiceRef.id,
        grossAmount: share.ptPrice,
        trainerShareAmount: share.trainerShareAmount,
        gymShareAmount: share.gymShareAmount,
        paymentDate: today,
        status: "pending",
        paidAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }
    const items = [
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
              name: `PT: ${input.pt.pkg.name}`,
              description: `Personal training with ${input.pt.trainer.name}`,
              quantity: 1,
              unitPrice: input.pt.pkg.price,
              total: input.pt.pkg.price,
              packageId: null,
            },
          ]
        : []),
    ];
    const { share: _s, ...money } = totals;
    const breakdown = {
      membershipGross: input.gymPackage?.price ?? 0,
      ptGross: input.pt?.pkg.price ?? 0,
      trainerShareTotal: share?.trainerShareAmount ?? 0,
    };
    const paymentStatus = derivePaymentStatus(money.total, money.amountPaid);
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
      paymentsTracked: true,
      paymentStatus,
      paymentMethod: input.method,
      invoiceDate: today,
      dueDate: today,
      notes: input.notes,
      pdfUrl: "",
      publicToken: token,
      createdBy: input.staff.name,
      createdByUid: input.staff.uid,
      createdAt: now,
      updatedAt: now,
    });
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
      dueDate: today,
      pdfUrl: "",
      business: input.settings,
      updatedAt: now,
    });
    if (paymentRef) {
      tx.set(paymentRef, {
        clientId: clientRef.id,
        clientNameSnapshot: fullName,
        invoiceId: invoiceRef.id,
        invoiceNumber,
        membershipId: membershipRef?.id ?? null,
        ptAssignmentId: ptRef?.id ?? null,
        amount: money.amountPaid,
        method: input.method,
        paymentDate: today,
        kind: "initial",
        ...allocatePayment({ total: money.total, ...breakdown }, money.amountPaid),
        createdBy: input.staff.name,
        createdAt: now,
        updatedAt: now,
      });
    }
    tx.set(enrollmentRef, {
      clientId: clientRef.id,
      clientNameSnapshot: fullName,
      status: needsBiometric ? "biometric_pending" : "active",
      membershipId: membershipRef?.id ?? null,
      ptAssignmentId: ptRef?.id ?? null,
      invoiceId: invoiceRef.id,
      paymentId: paymentRef?.id ?? null,
      paymentStatus,
      biometricDeviceId: input.existingClient?.biometricDeviceId ?? "",
      biometricUserId: input.existingClient?.biometricUserId ?? "",
      firstThumbRegistered: !needsBiometric,
      lastError: "",
      invoiceSharedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    if (input.existingClient) {
      const clientPatch: Record<string, unknown> = { updatedAt: now };
      // Only a member still waiting for a thumb points at this enrollment, so the profile can resume it.
      if (needsBiometric) clientPatch["enrollmentId"] = enrollmentRef.id;
      if (membershipRef && membershipStatus === "active") {
        clientPatch["currentMembership"] = {
          membershipId: membershipRef.id,
          packageName: input.gymPackage!.name,
          startDate: input.startDate,
          endDate,
          status: "active",
        };
        clientPatch["status"] = "active";
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

  const invSnap = await getDoc(invoiceRef);
  const invoice = mapInvoice(invoiceRef.id, invSnap.data() ?? {});
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
}

export type FingerprintRequestResult =
  { mode: "device"; message: string } | { mode: "adapter"; ok: boolean; message: string };

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
  if (!cSnap.exists()) throw new Error("Client not found.");
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
    batch.set(doc(col(COLLECTIONS.biometricCommands)), {
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
    .filter((d) => d.data()["door"] !== true && ["pending", "sent"].includes(String(d.data()["status"])))
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
    if (e.membershipId) {
      const mSnap = await getDoc(doc(db, COLLECTIONS.memberships, e.membershipId));
      const m = mSnap.data() ?? {};
      const today = todayISO();
      const status = String(m["startDate"] ?? today) > today ? "pending" : "active";
      const others = await getDocs(
        query(col(COLLECTIONS.memberships), where("clientId", "==", client.id)),
      );
      if (status === "active")
        others.docs
          .filter((d) => d.id !== e.membershipId && d.data()["status"] === "active")
          .forEach((d) => batch.update(d.ref, { status: "expired", updatedAt: now }));
      batch.update(mSnap.ref, { status, updatedAt: now });
      if (status === "active")
        batch.update(clientRef, {
          currentMembership: {
            membershipId: e.membershipId,
            packageName: m["packageNameSnapshot"] ?? "",
            startDate: m["startDate"] ?? "",
            endDate: m["endDate"] ?? "",
            status,
          },
        });
    }
    if (e.ptAssignmentId)
      batch.update(doc(db, COLLECTIONS.ptAssignments, e.ptAssignmentId), {
        status: "active",
        updatedAt: now,
      });
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
