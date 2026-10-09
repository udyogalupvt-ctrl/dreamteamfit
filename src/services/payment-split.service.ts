import {
  deleteField,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type DocumentReference,
} from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { formatDateISO, formatPrice, todayISO } from "@/lib/format";
import {
  billModes,
  scaleAllocation,
  shareOut,
  type PayAllocation,
  type PayPart,
} from "@/lib/split-pay";
import type { Payment, RecordEdit } from "@/types/models";
import { cashOpenFrom } from "./finance.service";
import { col, COLLECTIONS } from "./firestore.service";
import { paymentDateRights, paymentEditRights } from "./payment-edit.service";

/**
 * Edit payment on a Cash + UPI payment (or making one): its parts are edited as ONE payment. The
 * total stays the same (choose one mode first to change it); the date goes to every part; a part
 * that is no longer needed (back to one mode) is deleted, its money folded into the kept one. The
 * gym / PT / trainer split of the parts always adds up to what it was (lib/split-pay.ts).
 */

const round = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const ALLOC_KEYS = [
  "trainerShareAmount",
  "gymAmount",
  "membershipGymAmount",
  "ptGymAmount",
  "otherGymAmount",
] as const;

const partsText = (parts: PayPart[]) =>
  parts.map((x) => `${x.method} ${formatPrice(x.amount)}`).join(" + ");
const samePart = (a: PayPart[], b: PayPart[]) =>
  a.length === b.length &&
  a.every((x, i) => x.method === b[i]!.method && round(x.amount) === round(b[i]!.amount));
const rank = (m: string) => (m === "UPI" ? 0 : m === "Cash" ? 1 : 2);
/** UPI part first, then cash (then anything else), like the checkout saves them. */
const ordered = (parts: PayPart[]) => [...parts].sort((a, b) => rank(a.method) - rank(b.method));

/** The lines for "Will change" and the payment's history. */
export function splitChanges(
  group: Payment[],
  target: PayPart[],
  paymentDate: string,
  note: string,
) {
  const p = group[0]!;
  const before = ordered(group.map((x) => ({ method: x.method, amount: x.amount })));
  const after = ordered(target);
  const out: string[] = [];
  if (!samePart(before, after)) out.push(`Mode ${partsText(before)} → ${partsText(after)}`);
  if (paymentDate !== p.paymentDate)
    out.push(`Date ${formatDateISO(p.paymentDate)} → ${formatDateISO(paymentDate)}`);
  if (note.trim() !== p.note.trim())
    out.push(note.trim() ? `Note: ${note.trim()}` : "Note removed");
  return out;
}

export async function editSplitPayment(input: {
  /** The part opened in Edit payment. */
  payment: Payment;
  /** Every part now, the opened one included (one = not split yet). */
  group: Payment[];
  /** The parts wanted: one = one mode, two = Cash + UPI. */
  target: PayPart[];
  paymentDate: string;
  /** The opened part's note as edited (unchanged = each part keeps its own). */
  note: string;
  reason: string;
  can: { billing: boolean; finance: boolean };
  by: string;
}) {
  const { payment: p } = input;
  const group = [p, ...input.group.filter((x) => x.id !== p.id)];
  const target = ordered(input.target.map((x) => ({ ...x, amount: round(x.amount) })));
  const today = todayISO();
  if (group.some((x) => x.oldSoftware))
    throw new Error("This was paid in the old software: change it from the member's plan.");
  if (group.some((x) => x.kind === "refund" || x.amount <= 0))
    throw new Error("Money given back can't be split.");
  if (group.some((x) => x.invoiceId !== p.invoiceId || x.kind !== p.kind))
    throw new Error("These parts belong to different bills: change them one by one.");
  const total = round(group.reduce((n, x) => n + x.amount, 0));
  if (!target.length || target.length > 2 || target.some((x) => !(x.amount > 0)))
    throw new Error("Each part must be above ₹0.");
  if (target.length === 2 && target[0]!.method === target[1]!.method)
    throw new Error("The two parts must be in different modes.");
  if (round(target.reduce((n, x) => n + x.amount, 0)) !== total)
    throw new Error(
      `The total stays ${formatPrice(total)} while it is split. To change the total, choose one mode first.`,
    );
  const dateChanged = input.paymentDate !== p.paymentDate;
  const sameParts = !splitChanges(group, target, p.paymentDate, p.note).length;
  // Every part must be this login's to change, not only the one opened (a part dated in a closed
  // Day Book month stays as it is; only the note changes then, like Edit payment).
  for (const x of group) {
    const r = paymentEditRights(x, input.can);
    if (!r.mayEdit)
      throw new Error("Only today's payments can be changed here. Ask the owner for older ones.");
    const moves = x.paymentDate !== input.paymentDate;
    if (!r.money && (!sameParts || moves))
      throw new Error("This payment is older than last month: only its note can change.");
    if (moves) {
      const dr = paymentDateRights(x, input.can);
      if (!dr.allowed) throw new Error(dr.note);
    }
  }
  if (group.some((x) => x.paymentDate !== input.paymentDate)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paymentDate)) throw new Error("Pick the payment date.");
    if (input.paymentDate > today) throw new Error("The payment date can't be in the future.");
    if (input.paymentDate < cashOpenFrom(today))
      throw new Error(`Pick a date from ${formatDateISO(cashOpenFrom(today))} on.`);
  }
  const changes = splitChanges(group, target, input.paymentDate, input.note);
  if (!changes.length) throw new Error("Nothing was changed.");
  const noteChanged = input.note.trim() !== p.note.trim();
  const edit: RecordEdit = {
    on: today,
    by: input.by,
    reason: input.reason.trim().slice(0, 300),
    changes,
  };

  // Which saved part takes which new part: the one already in that mode, else the opened one.
  // Back to one mode: the first part keeps it (the bill and the sale point at that payment).
  const refs = group.map((x) => doc(db, COLLECTIONS.payments, x.id));
  const slots: { ref: DocumentReference; from: Payment | null; part: PayPart }[] = [];
  const free = [...group];
  if (target.length === 1) {
    const keep = group.find((x) => x.id === x.splitId) ?? p;
    free.splice(free.indexOf(keep), 1);
    slots.push({ ref: doc(db, COLLECTIONS.payments, keep.id), from: keep, part: target[0]! });
  } else
    for (const part of target) {
      const i = free.findIndex((x) => x.method === part.method);
      const from = i >= 0 ? free.splice(i, 1)[0]! : null;
      slots.push({
        ref: from ? doc(db, COLLECTIONS.payments, from.id) : doc(col(COLLECTIONS.payments)),
        from,
        part,
      });
    }
  // A new part when nothing was in its mode: reuse a saved part not needed otherwise.
  for (const s of slots)
    if (!s.from && free.length) {
      const reuse = free.shift()!;
      s.from = reuse;
      s.ref = doc(db, COLLECTIONS.payments, reuse.id);
    }
  const gone = free; // saved parts no longer needed (back to one mode)
  // Split here for the first time: the link is the original payment's id (the one the bill and
  // the sale point at), so going back to one mode keeps that payment.
  const linked = group.length > 1 ? (group.find((x) => x.splitId)?.splitId ?? "") : "";
  const splitId = target.length > 1 ? linked || p.id : "";

  const payoutRefs: DocumentReference[] =
    dateChanged && input.can.finance && p.kind === "initial" && p.invoiceId
      ? (
          await getDocs(
            query(col(COLLECTIONS.trainerPayouts), where("invoiceId", "==", p.invoiceId)),
          )
        ).docs.map((d) => d.ref)
      : [];

  await runTransaction(db, async (tx) => {
    const snaps = await Promise.all(refs.map((r) => tx.get(r)));
    const invRef = p.invoiceId ? doc(db, COLLECTIONS.invoices, p.invoiceId) : null;
    const inv = invRef && p.kind === "initial" ? await tx.get(invRef) : null;
    const payouts = await Promise.all(payoutRefs.map((r) => tx.get(r)));
    snaps.forEach((s, i) => {
      const was = group[i]!;
      const cur = s.data();
      if (
        !s.exists() ||
        !cur ||
        Number(cur["amount"]) !== was.amount ||
        cur["method"] !== was.method ||
        cur["paymentDate"] !== was.paymentDate ||
        String(cur["splitId"] ?? "") !== (was.splitId ?? "")
      )
        throw new Error("This payment was just changed by someone else. Open it again.");
    });
    const raw = new Map(snaps.map((s) => [s.id, s.data() ?? {}]));
    // The split as saved, summed: the parts share it out again.
    const whole = Object.fromEntries(
      ALLOC_KEYS.map((k) => [
        k,
        round([...raw.values()].reduce((n, d) => n + Number(d[k] ?? 0), 0)),
      ]),
    ) as PayAllocation;
    const firstAlloc =
      slots.length > 1 ? scaleAllocation(whole, total, slots[0]!.part.amount) : whole;
    const allocs = slots.length > 1 ? shareOut(whole, firstAlloc) : [whole];
    const base = raw.get(p.id) ?? {};
    slots.forEach((s, i) => {
      const alloc = Object.fromEntries(ALLOC_KEYS.map((k) => [k, allocs[i]![k]]));
      const common = {
        amount: s.part.amount,
        method: s.part.method,
        paymentDate: input.paymentDate,
        ...alloc,
        splitId: splitId || deleteField(),
        updatedAt: serverTimestamp(),
      };
      if (s.from) {
        const cur = raw.get(s.from.id) ?? {};
        tx.update(s.ref, {
          ...common,
          ...(noteChanged ? { note: input.note.trim().slice(0, 300) } : {}),
          edits: [...(Array.isArray(cur["edits"]) ? cur["edits"] : []), edit],
        });
      } else {
        // The new part: the same payment (who took it, when it was typed in, its bill and plans,
        // its history: a day set by hand stays set for both parts).
        const { edits: before, splitId: _s, ...keep } = base;
        tx.set(s.ref, {
          ...keep,
          ...common,
          splitId,
          note: input.note.trim().slice(0, 300),
          edits: [...(Array.isArray(before) ? before : []), edit],
        });
      }
    });
    gone.forEach((g) => tx.delete(doc(db, COLLECTIONS.payments, g.id)));
    // The bill shows its checkout payment's mode(s).
    if (inv?.exists() && invRef) {
      const d = inv.data();
      const modes = billModes(target);
      const billPatch = {
        paymentMethod: modes.paymentMethod,
        paymentModes: modes.paymentModes ?? deleteField(),
        updatedAt: serverTimestamp(),
      };
      tx.update(invRef, billPatch);
      if (d["publicToken"])
        tx.update(doc(db, COLLECTIONS.publicInvoices, String(d["publicToken"])), billPatch);
    }
    payouts.forEach((po) => {
      const x = po.data();
      if (po.exists() && x?.["status"] === "pending" && x["paymentDate"] === p.paymentDate)
        tx.update(po.ref, { paymentDate: input.paymentDate, updatedAt: serverTimestamp() });
    });
  });
  return changes;
}
