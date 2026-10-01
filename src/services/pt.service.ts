import {
  addDoc,
  doc,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
} from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { todayISO } from "@/lib/format";
import type { PtAssignment, PtPackage, ShareType, Staff, Trainer } from "@/types/models";
import { col, COLLECTIONS, subscribeCollection, subscribeQuery, toDate } from "./firestore.service";

export const mapPtPackage = (id: string, d: DocumentData): PtPackage => ({
  id,
  name: d["name"] ?? "",
  schedule: d["schedule"] === "alternate" ? "alternate" : "daily",
  durationType: d["durationType"] ?? "monthly",
  durationDays: Number(d["durationDays"] ?? 0),
  price: Number(d["price"] ?? 0),
  description: d["description"] ?? "",
  isActive: d["isActive"] !== false,
  maxDiscount:
    d["maxDiscount"] === undefined || d["maxDiscount"] === null ? null : Number(d["maxDiscount"]),
  createdAt: toDate(d["createdAt"]),
  updatedAt: toDate(d["updatedAt"]),
});
export const mapTrainer = (id: string, d: DocumentData): Trainer => ({
  id,
  name: d["name"] ?? "",
  phone: d["phone"] ?? "",
  email: d["email"] ?? "",
  specialization: d["specialization"] ?? "",
  joiningDate: d["joiningDate"] ?? "",
  status: d["status"] ?? "active",
  defaultShareType: d["defaultShareType"] ?? "percentage",
  defaultTrainerShare: Number(d["defaultTrainerShare"] ?? 0),
  notes: d["notes"] ?? "",
  portalCode: d["portalCode"] ?? "",
  portalActive: d["portalActive"] !== false,
  counsellorStaffId: d["counsellorStaffId"] ?? "",
  staffId: d["staffId"] ?? "",
  createdAt: toDate(d["createdAt"]),
  updatedAt: toDate(d["updatedAt"]),
});
export const mapPtAssignment = (id: string, d: DocumentData): PtAssignment => ({
  id,
  clientId: d["clientId"] ?? "",
  clientNameSnapshot: d["clientNameSnapshot"] ?? "",
  ptPackageId: d["ptPackageId"] ?? "",
  ptPackageNameSnapshot: d["ptPackageNameSnapshot"] ?? "",
  trainerId: d["trainerId"] ?? "",
  trainerNameSnapshot: d["trainerNameSnapshot"] ?? "",
  ptPrice: Number(d["ptPrice"] ?? 0),
  trainerShareType: d["trainerShareType"] ?? "percentage",
  trainerShareValue: Number(d["trainerShareValue"] ?? 0),
  trainerShareAmount: Number(d["trainerShareAmount"] ?? 0),
  gymShareAmount: Number(d["gymShareAmount"] ?? 0),
  startDate: d["startDate"] ?? "",
  endDate: d["endDate"] ?? "",
  status: d["status"] ?? "pending",
  invoiceId: d["invoiceId"] ?? "",
  ...(d["cancelId"] ? { cancelId: String(d["cancelId"]) } : {}),
  ...(d["cancelReason"] ? { cancelReason: String(d["cancelReason"]) } : {}),
  ...(d["cancelledOn"] ? { cancelledOn: String(d["cancelledOn"]) } : {}),
  enrollmentId: d["enrollmentId"] ?? null,
  createdAt: toDate(d["createdAt"]),
  updatedAt: toDate(d["updatedAt"]),
});

export const subscribePtPackages = (ok: (x: PtPackage[]) => void, fail: (e: Error) => void) =>
  subscribeCollection(COLLECTIONS.ptPackages, mapPtPackage, ok, fail, orderBy("createdAt", "desc"));
export const subscribeTrainers = (ok: (x: Trainer[]) => void, fail: (e: Error) => void) =>
  subscribeCollection(COLLECTIONS.trainers, mapTrainer, ok, fail, orderBy("createdAt", "desc"));
export const subscribePtAssignments = (ok: (x: PtAssignment[]) => void, fail: (e: Error) => void) =>
  subscribeCollection(
    COLLECTIONS.ptAssignments,
    mapPtAssignment,
    ok,
    fail,
    orderBy("createdAt", "desc"),
  );
export const subscribeClientPtAssignments = (
  clientId: string,
  ok: (x: PtAssignment[]) => void,
  fail: (e: Error) => void,
) =>
  subscribeQuery(
    query(col(COLLECTIONS.ptAssignments), where("clientId", "==", clientId)),
    mapPtAssignment,
    (x) => ok(x.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())),
    fail,
  );

export type PtPackageInput = Omit<PtPackage, "id" | "createdAt" | "updatedAt">;
/** The trainer app login (portal*) is set only by the server, never by the trainer form. */
export type TrainerInput = Omit<
  Trainer,
  "id" | "createdAt" | "updatedAt" | "portalCode" | "portalActive"
>;

export async function savePtPackage(input: PtPackageInput, id?: string) {
  if (id) {
    await updateDoc(doc(db, COLLECTIONS.ptPackages, id), {
      ...input,
      updatedAt: serverTimestamp(),
    });
    return id;
  }
  return (
    await addDoc(col(COLLECTIONS.ptPackages), {
      ...input,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  ).id;
}
/** A staff member with the role "Trainer" is a trainer (Packages & Trainers lists them). */
export const isTrainerRole = (role: string) => role.trim().toLowerCase() === "trainer";
const last10 = (phone: string) => phone.replace(/\D/g, "").slice(-10);
/** The trainer profile made for a staff member (a fixed id, so it is never made twice). */
export const staffTrainerId = (staffId: string) => `staff_${staffId}`;

/**
 * Keeps the trainers in step with the Staff page, so a trainer is added once (on Staff, role
 * "Trainer"): each such staff member has a trainer profile (made when missing; one added here
 * before is matched by phone, then by name), with the name, phone and active / left from Staff.
 * The PT share and the rest stay as set on the trainer. Someone whose role is no longer Trainer
 * keeps their profile for history, inactive. Writes only what changed.
 */
export async function syncStaffTrainers(staff: Staff[], trainers: Trainer[]) {
  const byStaff = new Map(trainers.filter((t) => t.staffId).map((t) => [t.staffId, t]));
  const unlinked = trainers.filter((t) => !t.staffId);
  for (const s of staff) {
    let t = byStaff.get(s.id);
    if (!isTrainerRole(s.role)) {
      if (t && t.status !== "inactive")
        await updateDoc(doc(db, COLLECTIONS.trainers, t.id), {
          status: "inactive",
          updatedAt: serverTimestamp(),
        });
      continue;
    }
    if (!t) {
      t =
        unlinked.find((x) => last10(x.phone) && last10(x.phone) === last10(s.phone)) ??
        unlinked.find((x) => x.name.trim().toLowerCase() === s.name.trim().toLowerCase());
      if (t) unlinked.splice(unlinked.indexOf(t), 1);
    }
    const fromStaff = {
      staffId: s.id,
      counsellorStaffId: s.id,
      name: s.name,
      phone: s.phone,
      status: s.active ? "active" : "inactive",
    };
    if (!t)
      await setDoc(
        doc(db, COLLECTIONS.trainers, staffTrainerId(s.id)),
        {
          ...fromStaff,
          email: "",
          specialization: "",
          joiningDate: s.joiningDate || todayISO(),
          defaultShareType: "percentage",
          defaultTrainerShare: 0,
          notes: "",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    else if (
      Object.entries(fromStaff).some(([k, v]) => (t as unknown as Record<string, unknown>)[k] !== v)
    )
      await updateDoc(doc(db, COLLECTIONS.trainers, t.id), {
        ...fromStaff,
        updatedAt: serverTimestamp(),
      });
  }
}

/** The trainer profile of a staff member just added as a trainer (PT share and the rest). */
export async function saveStaffTrainerProfile(
  staff: { id: string; name: string; phone: string; joiningDate: string },
  profile: Pick<Trainer, "specialization" | "defaultShareType" | "defaultTrainerShare" | "notes">,
) {
  await setDoc(
    doc(db, COLLECTIONS.trainers, staffTrainerId(staff.id)),
    {
      ...profile,
      staffId: staff.id,
      counsellorStaffId: staff.id,
      name: staff.name,
      phone: staff.phone,
      email: "",
      joiningDate: staff.joiningDate,
      status: "active",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function saveTrainer(raw: TrainerInput, id?: string) {
  // A form opened before the owner made the trainer's login must not wipe it.
  const {
    portalCode: _c,
    portalActive: _a,
    ...input
  } = raw as TrainerInput & Partial<Pick<Trainer, "portalCode" | "portalActive">>;
  if (id) {
    await updateDoc(doc(db, COLLECTIONS.trainers, id), { ...input, updatedAt: serverTimestamp() });
    return id;
  }
  return (
    await addDoc(col(COLLECTIONS.trainers), {
      ...input,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  ).id;
}

const round = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** Trainer/gym split. Admin decides type and value; nothing is hardcoded. */
export function calculateShare(ptPrice: number, type: ShareType, value: number) {
  const raw =
    type === "percentage"
      ? (ptPrice * Math.min(Math.max(value, 0), 100)) / 100
      : Math.max(value, 0);
  const trainerShareAmount = round(Math.min(raw, ptPrice));
  return {
    ptPrice,
    trainerShareType: type,
    trainerShareValue: value,
    trainerShareAmount,
    gymShareAmount: round(ptPrice - trainerShareAmount),
  };
}

export const PT_SCHEDULE_LABELS = { daily: "Daily", alternate: "Alternate days" } as const;
/** "Monthly PT (Alternate days)": the name kept on the member's PT plan, bill and apps. */
export const ptPackageLabel = (p: Pick<PtPackage, "name" | "schedule">) =>
  `${p.name} (${PT_SCHEDULE_LABELS[p.schedule]})`;

export const PT_DURATION_LABELS = {
  day: "Day",
  monthly: "Monthly",
  yearly: "Yearly",
  custom: "Custom",
} as const;
export const DEFAULT_PT_DAYS = { day: 1, monthly: 30, yearly: 365, custom: 30 } as const;

/** PT plans running or waiting to start (not every PT plan ever sold). */
export const subscribeOpenPtAssignments = (
  ok: (x: PtAssignment[]) => void,
  fail: (e: Error) => void,
) =>
  subscribeCollection(
    COLLECTIONS.ptAssignments,
    mapPtAssignment,
    ok,
    fail,
    where("status", "in", ["active", "pending"]),
  );
