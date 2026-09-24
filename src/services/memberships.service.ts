import {
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentData,
} from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { addDaysISO, todayISO } from "@/lib/format";
import type { GymPackage, Membership, MembershipSummary } from "@/types/models";
import {
  col,
  COLLECTIONS,
  subscribeCollection,
  subscribeQuery,
  toDate,
} from "./firestore.service";

const mapMembership = (id: string, d: DocumentData): Membership => ({
  id,
  clientId: d["clientId"] ?? "",
  packageId: d["packageId"] ?? "",
  packageNameSnapshot: d["packageNameSnapshot"] ?? "",
  priceSnapshot: Number(d["priceSnapshot"] ?? 0),
  durationDaysSnapshot: Number(d["durationDaysSnapshot"] ?? 0),
  startDate: d["startDate"] ?? "",
  endDate: d["endDate"] ?? "",
  status: d["status"] ?? "pending",
  createdAt: toDate(d["createdAt"]),
  updatedAt: toDate(d["updatedAt"]),
});

const byStartDesc = (a: Membership, b: Membership) =>
  b.startDate.localeCompare(a.startDate) || b.createdAt.getTime() - a.createdAt.getTime();

export function subscribeClientMemberships(
  clientId: string,
  onData: (items: Membership[]) => void,
  onError: (e: Error) => void,
) {
  // Single-field filter only (no composite index needed); sorted client-side.
  return subscribeQuery(
    query(col(COLLECTIONS.memberships), where("clientId", "==", clientId)),
    mapMembership,
    (items) => onData([...items].sort(byStartDesc)),
    onError,
  );
}

export function subscribeMemberships(
  onData: (items: Membership[]) => void,
  onError: (e: Error) => void,
) {
  return subscribeCollection(
    COLLECTIONS.memberships,
    mapMembership,
    onData,
    onError,
    orderBy("createdAt", "desc"),
  );
}

/** End date = start + durationDays (e.g. 23 Sep + 30 days = 23 Oct). */
export const calculateEndDate = (startDate: string, durationDays: number) =>
  addDaysISO(startDate, durationDays);

export type PreviousAction = "expired" | "cancelled";

/**
 * Creates a membership with package snapshots. If it starts today or earlier it becomes
 * active and any previously active membership is closed (never deleted).
 */
export async function createMembership(params: {
  clientId: string;
  pkg: GymPackage;
  startDate: string;
  previousAction: PreviousAction;
}) {
  const { clientId, pkg, startDate, previousAction } = params;
  const endDate = calculateEndDate(startDate, pkg.durationDays);
  const status = startDate > todayISO() ? "pending" : "active";

  const batch = writeBatch(db);
  if (status === "active") {
    const existing = await getDocs(
      query(col(COLLECTIONS.memberships), where("clientId", "==", clientId)),
    );
    existing.docs
      .filter((d) => d.data()["status"] === "active")
      .forEach((d) =>
        batch.update(d.ref, { status: previousAction, updatedAt: serverTimestamp() }),
      );
  }

  const ref = doc(col(COLLECTIONS.memberships));
  batch.set(ref, {
    clientId,
    packageId: pkg.id,
    packageNameSnapshot: pkg.name,
    priceSnapshot: pkg.price,
    durationDaysSnapshot: pkg.durationDays,
    startDate,
    endDate,
    status,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const summary: MembershipSummary = {
    membershipId: ref.id,
    packageName: pkg.name,
    startDate,
    endDate,
    status,
  };
  batch.update(doc(db, COLLECTIONS.clients, clientId), {
    ...(status === "active" ? { currentMembership: summary, status: "active" } : {}),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  return ref.id;
}

export async function cancelMembership(membership: Membership, clientSummaryId?: string | null) {
  const batch = writeBatch(db);
  batch.update(doc(db, COLLECTIONS.memberships, membership.id), {
    status: "cancelled",
    updatedAt: serverTimestamp(),
  });
  if (clientSummaryId === membership.id) {
    batch.update(doc(db, COLLECTIONS.clients, membership.clientId), {
      "currentMembership.status": "cancelled",
      updatedAt: serverTimestamp(),
    });
  }
  await batch.commit();
}
