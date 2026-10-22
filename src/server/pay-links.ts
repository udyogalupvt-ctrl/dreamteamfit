/**
 * UPI pay links (src/lib/pay-links.ts). Links are made and changed by the member side only here;
 * the desk confirms them from Billing (rules-checked, with the payment in the same transaction) or
 * says the money didn't come.
 *
 *   GET  /api/pay/<token>             anyone with the link: what to pay and how
 *   POST /api/pay/<token>             { action: "paid", utr }: the member says they paid
 *   GET  /api/pay/bill/<billToken>    the bill page: { on, amount, link }
 *   POST /api/pay/bill/<billToken>    the bill page's Pay button: { token }
 *   POST /api/portal/pay-link         member app: { kind: "balance", bill } | { kind: "renewal" }
 *
 * Amounts are worked out again on every visit: a bill's balance now, or the package price now with
 * the gym's tax. A link that has nothing left to collect closes itself.
 */
import {
  FieldValue,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import type { PortalPay, PortalPayLinkState, PublicPayLink } from "@/constants/portal";
import {
  CLOSED_TEXT,
  PAY_LIMITS,
  addDaysIso,
  cleanUtr,
  closeReason,
  isBillToken,
  isPayToken,
  newPayToken,
  paidRateOk,
  renewalAmount,
  renewalOffer,
  upiNote,
  upiUri,
  validateUpiSettings,
  type PayCloseReason,
  type PayLinkKind,
  type PayLinkStatus,
} from "@/lib/pay-links";
import { formatPrice } from "@/lib/format";
import { db, json, localDate } from "./admin";
import { appLog, bodyOf, liveMember, n, s } from "./portal-common";

type D = DocumentData;
const links = () => db().collection("payLinks");
const OFF = "Online payment is switched off. Please pay at the gym.";

/** The gym's UPI ID and name; null = online pay is off (or what is saved isn't valid). */
export async function upiSettings(): Promise<{ upiId: string; payeeName: string } | null> {
  const d = (await db().doc("settings/upi").get()).data() ?? {};
  const v = validateUpiSettings({ upiId: d["upiId"], payeeName: d["payeeName"] });
  return v.ok && v.upiId ? { upiId: v.upiId, payeeName: v.payeeName } : null;
}

/** What a bill still asks for; null = it can't take money (gone or refunded). */
function billOwedNow(inv: D | undefined): number | null {
  if (!inv || s(inv["paymentStatus"]) === "refunded") return null;
  return Math.max(0, n(inv["balanceDue"]));
}

async function billingTax() {
  const g = (await db().doc("settings/business").get()).data() ?? {};
  return { taxEnabled: Boolean(g["taxEnabled"]), taxRate: n(g["taxRate"]) };
}

/** A gym plan as renewalOffer reads it. */
export const planRow = (m: D) => ({
  packageId: s(m["packageId"]),
  startDate: s(m["startDate"]),
  endDate: s(m["endDate"]),
  status: s(m["status"]),
});

async function invoiceByToken(billToken: string) {
  const snap = await db()
    .collection("invoices")
    .where("publicToken", "==", billToken)
    .limit(1)
    .get();
  return snap.docs[0] ?? null;
}

/** The renewal on offer for this member now (null = renew at the gym). */
async function renewalNow(clientId: string, c: D, plans?: ReturnType<typeof planRow>[]) {
  const rows =
    plans ??
    (await db().collection("memberships").where("clientId", "==", clientId).get()).docs.map((d) =>
      planRow(d.data()),
    );
  const packageId = renewalOffer(rows, localDate());
  if (!packageId) return null;
  const [pkg, tax] = await Promise.all([db().doc(`packages/${packageId}`).get(), billingTax()]);
  const p = pkg.data();
  if (!p || p["isActive"] !== true || !(n(p["price"]) > 0)) return null;
  return {
    packageId,
    packageName: s(p["name"]),
    amount: renewalAmount(n(p["price"]), tax),
    planSeq: n(c["planSeq"]),
  };
}

const status = (l: D) => s(l["status"]) as PayLinkStatus;

/** A link for the same thing to use again: one waiting for the desk first, else an open one. */
function reusable(docs: QueryDocumentSnapshot[], match: (l: D) => boolean, today: string) {
  const live = docs.map((d) => ({ id: d.id, l: d.data() })).filter(({ l }) => match(l));
  return (
    live.find(({ l }) => status(l) === "member_paid") ??
    live.find(({ l }) => status(l) === "open" && s(l["expiresOn"]) >= today) ??
    null
  );
}

const stateOf = (id: string, l: D): PortalPayLinkState => ({
  token: id,
  status: status(l) === "member_paid" ? "member_paid" : "open",
  deskNote: s(l["deskNote"]),
  memberAmount: n(l["memberAmount"]),
});

/** What the link asks for now, and why it should close ("" = it stays). */
async function freshen(
  l: D,
  today: string,
): Promise<{ amount: number; reason: PayCloseReason | "" }> {
  const link = {
    kind: s(l["kind"]) as PayLinkKind,
    status: status(l),
    expiresOn: s(l["expiresOn"]),
    planSeq: n(l["planSeq"]),
  };
  if (link.kind === "balance") {
    const owed = billOwedNow(
      (
        await db()
          .doc(`invoices/${s(l["invoiceId"])}`)
          .get()
      ).data(),
    );
    return { amount: owed ?? 0, reason: closeReason(link, { today, billOwed: owed }) };
  }
  const [pkg, client, tax] = await Promise.all([
    db()
      .doc(`packages/${s(l["packageId"])}`)
      .get(),
    db()
      .doc(`clients/${s(l["clientId"])}`)
      .get(),
    billingTax(),
  ]);
  const p = pkg.data();
  const sold = !!p && p["isActive"] === true && n(p["price"]) > 0;
  return {
    amount: sold ? renewalAmount(n(p["price"]), tax) : 0,
    reason: closeReason(link, {
      today,
      packageSold: sold && client.exists,
      planSeq: n(client.data()?.["planSeq"]),
    }),
  };
}

/** Brings an open link up to date (amount, or closed). Returns the link as it is now. */
async function refresh(token: string, l: D, today: string): Promise<D> {
  if (status(l) !== "open") return l;
  const fresh = await freshen(l, today);
  const patch: D | null = fresh.reason
    ? { status: "cancelled", closedReason: fresh.reason }
    : fresh.amount !== n(l["amount"])
      ? { amount: fresh.amount }
      : null;
  if (!patch) return l;
  const ref = links().doc(token);
  const changed = await db().runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    if (status(cur.data() ?? {}) !== "open") return false;
    tx.update(ref, { ...patch, updatedAt: FieldValue.serverTimestamp() });
    return true;
  });
  return changed ? { ...l, ...patch } : ((await ref.get()).data() ?? l);
}

async function newLink(fields: {
  clientId: string;
  clientName: string;
  memberCode: string;
  kind: PayLinkKind;
  invoiceId: string;
  invoiceNumber: string;
  invoiceToken: string;
  packageId: string;
  packageName: string;
  planSeq: number;
  amount: number;
}) {
  const token = newPayToken();
  await links()
    .doc(token)
    .create({
      ...fields,
      status: "open",
      closedReason: "",
      utr: "",
      utrSeenBefore: false,
      memberAmount: 0,
      memberPaidAt: null,
      paidTimes: [],
      deskNote: "",
      paymentIds: [],
      saleBillId: "",
      checkedBy: "",
      checkedByUid: "",
      checkedAt: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      expiresOn: addDaysIso(localDate(), PAY_LIMITS.openDays),
    });
  return token;
}

/** A link for this bill's balance: the one already made, or a new one. */
async function ensureBalance(inv: QueryDocumentSnapshot): Promise<Response> {
  const i = inv.data();
  const owed = billOwedNow(i);
  if (!owed) return json({ error: "Nothing is left to pay on this bill." }, 409);
  if (!s(i["clientId"])) return json({ error: "Please pay this bill at the gym." }, 409);
  const today = localDate();
  const mine = await links().where("invoiceId", "==", inv.id).get();
  const found = reusable(mine.docs, (l) => s(l["kind"]) === "balance", today);
  if (found) {
    if (status(found.l) === "open" && n(found.l["amount"]) !== owed)
      await links().doc(found.id).update({ amount: owed, updatedAt: FieldValue.serverTimestamp() });
    return json({ token: found.id });
  }
  const c =
    (
      await db()
        .doc(`clients/${s(i["clientId"])}`)
        .get()
    ).data() ?? {};
  const token = await newLink({
    clientId: s(i["clientId"]),
    clientName: s(c["fullName"]) || s(i["clientNameSnapshot"]),
    memberCode: s(c["clientCode"]),
    kind: "balance",
    invoiceId: inv.id,
    invoiceNumber: s(i["invoiceNumber"]),
    invoiceToken: s(i["publicToken"]),
    packageId: "",
    packageName: "",
    planSeq: 0,
    amount: owed,
  });
  return json({ token });
}

/** A link to renew with the latest plan's package: the one already made, or a new one. */
async function ensureRenewal(clientId: string, c: D): Promise<Response> {
  const offer = await renewalNow(clientId, c);
  if (!offer)
    return json({ error: "Your plan can't be renewed online now. Please renew at the gym." }, 409);
  const mine = await links().where("clientId", "==", clientId).get();
  const found = reusable(
    mine.docs,
    (l) =>
      s(l["kind"]) === "renewal" &&
      s(l["packageId"]) === offer.packageId &&
      n(l["planSeq"]) === offer.planSeq,
    localDate(),
  );
  if (found) {
    if (status(found.l) === "open" && n(found.l["amount"]) !== offer.amount)
      await links()
        .doc(found.id)
        .update({ amount: offer.amount, updatedAt: FieldValue.serverTimestamp() });
    return json({ token: found.id });
  }
  const token = await newLink({
    clientId,
    clientName: s(c["fullName"]),
    memberCode: s(c["clientCode"]),
    kind: "renewal",
    invoiceId: "",
    invoiceNumber: "",
    invoiceToken: "",
    packageId: offer.packageId,
    packageName: offer.packageName,
    planSeq: offer.planSeq,
    amount: offer.amount,
  });
  return json({ token });
}

const noteFor = (l: D) =>
  s(l["kind"]) === "balance"
    ? upiNote([s(l["invoiceNumber"]), s(l["memberCode"])])
    : upiNote(["Renew", s(l["memberCode"]), s(l["packageName"])]);

const whatFor = (l: D) =>
  s(l["kind"]) === "balance"
    ? `bill ${s(l["invoiceNumber"])}`
    : `renewal (${s(l["packageName"]) || "plan"})`;

async function linkView(token: string): Promise<Response> {
  const snap = await links().doc(token).get();
  if (!snap.exists)
    return json(
      { error: "This payment link doesn't exist. Please ask the gym for a new one." },
      404,
    );
  const [l, upi, biz] = await Promise.all([
    refresh(token, snap.data() ?? {}, localDate()),
    upiSettings(),
    db().doc("settings/business").get(),
  ]);
  const st = status(l);
  const amount = st === "open" ? n(l["amount"]) : n(l["memberAmount"]) || n(l["amount"]);
  const reason = s(l["closedReason"]) as PayCloseReason;
  const out: PublicPayLink = {
    status: st,
    kind: s(l["kind"]) as PayLinkKind,
    on: !!upi,
    amount,
    gymName: s(biz.data()?.["businessName"]) || "Our gym",
    memberName: s(l["clientName"]).trim().split(/\s+/)[0] ?? "",
    invoiceNumber: s(l["invoiceNumber"]),
    billToken: s(l["invoiceToken"]),
    packageName: s(l["packageName"]),
    upiId: upi?.upiId ?? "",
    payeeName: upi?.payeeName ?? "",
    uri: upi && st === "open" ? upiUri({ ...upi, amount, note: noteFor(l) }) : "",
    utr: s(l["utr"]),
    deskNote: s(l["deskNote"]),
    closedText: st === "cancelled" ? (CLOSED_TEXT[reason] ?? CLOSED_TEXT.expired) : "",
  };
  return json(out);
}

/** The member says they paid: the desk sees it under Billing → Payments to confirm. */
async function markPaid(token: string, body: Record<string, unknown>): Promise<Response> {
  const utrCheck = cleanUtr(body["utr"]);
  if ("error" in utrCheck) return json({ error: utrCheck.error }, 400);
  const { utr } = utrCheck;
  if (!(await upiSettings())) return json({ error: OFF }, 409);
  const ref = links().doc(token);
  const snap = await ref.get();
  if (!snap.exists) return json({ error: "This payment link doesn't exist." }, 404);
  const l = await refresh(token, snap.data() ?? {}, localDate());
  if (status(l) !== "open") return linkView(token);
  const now = Date.now();
  const times = (Array.isArray(l["paidTimes"]) ? (l["paidTimes"] as unknown[]) : []).map(Number);
  if (!paidRateOk(times, now))
    return json({ error: "Too many tries today. Please contact the gym." }, 429);
  const seen = utr
    ? (await links().where("utr", "==", utr).limit(3).get()).docs.some((d) => d.id !== token)
    : false;
  const amount = n(l["amount"]);
  const ok = await db().runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    if (status(cur.data() ?? {}) !== "open") return false;
    tx.update(ref, {
      status: "member_paid",
      utr,
      utrSeenBefore: seen,
      memberAmount: amount,
      memberPaidAt: FieldValue.serverTimestamp(),
      paidTimes: [...times.filter((t) => now - t < 86_400_000), now],
      deskNote: "",
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
  if (ok)
    await appLog({
      collection: "payLinks",
      docId: token,
      summary: `Said they paid ${formatPrice(amount)} by UPI for ${whatFor(l)}${utr ? ` (ref ${utr})` : ""}`,
      actorName: s(l["clientName"]) || "Member",
      clientId: s(l["clientId"]),
      clientName: s(l["clientName"]),
    });
  return linkView(token);
}

async function billState(billToken: string): Promise<Response> {
  const [inv, upi] = await Promise.all([invoiceByToken(billToken), upiSettings()]);
  const owed = billOwedNow(inv?.data());
  if (!inv || !upi || !owed) return json({ on: false, amount: 0, link: null });
  const today = localDate();
  const mine = await links().where("invoiceId", "==", inv.id).get();
  const found = reusable(mine.docs, (l) => s(l["kind"]) === "balance", today);
  return json({ on: true, amount: owed, link: found ? stateOf(found.id, found.l) : null });
}

export async function handlePay(request: Request, url: URL): Promise<Response> {
  const parts = url.pathname.replace(/^\/api\/pay\//, "").split("/");
  if (parts[0] === "bill" && parts.length === 2) {
    const billToken = parts[1] ?? "";
    if (!isBillToken(billToken)) return json({ error: "Bill not found." }, 404);
    if (request.method === "GET") return billState(billToken);
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    if (!(await upiSettings())) return json({ error: OFF }, 409);
    const inv = await invoiceByToken(billToken);
    if (!inv) return json({ error: "Bill not found." }, 404);
    return ensureBalance(inv);
  }
  const token = parts.length === 1 ? (parts[0] ?? "") : "";
  if (!isPayToken(token)) return json({ error: "Not found." }, 404);
  if (request.method === "GET") return linkView(token);
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const body = await bodyOf(request);
  if (s(body["action"]) === "paid") return markPaid(token, body);
  return json({ error: "Unknown action." }, 400);
}

/** Member app: the Pay button on a bill, or Renew online. */
export async function memberPayLink(clientId: string, body: Record<string, unknown>) {
  const member = await liveMember(clientId);
  if (!member.ok) return member.response;
  if (!(await upiSettings())) return json({ error: OFF }, 409);
  const kind = s(body["kind"]);
  if (kind === "renewal") return ensureRenewal(clientId, member.data);
  if (kind !== "balance") return json({ error: "Unknown payment." }, 400);
  const bill = s(body["bill"]);
  const inv = isBillToken(bill) ? await invoiceByToken(bill) : null;
  if (!inv || s(inv.data()["clientId"]) !== clientId)
    return json({ error: "Bill not found." }, 404);
  return ensureBalance(inv);
}

/** What /me says about paying online. `plans` = the member's gym plans (planRow). */
export async function memberPay(
  clientId: string,
  c: D,
  x: { plans: ReturnType<typeof planRow>[]; openBills: { token: string }[] },
): Promise<PortalPay | null> {
  if (!(await upiSettings())) return null;
  const today = localDate();
  const [mine, offer] = await Promise.all([
    links().where("clientId", "==", clientId).get(),
    renewalNow(clientId, c, x.plans),
  ]);
  const bills: Record<string, PortalPayLinkState> = {};
  for (const b of x.openBills) {
    const found = reusable(
      mine.docs,
      (l) => s(l["kind"]) === "balance" && s(l["invoiceToken"]) === b.token,
      today,
    );
    if (found) bills[b.token] = stateOf(found.id, found.l);
  }
  const ren = offer
    ? reusable(
        mine.docs,
        (l) =>
          s(l["kind"]) === "renewal" &&
          s(l["packageId"]) === offer.packageId &&
          n(l["planSeq"]) === offer.planSeq,
        today,
      )
    : null;
  return {
    bills,
    renewal: offer
      ? {
          packageName: offer.packageName,
          amount: offer.amount,
          link: ren ? stateOf(ren.id, ren.l) : null,
        }
      : null,
  };
}
