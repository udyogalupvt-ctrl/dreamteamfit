import { doc, getDoc, getDocs, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, writeBatch, type DocumentReference } from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { key, type ImportContext, type Resolution, type ValidatedRow } from "@/lib/data-import";
import { MAX_MEMBER_ID } from "./clients.service";
import { todayISO } from "@/lib/format";
import { currentRow, pickCurrent, type CurrentSummary } from "@/lib/current-plan";
import type { ImportBatchStatus, ImportType } from "@/types/models";
import { col, COLLECTIONS, type CollectionName } from "./firestore.service";

export interface ImportResult { batchId: string; rowsFound: number; imported: number; updated: number; skipped: number; failed: number; duplicates: number; status: ImportBatchStatus; failures: { row: number; field: string; reason: string }[] }

const TARGET: Record<ImportType, CollectionName> = { clients: COLLECTIONS.clients, packages: COLLECTIONS.packages, trainers: COLLECTIONS.trainers, memberships: COLLECTIONS.memberships, expenses: COLLECTIONS.expenses };
// Up to two writes per row (e.g. member + its ID), and a batch holds at most 500.
const CHUNK = 200;
const slug = (s: string) => key(s).replace(/[^a-z0-9]+/g, "-").slice(0, 60);

export async function fingerprintFile(type: ImportType, fileName: string, rows: unknown[]) {
  const bytes = new TextEncoder().encode(`${type}|${fileName}|${JSON.stringify(rows)}`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Returns an existing finished batch for this exact file, used to block accidental re-imports. */
export async function findCompletedBatch(fingerprint: string) {
  const snap = await getDoc(doc(db, COLLECTIONS.importBatches, `imp_${fingerprint.slice(0, 24)}`));
  const st = snap.exists() ? String(snap.data()["status"]) : "";
  return st === "completed" || st === "completed_with_errors" ? snap.data() : null;
}

/**
 * Writes validated rows. Nothing is written for invalid or skipped rows. Document IDs are
 * deterministic per batch+row so re-submitting (or retrying a failed run) never duplicates records.
 */
export async function runImport(params: {
  type: ImportType; fileName: string; fingerprint: string; rows: ValidatedRow[]; ctx: ImportContext;
  staff: { uid: string; name: string }; onProgress?: (done: number, total: number) => void;
  /** New members may get bills and reminders on WhatsApp (they gave the number to the gym). */
  whatsappOptIn?: boolean;
}): Promise<ImportResult> {
  const { type, rows, ctx, staff } = params;
  const batchId = `imp_${params.fingerprint.slice(0, 24)}`;
  const batchRef = doc(db, COLLECTIONS.importBatches, batchId);
  const prior = await getDoc(batchRef);
  if (prior.exists() && ["completed", "completed_with_errors"].includes(String(prior.data()["status"]))) throw new Error("This exact file was already imported. Nothing was written again.");
  const invalid = rows.filter((r) => r.errors.length);
  const duplicates = rows.filter((r) => r.duplicate).length;
  const failures = invalid.flatMap((r) => r.errors.map((e) => ({ row: r.row, ...e })));
  await setDoc(batchRef, { importBatchId: batchId, filename: params.fileName, fileName: params.fileName, dataType: type, uploadedBy: staff.name, uploadedByUid: staff.uid, uploadedAt: serverTimestamp(), rowsFound: rows.length, rowsImported: 0, rowsSkipped: 0, rowsFailed: invalid.length, duplicates, status: "processing", fingerprint: params.fingerprint, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });

  try {
    const work = rows.filter((r) => !r.errors.length && r.action !== "skip");
    let skipped = rows.filter((r) => !r.errors.length && r.action === "skip").length;
    // Resume support: rows already written by an earlier attempt of this batch are not rewritten.
    const existing = new Set((await getDocs(query(col(TARGET[type]), where("importBatchId", "==", batchId)))).docs.map((d) => d.id));
    const idFor = (r: ValidatedRow) => `${batchId}_r${r.row}`;

    // Create packages/trainers the admin chose to create during migration (deterministic IDs).
    const createdPackages = new Map<string, { id: string; name: string; price: number; durationDays: number }>();
    const createdTrainers = new Map<string, { id: string; name: string }>();
    if (type === "memberships") {
      for (const r of work) {
        const pn = r.data["createPackage"] as string | undefined;
        if (pn && !createdPackages.has(key(pn))) {
          const res = ctx.packageRes[key(pn)] as Extract<Resolution, { mode: "create" }>;
          const id = `${batchId}_pkg_${slug(pn)}`;
          await setDoc(doc(db, COLLECTIONS.packages, id), { name: pn, category: "Custom", description: "Created during data import", durationDays: Number(res.durationDays), price: Number(res.price), isActive: true, importBatchId: batchId, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
          createdPackages.set(key(pn), { id, name: pn, price: Number(res.price), durationDays: Number(res.durationDays) });
        }
        const tn = r.data["createTrainer"] as string | undefined;
        if (tn && !createdTrainers.has(key(tn))) {
          const id = `${batchId}_trn_${slug(tn)}`;
          await setDoc(doc(db, COLLECTIONS.trainers, id), { name: tn, phone: "", email: "", specialization: "", joiningDate: todayISO(), status: "active", defaultShareType: "percentage", defaultTrainerShare: 0, notes: "Created during data import — set the share in Trainers.", importBatchId: batchId, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
          createdTrainers.set(key(tn), { id, name: tn });
        }
      }
    }

    // Member IDs: the old software's number when the file has one (it is also the number on the
    // fingerprint machine), otherwise the next free numbers. Every ID is claimed in /memberIds.
    const newClients = type === "clients" ? work.filter((r) => r.action === "create" && !existing.has(idFor(r))) : [];
    const codeOf = new Map<number, string>();
    const claimed = new Set<number>();
    if (newClients.length) {
      const [reserved, onMachine] = await Promise.all([
        getDocs(col(COLLECTIONS.memberIds)),
        getDocs(col(COLLECTIONS.deviceUsers)).catch(() => null),
      ]);
      const reservedBy = new Map(reserved.docs.map((d) => [d.id, String(d.data()["clientId"] ?? "")]));
      const taken = new Set<string>([...reservedBy.keys(), ...ctx.clients.flatMap((c) => [c.clientCode, c.biometricUserId].filter(Boolean))]);
      const kept: ValidatedRow[] = [];
      for (const r of newClients) {
        const mid = String(r.data["memberId"] ?? "");
        const holder = mid ? reservedBy.get(mid) : undefined;
        if (mid && holder !== undefined && holder !== idFor(r)) {
          failures.push({ row: r.row, field: "Member ID", reason: `ID ${mid} is already taken` });
          continue;
        }
        if (mid) { codeOf.set(r.row, mid); taken.add(mid); if (holder === idFor(r)) claimed.add(r.row); }
        kept.push(r);
      }
      // Numbers the old machine still uses (people not in this file) stay free for them.
      for (const d of onMachine?.docs ?? []) if (d.data()["removed"] !== true) taken.add(String(d.data()["pin"] ?? ""));
      // The lowest free numbers first, like the joining form.
      let next = 1;
      for (const r of kept) {
        if (codeOf.has(r.row)) continue;
        while (taken.has(String(next))) next++;
        if (next > MAX_MEMBER_ID) { failures.push({ row: r.row, field: "Member ID", reason: "No free member ID left" }); continue; }
        codeOf.set(r.row, String(next));
        taken.add(String(next));
      }
    }
    const dropped = new Set(type === "clients" ? work.filter((r) => r.action === "create" && !existing.has(idFor(r)) && !codeOf.has(r.row)).map((r) => r.row) : []);
    const toWrite = work.filter((r) => !dropped.has(r.row));
    const optIn = params.whatsappOptIn === true;

    // The member's current plan summary (lists work from it instead of loading every plan), by the
    // one rule (current-plan.ts) over their saved current plan and the imported ones.
    const latest = new Map<string, { r: ValidatedRow; summary: CurrentSummary }>();
    if (type === "memberships") {
      const byClient = new Map<string, ValidatedRow[]>();
      for (const r of work) { const cid = String(r.data["clientId"]); byClient.set(cid, [...(byClient.get(cid) ?? []), r]); }
      for (const [cid, rows] of byClient) {
        const saved = ctx.clients.find((c) => c.id === cid)?.currentMembership;
        const { summary } = pickCurrent([
          ...(saved?.membershipId ? [{ id: saved.membershipId, name: saved.packageName, startDate: saved.startDate, endDate: saved.endDate, status: saved.status }] : []),
          ...rows.map((r) => currentRow(idFor(r), r.data)),
        ], todayISO());
        const r = rows.find((x) => idFor(x) === summary?.membershipId);
        if (r && summary) latest.set(cid, { r, summary });
      }
    }

    let imported = 0, updated = 0;
    for (let i = 0; i < toWrite.length; i += CHUNK) {
      const chunk = toWrite.slice(i, i + CHUNK);
      const wb = writeBatch(db);
      for (const r of chunk) {
        const d = r.data; const id = idFor(r);
        if (r.action === "update" && r.duplicate?.id) {
          const patch = Object.fromEntries(Object.entries(pickFields(type, d)).filter(([k, v]) => v !== "" && v !== null && k !== "phone" && k !== "phoneNormalized"));
          wb.update(doc(db, TARGET[type], r.duplicate.id), { ...patch, lastImportBatchId: batchId, updatedAt: serverTimestamp() });
          continue;
        }
        if (existing.has(id)) continue;
        const ref: DocumentReference = doc(db, TARGET[type], id);
        const base = { importBatchId: batchId, importedRow: r.row, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
        if (type === "clients") {
          const clientCode = codeOf.get(r.row)!;
          if (!claimed.has(r.row)) wb.set(doc(db, COLLECTIONS.memberIds, clientCode), { clientId: id, createdAt: serverTimestamp() });
          wb.set(ref, { ...pickFields(type, d), clientCode, profilePhotoUrl: null, source: "other", status: "active", inquiryId: null, currentMembership: null, biometricUserId: "", biometricDeviceId: "", biometricStatus: "not_enrolled", firstThumbRegistered: false, enrollmentId: null, whatsappOptIn: optIn, whatsappPhone: d["phone"], whatsappStatus: optIn ? "ready" : "opted_out", lastWhatsappMessageAt: null, ...base });
        }
        else if (type === "packages") wb.set(ref, { ...pickFields(type, d), isActive: true, ...base });
        else if (type === "trainers") wb.set(ref, { ...pickFields(type, d), status: "active", defaultShareType: "percentage", defaultTrainerShare: Number(d["shareValue"] ?? 0) || 0, notes: "", ...base });
        else if (type === "expenses") wb.set(ref, { ...pickFields(type, d), description: "", createdBy: staff.name, createdByUid: staff.uid, ...base });
        else if (type === "memberships") {
          const cp = d["createPackage"] ? createdPackages.get(key(String(d["createPackage"]))) : undefined;
          const packageId = String(d["packageId"] ?? cp?.id ?? "");
          const start = String(d["startDate"]), end = String(d["endDate"]);
          const days = Math.round((new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime()) / 86400000) + 1;
          const tr = d["createTrainer"] ? createdTrainers.get(key(String(d["createTrainer"]))) : undefined;
          wb.set(ref, { clientId: d["clientId"], packageId, packageNameSnapshot: d["packageNameSnapshot"], priceSnapshot: Number(d["price"] ?? 0), durationDaysSnapshot: days, startDate: start, endDate: end, status: d["status"], trainerId: d["trainerId"] ?? tr?.id ?? "", trainerNameSnapshot: d["trainerNameSnapshot"] ?? "", source: "import", ...base });
          const cur = latest.get(String(d["clientId"]));
          if (cur?.r === r)
            wb.update(doc(db, COLLECTIONS.clients, String(d["clientId"])), { currentMembership: cur.summary, updatedAt: serverTimestamp() });
        }
      }
      try {
        await wb.commit();
        for (const r of chunk) { if (r.action === "update") updated++; else imported++; }
      } catch (e) {
        const reason = e instanceof Error ? e.message : "Write failed";
        for (const r of chunk) failures.push({ row: r.row, field: "—", reason: `Not saved: ${reason}` });
      }
      params.onProgress?.(Math.min(i + CHUNK, toWrite.length), toWrite.length);
    }
    const failed = invalid.length + (work.length - imported - updated);
    const status: ImportBatchStatus = imported + updated === 0 && failed > 0 ? "failed" : failed > 0 ? "completed_with_errors" : "completed";
    await updateDoc(batchRef, { rowsImported: imported + updated, rowsUpdated: updated, rowsSkipped: skipped, rowsFailed: failed, status, updatedAt: serverTimestamp() });
    skipped += 0;
    return { batchId, rowsFound: rows.length, imported, updated, skipped, failed, duplicates, status, failures };
  } catch (e) {
    await updateDoc(batchRef, { status: "failed", error: e instanceof Error ? e.message : "Import failed", updatedAt: serverTimestamp() }).catch(() => undefined);
    throw e;
  }
}

function pickFields(type: ImportType, d: Record<string, unknown>) {
  if (type === "clients") return { fullName: d["fullName"], phone: d["phone"], phoneNormalized: d["phoneNormalized"], email: d["email"], dateOfBirth: d["dateOfBirth"] || null, gender: d["gender"], address: d["address"], emergencyContact: d["emergencyContact"], notes: d["notes"], joinedOn: d["joinedOn"] || "" };
  if (type === "packages") return { name: d["name"], durationDays: d["durationDays"], price: d["price"], category: d["category"], description: d["description"] };
  if (type === "trainers") return { name: d["name"], phone: d["phone"], email: d["email"], specialization: d["specialization"], joiningDate: d["joiningDate"] || todayISO() };
  if (type === "expenses") return { title: d["title"], amount: d["amount"], date: d["date"], category: d["category"], paymentMethod: d["paymentMethod"], notes: d["notes"] };
  return {};
}
