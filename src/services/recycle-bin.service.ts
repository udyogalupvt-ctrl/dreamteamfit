import {
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
} from "@/lib/firestore";
import { db } from "@/lib/firebase";
import type {
  Client,
  ClassEnrollment,
  DeleteSection,
  Expense,
  FollowUp,
  Inquiry,
  Invoice,
  RecycleBinEntry,
  Staff,
  StaffAccess,
  Trainer,
} from "@/types/models";
import { updateEnrollmentStatus } from "./class-enrollments.service";
import { memberIdDocRef } from "./clients.service";
import { col, COLLECTIONS, toDate, type CollectionName } from "./firestore.service";
import { memberAppAction, trainerAccess } from "./portal.service";
import { mapBinEntry as mapEntry } from "./recycle-bin-list.service";
export { subscribeRecycleBin } from "./recycle-bin-list.service";
import { saveStaff, updateStaffLogin } from "./staff.service";

/**
 * Recycle Bin. Deleting moves things here instead of erasing them: every record that goes (the
 * thing itself and what belongs to it) is kept exactly as it was, with who deleted it and when.
 * Until then they appear nowhere else in the app. The owner restores them (all written back) or
 * deletes them forever. A staff login sees and can undo only what it deleted itself.
 */

export interface Deleter {
  uid: string;
  name: string;
  /** "Owner" / "Manager" / "Staff" */
  role: string;
}

const CHUNK = 400;
async function inChunks<T>(list: T[], write: (b: ReturnType<typeof writeBatch>, x: T) => void) {
  for (let i = 0; i < list.length; i += CHUNK) {
    const batch = writeBatch(db);
    list.slice(i, i + CHUNK).forEach((x) => write(batch, x));
    await batch.commit();
  }
}

/** Moves records to the bin. The thing itself first in `refs`, then what belongs to it. */
export async function moveToBin(input: {
  section: DeleteSection;
  label: string;
  detail?: string;
  refs: DocumentReference[];
  by: Deleter;
  extra?: Record<string, unknown>;
}) {
  const unique = [...new Map(input.refs.map((r) => [r.path, r])).values()];
  const found = (await Promise.all(unique.map((r) => getDoc(r)))).filter((s) => s.exists());
  if (!found.length) throw new Error("It was already deleted.");
  const binRef = doc(col(COLLECTIONS.recycleBin));
  const now = serverTimestamp();
  // 1. The copies first: nothing is lost even if a later step fails.
  await inChunks(
    found.map((s, n) => ({ s, n })),
    (b, { s, n }) =>
      b.set(doc(col(COLLECTIONS.recycleBinItems)), {
        binId: binRef.id,
        n,
        path: s.ref.path,
        collection: s.ref.parent.id,
        docId: s.id,
        data: s.data() ?? {},
        deletedByUid: input.by.uid,
        createdAt: now,
      }),
  );
  // 2. The bin entry together with the thing itself (and as many records as fit), then the rest.
  const [first, ...rest] = found as [DocumentSnapshot, ...DocumentSnapshot[]];
  const batch = writeBatch(db);
  batch.set(binRef, {
    section: input.section,
    label: input.label,
    detail: input.detail ?? "",
    count: found.length,
    deletedBy: input.by.name,
    deletedByUid: input.by.uid,
    deletedByRole: input.by.role,
    deletedAt: now,
    extra: input.extra ?? {},
  });
  batch.delete(first.ref);
  rest.slice(0, CHUNK - 2).forEach((s) => batch.delete(s.ref));
  await batch.commit();
  await inChunks(rest.slice(CHUNK - 2), (b, s) => b.delete(s.ref));
  return binRef.id;
}

interface BinItem {
  ref: DocumentReference;
  path: string;
  collection: string;
  docId: string;
  data: DocumentData;
  n: number;
}
async function itemsOf(
  entry: Pick<RecycleBinEntry, "id">,
  viewer: { owner: boolean; uid: string },
) {
  const snap = await getDocs(
    viewer.owner
      ? query(col(COLLECTIONS.recycleBinItems), where("binId", "==", entry.id))
      : query(
          col(COLLECTIONS.recycleBinItems),
          where("binId", "==", entry.id),
          where("deletedByUid", "==", viewer.uid),
        ),
  );
  return snap.docs
    .map((d): BinItem => ({
      ref: d.ref,
      path: String(d.data()["path"]),
      collection: String(d.data()["collection"]),
      docId: String(d.data()["docId"]),
      data: (d.data()["data"] as DocumentData) ?? {},
      n: Number(d.data()["n"] ?? 0),
    }))
    .sort((a, b) => a.n - b.n);
}

/** A door check for a member put back: the machine lets them in again if their plan runs. */
function doorCheck(b: ReturnType<typeof writeBatch>, clientId: string) {
  const now = serverTimestamp();
  b.set(doc(col(COLLECTIONS.biometricCommands)), {
    type: "door_check",
    clientId,
    staffId: "",
    deviceId: "",
    biometricUserId: "",
    serialNumber: "",
    enrollmentId: null,
    command: "",
    order: 0,
    door: true,
    status: "pending",
    cmdNo: null,
    returnCode: null,
    error: "",
    sentAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  });
}

/** Puts everything back as it was, then takes it out of the bin. */
export async function restoreFromBin(
  entry: RecycleBinEntry,
  by: Deleter,
  viewer: { owner: boolean; uid: string },
) {
  const items = await itemsOf(entry, viewer);
  // Marked first, so the activity log says "Restored" (not "deleted forever").
  await updateDoc(doc(db, COLLECTIONS.recycleBin, entry.id), { restoredBy: by.name });
  await inChunks(items, (b, it) => {
    const data = { ...it.data };
    // A member taken off the fingerprint machine when deleted: the door check puts them back.
    if (
      it.collection === COLLECTIONS.clients &&
      data["firstThumbRegistered"] &&
      data["biometricUserId"]
    )
      data["deviceAccess"] = "removed";
    // Machine commands that never ran are not sent after all this time.
    if (it.collection === COLLECTIONS.biometricCommands && data["status"] === "pending")
      data["status"] = "cancelled";
    b.set(doc(db, it.path), data);
    b.delete(it.ref);
  });
  const x = entry.extra;
  const last = writeBatch(db);
  if (entry.section === "members" && typeof x["clientId"] === "string") {
    const clientId = x["clientId"];
    // Leads that were linked to the member are linked again.
    for (const id of (x["leads"] as string[] | undefined) ?? [])
      last.update(doc(db, COLLECTIONS.inquiries, id), { clientId });
    doorCheck(last, clientId);
  }
  last.delete(doc(db, COLLECTIONS.recycleBin, entry.id));
  await last.commit();
  // Logins switched off when deleted come back on.
  if (entry.section === "members" && x["portalActive"] === true)
    await memberAppAction(String(x["clientId"]), "on").catch(() => undefined);
  if (entry.section === "packages" && x["trainerLoginOn"] === true)
    await trainerAccess(String(x["trainerId"]), "on").catch(() => undefined);
  if (entry.section === "staff" && typeof x["staffId"] === "string") {
    if (x["wasActive"] === true) {
      const s = items.find((i) => i.collection === COLLECTIONS.staff)?.data;
      if (s) await updateDoc(doc(db, COLLECTIONS.staff, x["staffId"]), { active: true });
    }
    if (x["loginOn"] === true)
      await updateStaffLogin({ staffId: x["staffId"], active: true }).catch(() => undefined);
  }
  return items.length;
}

/** "Undo" right after deleting: puts back what that delete moved to the bin. */
export async function restoreBinById(
  binId: string,
  by: Deleter,
  viewer: { owner: boolean; uid: string },
) {
  const snap = await getDoc(doc(db, COLLECTIONS.recycleBin, binId));
  if (!snap.exists()) throw new Error("It is no longer in the Recycle Bin.");
  return restoreFromBin(mapEntry(snap.id, snap.data()), by, viewer);
}

/** Erases it for good (owner): what the bin kept, and anything still held for a restore. */
export async function deleteForever(entry: RecycleBinEntry) {
  const items = await itemsOf(entry, { owner: true, uid: "" });
  if (entry.section === "members") {
    const c = items.find((i) => i.collection === COLLECTIONS.clients)?.data ?? {};
    const clientId = String(entry.extra["clientId"] ?? "");
    // Member app login, chat and ticks (the server reads the login from the bin copy).
    if (clientId) await memberAppAction(clientId, "delete").catch(() => undefined);
    const b = writeBatch(db);
    // The saved fingerprint is erased; the member ID becomes free for a new member.
    if (clientId && c["biometricUserId"]) {
      const now = serverTimestamp();
      b.set(doc(col(COLLECTIONS.biometricCommands)), {
        type: "forget",
        clientId,
        staffId: "",
        deviceId: String(c["biometricDeviceId"] ?? ""),
        biometricUserId: String(c["biometricUserId"]),
        serialNumber: "",
        enrollmentId: null,
        command: "",
        order: 0,
        door: true,
        status: "pending",
        cmdNo: null,
        returnCode: null,
        error: "",
        sentAt: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }
    const idRef = memberIdDocRef(String(c["clientCode"] ?? ""));
    if (idRef) b.delete(idRef);
    await b.commit();
  }
  await inChunks(items, (b, it) => b.delete(it.ref));
  const last = writeBatch(db);
  last.delete(doc(db, COLLECTIONS.recycleBin, entry.id));
  await last.commit();
}

// ------------------------------------------------------------------ what each section deletes

const where1 = async (name: CollectionName, field: string, value: string) =>
  (await getDocs(query(col(name), where(field, "==", value)))).docs.map((d) => d.ref);

/** Everything that belongs to one member (bills and payments only when not kept). */
const MEMBER_RECORDS: CollectionName[] = [
  COLLECTIONS.memberships,
  COLLECTIONS.enrollments,
  COLLECTIONS.ptAssignments,
  COLLECTIONS.followups,
  COLLECTIONS.leadLogs,
  COLLECTIONS.attendance,
  COLLECTIONS.bookings,
  COLLECTIONS.classEnrollments,
  COLLECTIONS.workoutAssignments,
  COLLECTIONS.dietAssignments,
  COLLECTIONS.whatsappMessages,
  COLLECTIONS.notifications,
  COLLECTIONS.renewalNotifications,
  COLLECTIONS.birthdayNotifications,
  COLLECTIONS.automationActivities,
];
const ACCOUNT_RECORDS: CollectionName[] = [
  COLLECTIONS.invoices,
  COLLECTIONS.payments,
  COLLECTIONS.trainerPayouts,
];

/**
 * A member and their records. They leave the fingerprint machine (their saved fingerprint and
 * member ID are kept for a restore) and their member app stops working.
 */
export async function binMember(client: Client, opts: { keepAccounts: boolean }, by: Deleter) {
  const byClient = (name: CollectionName) => where1(name, "clientId", client.id);
  // Free their group-class seats first, so class counts stay right.
  for (const ref of await byClient(COLLECTIONS.classEnrollments)) {
    const e = (await getDoc(ref)).data();
    if (e?.["status"] === "enrolled")
      await updateEnrollmentStatus(
        {
          id: ref.id,
          groupClassId: String(e["groupClassId"] ?? ""),
          clientId: client.id,
          clientNameSnapshot: String(e["clientNameSnapshot"] ?? ""),
          enrolledAt: toDate(e["enrolledAt"]),
          status: "enrolled",
        } satisfies ClassEnrollment,
        "cancelled",
      );
  }
  if (client.portalActive) await memberAppAction(client.id, "off").catch(() => undefined);
  const refs: DocumentReference[] = [doc(db, COLLECTIONS.clients, client.id)];
  for (const name of MEMBER_RECORDS) refs.push(...(await byClient(name)));
  if (!opts.keepAccounts)
    for (const name of ACCOUNT_RECORDS) {
      const found = await byClient(name);
      refs.push(...found);
      if (name === COLLECTIONS.invoices)
        for (const r of found) {
          const token = String((await getDoc(r)).data()?.["publicToken"] ?? "");
          if (token) refs.push(doc(db, COLLECTIONS.publicInvoices, token));
        }
    }
  // Their lead stays in Leads, no longer linked (linked again on a restore).
  const leads = await byClient(COLLECTIONS.inquiries);
  if (leads.length) {
    const b = writeBatch(db);
    leads.forEach((l) => b.update(l, { clientId: null }));
    await b.commit();
  }
  return moveToBin({
    section: "members",
    label: `Member: ${client.fullName}${client.clientCode ? ` (ID ${client.clientCode})` : ""}`,
    detail: `${client.phone}${opts.keepAccounts ? " · bills & payments kept" : ""}`,
    refs,
    by,
    extra: {
      clientId: client.id,
      leads: leads.map((l) => l.id),
      portalActive: client.portalActive === true,
    },
  });
}

/** A lead, with its calls and follow-ups. */
export async function binLead(lead: Inquiry, by: Deleter) {
  return moveToBin({
    section: "leads",
    label: `Lead: ${lead.name}`,
    detail: lead.phone,
    refs: [
      doc(db, COLLECTIONS.inquiries, lead.id),
      ...(await where1(COLLECTIONS.followups, "inquiryId", lead.id)),
      ...(await where1(COLLECTIONS.leadLogs, "inquiryId", lead.id)),
    ],
    by,
  });
}

export async function binFollowUp(f: FollowUp, by: Deleter) {
  return moveToBin({
    section: "leads",
    label: `Follow-up: ${f.clientNameSnapshot}`,
    detail: [f.followUpDate, f.reason].filter(Boolean).join(" · "),
    refs: [doc(db, COLLECTIONS.followups, f.id)],
    by,
  });
}

/**
 * A bill with its payments (so Collected, the Day Book and reports no longer count them), its
 * public link and the trainer's share from it. The plans on it stay.
 */
export async function binBill(inv: Invoice, by: Deleter) {
  return moveToBin({
    section: "bills",
    label: `Bill ${inv.invoiceNumber} · ${inv.clientNameSnapshot}`,
    detail: `Total ₹${inv.total.toLocaleString("en-IN")} · paid ₹${inv.amountPaid.toLocaleString("en-IN")}`,
    refs: [
      doc(db, COLLECTIONS.invoices, inv.id),
      ...(await where1(COLLECTIONS.payments, "invoiceId", inv.id)),
      ...(inv.publicToken ? [doc(db, COLLECTIONS.publicInvoices, inv.publicToken)] : []),
      ...(await where1(COLLECTIONS.trainerPayouts, "invoiceId", inv.id)),
    ],
    by,
  });
}

/** A trainer (their PT plans and payouts stay as history). Their trainer app stops working. */
export async function binTrainer(t: Trainer, by: Deleter) {
  if (t.portalActive) await trainerAccess(t.id, "off").catch(() => undefined);
  return moveToBin({
    section: "packages",
    label: `Trainer: ${t.name}`,
    detail: t.phone,
    refs: [doc(db, COLLECTIONS.trainers, t.id)],
    by,
    extra: { trainerId: t.id, trainerLoginOn: t.portalActive === true },
  });
}

/**
 * Someone who works here (owners only). Their login stops and their thumb leaves the machine
 * (as for "Mark as left"); attendance and salary history stay.
 */
export async function binStaff(s: Staff, access: StaffAccess | undefined, by: Deleter) {
  const loginOn = !!s.loginUid && access?.active === true;
  if (loginOn) await updateStaffLogin({ staffId: s.id, active: false }).catch(() => undefined);
  if (s.active)
    await saveStaff(
      {
        name: s.name,
        phone: s.phone,
        role: s.role,
        joiningDate: s.joiningDate,
        active: false,
        isCounsellor: s.isCounsellor,
      },
      s.id,
    );
  return moveToBin({
    section: "staff",
    label: `Staff: ${s.name}`,
    detail: s.role,
    refs: [doc(db, COLLECTIONS.staff, s.id), doc(db, COLLECTIONS.staffPrivate, s.id)],
    by,
    extra: { staffId: s.id, wasActive: s.active, loginOn },
  });
}

export async function binExpense(e: Expense, by: Deleter) {
  return moveToBin({
    section: "expenses",
    label: `Expense: ${e.title}`,
    detail: `₹${e.amount.toLocaleString("en-IN")} · ${e.date}`,
    refs: [doc(db, COLLECTIONS.expenses, e.id)],
    by,
  });
}

/** Gym / PT packages, workout and diet plans (checked as unused by the caller). */
export async function binSimple(
  name: CollectionName,
  id: string,
  label: string,
  by: Deleter,
  detail = "",
) {
  return moveToBin({ section: "packages", label, detail, refs: [doc(db, name, id)], by });
}
