import { doc, getDocs, query, where, writeBatch, type DocumentReference } from "@/lib/firestore";
import { db } from "@/lib/firebase";
import type { Client, ClassEnrollment } from "@/types/models";
import { updateEnrollmentStatus } from "./class-enrollments.service";
import { memberIdDocRef } from "./clients.service";
import { col, COLLECTIONS, toDate, type CollectionName } from "./firestore.service";

/** Everything that belongs to one member. */
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
  COLLECTIONS.biometricCommands,
];
/** Money records; optional so income reports can stay unchanged. */
const ACCOUNT_RECORDS: CollectionName[] = [
  COLLECTIONS.invoices,
  COLLECTIONS.payments,
  COLLECTIONS.trainerPayouts,
];

export interface DeleteResult {
  records: number;
  keptAccounts: boolean;
}

/**
 * Deletes a member and all their records. The server then removes them from the fingerprint
 * device, erases their stored thumb and writes "Member deleted" to the tamper-proof activity log
 * (which is never deleted).
 */
export async function deleteMemberCompletely(
  client: Client,
  opts: { keepAccounts: boolean },
): Promise<DeleteResult> {
  const byClient = async (name: CollectionName) =>
    (await getDocs(query(col(name), where("clientId", "==", client.id)))).docs;

  // Free group-class seats first so class counts stay right.
  for (const d of await byClient(COLLECTIONS.classEnrollments)) {
    const e = d.data();
    if (e["status"] === "enrolled")
      await updateEnrollmentStatus(
        {
          id: d.id,
          groupClassId: String(e["groupClassId"] ?? ""),
          clientId: client.id,
          clientNameSnapshot: String(e["clientNameSnapshot"] ?? ""),
          enrolledAt: toDate(e["enrolledAt"]),
          status: "enrolled",
        } satisfies ClassEnrollment,
        "cancelled",
      );
  }

  const refs: DocumentReference[] = [];
  for (const name of MEMBER_RECORDS) refs.push(...(await byClient(name)).map((d) => d.ref));
  if (!opts.keepAccounts) {
    for (const name of ACCOUNT_RECORDS) {
      const docs = await byClient(name);
      refs.push(...docs.map((d) => d.ref));
      if (name === COLLECTIONS.invoices)
        docs.forEach((d) => {
          const token = String(d.data()["publicToken"] ?? "");
          if (token) refs.push(doc(db, COLLECTIONS.publicInvoices, token));
        });
    }
  }
  const leads = await byClient(COLLECTIONS.inquiries);

  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db);
    refs.slice(i, i + 400).forEach((r) => batch.delete(r));
    await batch.commit();
  }
  const last = writeBatch(db);
  // The lead stays in Leads history, just no longer linked to a member.
  leads.forEach((l) => last.update(l.ref, { clientId: null }));
  last.delete(doc(db, COLLECTIONS.clients, client.id));
  // The member ID becomes free for a new member.
  const idRef = memberIdDocRef(client.clientCode);
  if (idRef) last.delete(idRef);
  await last.commit();
  return { records: refs.length, keptAccounts: opts.keepAccounts };
}
