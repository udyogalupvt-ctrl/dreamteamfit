import {
  deleteDoc,
  deleteField,
  doc,
  getCountFromServer,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  type DocumentData,
} from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { format } from "date-fns";
import type {
  AccessDecision,
  AttendanceEvent,
  AttendanceEventType,
  AttendanceSource,
  BiometricDevice,
  Client,
} from "@/types/models";
import { col, COLLECTIONS, subscribeCollection, subscribeQuery, toDate } from "./firestore.service";
export const mapAttendance = (id: string, d: DocumentData): AttendanceEvent => ({
  id,
  clientId: d["clientId"] ?? "",
  clientNameSnapshot: d["clientNameSnapshot"] ?? "Unknown member",
  biometricUserId: d["biometricUserId"] ?? "",
  deviceId: d["deviceId"] ?? "",
  deviceNameSnapshot: d["deviceNameSnapshot"] ?? "Manual",
  eventType: d["eventType"] ?? "unknown",
  attendanceDate: d["attendanceDate"] ?? "",
  timestamp: toDate(d["timestamp"]),
  source: d["source"] ?? "manual",
  accessDecision: d["accessDecision"] ?? "blocked",
  accessReason: d["accessReason"] ?? "MEMBER_NOT_FOUND",
  rawEventReference: d["rawEventReference"] ?? "",
  notes: d["notes"] ?? "",
  createdAt: toDate(d["createdAt"]),
  updatedAt: toDate(d["updatedAt"]),
});
/** One day's visits (e.g. today): only what the screen shows — the free database allowance is 50,000 reads a day. */
export const subscribeAttendanceDay = (
  day: string,
  ok: (x: AttendanceEvent[]) => void,
  fail: (e: Error) => void,
) =>
  subscribeQuery(
    query(col(COLLECTIONS.attendance), where("attendanceDate", "==", day)),
    mapAttendance,
    (x) => ok(x.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())),
    fail,
  );
/** Visits between two dates ("YYYY-MM-DD", both included), newest first. */
export const subscribeAttendanceRange = (
  from: string,
  to: string,
  ok: (x: AttendanceEvent[]) => void,
  fail: (e: Error) => void,
) =>
  subscribeQuery(
    query(
      col(COLLECTIONS.attendance),
      where("attendanceDate", ">=", from),
      where("attendanceDate", "<=", to),
    ),
    mapAttendance,
    (x) => ok(x.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())),
    fail,
  );
/**
 * Visit numbers for a long period without loading the visits (a count costs ~1 read per 1,000).
 * Only one condition per count, so no extra database index is needed.
 */
export async function attendanceCounts(from: string, to: string) {
  const [visits, unique] = await Promise.all([
    getCountFromServer(
      query(
        col(COLLECTIONS.attendance),
        where("attendanceDate", ">=", from),
        where("attendanceDate", "<=", to),
      ),
    ),
    // Members whose last visit falls in the period (visited at least once in it).
    getCountFromServer(
      query(
        col(COLLECTIONS.clients),
        where("lastVisitDate", ">=", from),
        where("lastVisitDate", "<=", to),
      ),
    ),
  ]);
  return { visits: visits.data().count, unique: unique.data().count, blocked: null };
}

/** Recent visits (default 62 days). Prefer subscribeAttendanceDay / subscribeAttendanceRange. */
export const subscribeAttendance = (
  ok: (x: AttendanceEvent[]) => void,
  fail: (e: Error) => void,
  days = 62,
) =>
  subscribeCollection(
    COLLECTIONS.attendance,
    mapAttendance,
    ok,
    fail,
    where("timestamp", ">=", Timestamp.fromMillis(Date.now() - days * 86_400_000)),
    orderBy("timestamp", "desc"),
  );
export const subscribeClientAttendance = (
  clientId: string,
  ok: (x: AttendanceEvent[]) => void,
  fail: (e: Error) => void,
) =>
  subscribeQuery(
    query(col(COLLECTIONS.attendance), where("clientId", "==", clientId)),
    mapAttendance,
    (x) => ok(x.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())),
    fail,
  );
const safeId = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 700);
export async function recordAttendance(input: {
  client: Client | null;
  biometricUserId: string;
  device: BiometricDevice | null;
  eventType: AttendanceEventType;
  timestamp: Date;
  source: AttendanceSource;
  decision: AccessDecision;
  rawEventReference: string;
  notes?: string;
}) {
  const id = safeId(input.rawEventReference);
  const ref = doc(db, COLLECTIONS.attendance, id);
  let created = false;
  await runTransaction(db, async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists()) return;
    created = true;
    tx.set(ref, {
      clientId: input.client?.id ?? "",
      clientNameSnapshot: input.client?.fullName ?? "Unknown member",
      biometricUserId: input.biometricUserId,
      deviceId: input.device?.id ?? "",
      deviceNameSnapshot: input.device?.name ?? "Manual attendance",
      eventType: input.eventType,
      attendanceDate: format(input.timestamp, "yyyy-MM-dd"),
      timestamp: Timestamp.fromDate(input.timestamp),
      source: input.source,
      accessDecision: input.decision.allowed ? "allowed" : "blocked",
      accessReason: input.decision.reason,
      rawEventReference: input.rawEventReference,
      notes: input.notes?.trim() ?? "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
  if (created && input.client && input.decision.allowed) {
    const day = format(input.timestamp, "yyyy-MM-dd");
    // First visit of the day: the member's last visit and their arrival time (member app).
    if (day > (input.client.lastVisitDate || "")) {
      await updateDoc(doc(db, COLLECTIONS.clients, input.client.id), { lastVisitDate: day }).catch(
        () => undefined,
      );
      await setDoc(
        doc(db, "memberVisits", input.client.id),
        {
          clientId: input.client.id,
          days: { [day]: format(input.timestamp, "HH:mm") },
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      ).catch(() => undefined);
    }
  }
  return { id, created };
}
export const makeManualReference = () => `manual-${crypto.randomUUID()}`;

/**
 * Removes a visit staff marked by hand by mistake (wrong member or day). The member's last visit
 * and the member app's visit calendar go back to their other visits. Thumb punches stay.
 */
export async function removeManualVisit(e: AttendanceEvent) {
  if (e.source !== "manual") throw new Error("Only a visit marked by hand can be removed.");
  await deleteDoc(doc(db, COLLECTIONS.attendance, e.id));
  if (!e.clientId || e.accessDecision !== "allowed") return;
  const rest = await getDocs(
    query(col(COLLECTIONS.attendance), where("clientId", "==", e.clientId)),
  );
  const days = rest.docs
    .map((d) => d.data())
    .filter((d) => d["accessDecision"] === "allowed")
    .map((d) => String(d["attendanceDate"] ?? ""))
    .filter(Boolean);
  if (days.includes(e.attendanceDate)) return;
  const last = days.sort().at(-1) ?? "";
  const ref = doc(db, COLLECTIONS.clients, e.clientId);
  await updateDoc(ref, { lastVisitDate: last }).catch(() => undefined);
  await updateDoc(doc(db, "memberVisits", e.clientId), {
    [`days.${e.attendanceDate}`]: deleteField(),
    updatedAt: serverTimestamp(),
  }).catch(() => undefined);
}
export async function findClientByBiometricId(userId: string, deviceId: string) {
  const snap = await getDocs(
    query(col(COLLECTIONS.clients), where("biometricUserId", "==", userId)),
  );
  return snap.docs.find((d) => !deviceId || d.data()["biometricDeviceId"] === deviceId) ?? null;
}
