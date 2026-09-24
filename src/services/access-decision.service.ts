import { doc, getDoc, getDocs, query, where } from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { todayISO } from "@/lib/format";
import type { AccessDecision, Client, Membership } from "@/types/models";
import { col, COLLECTIONS } from "./firestore.service";
import { mapClient } from "./clients.service";
const membershipFrom = (id: string, d: Record<string, unknown>): Membership => ({
  id,
  clientId: String(d["clientId"] ?? ""),
  packageId: String(d["packageId"] ?? ""),
  packageNameSnapshot: String(d["packageNameSnapshot"] ?? ""),
  priceSnapshot: Number(d["priceSnapshot"] ?? 0),
  durationDaysSnapshot: Number(d["durationDaysSnapshot"] ?? 0),
  startDate: String(d["startDate"] ?? ""),
  endDate: String(d["endDate"] ?? ""),
  counsellorId: String(d["counsellorId"] ?? ""),
  counsellorName: String(d["counsellorName"] ?? ""),
  status: (d["status"] ?? "pending") as Membership["status"],
  createdAt: new Date(),
  updatedAt: new Date(),
});
export function decideMemberAccess(
  client: Client | null,
  memberships: Membership[],
  deviceRegistered = true,
): AccessDecision {
  if (!client)
    return { allowed: false, reason: "MEMBER_NOT_FOUND", clientId: null, membershipId: null };
  if (!deviceRegistered)
    return {
      allowed: false,
      reason: "DEVICE_NOT_REGISTERED",
      clientId: client.id,
      membershipId: null,
    };
  if (client.biometricStatus !== "active")
    return {
      allowed: false,
      reason: "BIOMETRIC_DISABLED",
      clientId: client.id,
      membershipId: null,
    };
  const today = todayISO();
  const valid = memberships.find(
    (m) =>
      (m.status === "active" || m.status === "pending") &&
      m.startDate <= today &&
      m.endDate >= today,
  );
  if (valid)
    return {
      allowed: true,
      reason: "ACTIVE_MEMBERSHIP",
      clientId: client.id,
      membershipId: valid.id,
    };
  const expired = memberships.some((m) => m.endDate < today && m.status !== "cancelled");
  return {
    allowed: false,
    reason: expired ? "MEMBERSHIP_EXPIRED" : "NO_ACTIVE_MEMBERSHIP",
    clientId: client.id,
    membershipId: null,
  };
}
export async function checkMemberAccess(clientId: string, deviceRegistered = true) {
  const [clientDoc, memberships] = await Promise.all([
    getDoc(doc(db, COLLECTIONS.clients, clientId)),
    getDocs(query(col(COLLECTIONS.memberships), where("clientId", "==", clientId))),
  ]);
  const client = clientDoc.exists() ? mapClient(clientDoc.id, clientDoc.data()) : null;
  return decideMemberAccess(
    client,
    memberships.docs.map((d) => membershipFrom(d.id, d.data())),
    deviceRegistered,
  );
}
