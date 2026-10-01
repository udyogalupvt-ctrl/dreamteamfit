import { doc, runTransaction, serverTimestamp, writeBatch } from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { normalizePhone } from "@/lib/format";
import type { Staff, Trainer } from "@/types/models";
import { COLLECTIONS } from "./firestore.service";

/**
 * Trainers are created once, on the Staff page (role "Trainer"). Each one has a PT trainer
 * profile (trainers/{id}) that Packages & Trainers uses for the PT share and the trainer app;
 * its name, phone and joining date always follow the Staff record. A trainer added the old way
 * (only in Packages & Trainers) is linked to the staff member with the same phone number.
 */

export const STAFF_ROLES = ["Front desk", "Manager", "Counsellor", "Trainer", "Cleaner", "Other"];

export const isTrainerRole = (role: string) => role.trim().toLowerCase() === "trainer";

/** Roles that sign in to the gym app ("Create login" on the Staff page). */
export const LOGIN_ROLES = ["Front desk", "Manager"];
export const isLoginRole = (role: string) =>
  LOGIN_ROLES.some((r) => r.toLowerCase() === role.trim().toLowerCase());

/** The PT trainer profile of a staff member, if any. */
export const trainerOfStaff = (s: Pick<Staff, "id">, trainers: Trainer[]) =>
  trainers.find((t) => t.staffId === s.id) ?? trainers.find((t) => t.id === s.id) ?? null;

/** The staff member a trainer profile belongs to, if any. */
export const staffOfTrainer = (t: Trainer, staff: Staff[]) =>
  staff.find((s) => s.id === t.staffId) ?? staff.find((s) => s.id === t.id) ?? null;

type Change =
  | { kind: "create"; staff: Staff }
  | { kind: "patch"; trainerId: string; patch: Record<string, unknown> };

/** What has to change so every staff trainer has a PT profile that matches them. */
export function staffTrainerChanges(staff: Staff[], trainers: Trainer[]): Change[] {
  const out: Change[] = [];
  const claimed = new Set(
    trainers.filter((t) => t.staffId && staff.some((s) => s.id === t.staffId)).map((t) => t.id),
  );
  for (const s of staff) {
    let t = trainerOfStaff(s, trainers);
    const trainerRole = isTrainerRole(s.role);
    // Made twice before: the PT trainer with the same phone number becomes this person's profile.
    if (!t && trainerRole && normalizePhone(s.phone).length >= 10) {
      t =
        trainers.find(
          (x) =>
            !claimed.has(x.id) &&
            !staff.some((o) => o.id === x.staffId) &&
            normalizePhone(x.phone) === normalizePhone(s.phone),
        ) ?? null;
      if (t) claimed.add(t.id);
    }
    if (!t) {
      if (trainerRole) out.push({ kind: "create", staff: s });
      continue;
    }
    const patch: Record<string, unknown> = {};
    if (t.staffId !== s.id) patch["staffId"] = s.id;
    if (!t.counsellorStaffId) patch["counsellorStaffId"] = s.id;
    if (trainerRole) {
      if (s.name && t.name !== s.name) patch["name"] = s.name;
      if (t.phone !== s.phone) patch["phone"] = s.phone;
      if (s.joiningDate && t.joiningDate !== s.joiningDate) patch["joiningDate"] = s.joiningDate;
    }
    const shouldBeOff = !s.active || !trainerRole;
    if (shouldBeOff && t.status === "active") {
      patch["status"] = "inactive";
      patch["offWithStaff"] = true;
    } else if (!shouldBeOff && t.status === "inactive" && t.offWithStaff) {
      // Back at work (or a trainer again): PT on again, unless it was switched off by hand.
      patch["status"] = "active";
      patch["offWithStaff"] = false;
    }
    if (Object.keys(patch).length) out.push({ kind: "patch", trainerId: t.id, patch });
  }
  return out;
}

/** Writes the changes. A new profile starts with no PT share set (the owner sets it). */
export async function applyStaffTrainerChanges(changes: Change[]) {
  const patches = changes.filter((c) => c.kind === "patch");
  if (patches.length) {
    const batch = writeBatch(db);
    patches.forEach((c) =>
      batch.update(doc(db, COLLECTIONS.trainers, c.trainerId), {
        ...c.patch,
        updatedAt: serverTimestamp(),
      }),
    );
    await batch.commit();
  }
  for (const c of changes) {
    if (c.kind !== "create") continue;
    const s = c.staff;
    const ref = doc(db, COLLECTIONS.trainers, s.id);
    // Created only if it isn't there yet (two screens open at once make it once).
    await runTransaction(db, async (tx) => {
      if ((await tx.get(ref)).exists()) return;
      tx.set(ref, {
        name: s.name,
        phone: s.phone,
        email: "",
        specialization: "",
        joiningDate: s.joiningDate,
        status: s.active ? "active" : "inactive",
        offWithStaff: !s.active,
        defaultShareType: "percentage",
        defaultTrainerShare: 0,
        notes: "",
        portalCode: "",
        portalActive: true,
        counsellorStaffId: s.id,
        staffId: s.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
  }
}
