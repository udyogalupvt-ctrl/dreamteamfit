/**
 * Sales here that look like plans paid in the old software (Income & expenses → "Paid in the old
 * software?"). Read-only: the owner checks each and corrects it from the member's plan.
 *
 *   GET /api/old-data/suspects   Income & expenses: payments since the 1st of last month whose
 *                                plan (gym, or PT sold alone) the old software already had, or
 *                                that this app already has as an old-software plan, or that
 *                                started well before it was paid here
 *   GET /api/old-data/overlaps   Income & expenses: one member's gym plans for the same days
 *                                (ending on or after the 1st of last month), see plan-overlap.ts
 *
 * Why: before "Paid in the old software" could take the old offer price, staff unticked it and
 * gave a discount instead, so money paid months ago was recorded as paid the day it was typed in.
 */
import {
  isOldPtPlanName,
  oldPersonFor,
  oldPhoneKey,
  oldPlanInRecords,
  pickOldMember,
  type OldMember,
  type OldNotInRecords,
  type OldPlan,
  type OldSaleSuspect,
} from "@/lib/old-data";
import {
  overlapDays,
  overlapPairs,
  overlapPlan,
  type OverlapListPlan,
  type OverlapListRow,
} from "@/lib/plan-overlap";
import { formatDateISO } from "@/lib/format";
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
  // `typed`: the days the payments were typed in. A sale typed in after its plan started counts on
  // the plan's first day (late-sales.ts), so how late it was is read from when it was typed in.
  const byBill = new Map<
    string,
    {
      membershipId: string;
      /** A PT plan sold alone (no gym plan on the bill). */
      ptAssignmentId: string;
      clientId: string;
      paid: number;
      dates: string[];
      typed: string[];
      by: string;
    }
  >();
  for (const d of pays.docs) {
    const p = d.data();
    const amount = Number(p["amount"] ?? 0);
    const bill = String(p["invoiceId"] ?? "");
    const ptOnly = !p["membershipId"] && !!p["ptAssignmentId"];
    if (!bill || (!p["membershipId"] && !ptOnly)) continue;
    const row = byBill.get(bill) ?? {
      membershipId: ptOnly ? "" : String(p["membershipId"]),
      ptAssignmentId: ptOnly ? String(p["ptAssignmentId"]) : "",
      clientId: String(p["clientId"] ?? ""),
      paid: 0,
      dates: [],
      typed: [],
      by: String(p["createdBy"] ?? ""),
    };
    row.paid += amount;
    if (amount > 0) {
      row.dates.push(String(p["paymentDate"] ?? ""));
      const at = (p["createdAt"] as { toDate?: () => Date } | undefined)?.toDate?.();
      row.typed.push(at ? localDate(at) : String(p["paymentDate"] ?? ""));
    }
    byBill.set(bill, row);
  }
  const rows = [...byBill.entries()].filter(([, r]) => r.paid > 0);
  const [plans, ptPlans, bills, clients] = await Promise.all([
    getAll(
      "memberships",
      rows.map(([, r]) => r.membershipId),
    ),
    getAll(
      "ptAssignments",
      rows.map(([, r]) => r.ptAssignmentId),
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
  // Plans already in this app as paid in the old software (gym and PT), per member.
  const inApp = new Map<string, { kind: "gym" | "pt"; d: FirebaseFirestore.DocumentData }[]>();
  const ptClients = new Set(rows.filter(([, r]) => r.ptAssignmentId).map(([, r]) => r.clientId));
  await Promise.all(
    [...clients.keys()].map(async (id) => {
      const [g, t] = await Promise.all([
        db().collection("memberships").where("clientId", "==", id).get(),
        ptClients.has(id)
          ? db().collection("ptAssignments").where("clientId", "==", id).get()
          : Promise.resolve(null),
      ]);
      const keep = (d: FirebaseFirestore.DocumentData) =>
        d["paidInOldSoftware"] === true && d["status"] !== "cancelled";
      inApp.set(id, [
        ...g.docs.filter((x) => keep(x.data())).map((x) => ({ kind: "gym" as const, d: x.data() })),
        ...(t?.docs ?? [])
          .filter((x) => keep(x.data()))
          .map((x) => ({ kind: "pt" as const, d: x.data() })),
      ]);
    }),
  );

  const out: OldSaleSuspect[] = [];
  for (const [billId, r] of rows) {
    const kind = r.ptAssignmentId ? ("pt" as const) : ("gym" as const);
    const m = kind === "pt" ? ptPlans.get(r.ptAssignmentId) : plans.get(r.membershipId);
    const b = bills.get(billId);
    const c = clients.get(r.clientId);
    if (!m || !b || !c || m["paidInOldSoftware"] === true) continue;
    if (["cancelled"].includes(String(m["status"]))) continue;
    const start = String(m["startDate"] ?? "");
    const end = String(m["endDate"] ?? "");
    const firstPaid = [...r.typed].sort()[0] ?? today;
    const records = (old.get(oldPhoneKey(String(c["phone"] ?? "")))?.["members"] ??
      []) as OldMember[];
    const person =
      records.find((x) => x.memberId && x.memberId === c["oldMemberId"]) ??
      pickOldMember(records, String(c["fullName"] ?? "")) ??
      (records.length === 1 ? records[0]! : null);
    // An old plan of the same kind (gym / PT), paid there, that covers these days and began before
    // it was paid here.
    const oldPlan =
      person?.plans
        .filter((p) => paidOf(p) > 0 && p.start && p.end)
        .filter((p) => isOldPtPlanName(p.name) === (kind === "pt"))
        .filter((p) => p.start <= end && p.end >= start && p.start <= firstPaid)
        .sort((a, b2) => Math.abs(days(a.start, start)) - Math.abs(days(b2.start, start)))[0] ??
      null;
    const reasons: string[] = [];
    if (oldPlan)
      reasons.push(
        `Old software: ${oldPlan.name} ${oldPlan.start} → ${oldPlan.end}, paid ₹${paidOf(oldPlan).toLocaleString("en-IN")}${oldPlan.bill ? ` (bill ${oldPlan.bill})` : ""}`,
      );
    // The same days already in this app as an old-software plan: usually this sale is a copy.
    const already =
      (inApp.get(r.clientId) ?? [])
        .filter((x) => x.kind === kind)
        .map((x) => ({
          name: String(
            kind === "pt"
              ? `PT · ${x.d["ptPackageNameSnapshot"] ?? ""}`
              : (x.d["packageNameSnapshot"] ?? ""),
          ),
          start: String(x.d["startDate"] ?? ""),
          end: String(x.d["endDate"] ?? ""),
          paid: Number(x.d["oldSoftwarePaid"] ?? 0),
        }))
        .filter(
          (x) =>
            overlapDays(
              { startDate: x.start, endDate: x.end },
              { startDate: start, endDate: end },
            ) > 0,
        )
        .sort((a, b2) => Math.abs(days(a.start, start)) - Math.abs(days(b2.start, start)))[0] ??
      null;
    if (already)
      reasons.push(
        `Already in this app as an old-software plan: ${already.name} ${already.start} → ${already.end}${already.paid > 0 ? `, paid ₹${already.paid.toLocaleString("en-IN")} there` : ""}`,
      );
    const late = days(start, firstPaid);
    if (late >= 7) reasons.push(`Plan started ${late} days before it was typed in here`);
    const discount = Number(b["discount"] ?? 0) - Number(b["upgradeCredit"] ?? 0);
    if (discount > 0) reasons.push(`Discount ₹${discount.toLocaleString("en-IN")} on the bill`);
    if (oldPlan && Math.abs(Number(b["total"] ?? 0) - oldPlan.amount) < 1)
      reasons.push("Bill total is the same as the old software's amount");
    if (!oldPlan && !already && late < 7) continue;
    out.push({
      kind,
      membershipId: r.membershipId,
      ptAssignmentId: r.ptAssignmentId,
      clientId: r.clientId,
      clientName: String(c["fullName"] ?? ""),
      clientCode: String(c["clientCode"] ?? ""),
      plan: String(
        kind === "pt"
          ? `PT · ${m["ptPackageNameSnapshot"] ?? ""}`
          : (m["packageNameSnapshot"] ?? ""),
      ),
      start,
      end,
      price: Number((kind === "pt" ? m["ptPrice"] : m["priceSnapshot"]) ?? 0),
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
      inApp: already,
      reasons,
      // Strong when it is the same plan: already in this app as an old plan for these days, or the
      // old data has one with the same start or end (±7 days) and about as long (a 1-month old plan
      // is not the same as an annual plan here).
      strength:
        already ||
        (oldPlan &&
          (Math.abs(days(oldPlan.start, start)) <= 7 || Math.abs(days(oldPlan.end, end)) <= 7) &&
          days(oldPlan.start, oldPlan.end) >= 0.8 * days(start, end))
          ? "strong"
          : "check",
    });
  }
  out.sort(
    (a, b) =>
      (a.strength === b.strength ? 0 : a.strength === "strong" ? -1 : 1) || b.paidHere - a.paidHere,
  );
  return json({
    from,
    suspects: out,
    total: out.reduce((n, s) => n + s.paidHere, 0),
    notInOld: await notInOldRecords(pays.docs),
  });
}

/**
 * Plans saved as paid in the old software (their old-software payments dated from the 1st of last
 * month) whose days the old software's records don't have: money paid here ticked as old by
 * mistake shows up here (the October check). Records stop on the day they were exported, so a
 * plan sold there after that is listed too: the owner checks each one.
 */
async function notInOldRecords(
  pays: FirebaseFirestore.QueryDocumentSnapshot[],
): Promise<OldNotInRecords[]> {
  const byPlan = new Map<
    string,
    { kind: "gym" | "pt"; clientId: string; paid: number; dates: string[]; by: string }
  >();
  for (const d of pays) {
    const p = d.data();
    if (p["oldSoftware"] !== true || !(Number(p["amount"] ?? 0) > 0)) continue;
    const gym = String(p["membershipId"] ?? "");
    const pt = String(p["ptAssignmentId"] ?? "");
    const key = gym ? `gym:${gym}` : pt ? `pt:${pt}` : "";
    if (!key) continue;
    const row = byPlan.get(key) ?? {
      kind: gym ? ("gym" as const) : ("pt" as const),
      clientId: String(p["clientId"] ?? ""),
      paid: 0,
      dates: [],
      by: String(p["createdBy"] ?? ""),
    };
    row.paid += Number(p["amount"] ?? 0);
    row.dates.push(String(p["paymentDate"] ?? ""));
    byPlan.set(key, row);
  }
  if (!byPlan.size) return [];
  const ids = (kind: "gym" | "pt") =>
    [...byPlan.keys()].filter((k) => k.startsWith(`${kind}:`)).map((k) => k.slice(kind.length + 1));
  const [plans, ptPlans, clients] = await Promise.all([
    getAll("memberships", ids("gym")),
    getAll("ptAssignments", ids("pt")),
    getAll(
      "clients",
      [...byPlan.values()].map((r) => r.clientId),
    ),
  ]);
  const old = await getAll(
    "oldMembers",
    [...clients.values()]
      .map((c) => oldPhoneKey(String(c["phone"] || c["phoneNormalized"] || "")))
      .filter((k) => k.length >= 6),
  );
  const out: OldNotInRecords[] = [];
  for (const [key, r] of byPlan) {
    const id = key.slice(r.kind.length + 1);
    const m = r.kind === "pt" ? ptPlans.get(id) : plans.get(id);
    const c = clients.get(r.clientId);
    if (!m || !c || m["status"] === "cancelled" || m["paidInOldSoftware"] !== true) continue;
    const start = String(m["startDate"] ?? "");
    const end = String(m["endDate"] ?? "");
    const records = (old.get(oldPhoneKey(String(c["phone"] || c["phoneNormalized"] || "")))?.[
      "members"
    ] ?? []) as OldMember[];
    const who = { oldMemberId: String(c["oldMemberId"] ?? ""), name: String(c["fullName"] ?? "") };
    if (oldPlanInRecords(records, who, { kind: r.kind, start, end })) continue;
    // Linked to an old record, but none on this phone (the phone changed): can't tell.
    if (!records.length && who.oldMemberId) continue;
    const person = oldPersonFor(records, who);
    const last = [...(person?.plans ?? [])]
      .filter((p) => p.start)
      .sort((a, b) => b.start.localeCompare(a.start))[0];
    out.push({
      kind: r.kind,
      planId: id,
      clientId: r.clientId,
      clientName: String(c["fullName"] ?? ""),
      clientCode: String(c["clientCode"] ?? ""),
      plan: String(
        r.kind === "pt"
          ? `PT · ${m["ptPackageNameSnapshot"] ?? ""}`
          : (m["packageNameSnapshot"] ?? ""),
      ),
      start,
      end,
      paid: Math.round(r.paid * 100) / 100,
      paidOn: [...new Set(r.dates)].sort(),
      createdBy: r.by,
      reason: !records.length
        ? "This phone is not in the old software's records."
        : !person
          ? "The old software has this phone, but not this member's name."
          : last
            ? `The old software has no plan for these days. Its last plan for them: ${last.name}, ${formatDateISO(last.start)}${last.end ? ` → ${formatDateISO(last.end)}` : ""}.`
            : "The old software has this member, but no plans.",
    });
  }
  return out.sort((a, b) => b.start.localeCompare(a.start));
}

/**
 * Gym plans of one member for the same days, both counted (usually a copy). Plans ending before the
 * 1st of last month are not read: their money is in closed Day Book months.
 */
export async function planOverlaps(request: Request) {
  if (!(await requireFeature(request, "finance")))
    return json({ error: "This needs Income & expenses (the owner)." }, 403);
  const from = firstOfLastMonth(localDate());
  const snap = await db().collection("memberships").where("endDate", ">=", from).get();
  const docs = new Map(snap.docs.map((d) => [d.id, d.data()]));
  const pairs = overlapPairs(snap.docs.map((d) => overlapPlan(d.id, d.data())));
  const clients = await getAll(
    "clients",
    pairs.map((p) => p.clientId),
  );
  const shown = (id: string): OverlapListPlan => {
    const d = docs.get(id) ?? {};
    return {
      id,
      name: String(d["packageNameSnapshot"] ?? ""),
      startDate: String(d["startDate"] ?? ""),
      endDate: String(d["endDate"] ?? ""),
      status: String(d["status"] ?? ""),
      paidInOldSoftware: d["paidInOldSoftware"] === true,
      oldPaid: Number(d["oldSoftwarePaid"] ?? 0),
      invoiceId: String(d["invoiceId"] ?? ""),
    };
  };
  const rows: OverlapListRow[] = pairs
    .filter((p) => clients.has(p.clientId))
    .map((p) => ({
      clientId: p.clientId,
      clientName: String(clients.get(p.clientId)?.["fullName"] ?? ""),
      clientCode: String(clients.get(p.clientId)?.["clientCode"] ?? ""),
      days: p.days,
      a: shown(p.a.id),
      b: shown(p.b.id),
    }));
  return json({ from, overlaps: rows });
}
