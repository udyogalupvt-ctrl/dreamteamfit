/**
 * Sales here that look like plans paid in the old software (Income & expenses → "Paid in the old
 * software?"). Read-only: the owner checks each and corrects it from the member's plan.
 *
 *   GET /api/old-data/suspects   Income & expenses: payments since the 1st of last month whose
 *                                plan the old software already had (or that started well before
 *                                it was paid here)
 *
 * Why: before "Paid in the old software" could take the old offer price, staff unticked it and
 * gave a discount instead, so money paid months ago was recorded as paid the day it was typed in.
 */
import {
  oldPhoneKey,
  pickOldMember,
  type OldMember,
  type OldPlan,
  type OldSaleSuspect,
} from "@/lib/old-data";
import { db, json, localDate, requireFeature } from "./admin";

const DAY = 86_400_000;
const days = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const firstOfLastMonth = (today: string) => {
  const [y, m] = today.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
};

async function getAll(col: string, ids: string[]) {
  const out = new Map<string, FirebaseFirestore.DocumentData>();
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 200) {
    const refs = unique.slice(i, i + 200).map((id) => db().doc(`${col}/${id}`));
    if (refs.length)
      for (const s of await db().getAll(...refs)) if (s.exists) out.set(s.id, s.data() ?? {});
  }
  return out;
}

const paidOf = (p: OldPlan) => Math.max(0, (p.amount || 0) - (p.balance || 0));

export async function oldSaleSuspects(request: Request) {
  if (!(await requireFeature(request, "finance")))
    return json({ error: "This needs Income & expenses (the owner)." }, 403);
  const today = localDate();
  const from = firstOfLastMonth(today);
  const pays = await db().collection("payments").where("paymentDate", ">=", from).get();
  // Money taken here for a plan, by bill.
  const byBill = new Map<
    string,
    { membershipId: string; clientId: string; paid: number; dates: string[]; by: string }
  >();
  for (const d of pays.docs) {
    const p = d.data();
    const amount = Number(p["amount"] ?? 0);
    const bill = String(p["invoiceId"] ?? "");
    if (!bill || !p["membershipId"]) continue;
    const row = byBill.get(bill) ?? {
      membershipId: String(p["membershipId"]),
      clientId: String(p["clientId"] ?? ""),
      paid: 0,
      dates: [],
      by: String(p["createdBy"] ?? ""),
    };
    row.paid += amount;
    if (amount > 0) row.dates.push(String(p["paymentDate"] ?? ""));
    byBill.set(bill, row);
  }
  const rows = [...byBill.entries()].filter(([, r]) => r.paid > 0);
  const [plans, bills, clients] = await Promise.all([
    getAll(
      "memberships",
      rows.map(([, r]) => r.membershipId),
    ),
    getAll(
      "invoices",
      rows.map(([id]) => id),
    ),
    getAll(
      "clients",
      rows.map(([, r]) => r.clientId),
    ),
  ]);
  const keys = [...clients.values()].map((c) =>
    oldPhoneKey(String(c["phone"] ?? c["phoneNormalized"] ?? "")),
  );
  const old = await getAll(
    "oldMembers",
    keys.filter((k) => k.length >= 6),
  );

  const out: OldSaleSuspect[] = [];
  for (const [billId, r] of rows) {
    const m = plans.get(r.membershipId);
    const b = bills.get(billId);
    const c = clients.get(r.clientId);
    if (!m || !b || !c || m["paidInOldSoftware"] === true) continue;
    if (["cancelled"].includes(String(m["status"]))) continue;
    const start = String(m["startDate"] ?? "");
    const end = String(m["endDate"] ?? "");
    const firstPaid = [...r.dates].sort()[0] ?? today;
    const records = (old.get(oldPhoneKey(String(c["phone"] ?? "")))?.["members"] ??
      []) as OldMember[];
    const person =
      records.find((x) => x.memberId && x.memberId === c["oldMemberId"]) ??
      pickOldMember(records, String(c["fullName"] ?? "")) ??
      (records.length === 1 ? records[0]! : null);
    // An old plan, paid there, that covers these days and began before it was paid here.
    const oldPlan =
      person?.plans
        .filter((p) => paidOf(p) > 0 && p.start && p.end)
        .filter((p) => p.start <= end && p.end >= start && p.start <= firstPaid)
        .sort((a, b2) => Math.abs(days(a.start, start)) - Math.abs(days(b2.start, start)))[0] ??
      null;
    const reasons: string[] = [];
    if (oldPlan)
      reasons.push(
        `Old software: ${oldPlan.name} ${oldPlan.start} → ${oldPlan.end}, paid ₹${paidOf(oldPlan).toLocaleString("en-IN")}${oldPlan.bill ? ` (bill ${oldPlan.bill})` : ""}`,
      );
    const late = days(start, firstPaid);
    if (late >= 7) reasons.push(`Plan started ${late} days before it was paid here`);
    const discount = Number(b["discount"] ?? 0) - Number(b["upgradeCredit"] ?? 0);
    if (discount > 0) reasons.push(`Discount ₹${discount.toLocaleString("en-IN")} on the bill`);
    if (oldPlan && Math.abs(Number(b["total"] ?? 0) - oldPlan.amount) < 1)
      reasons.push("Bill total is the same as the old software's amount");
    if (!oldPlan && late < 7) continue;
    out.push({
      membershipId: r.membershipId,
      clientId: r.clientId,
      clientName: String(c["fullName"] ?? ""),
      clientCode: String(c["clientCode"] ?? ""),
      plan: String(m["packageNameSnapshot"] ?? ""),
      start,
      end,
      price: Number(m["priceSnapshot"] ?? 0),
      invoiceId: billId,
      invoiceNumber: String(b["invoiceNumber"] ?? ""),
      discount: Math.max(0, discount),
      billTotal: Number(b["total"] ?? 0),
      paidHere: Math.round(r.paid * 100) / 100,
      paidOn: [...new Set(r.dates)].sort(),
      createdBy: r.by,
      old: oldPlan
        ? {
            memberId: person?.memberId ?? "",
            plan: oldPlan.name,
            start: oldPlan.start,
            end: oldPlan.end,
            amount: oldPlan.amount,
            paid: paidOf(oldPlan),
            balance: oldPlan.balance,
            bill: oldPlan.bill,
          }
        : null,
      reasons,
      // Strong only when it is the same plan: same start or end (±7 days) and about as long
      // (a 1-month old plan is not the same as an annual plan here).
      strength:
        oldPlan &&
        (Math.abs(days(oldPlan.start, start)) <= 7 || Math.abs(days(oldPlan.end, end)) <= 7) &&
        days(oldPlan.start, oldPlan.end) >= 0.8 * days(start, end)
          ? "strong"
          : "check",
    });
  }
  out.sort(
    (a, b) =>
      (a.strength === b.strength ? 0 : a.strength === "strong" ? -1 : 1) || b.paidHere - a.paidHere,
  );
  return json({ from, suspects: out, total: out.reduce((n, s) => n + s.paidHere, 0) });
}
