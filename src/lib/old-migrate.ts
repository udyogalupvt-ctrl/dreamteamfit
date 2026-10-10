/**
 * Old-software members keep their old plan AS IS (design 2026-10-10): the exact old plan name,
 * start, end, amount and balance — no package picking, no sale bill, no WhatsApp. This module
 * holds the pure decisions for the one-time migration, the single-member carry ("Add from old
 * software") and the fix-up of plans staff entered by hand. No Firestore here: the server
 * (src/server/old-migrate.ts) executes what this returns, keeping full before-copies for Undo.
 *
 * Money rules (unchanged invariants):
 * - What was paid there = ONE payment on the plan's start day, method "Not recorded",
 *   `oldSoftware: true` (never in the Day Book drawer, incentives or trainer payouts).
 * - Money taken HERE is sacred: a non-oldSoftware payment is never deleted or changed, only its
 *   `invoiceId` may move to the kept balance bill.
 */
import {
  type OldMember,
  type OldPlan,
  isOldPtPlanName,
  oldJoinedOn,
  tidyName,
} from "./old-data.ts";

export type D = Record<string, unknown>;
export interface Row {
  id: string;
  data: D;
}

/** gym / pt / pt that also opens the floor (membership + PT pair), from the old plan's name. */
export type PlanKind = "gym" | "pt" | "pair";
export function oldPlanKind(name: string): PlanKind {
  if (!isOldPtPlanName(name)) return "gym";
  return /floor|\bgym\b/i.test(name) ? "pair" : "pt";
}

export const normPlanName = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** One old plan can be carried once: this key marks the app plan that carries it. */
export const asIsKey = (oldMemberId: string, p: Pick<OldPlan, "name" | "start" | "end">) =>
  `${oldMemberId}|${p.start}|${p.end}|${normPlanName(p.name)}`;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
/** Days from start to end, both counted ("2026-10-01".."2026-10-30" = 30). 0 when dates are bad. */
export const daysIncl = (start: string, end: string) =>
  DAY.test(start) && DAY.test(end) && end >= start
    ? Math.round((ms(end) - ms(start)) / 86_400_000) + 1
    : 0;
const dayGap = (a: string, b: string) => Math.abs(ms(a) - ms(b)) / 86_400_000;

export const gymStatusOf = (start: string, end: string, today: string) =>
  start > today ? "pending" : end < today ? "expired" : "active";
export const ptStatusOf = (start: string, end: string, today: string) =>
  start > today ? "pending" : end < today ? "completed" : "active";

/** The paid part of an old plan (what its one payment holds). */
export const oldPaidOf = (p: Pick<OldPlan, "amount" | "balance">) =>
  Math.max(0, (p.amount || 0) - Math.max(0, p.balance || 0));
export const oldBalanceOf = (p: Pick<OldPlan, "balance">) => Math.max(0, p.balance || 0);

export const NOT_RECORDED = "Not recorded";
export const OLD_BILL_PREFIX = "Balance from the old software";

/* ------------------------------------------------------------------ exact as-is documents */

/** Membership fields for an as-is old plan (server adds clientId, invoiceId, timestamps). */
export function asIsMembership(m: OldMember, p: OldPlan, today: string): D {
  const kind = oldPlanKind(p.name);
  return {
    packageId: "",
    packageNameSnapshot: p.name,
    priceSnapshot: kind === "pt" ? 0 : p.amount || 0,
    durationDaysSnapshot: daysIncl(p.start, p.end),
    startDate: p.start,
    endDate: p.end,
    status: gymStatusOf(p.start, p.end, today),
    counsellorId: "",
    counsellorName: "",
    pauses: [],
    edits: [],
    enrollmentId: "",
    paidInOldSoftware: true,
    oldSoftwarePaid: oldPaidOf(p),
    oldSoftwareBalance: oldBalanceOf(p),
    ...(p.bill ? { oldSoftwareBillNo: p.bill.slice(0, 40) } : {}),
    oldPlanAsIs: true,
    oldPlanKey: asIsKey(m.memberId, p),
    oldMemberId: m.memberId,
  };
}

/** PT-assignment fields for an as-is old PT plan (no trainer, no share, no payout). */
export function asIsPt(m: OldMember, p: OldPlan, today: string): D {
  const kind = oldPlanKind(p.name);
  return {
    ptPackageId: "",
    ptPackageNameSnapshot: p.name,
    trainerId: "",
    trainerNameSnapshot: "",
    ptPrice: kind === "pt" ? p.amount || 0 : 0,
    trainerShareType: "percent",
    trainerShareValue: 0,
    trainerShareAmount: 0,
    gymShareAmount: kind === "pt" ? p.amount || 0 : 0,
    startDate: p.start,
    endDate: p.end,
    status: ptStatusOf(p.start, p.end, today),
    edits: [],
    enrollmentId: "",
    paidInOldSoftware: true,
    oldSoftwarePaid: oldPaidOf(p),
    oldSoftwareBalance: oldBalanceOf(p),
    ...(p.bill ? { oldSoftwareBillNo: p.bill.slice(0, 40) } : {}),
    oldPlanAsIs: true,
    oldPlanKey: asIsKey(m.memberId, p),
    oldMemberId: m.memberId,
  };
}

/**
 * The one payment for what was paid in the old software (server adds clientId, names, links,
 * createdBy and timestamps via oldPaymentData-compatible fields). null when nothing was paid.
 */
export function asIsPayment(p: OldPlan): D | null {
  const paid = oldPaidOf(p);
  if (paid <= 0) return null;
  const kind = oldPlanKind(p.name);
  return {
    amount: paid,
    method: NOT_RECORDED,
    paymentDate: p.start,
    kind: "initial",
    oldSoftware: true,
    oldSoftwareBillNo: (p.bill || "").slice(0, 40),
    trainerShareAmount: 0,
    gymAmount: paid,
    membershipGymAmount: kind === "pt" ? 0 : paid,
    ptGymAmount: kind === "pt" ? paid : 0,
    otherGymAmount: 0,
    counsellorId: "",
    counsellorName: "",
    note: "Paid in the old software",
    edits: [],
  };
}

/** The balance bill's one line + money (server adds number, token, client fields, dates). */
export function asIsBill(p: OldPlan, paidHere = 0): D | null {
  const balance = oldBalanceOf(p);
  if (balance <= 0) return null;
  const kind = oldPlanKind(p.name);
  return {
    items: [
      {
        name: `${OLD_BILL_PREFIX} · ${p.name}`,
        description: "Plan paid in the old software; this part was still due",
        quantity: 1,
        unitPrice: balance,
        total: balance,
        packageId: null,
      },
    ],
    subtotal: balance,
    discount: 0,
    tax: 0,
    total: balance,
    amountPaid: paidHere,
    balanceDue: Math.max(0, balance - paidHere),
    upgradeCredit: 0,
    membershipGross: kind === "pt" ? 0 : balance,
    ptGross: kind === "pt" ? balance : 0,
    trainerShareTotal: 0,
    paymentsTracked: true,
    paymentStatus: paidHere >= balance ? "paid" : paidHere > 0 ? "partial" : "pending",
    ...(DAY.test(p.nextPayment) ? { dueDate: p.nextPayment } : {}),
  };
}

/* ------------------------------------------------------------------ matching */

const nameWords = (s: string) =>
  new Set(
    String(s ?? "")
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1),
  );

/** Word-overlap score between an app client's name and an old member's name. */
export function nameScore(a: string, b: string) {
  const wa = nameWords(a);
  return [...nameWords(b)].filter((w) => wa.has(w)).length;
}

/**
 * The app client that IS this old member: linked by oldMemberId first, else the clearly best
 * name match on the phone; null when none fits (a family member not in the app yet).
 */
export function matchClient(clients: Row[], m: OldMember): Row | null {
  const linked = m.memberId
    ? clients.find((c) => String(c.data["oldMemberId"] ?? "") === m.memberId)
    : null;
  if (linked) return linked;
  const free = clients.filter((c) => !c.data["oldMemberId"]);
  // Every word of the shorter name must be shared ("K. Sudheer" = "Sudheer Kumar K"); one shared
  // surname alone must not claim somebody else's record.
  const subset = (a: string, b: string) => {
    const wa = [...nameWords(a)];
    const wb = [...nameWords(b)];
    if (!wa.length || !wb.length) return false;
    const [small, big] = wa.length <= wb.length ? [wa, new Set(wb)] : [wb, new Set(wa)];
    return small.every((w) => big.has(w));
  };
  const scored = free
    .map((c) => ({ c, score: nameScore(String(c.data["fullName"] ?? ""), m.name) }))
    .filter((x) => x.score > 0 && subset(String(x.c.data["fullName"] ?? ""), m.name))
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  if (scored[1] && scored[1].score === scored[0]!.score) return null;
  return scored[0]!.c;
}

/* ------------------------------------------------------------------ the decision */

/** A legacy "sale unit": the app docs that together hold one hand-entered old plan. */
export interface SaleUnit {
  membership: Row | null;
  pt: Row | null;
  invoice: Row | null;
  /** Payments linked to these plans or this bill. */
  payments: Row[];
}

export interface CarryPlan {
  plan: OldPlan;
  kind: PlanKind;
  key: string;
  membership: D | null;
  pt: D | null;
  payment: D | null;
  bill: D | null;
  /** Sold-here plan ids this as-is plan overlaps: both sides get overlapOk marks. */
  overlapWith: string[];
}

export interface FixPlan extends CarryPlan {
  /** Existing ids to rewrite (kept when the shape matches, deleted when it doesn't). */
  membershipId: string | null;
  ptAssignmentId: string | null;
  /** Docs of the wrong shape to delete (snapshot first). */
  deleteMembershipId: string | null;
  deletePtId: string | null;
  invoiceId: string | null;
  /** What happens to the legacy bill. */
  billAction: "none" | "rewrite" | "create" | "delete";
  /** oldSoftware payments of the unit to delete (replaced by the one exact payment). */
  deletePaymentIds: string[];
  /** Keep the unit's existing old payments (sum already matches and staff set real modes). */
  keepPayments: boolean;
  /** Non-old payments whose invoiceId must point at the kept/created bill. */
  repointPaymentIds: string[];
  paidHere: number;
  /** The hand-entry was ended on purpose (a renewal here): keep it ended, stamped. */
  keepEnded: { status: string; endedBy: string } | null;
}

export interface RecycleSale {
  membershipId: string | null;
  ptAssignmentId: string | null;
  reason: string;
}

export interface MemberPlanResult {
  /** null → create this member (case 1 / first-visit carry). */
  clientId: string | null;
  client: { draft: D; desiredCode: string | null } | null;
  old: { memberId: string; name: string };
  carries: CarryPlan[];
  fixes: FixPlan[];
  recycles: RecycleSale[];
  was: string[];
  now: string[];
}

export interface Skip {
  who: string;
  what: string;
  reason: string;
}

export interface MigrateInput {
  today: string;
  phoneKey: string;
  oldMembers: OldMember[];
  /** Clients on this phone or linked to these old member ids, with their docs. */
  clients: Row[];
  memberships: Row[];
  ptAssignments: Row[];
  invoices: Row[];
  payments: Row[];
  /** "running": carry only plans running today (the bulk run). "latest": also the latest ended plan (first visit). */
  scope: "running" | "latest";
  /** Only this old member (single-member carry), "" = all on the phone. */
  onlyOldMemberId?: string;
}

export interface MigrateResult {
  members: MemberPlanResult[];
  skips: Skip[];
}

const isCancelled = (d: D) => String(d["status"]) === "cancelled" || !!d["cancelId"];
const money = (v: unknown) => Number(v ?? 0) || 0;
const tsMs = (v: unknown) =>
  v && typeof (v as { toMillis?: () => number }).toMillis === "function"
    ? (v as { toMillis: () => number }).toMillis()
    : NaN;
/**
 * A hand-entry that is expired/completed because a renewal ENDED it (endedBy stamp, or the
 * older style: its updatedAt equals the renewal's createdAt — the same write). Fixing its dates
 * must not bring it back to life.
 */
export function endedOnPurpose(
  row: Row,
  siblings: Row[],
): { status: string; endedBy: string } | null {
  const st = String(row.data["status"] ?? "");
  if (!["expired", "completed"].includes(st)) return null;
  const by = String(row.data["endedBy"] ?? "");
  if (by) return { status: st, endedBy: by };
  const up = tsMs(row.data["updatedAt"]);
  const sib = Number.isFinite(up)
    ? siblings.find((o) => o.id !== row.id && tsMs(o.data["createdAt"]) === up)
    : null;
  return sib ? { status: st, endedBy: sib.id } : null;
}

/** Client draft for a member who only exists in the old software (case 1). */
export function clientDraft(
  m: OldMember,
  phoneKey: string,
): { draft: D; desiredCode: string | null } {
  const code =
    /^\d{1,4}$/.test(m.memberId) && Number(m.memberId) >= 1 && Number(m.memberId) <= 8999
      ? String(Number(m.memberId))
      : null;
  return {
    desiredCode: code,
    draft: {
      fullName: tidyName(m.name),
      phone: phoneKey,
      phoneNormalized: phoneKey,
      email: m.email || "",
      gender: m.gender,
      dateOfBirth: m.dob || "",
      joinedOn: oldJoinedOn(m),
      address: m.address || "",
      oldMemberId: m.memberId,
      status: "active",
      biometricUserId: "",
      biometricDeviceId: "",
      biometricStatus: "not_enrolled",
      firstThumbRegistered: false,
      enrollmentId: "",
      whatsappOptIn: true,
      whatsappPhone: phoneKey,
      whatsappStatus: "ready",
      lastWhatsappMessageAt: null,
      inquiryId: null,
      currentMembership: null,
    },
  };
}

/** Does this app plan (gym or pt row) look like a hand-entered copy of old plan p? */
export function datesMatch(d: D, p: OldPlan) {
  const s = String(d["startDate"] ?? "");
  const e = String(d["endDate"] ?? "");
  if (!DAY.test(s) || !DAY.test(p.start)) return false;
  if (dayGap(s, p.start) <= 10) return true;
  if (DAY.test(e) && DAY.test(p.end) && dayGap(e, p.end) <= 10) return true;
  // Big overlap also counts (wrong dates typed, same stretch).
  if (DAY.test(e) && DAY.test(p.end)) {
    const lo = s > p.start ? s : p.start;
    const hi = e < p.end ? e : p.end;
    const shared = daysIncl(lo, hi);
    const len = Math.max(1, daysIncl(p.start, p.end));
    if (shared / len >= 0.6) return true;
  }
  return false;
}

/** Group a client's plans into sale units (a gym plan + the PT sold with it + their bill). */
export function saleUnits(
  memberships: Row[],
  ptAssignments: Row[],
  invoices: Row[],
  payments: Row[],
): SaleUnit[] {
  const used = new Set<string>();
  const units: SaleUnit[] = [];
  const billOf = (id: string) => invoices.find((i) => i.id === id) ?? null;
  const payFor = (mId: string | null, pId: string | null, invId: string | null) =>
    payments.filter(
      (p) =>
        (mId && p.data["membershipId"] === mId) ||
        (pId && p.data["ptAssignmentId"] === pId) ||
        (invId && p.data["invoiceId"] === invId),
    );
  for (const m of memberships) {
    const enr = String(m.data["enrollmentId"] ?? "");
    const inv = String(m.data["invoiceId"] ?? "");
    const pt =
      ptAssignments.find(
        (p) =>
          !used.has(`pt:${p.id}`) &&
          ((enr && p.data["enrollmentId"] === enr) ||
            (inv && p.data["invoiceId"] === inv) ||
            payments.some(
              (x) => x.data["membershipId"] === m.id && x.data["ptAssignmentId"] === p.id,
            )),
      ) ?? null;
    if (pt) used.add(`pt:${pt.id}`);
    used.add(`m:${m.id}`);
    const invoice = inv ? billOf(inv) : null;
    units.push({ membership: m, pt, invoice, payments: payFor(m.id, pt?.id ?? null, inv || null) });
  }
  for (const p of ptAssignments) {
    if (used.has(`pt:${p.id}`)) continue;
    const inv = String(p.data["invoiceId"] ?? "");
    units.push({
      membership: null,
      pt: p,
      invoice: inv ? billOf(inv) : null,
      payments: payFor(null, p.id, inv || null),
    });
  }
  return units;
}

const unitLabel = (u: SaleUnit) =>
  [
    u.membership ? String(u.membership.data["packageNameSnapshot"] ?? "plan") : "",
    u.pt ? `PT: ${String(u.pt.data["ptPackageNameSnapshot"] ?? "PT")}` : "",
  ]
    .filter(Boolean)
    .join(" + ");

const planWord = (p: OldPlan) =>
  `${p.name} ${p.start}→${p.end} ₹${p.amount}${p.balance > 0 ? ` (₹${p.balance} due)` : ""}`;

/**
 * The whole decision for one phone record. Pure; the server executes `members` in per-member
 * transactions and lists `skips` on the owner page.
 */
export function planMigration(input: MigrateInput): MigrateResult {
  const { today, phoneKey } = input;
  const skips: Skip[] = [];
  const members: MemberPlanResult[] = [];
  const olds = input.oldMembers.filter(
    (m) => !input.onlyOldMemberId || m.memberId === input.onlyOldMemberId,
  );
  const claimedClients = new Set<string>();

  for (const m of olds) {
    const client = matchClient(
      input.clients.filter((c) => !claimedClients.has(c.id)),
      m,
    );
    if (client) claimedClients.add(client.id);
    const my = (rows: Row[]) => rows.filter((r) => r.data["clientId"] === client?.id);
    const myMs = client ? my(input.memberships) : [];
    const myPts = client ? my(input.ptAssignments) : [];
    const myInvs = client ? my(input.invoices) : [];
    const myPays = client ? my(input.payments) : [];
    const units = saleUnits(myMs, myPts, myInvs, myPays);
    const consumed = new Set<SaleUnit>();

    const result: MemberPlanResult = {
      clientId: client?.id ?? null,
      client: client ? null : clientDraft(m, phoneKey),
      old: { memberId: m.memberId, name: m.name },
      carries: [],
      fixes: [],
      recycles: [],
      was: [],
      now: [],
    };

    // Newest old plan first (old-data sorts them that way already). The old software's export
    // sometimes holds the SAME subscription row more than once: one plan is one plan here.
    const seenKeys = new Set<string>();
    for (const p of m.plans) {
      const label = planWord(p);
      if (!DAY.test(p.start) || !DAY.test(p.end) || p.end < p.start) {
        skips.push({
          who: m.name,
          what: label,
          reason: "dates missing in the old record — staff add it by hand",
        });
        continue;
      }
      const key = asIsKey(m.memberId, p);
      if (seenKeys.has(key)) continue; // a duplicated export row, not a second plan
      seenKeys.add(key);
      const carriedAlready =
        myMs.some((r) => r.data["oldPlanKey"] === key) ||
        myPts.some((r) => r.data["oldPlanKey"] === key);
      if (carriedAlready) continue; // carried once, nothing to do

      const kind = oldPlanKind(p.name);
      // Running today, or paid in advance and starting later: both are live money and come over.
      const liveNow = p.end >= today && !/inactive/i.test(p.status);

      // Hand-entered copies of this old plan: old-marked units whose dates fit.
      const matches = units.filter(
        (u) =>
          !consumed.has(u) &&
          (u.membership ?? u.pt) &&
          [u.membership, u.pt].some(
            (r) =>
              r &&
              r.data["paidInOldSoftware"] === true &&
              !r.data["oldPlanAsIs"] &&
              datesMatch(r.data, p),
          ),
      );
      // Unpaid non-old copies (typed as a sale, nothing paid): safe duplicates.
      const unpaidCopies = units.filter(
        (u) =>
          !consumed.has(u) &&
          !matches.includes(u) &&
          (u.membership ?? u.pt) &&
          ![u.membership, u.pt].some(
            (r) => r && (r.data["paidInOldSoftware"] === true || r.data["oldPlanAsIs"]),
          ) &&
          [u.membership, u.pt].some(
            (r) =>
              r &&
              datesMatch(r.data, p) &&
              dayGap(String(r.data["startDate"]), p.start) <= 10 &&
              DAY.test(String(r.data["endDate"] ?? "")) &&
              dayGap(String(r.data["endDate"]), p.end) <= 10,
          ) &&
          u.payments.length === 0 &&
          money(u.invoice?.data["amountPaid"]) === 0,
      );

      const skipUnit = (u: SaleUnit, why: string) => {
        consumed.add(u);
        skips.push({ who: m.name, what: `${unitLabel(u)} ↔ ${label}`, reason: why });
      };

      // Pick the unit to fix: nearest start.
      const sorted = matches.sort((a, b) => {
        const s = (u: SaleUnit) => String((u.membership ?? u.pt)!.data["startDate"] ?? "9999");
        return dayGap(s(a), p.start) - dayGap(s(b), p.start);
      });
      let fixed = false;
      // The old plan is in the app but can't be fixed by rule (upgraded, refunds, money that
      // doesn't fit): leave it AND don't carry a fresh copy next to it.
      let blocked = false;
      for (const u of sorted) {
        const rows = [u.membership, u.pt].filter(Boolean) as Row[];
        // Cancelled here = staff undid the entry; the old plan is NOT active in the app, so a
        // fresh carry is right. Everything else blocks the carry.
        if (rows.some((r) => isCancelled(r.data))) {
          skipUnit(u, "cancelled here — owner decides");
          continue;
        }
        const oldPays = u.payments.filter((x) => x.data["oldSoftware"] === true);
        const herePays = u.payments.filter((x) => x.data["oldSoftware"] !== true);
        if (fixed) {
          // A second copy of the same old plan.
          if (herePays.length)
            skipUnit(u, "a copy, but money was taken here on it — owner decides");
          else {
            consumed.add(u);
            result.recycles.push({
              membershipId: u.membership?.id ?? null,
              ptAssignmentId: u.pt?.id ?? null,
              reason: `copy of ${label}`,
            });
            result.was.push(`${unitLabel(u)} (copy)`);
            result.now.push("moved to the Recycle Bin");
          }
          continue;
        }
        if (rows.some((r) => r.data["upgradedTo"])) {
          skipUnit(u, "upgraded here — owner decides");
          blocked = true;
          continue;
        }
        if (herePays.some((x) => money(x.data["amount"]) < 0)) {
          skipUnit(u, "a refund was given here — owner decides");
          blocked = true;
          continue;
        }
        if (
          herePays.some(
            (x) => x.data["invoiceId"] && (!u.invoice || x.data["invoiceId"] !== u.invoice.id),
          )
        ) {
          skipUnit(u, "money taken here sits on another bill — owner decides");
          blocked = true;
          continue;
        }
        const paidHere = herePays.reduce((s, x) => s + money(x.data["amount"]), 0);
        const balance = oldBalanceOf(p);
        if (paidHere > balance) {
          skipUnit(
            u,
            `₹${paidHere} was collected here but the old record's balance is ₹${balance} — owner decides`,
          );
          blocked = true;
          continue;
        }
        {
          consumed.add(u);
          const oldSum = oldPays.reduce((s, x) => s + money(x.data["amount"]), 0);
          const keepPayments =
            oldSum === oldPaidOf(p) &&
            oldPays.length > 0 &&
            oldPays.every((x) => DAY.test(String(x.data["paymentDate"] ?? ""))) &&
            oldPays.some(
              (x) =>
                (x.data["edits"] as unknown[] | undefined)?.length ||
                !["Other", NOT_RECORDED, ""].includes(String(x.data["method"] ?? "")),
            );
          const wantM = kind !== "pt";
          const wantP = kind !== "gym";
          const bill = asIsBill(p, paidHere);
          const fix: FixPlan = {
            plan: p,
            kind,
            key,
            membership: wantM ? asIsMembership(m, p, today) : null,
            pt: wantP ? asIsPt(m, p, today) : null,
            payment: keepPayments ? null : asIsPayment(p),
            bill,
            overlapWith: [],
            membershipId: wantM ? (u.membership?.id ?? null) : null,
            ptAssignmentId: wantP ? (u.pt?.id ?? null) : null,
            deleteMembershipId: !wantM && u.membership ? u.membership.id : null,
            deletePtId: !wantP && u.pt ? u.pt.id : null,
            invoiceId: u.invoice?.id ?? null,
            billAction: bill
              ? u.invoice
                ? "rewrite"
                : "create"
              : u.invoice
                ? herePays.length
                  ? "rewrite" // keep the bill for the money taken here, due 0
                  : "delete"
                : "none",
            deletePaymentIds: keepPayments ? [] : oldPays.map((x) => x.id),
            keepPayments,
            repointPaymentIds: herePays.map((x) => x.id),
            paidHere,
            keepEnded: endedOnPurpose((u.membership ?? u.pt)!, [...myMs, ...myPts]),
          };
          // A plan whose membership stays must keep running-state stamps (endedBy means a
          // renewal here already ended it — keep it ended).
          result.fixes.push(fix);
          result.was.push(`${unitLabel(u)} (hand-entered)`);
          result.now.push(`${planWord(p)} — exact from the old software`);
          fixed = true;
        }
      }
      for (const u of unpaidCopies) {
        if (!fixed) break; // nothing confirmed this old plan is in the app; don't guess
        consumed.add(u);
        result.recycles.push({
          membershipId: u.membership?.id ?? null,
          ptAssignmentId: u.pt?.id ?? null,
          reason: `unpaid copy of ${label}`,
        });
        result.was.push(`${unitLabel(u)} (unpaid copy)`);
        result.now.push("moved to the Recycle Bin");
      }

      if (fixed || blocked) continue;

      // An old-marked hand-entry that fits NO old plan (October's mistake): carrying this plan
      // beside it could count the same old money twice, so the owner clears it first.
      const doubtful = units.filter(
        (u) =>
          !consumed.has(u) &&
          [u.membership, u.pt].some(
            (r) =>
              r &&
              r.data["paidInOldSoftware"] === true &&
              !r.data["oldPlanAsIs"] &&
              !isCancelled(r.data),
          ) &&
          !m.plans.some(
            (q) =>
              DAY.test(q.start) &&
              DAY.test(q.end) &&
              [u.membership, u.pt].some((r) => r && datesMatch(r.data, q)),
          ),
      );
      if (doubtful.length && (liveNow || input.scope === "latest")) {
        skips.push({
          who: m.name,
          what: planWord(p),
          reason:
            "not carried yet: a plan here is saved as paid in the old software but its records have no such plan — clear that first (owner decides)",
        });
        continue;
      }

      // Not in the app yet: carry it when it is live (bulk) or it is the latest plan (first visit).
      const isLatest = m.plans[0] === p;
      if (liveNow || (input.scope === "latest" && isLatest)) {
        // A sold-here plan covering any of the same days: never touched; the as-is plan is
        // created with overlapOk marks so the owner's overlap list stays quiet.
        const sharesDays = (d: D) => {
          const s = String(d["startDate"] ?? "");
          const e = String(d["endDate"] ?? "");
          return DAY.test(s) && DAY.test(e) && s <= p.end && e >= p.start;
        };
        const overlapWith = units
          .filter((u) => !consumed.has(u))
          .flatMap((u) => [u.membership, u.pt].filter(Boolean) as Row[])
          .filter((r) => !r.data["paidInOldSoftware"] && !isCancelled(r.data) && sharesDays(r.data))
          .map((r) => r.id);
        result.carries.push({
          plan: p,
          kind,
          key,
          membership: kind !== "pt" ? asIsMembership(m, p, today) : null,
          pt: kind !== "gym" ? asIsPt(m, p, today) : null,
          payment: asIsPayment(p),
          bill: asIsBill(p),
          overlapWith,
        });
        result.was.push(client ? `${planWord(p)} — only in the old software` : `not in the app`);
        result.now.push(
          `${planWord(p)} — carried as-is${overlapWith.length ? " (runs alongside a plan sold here)" : ""}`,
        );
      } else if (!liveNow && input.scope === "running" && isLatest && !client) {
        skips.push({
          who: m.name,
          what: label,
          reason: "plan already ended — added on their first visit",
        });
      }
    }

    // Old-marked plans that match NO old plan: likely new money ticked as old (October's case).
    for (const u of units) {
      if (consumed.has(u)) continue;
      const rows = [u.membership, u.pt].filter(Boolean) as Row[];
      const legacy = rows.filter(
        (r) => r.data["paidInOldSoftware"] === true && !r.data["oldPlanAsIs"],
      );
      if (!legacy.length) continue;
      if (!client) continue;
      skips.push({
        who: m.name,
        what: unitLabel(u),
        reason:
          "saved as paid in the old software, but the old records have no such plan (likely money paid here) — owner decides",
      });
    }

    const changes = result.carries.length + result.fixes.length + result.recycles.length;
    if (!client && !result.carries.length) {
      // Nothing to create now (ended plans only).
      continue;
    }
    if (changes > 0 || (!client && result.carries.length)) members.push(result);
  }

  return { members, skips };
}
