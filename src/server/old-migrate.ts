/**
 * Old plans as-is: the one-time migration, the single-member carry and their Undo. The pure
 * decisions live in src/lib/old-migrate.ts; this file only reads the old records (closed to the
 * browser), re-checks every decision inside a per-member transaction and writes it, keeping a
 * full before-copy in oldSoftwareMoves (kind "as-is") so every member's change can be undone.
 *
 *   POST /api/old-migrate/preview   owner: dry run over a page of phone keys, writes nothing
 *   POST /api/old-migrate/apply     owner: apply the changes for the given phone keys
 *   POST /api/old-migrate/undo      owner: undo one member's change (a move document)
 *   POST /api/old-migrate/undo-run  owner: undo a whole run, newest member first
 *   POST /api/old-migrate/carry     "Members": carry one old member's plan (first visit)
 *   GET  /api/old-migrate/search    "Members": find someone in the old software by name/phone
 *
 * Money rules: what was paid there = one payment on the start day, method "Not recorded",
 * oldSoftware: true. Money taken HERE is never deleted or changed (only its bill link may move).
 */
import { randomBytes } from "node:crypto";
import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type Transaction,
} from "firebase-admin/firestore";
import { isOwnerEmail } from "@/constants/owners";
import { oldPhoneKey, type OldDirectoryEntry, type OldMember } from "@/lib/old-data";
import {
  planMigration,
  NOT_RECORDED,
  type CarryPlan,
  type FixPlan,
  type MemberPlanResult,
  type Row,
} from "@/lib/old-migrate";
import { currentRow, pickCurrent } from "@/lib/current-plan";
import { db, json, localDate, requireFeature, requireStaff } from "./admin";

const MOVES = "oldSoftwareMoves";
const KIND = "as-is";
/** Phone keys per preview request (reads only). */
const PREVIEW_PAGE = 120;
/** Members applied or undone per request (each is one transaction). */
const APPLY_PAGE = 12;

type D = DocumentData;
type Actor = { uid: string; name: string };

const actorOf = (u: { uid: string; email?: string | undefined; name?: unknown }): Actor => ({
  uid: u.uid,
  name: String(u.name ?? "") || u.email || "Staff",
});

async function owner(request: Request) {
  const user = await requireStaff(request);
  return user && isOwnerEmail(user.email) ? user : null;
}

const token = () => randomBytes(18).toString("hex");

async function audit(actor: Actor, clientId: string, clientName: string, summary: string) {
  await db()
    .collection("auditLogs")
    .add({
      at: FieldValue.serverTimestamp(),
      action: "updated",
      clientId,
      clientName,
      collection: "memberships",
      docId: "",
      summary,
      actorType: "app_user",
      actorUid: actor.uid,
      actorName: actor.name,
      changes: {},
    })
    .catch((e) => console.error("old-migrate audit failed", String(e)));
}

/** Same shape the app's write wrapper queues so the machine re-checks one member's door. */
function doorCheck(tx: Transaction, clientId: string) {
  const now = FieldValue.serverTimestamp();
  tx.set(db().collection("biometricCommands").doc(), {
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

/* ------------------------------------------------------------------ reading state */

async function directoryKeys(): Promise<string[]> {
  const summary = (await db().doc("oldDataIndex/summary").get()).data();
  return ((summary?.["keys"] as string[] | undefined) ?? []).slice().sort();
}

async function oldRecordsFor(keys: string[]): Promise<Map<string, OldMember[]>> {
  const out = new Map<string, OldMember[]>();
  for (let i = 0; i < keys.length; i += 100) {
    const refs = keys.slice(i, i + 100).map((k) => db().doc(`oldMembers/${k}`));
    const snaps = await db().getAll(...refs);
    snaps.forEach((s) => {
      const members = (s.data()?.["members"] as OldMember[] | undefined) ?? [];
      if (members.length) out.set(s.id, members);
    });
  }
  return out;
}

const rowsOf = (snap: FirebaseFirestore.QuerySnapshot): Row[] =>
  snap.docs.map((d) => ({ id: d.id, data: d.data() }));

interface AppState {
  clients: Row[];
  byPhone: Map<string, Row[]>;
  byOldId: Map<string, Row>;
  memberships: Map<string, Row[]>;
  ptAssignments: Map<string, Row[]>;
  usedCodes: Set<string>;
}

/** Clients and plans once per request; bills and payments only for the clients involved. */
async function loadAppState(): Promise<AppState> {
  const [clients, memberships, pts, ids] = await Promise.all([
    db().collection("clients").get(),
    db().collection("memberships").get(),
    db().collection("ptAssignments").get(),
    db().collection("memberIds").get(),
  ]);
  const byPhone = new Map<string, Row[]>();
  const byOldId = new Map<string, Row>();
  for (const c of rowsOf(clients)) {
    const k = oldPhoneKey(String(c.data["phoneNormalized"] ?? c.data["phone"] ?? ""));
    if (k) byPhone.set(k, [...(byPhone.get(k) ?? []), c]);
    const oldId = String(c.data["oldMemberId"] ?? "");
    if (oldId) byOldId.set(oldId, c);
  }
  const group = (rows: Row[]) => {
    const m = new Map<string, Row[]>();
    rows.forEach((r) => {
      const c = String(r.data["clientId"] ?? "");
      m.set(c, [...(m.get(c) ?? []), r]);
    });
    return m;
  };
  return {
    clients: rowsOf(clients),
    byPhone,
    byOldId,
    memberships: group(rowsOf(memberships)),
    ptAssignments: group(rowsOf(pts)),
    usedCodes: new Set(ids.docs.map((d) => d.id)),
  };
}

async function docsForClients(col: string, clientIds: string[]): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < clientIds.length; i += 30) {
    const snap = await db()
      .collection(col)
      .where("clientId", "in", clientIds.slice(i, i + 30))
      .get();
    out.push(...rowsOf(snap));
  }
  return out;
}

/** Everything planMigration needs for one phone key. */
async function inputFor(
  state: AppState,
  key: string,
  oldMembers: OldMember[],
  scope: "running" | "latest",
  onlyOldMemberId = "",
) {
  const clients = [
    ...(state.byPhone.get(key) ?? []),
    ...oldMembers.map((m) => state.byOldId.get(m.memberId)).filter(Boolean),
  ].filter((c, i, all) => all.findIndex((x) => x!.id === c!.id) === i) as Row[];
  const ids = clients.map((c) => c.id);
  const memberships = ids.flatMap((id) => state.memberships.get(id) ?? []);
  const ptAssignments = ids.flatMap((id) => state.ptAssignments.get(id) ?? []);
  const [invoices, payments] = ids.length
    ? await Promise.all([docsForClients("invoices", ids), docsForClients("payments", ids)])
    : [[], []];
  return {
    today: localDate(),
    phoneKey: key,
    oldMembers,
    clients,
    memberships,
    ptAssignments,
    invoices,
    payments,
    scope,
    onlyOldMemberId,
  };
}

/* ------------------------------------------------------------------ applying one member */

interface Created {
  clientId?: string;
  memberIdReserved?: string;
  memberships: string[];
  ptAssignments: string[];
  invoices: string[];
  publicInvoices: string[];
  payments: string[];
  binId?: string;
  binItems: string[];
  commands: number;
}

const planEdit = (by: Actor) => ({
  on: localDate(),
  by: by.name,
  reason: "Old software migration: kept exactly as in the old records",
  changes: ["Old plan carried as-is"],
  tool: "old-migrate",
});

/** Next free Member ID for a created member: the old numeric ID when free, else max + 1. */
function allocateCode(state: AppState, desired: string | null): string {
  if (desired && !state.usedCodes.has(desired)) {
    state.usedCodes.add(desired);
    return desired;
  }
  let max = 0;
  state.usedCodes.forEach((c) => {
    if (/^\d+$/.test(c)) max = Math.max(max, Number(c));
  });
  const next = String(Math.min(Math.max(max + 1, 1), 8999));
  state.usedCodes.add(next);
  return next;
}

/**
 * Apply one member's decision in one transaction. Re-reads everything, re-plans, refuses on any
 * surprise, writes the move document with full before-copies. Returns the move id, or null when
 * a re-check found nothing left to do.
 */
async function applyMember(
  state: AppState,
  key: string,
  oldMembers: OldMember[],
  oldMemberId: string,
  scope: "running" | "latest",
  runId: string,
  by: Actor,
  onlyPlanKey = "",
): Promise<{ moveId: string; clientId: string; summary: string } | null> {
  const firestore = db();
  const today = localDate();
  const year = new Date(`${today}T00:00:00`).getFullYear();
  const invKey = `invoiceSeq${year}`;

  return firestore.runTransaction(async (tx) => {
    // Fresh reads inside the transaction (the page-level state may be stale).
    const clientSnap = await tx.get(
      firestore.collection("clients").where("phoneNormalized", "==", key),
    );
    let clients = rowsOf(clientSnap as FirebaseFirestore.QuerySnapshot);
    const linked = await tx.get(
      firestore.collection("clients").where("oldMemberId", "==", oldMemberId),
    );
    rowsOf(linked as FirebaseFirestore.QuerySnapshot).forEach((c) => {
      if (!clients.some((x) => x.id === c.id)) clients = [...clients, c];
    });
    const ids = clients.map((c) => c.id);
    const read = async (col: string) => {
      const out: Row[] = [];
      for (let i = 0; i < ids.length; i += 30) {
        const s = await tx.get(
          firestore.collection(col).where("clientId", "in", ids.slice(i, i + 30)),
        );
        out.push(...rowsOf(s as FirebaseFirestore.QuerySnapshot));
      }
      return out;
    };
    const [memberships, ptAssignments, invoices, payments] = ids.length
      ? await Promise.all([
          read("memberships"),
          read("ptAssignments"),
          read("invoices"),
          read("payments"),
        ])
      : [[], [], [], []];

    const fresh = planMigration({
      today,
      phoneKey: key,
      oldMembers,
      clients,
      memberships,
      ptAssignments,
      invoices,
      payments,
      scope,
      onlyOldMemberId: oldMemberId,
    });
    let result = fresh.members.find((m) => m.old.memberId === oldMemberId) ?? null;
    if (result && onlyPlanKey) {
      const carries = result.carries.filter((c) => c.key === onlyPlanKey);
      const fixes = result.fixes.filter((c) => c.key === onlyPlanKey);
      result = carries.length || fixes.length ? { ...result, carries, fixes, recycles: [] } : null;
    }
    if (!result || (!result.carries.length && !result.fixes.length && !result.recycles.length))
      return null;

    const counterRef = firestore.doc("settings/counters");
    const billsNeeded =
      result.carries.filter((c) => c.bill).length +
      result.fixes.filter((f) => f.billAction === "create").length;
    const counter = billsNeeded ? await tx.get(counterRef) : null;
    const settings = billsNeeded ? await tx.get(firestore.doc("settings/business")) : null;
    let invSeq = Number(counter?.data()?.[invKey] ?? 0);
    const invPrefix = String(settings?.data()?.["invoicePrefix"] ?? "INV");

    // Member ID for a created member.
    let claim: { ref: FirebaseFirestore.DocumentReference; code: string } | null = null;
    if (!result.clientId && result.client) {
      const code = allocateCode(state, result.client.desiredCode);
      const idRef = firestore.doc(`memberIds/${code}`);
      const taken = await tx.get(idRef);
      if (taken.exists) throw new Error(`Member ID ${code} was just taken. Run again.`);
      claim = { ref: idRef, code };
    }

    const now = FieldValue.serverTimestamp();
    const before: {
      clients: { id: string; data: D }[];
      memberships: { id: string; data: D }[];
      ptAssignments: { id: string; data: D }[];
      invoices: { id: string; data: D }[];
      publicInvoices: { id: string; data: D }[];
      payments: { id: string; data: D }[];
    } = {
      clients: [],
      memberships: [],
      ptAssignments: [],
      invoices: [],
      publicInvoices: [],
      payments: [],
    };
    const created: Created = {
      memberships: [],
      ptAssignments: [],
      invoices: [],
      publicInvoices: [],
      payments: [],
      binItems: [],
      commands: 0,
    };
    const snapOnce = (bucket: { id: string; data: D }[], row: Row | null | undefined) => {
      if (row && !bucket.some((x) => x.id === row.id)) bucket.push({ id: row.id, data: row.data });
    };
    const rowById = (rows: Row[], id: string | null | undefined) =>
      (id && rows.find((r) => r.id === id)) || null;
    const publicSnaps = new Map<string, D | null>();
    for (const f of result.fixes) {
      const inv = rowById(invoices, f.invoiceId);
      const tok = inv ? String(inv.data["publicToken"] ?? "") : "";
      if (tok && !publicSnaps.has(tok)) {
        const p = await tx.get(firestore.doc(`publicInvoices/${tok}`));
        publicSnaps.set(tok, p.exists ? (p.data() as D) : null);
      }
    }

    /* ---------- writes ---------- */
    const clientRow = result.clientId ? rowById(clients, result.clientId) : null;
    let clientRef: FirebaseFirestore.DocumentReference;
    let clientName: string;
    if (clientRow) {
      clientRef = firestore.doc(`clients/${clientRow.id}`);
      clientName = String(clientRow.data["fullName"] ?? "");
      snapOnce(before.clients, clientRow);
    } else {
      clientRef = firestore.collection("clients").doc();
      clientName = String(result.client!.draft["fullName"] ?? "");
      created.clientId = clientRef.id;
    }

    const newPlanRows: Row[] = [];
    const deletedPlanIds = new Set<string>();

    const makeBill = (
      p: CarryPlan["plan"],
      bill: D,
      planRefs: { m?: string | undefined; pt?: string | undefined },
    ) => {
      invSeq += 1;
      const invoiceNumber = `${invPrefix}-${year}-${String(invSeq).padStart(6, "0")}`;
      const invRef = firestore.collection("invoices").doc();
      const tok = token();
      const common = {
        ...bill,
        invoiceNumber,
        clientId: clientRef.id,
        clientNameSnapshot: clientName,
        clientPhoneSnapshot: key,
        clientEmailSnapshot: "",
        membershipId: planRefs.m ?? null,
        packageId: null,
        ptAssignmentId: planRefs.pt ?? null,
        paymentId: null,
        enrollmentId: "",
        remindOldBalance: false,
        paymentMethod: NOT_RECORDED,
        invoiceDate: today,
        dueDate: String(bill["dueDate"] ?? today),
        notes: "Moved from the old software (plan paid there)",
        counsellorId: "",
        counsellorName: "",
        pdfUrl: "",
        publicToken: tok,
        createdBy: by.name,
        createdByUid: by.uid,
        createdAt: now,
        updatedAt: now,
      };
      tx.set(invRef, common);
      tx.set(firestore.doc(`publicInvoices/${tok}`), {
        publicToken: tok,
        invoiceNumber,
        clientName,
        clientPhone: key,
        clientEmail: "",
        items: bill["items"],
        subtotal: bill["subtotal"],
        discount: 0,
        tax: 0,
        total: bill["total"],
        amountPaid: bill["amountPaid"],
        balanceDue: bill["balanceDue"],
        upgradeCredit: 0,
        paymentStatus: bill["paymentStatus"],
        paymentMethod: NOT_RECORDED,
        invoiceDate: today,
        dueDate: common.dueDate,
        createdAt: now,
        updatedAt: now,
      });
      created.invoices.push(invRef.id);
      created.publicInvoices.push(tok);
      return invRef.id;
    };

    const makePayment = (draft: D, links: { m?: string | undefined; pt?: string | undefined }) => {
      const ref = firestore.collection("payments").doc();
      tx.set(ref, {
        ...draft,
        clientId: clientRef.id,
        clientNameSnapshot: clientName,
        invoiceId: "",
        invoiceNumber: "",
        membershipId: links.m ?? null,
        ptAssignmentId: links.pt ?? null,
        createdBy: by.name,
        createdByUid: by.uid,
        createdAt: now,
        updatedAt: now,
      });
      created.payments.push(ref.id);
    };

    const makePlans = (
      c: CarryPlan | FixPlan,
      existing?: { m?: string | undefined; pt?: string | undefined },
    ) => {
      let mId = existing?.m ?? "";
      let ptId = existing?.pt ?? "";
      if (c.membership) {
        const ref = mId
          ? firestore.doc(`memberships/${mId}`)
          : firestore.collection("memberships").doc();
        if (!mId) {
          created.memberships.push(ref.id);
          mId = ref.id;
        }
        newPlanRows.push({ id: ref.id, data: c.membership });
      }
      if (c.pt) {
        const ref = ptId
          ? firestore.doc(`ptAssignments/${ptId}`)
          : firestore.collection("ptAssignments").doc();
        if (!ptId) {
          created.ptAssignments.push(ref.id);
          ptId = ref.id;
        }
      }
      return { mId, ptId };
    };

    // 1. Carries: brand-new as-is plans.
    const summaryBits: string[] = [];
    for (const c of result.carries) {
      const { mId, ptId } = makePlans(c);
      const billId = c.bill
        ? makeBill(c.plan, c.bill, {
            m: c.membership ? mId : undefined,
            pt: c.pt ? ptId : undefined,
          })
        : "";
      if (c.membership) {
        tx.set(firestore.doc(`memberships/${mId}`), {
          ...c.membership,
          clientId: clientRef.id,
          invoiceId: billId,
          edits: [planEdit(by)],
          ...(c.overlapWith.length ? { overlapOk: c.overlapWith } : {}),
          createdAt: now,
          updatedAt: now,
        });
      }
      if (c.pt) {
        tx.set(firestore.doc(`ptAssignments/${ptId}`), {
          ...c.pt,
          clientId: clientRef.id,
          clientNameSnapshot: clientName,
          invoiceId: billId,
          edits: [planEdit(by)],
          ...(c.overlapWith.length ? { overlapOk: c.overlapWith } : {}),
          createdAt: now,
          updatedAt: now,
        });
      }
      if (c.payment)
        makePayment(c.payment, { m: c.membership ? mId : undefined, pt: c.pt ? ptId : undefined });
      // Mark the sold-here side of each allowed overlap, without touching updatedAt (the
      // Remove tool's same-write check reads it).
      for (const otherId of c.overlapWith) {
        const isGym = !!rowById(memberships, otherId);
        const other = rowById(memberships, otherId) ?? rowById(ptAssignments, otherId);
        if (!other) continue;
        const col = isGym ? "memberships" : "ptAssignments";
        snapOnce(isGym ? before.memberships : before.ptAssignments, other);
        const marks = new Set([
          ...(Array.isArray(other.data["overlapOk"])
            ? (other.data["overlapOk"] as unknown[]).map(String)
            : []),
        ]);
        if (c.membership) marks.add(mId);
        if (c.pt) marks.add(ptId);
        tx.update(firestore.doc(`${col}/${otherId}`), { overlapOk: [...marks] });
      }
      summaryBits.push(`carried ${c.plan.name} ${c.plan.start}→${c.plan.end}`);
    }

    // 2. Fixes: rewrite the hand-entered plan to the exact old plan.
    for (const f of result.fixes) {
      const mRow = rowById(memberships, f.membershipId ?? f.deleteMembershipId);
      const ptRow = rowById(ptAssignments, f.ptAssignmentId ?? f.deletePtId);
      snapOnce(before.memberships, mRow);
      snapOnce(before.ptAssignments, ptRow);
      const { mId, ptId } = makePlans(f, {
        m: f.membershipId ?? undefined,
        pt: f.ptAssignmentId ?? undefined,
      });
      if (f.deleteMembershipId) {
        tx.delete(firestore.doc(`memberships/${f.deleteMembershipId}`));
        deletedPlanIds.add(f.deleteMembershipId);
      }
      if (f.deletePtId) {
        tx.delete(firestore.doc(`ptAssignments/${f.deletePtId}`));
        deletedPlanIds.add(f.deletePtId);
      }

      // The bill first (plans point at it).
      const inv = rowById(invoices, f.invoiceId);
      let billId = "";
      if (f.billAction === "create") {
        billId = makeBill(f.plan, f.bill!, {
          m: f.membership ? mId : undefined,
          pt: f.pt ? ptId : undefined,
        });
      } else if (inv) {
        snapOnce(before.invoices, inv);
        const tok = String(inv.data["publicToken"] ?? "");
        const pub = tok ? publicSnaps.get(tok) : null;
        if (pub) before.publicInvoices.push({ id: tok, data: pub });
        if (f.billAction === "delete") {
          tx.delete(firestore.doc(`invoices/${inv.id}`));
          if (tok) tx.delete(firestore.doc(`publicInvoices/${tok}`));
        } else if (f.billAction === "rewrite") {
          billId = inv.id;
          const money = f.bill ?? {
            items: [
              {
                name: `Balance from the old software · ${f.plan.name}`,
                description: "Plan paid in the old software; this part was still due",
                quantity: 1,
                unitPrice: 0,
                total: 0,
                packageId: null,
              },
            ],
            subtotal: 0,
            discount: 0,
            tax: 0,
            total: f.paidHere,
            amountPaid: f.paidHere,
            balanceDue: 0,
            upgradeCredit: 0,
            membershipGross: f.kind === "pt" ? 0 : f.paidHere,
            ptGross: f.kind === "pt" ? f.paidHere : 0,
            trainerShareTotal: 0,
            paymentsTracked: true,
            paymentStatus: "paid",
          };
          tx.set(
            firestore.doc(`invoices/${inv.id}`),
            {
              ...money,
              membershipId: f.membership ? mId : null,
              packageId: null,
              ptAssignmentId: f.pt ? ptId : null,
              remindOldBalance: inv.data["remindOldBalance"] === true,
              paymentMethod: NOT_RECORDED,
              notes: "Moved from the old software (plan paid there)",
              updatedAt: now,
            },
            { merge: true },
          );
          if (tok)
            tx.set(
              firestore.doc(`publicInvoices/${tok}`),
              {
                items: money["items"],
                subtotal: money["subtotal"],
                discount: 0,
                tax: 0,
                total: money["total"],
                amountPaid: money["amountPaid"],
                balanceDue: money["balanceDue"],
                paymentStatus: money["paymentStatus"],
                paymentMethod: NOT_RECORDED,
                updatedAt: now,
              },
              { merge: true },
            );
        }
      }

      // The plans: exact as-is fields, keeping what staff know better than the old record.
      const keepOf = (row: Row | null) => {
        const d = row?.data ?? {};
        return {
          ...(d["counsellorId"]
            ? { counsellorId: d["counsellorId"], counsellorName: d["counsellorName"] ?? "" }
            : {}),
          ...(Array.isArray(d["pauses"]) && (d["pauses"] as unknown[]).length
            ? { pauses: d["pauses"] }
            : {}),
          ...(d["endedBy"]
            ? {
                endedBy: d["endedBy"],
                status: d["status"],
                ...(d["statusBeforeSale"] ? { statusBeforeSale: d["statusBeforeSale"] } : {}),
              }
            : {}),
          ...(Array.isArray(d["overlapOk"]) && (d["overlapOk"] as unknown[]).length
            ? { overlapOk: d["overlapOk"] }
            : {}),
          enrollmentId: d["enrollmentId"] ?? "",
          edits: [...((d["edits"] as unknown[] | undefined) ?? []), planEdit(by)],
          createdAt: d["createdAt"] ?? now,
        };
      };
      if (f.membership)
        tx.set(firestore.doc(`memberships/${mId}`), {
          ...f.membership,
          clientId: clientRef.id,
          invoiceId: billId,
          ...keepOf(mRow && f.membershipId ? mRow : null),
          updatedAt: now,
        });
      if (f.pt)
        tx.set(firestore.doc(`ptAssignments/${ptId}`), {
          ...f.pt,
          clientId: clientRef.id,
          clientNameSnapshot: clientName,
          invoiceId: billId,
          ...keepOf(ptRow && f.ptAssignmentId ? ptRow : null),
          updatedAt: now,
        });

      // Payments: replace the old-software rows with the one exact record (or keep staff's rows).
      for (const pid of f.deletePaymentIds) {
        const p = rowById(payments, pid);
        if (p?.data["oldSoftware"] !== true)
          throw new Error("Refused: tried to delete a payment taken here.");
        snapOnce(before.payments, p);
        tx.delete(firestore.doc(`payments/${pid}`));
      }
      if (f.payment)
        makePayment(f.payment, { m: f.membership ? mId : undefined, pt: f.pt ? ptId : undefined });
      if (f.keepPayments) {
        // Staff's rows stay; only their plan links move when the shape changed.
        for (const p of payments.filter((x) => x.data["oldSoftware"] === true)) {
          const linksM = p.data["membershipId"] === f.deleteMembershipId && f.membership;
          const linksPt = p.data["ptAssignmentId"] === f.deletePtId && f.pt;
          if (linksM || linksPt) {
            snapOnce(before.payments, p);
            tx.update(firestore.doc(`payments/${p.id}`), {
              ...(linksM ? { membershipId: mId } : {}),
              ...(linksPt ? { ptAssignmentId: ptId } : {}),
              updatedAt: now,
            });
          }
        }
      }
      for (const pid of f.repointPaymentIds) {
        const p = rowById(payments, pid);
        if (!p) continue;
        snapOnce(before.payments, p);
        tx.update(firestore.doc(`payments/${pid}`), {
          invoiceId: billId,
          invoiceNumber: billId && inv ? (inv.data["invoiceNumber"] ?? "") : "",
          ...(f.membership ? { membershipId: mId } : {}),
          ...(f.pt ? { ptAssignmentId: ptId } : {}),
          updatedAt: now,
        });
      }
      summaryBits.push(`fixed to ${f.plan.name} ${f.plan.start}→${f.plan.end}`);
    }

    // 3. Copies → Recycle Bin (visible under Recycle Bin like a removed plan).
    let binRef: FirebaseFirestore.DocumentReference | null = null;
    if (result.recycles.length) {
      binRef = firestore.collection("recycleBin").doc();
      created.binId = binRef.id;
      const plans: string[] = [];
      const labelBits: string[] = [];
      let n = 0;
      for (const r of result.recycles) {
        const mRow = rowById(memberships, r.membershipId);
        const ptRow = rowById(ptAssignments, r.ptAssignmentId);
        const unitPays = payments.filter(
          (p) =>
            (r.membershipId && p.data["membershipId"] === r.membershipId) ||
            (r.ptAssignmentId && p.data["ptAssignmentId"] === r.ptAssignmentId),
        );
        if (unitPays.some((p) => p.data["oldSoftware"] !== true))
          throw new Error("Refused: a copy picked for the bin has money taken here.");
        const invRow = rowById(
          invoices,
          String(mRow?.data["invoiceId"] ?? ptRow?.data["invoiceId"] ?? "") || null,
        );
        const item = (collection: string, row: Row) => {
          const ref = firestore.collection("recycleBinItems").doc();
          n += 1;
          tx.set(ref, {
            binId: binRef!.id,
            n,
            path: `${collection}/${row.id}`,
            collection,
            docId: row.id,
            data: row.data,
            deletedByUid: by.uid,
            createdAt: now,
          });
          created.binItems.push(ref.id);
          tx.delete(firestore.doc(`${collection}/${row.id}`));
        };
        if (mRow) {
          item("memberships", mRow);
          deletedPlanIds.add(mRow.id);
          plans.push(`gym:${mRow.id}`);
          labelBits.push(String(mRow.data["packageNameSnapshot"] ?? "Plan"));
        }
        if (ptRow) {
          item("ptAssignments", ptRow);
          deletedPlanIds.add(ptRow.id);
          plans.push(`pt:${ptRow.id}`);
          labelBits.push(`PT: ${String(ptRow.data["ptPackageNameSnapshot"] ?? "PT")}`);
        }
        if (invRow) {
          item("invoices", invRow);
          const tok = String(invRow.data["publicToken"] ?? "");
          if (tok) tx.delete(firestore.doc(`publicInvoices/${tok}`));
        }
        unitPays.forEach((p) => item("payments", p));
        summaryBits.push(`copy to the Recycle Bin (${r.reason})`);
      }
      tx.set(binRef, {
        section: "plans",
        label: `Plan: ${labelBits.join(" + ")} · ${clientName}`,
        detail: "copy of an old-software plan · migration",
        count: n,
        deletedBy: by.name,
        deletedByUid: by.uid,
        deletedByRole: "owner",
        deletedAt: now,
        extra: {
          kind: "plan",
          clientId: clientRef.id,
          plans,
          changed: [],
          putBack: [],
          enrollmentId: "",
          enrollmentNow: String(clientRow?.data["enrollmentId"] ?? ""),
        },
      });
    }

    // 4. The member record and their current plan.
    const finalPlans = [
      ...memberships.filter(
        (r) => !deletedPlanIds.has(r.id) && !newPlanRows.some((x) => x.id === r.id),
      ),
      ...newPlanRows,
    ].filter(
      (r) =>
        r.data["clientId"] === undefined ||
        r.data["clientId"] === clientRef.id ||
        newPlanRows.includes(r),
    );
    const current = pickCurrent(
      finalPlans.map((r) => currentRow(r.id, r.data as never)),
      today,
    );
    if (clientRow) {
      tx.update(clientRef, {
        currentMembership: current.summary,
        ...(current.active ? { status: "active" } : {}),
        ...(clientRow.data["oldMemberId"] ? {} : { oldMemberId: oldMemberId }),
        updatedAt: now,
      });
    } else {
      if (claim) {
        tx.set(claim.ref, { clientId: clientRef.id, createdAt: now });
        created.memberIdReserved = claim.code;
      }
      tx.set(clientRef, {
        ...result.client!.draft,
        clientCode: claim?.code ?? "",
        currentMembership: current.summary,
        photoUploadToken: token(),
        createdAt: now,
        updatedAt: now,
      });
    }
    if (billsNeeded) tx.set(counterRef, { [invKey]: invSeq, updatedAt: now }, { merge: true });
    if (clientRow?.data["firstThumbRegistered"] === true) {
      doorCheck(tx, clientRef.id);
      created.commands = 1;
    }

    // 5. The move document: everything needed to put it all back.
    const moveRef = firestore.collection(MOVES).doc();
    tx.set(moveRef, {
      kind: KIND,
      runId,
      phoneKey: key,
      oldMemberId,
      clientId: clientRef.id,
      clientName,
      action: clientRow ? (result.fixes.length ? "fix" : "carry") : "create-member",
      was: result.was,
      now: result.now,
      summary: summaryBits.join("; "),
      before,
      created: created as unknown as D,
      undone: false,
      by: by.name,
      byUid: by.uid,
      createdAt: now,
    });
    return { moveId: moveRef.id, clientId: clientRef.id, summary: summaryBits.join("; ") };
  });
}

/* ------------------------------------------------------------------ undo */

const tsEq = (a: unknown, b: unknown) =>
  a instanceof Timestamp && b instanceof Timestamp ? a.isEqual(b) : a === b;

/**
 * Put one member's change back exactly: every before-copy is rewritten whole, every created
 * document is deleted — refused when anything was edited since (so money collected later on a
 * created bill is never lost).
 */
async function undoMove(moveId: string, by: Actor): Promise<{ ok: true } | { error: string }> {
  const firestore = db();
  try {
    await firestore.runTransaction(async (tx) => {
      const moveSnap = await tx.get(firestore.doc(`${MOVES}/${moveId}`));
      const move = moveSnap.data();
      if (!move || move["kind"] !== KIND) throw new Error("This change was not found.");
      if (move["undone"]) throw new Error("Already undone.");
      const before = (move["before"] ?? {}) as Record<string, { id: string; data: D }[]>;
      const created = (move["created"] ?? {}) as unknown as Created;
      const col = (c: string, id: string) => firestore.doc(`${c}/${id}`);

      // Created documents must be untouched (updatedAt still equals createdAt).
      const createdRefs: { c: string; id: string }[] = [
        ...(created.memberships ?? []).map((id) => ({ c: "memberships", id })),
        ...(created.ptAssignments ?? []).map((id) => ({ c: "ptAssignments", id })),
        ...(created.invoices ?? []).map((id) => ({ c: "invoices", id })),
        ...(created.payments ?? []).map((id) => ({ c: "payments", id })),
      ];
      for (const { c, id } of createdRefs) {
        const s = await tx.get(col(c, id));
        if (!s.exists) continue;
        const d = s.data()!;
        if (!tsEq(d["updatedAt"], d["createdAt"]))
          throw new Error(
            `Can't undo: ${c === "invoices" ? "the balance bill" : c === "payments" ? "a payment" : "the carried plan"} was changed after the run (edit or money collected). Undo that first.`,
          );
      }
      if (created.clientId) {
        // A created member must have nothing new hanging off them.
        for (const c of ["memberships", "ptAssignments", "invoices", "payments"] as const) {
          const s = await tx.get(firestore.collection(c).where("clientId", "==", created.clientId));
          const known = new Set(
            (created[c === "ptAssignments" ? "ptAssignments" : c] ?? []) as string[],
          );
          for (const d of s.docs)
            if (!known.has(d.id))
              throw new Error(
                "Can't undo: this member already has new records here. Undo by hand.",
              );
        }
        const cSnap = await tx.get(col("clients", created.clientId));
        if (cSnap.exists && cSnap.data()!["firstThumbRegistered"] === true)
          throw new Error("Can't undo: this member's thumb was registered since. Undo by hand.");
      }
      const binItems: { id: string; data: D }[] = [];
      for (const id of created.binItems ?? []) {
        const s = await tx.get(col("recycleBinItems", id));
        if (!s.exists)
          throw new Error("Can't undo: the Recycle Bin copy was restored or emptied already.");
        binItems.push({ id, data: s.data()! });
      }
      const clientId = String(move["clientId"] ?? "");
      const clientSnap =
        clientId && !created.clientId ? await tx.get(col("clients", clientId)) : null;

      const now = FieldValue.serverTimestamp();
      // Delete everything the run created.
      for (const { c, id } of createdRefs) tx.delete(col(c, id));
      for (const tok of created.publicInvoices ?? []) tx.delete(col("publicInvoices", tok));
      if (created.binId) tx.delete(col("recycleBin", created.binId));
      for (const b of binItems) {
        // Put the binned copy back where it was.
        tx.set(firestore.doc(String(b.data["path"])), b.data["data"] as D);
        tx.delete(col("recycleBinItems", b.id));
      }
      if (created.clientId) {
        tx.delete(col("clients", created.clientId));
        if (created.memberIdReserved) tx.delete(col("memberIds", created.memberIdReserved));
      }
      // Write every before-copy back whole.
      for (const [c, rows] of Object.entries(before))
        for (const r of rows ?? []) {
          if (c === "clients") continue; // patched below, so later unrelated edits survive
          tx.set(firestore.doc(`${c}/${r.id}`), r.data);
        }
      // The member record: only the fields this run touched.
      if (clientSnap?.exists) {
        const beforeClient = (before["clients"] ?? []).find((r) => r.id === clientId);
        tx.update(col("clients", clientId), {
          currentMembership: beforeClient?.data["currentMembership"] ?? null,
          status: beforeClient?.data["status"] ?? "active",
          ...(beforeClient && !beforeClient.data["oldMemberId"]
            ? { oldMemberId: FieldValue.delete() }
            : {}),
          updatedAt: now,
        });
        if (clientSnap.data()!["firstThumbRegistered"] === true) doorCheck(tx, clientId);
      }
      tx.update(firestore.doc(`${MOVES}/${moveId}`), {
        undone: true,
        undoneAt: now,
        undoneBy: by.name,
        undoneByUid: by.uid,
      });
    });
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/* ------------------------------------------------------------------ endpoints */

async function preview(request: Request) {
  const user = await owner(request);
  if (!user) return json({ error: "Only the owner can run the old software check." }, 403);
  const body = (await request.json().catch(() => ({}))) as { cursor?: number };
  const cursor = Math.max(0, Number(body.cursor ?? 0));
  const keys = await directoryKeys();
  if (!keys.length)
    return json({ error: "Add the old software's files on the Backup page first." }, 400);
  const page = keys.slice(cursor, cursor + PREVIEW_PAGE);
  const [records, state] = await Promise.all([oldRecordsFor(page), loadAppState()]);
  const rows: D[] = [];
  const skips: D[] = [];
  for (const key of page) {
    const oldMembers = records.get(key);
    if (!oldMembers) continue;
    const input = await inputFor(state, key, oldMembers, "running");
    const r = planMigration(input);
    r.members.forEach((m) =>
      rows.push({
        phone: key,
        oldMemberId: m.old.memberId,
        name: m.old.name,
        clientId: m.clientId,
        creates: !m.clientId,
        was: m.was,
        now: m.now,
        carries: m.carries.length,
        fixes: m.fixes.length,
        recycles: m.recycles.length,
      }),
    );
    r.skips.forEach((s) => skips.push({ phone: key, ...s }));
  }
  const next = cursor + PREVIEW_PAGE;
  return json({
    rows,
    skips,
    next: next < keys.length ? next : null,
    total: keys.length,
    done: Math.min(next, keys.length),
  });
}

async function apply(request: Request) {
  const user = await owner(request);
  if (!user) return json({ error: "Only the owner can run the old software check." }, 403);
  const body = (await request.json().catch(() => ({}))) as {
    runId?: string;
    members?: { phone: string; oldMemberId: string }[];
  };
  const runId = String(body.runId ?? "").slice(0, 60);
  const members = (body.members ?? []).slice(0, APPLY_PAGE);
  if (!runId || !members.length) return json({ error: "Nothing to apply." }, 400);
  const by = actorOf(user);
  const keys = [...new Set(members.map((m) => oldPhoneKey(m.phone)))];
  const [records, state] = await Promise.all([oldRecordsFor(keys), loadAppState()]);
  const applied: D[] = [];
  const skipped: D[] = [];
  const errors: D[] = [];
  for (const m of members) {
    const key = oldPhoneKey(m.phone);
    const oldMembers = records.get(key);
    if (!oldMembers) {
      skipped.push({ ...m, reason: "no old record" });
      continue;
    }
    try {
      const r = await applyMember(state, key, oldMembers, m.oldMemberId, "running", runId, by);
      if (r) {
        applied.push({ ...m, ...r });
        await audit(by, r.clientId, "", `Old software migration: ${r.summary}`);
      } else skipped.push({ ...m, reason: "nothing left to do (already carried)" });
    } catch (e) {
      errors.push({ ...m, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return json({ applied, skipped, errors });
}

async function carry(request: Request) {
  const user = await requireFeature(request, "members");
  if (!user) return json({ error: "This login can't add members." }, 403);
  const body = (await request.json().catch(() => ({}))) as {
    phone?: string;
    oldMemberId?: string;
    planKey?: string;
  };
  const key = oldPhoneKey(String(body.phone ?? ""));
  const oldMemberId = String(body.oldMemberId ?? "");
  if (key.length < 6 || !oldMemberId)
    return json({ error: "Phone and old member are needed." }, 400);
  const snap = await db().doc(`oldMembers/${key}`).get();
  const oldMembers = (snap.data()?.["members"] as OldMember[] | undefined) ?? [];
  if (!oldMembers.some((m) => m.memberId === oldMemberId))
    return json({ error: "The old software has no such member on this phone." }, 404);
  const state = await loadAppState();
  const by = actorOf(user);
  try {
    const r = await applyMember(
      state,
      key,
      oldMembers,
      oldMemberId,
      "latest",
      `carry-${localDate()}`,
      by,
      String(body.planKey ?? ""),
    );
    if (!r) return json({ error: "Their old plan is already in the app." }, 409);
    await audit(by, r.clientId, "", `Old software carry: ${r.summary}`);
    return json({ moveId: r.moveId, clientId: r.clientId, summary: r.summary });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 409);
  }
}

async function undo(request: Request) {
  const user = await owner(request);
  if (!user) return json({ error: "Only the owner can undo this." }, 403);
  const body = (await request.json().catch(() => ({}))) as { moveId?: string };
  if (!body.moveId) return json({ error: "Which change?" }, 400);
  const r = await undoMove(String(body.moveId), actorOf(user));
  return "error" in r ? json(r, 409) : json(r);
}

async function undoRun(request: Request) {
  const user = await owner(request);
  if (!user) return json({ error: "Only the owner can undo this." }, 403);
  const body = (await request.json().catch(() => ({}))) as { runId?: string };
  const runId = String(body.runId ?? "");
  if (!runId) return json({ error: "Which run?" }, 400);
  const snap = await db()
    .collection(MOVES)
    .where("kind", "==", KIND)
    .where("runId", "==", runId)
    .get();
  const open = snap.docs.filter((d) => !d.data()["undone"]);
  const page = open.slice(0, APPLY_PAGE);
  const by = actorOf(user);
  const undone: string[] = [];
  const errors: D[] = [];
  for (const d of page) {
    const r = await undoMove(d.id, by);
    if ("error" in r) errors.push({ moveId: d.id, who: d.data()["clientName"], error: r.error });
    else undone.push(d.id);
  }
  return json({ undone, errors, remaining: open.length - page.length });
}

async function search(request: Request, url: URL) {
  const user = await requireFeature(request, "members");
  if (!user) return json({ error: "This login can't look up members." }, 403);
  const q = String(url.searchParams.get("q") ?? "")
    .trim()
    .toLowerCase();
  if (q.length < 2) return json({ entries: [] });
  const summary = (await db().doc("oldDataIndex/summary").get()).data();
  const parts = Number(summary?.["parts"] ?? 0);
  const docs = await Promise.all(
    Array.from({ length: parts }, (_, i) => db().doc(`oldDataIndex/dir-${i}`).get()),
  );
  const entries = docs.flatMap(
    (d) => (d.data()?.["entries"] as OldDirectoryEntry[] | undefined) ?? [],
  );
  const digits = q.replace(/\D/g, "");
  const words = q.split(/\s+/).filter(Boolean);
  const hits = entries
    .filter((e) => {
      if (digits.length >= 4 && e.k.includes(digits)) return true;
      const name = e.n.toLowerCase();
      return words.length > 0 && words.every((w) => name.includes(w));
    })
    .slice(0, 8);
  // Which of them are already members here?
  const inApp = new Map<string, string>();
  const clientSnaps = await Promise.all(
    hits.map((e) => db().collection("clients").where("oldMemberId", "==", e.id).limit(1).get()),
  );
  clientSnaps.forEach((s, i) => {
    if (!s.empty) inApp.set(hits[i]!.id, s.docs[0]!.id);
  });
  const phones = [...new Set(hits.filter((e) => !inApp.has(e.id)).map((e) => e.k))];
  for (const p of phones) {
    const s = await db().collection("clients").where("phoneNormalized", "==", p).get();
    for (const e of hits.filter((x) => x.k === p && !inApp.has(x.id))) {
      const c = s.docs.find((d) => !d.data()["oldMemberId"]);
      if (s.docs.some((d) => d.data()["oldMemberId"] === e.id))
        inApp.set(e.id, s.docs.find((d) => d.data()["oldMemberId"] === e.id)!.id);
      else if (c && s.size === 1 && hits.filter((x) => x.k === p).length === 1)
        inApp.set(e.id, c.id);
    }
  }
  return json({
    entries: hits.map((e) => ({ ...e, clientId: inApp.get(e.id) ?? "" })),
    today: localDate(),
  });
}

export async function handleOldMigrate(request: Request, url: URL): Promise<Response | null> {
  const path = url.pathname.replace(/^\/api\/old-migrate\/?/, "");
  if (request.method === "POST" && path === "preview") return preview(request);
  if (request.method === "POST" && path === "apply") return apply(request);
  if (request.method === "POST" && path === "carry") return carry(request);
  if (request.method === "POST" && path === "undo") return undo(request);
  if (request.method === "POST" && path === "undo-run") return undoRun(request);
  if (request.method === "GET" && path === "search") return search(request, url);
  return null;
}
