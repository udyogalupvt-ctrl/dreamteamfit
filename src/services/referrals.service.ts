/**
 * Referral rewards (src/lib/referrals.ts). referrals/{newClientId} is written together with the
 * new member (createClient / enrollMember) when a member referred them; logins with "Referral
 * rewards" decide and record the reward here. Lists sort on the phone, so no index is needed.
 */
import {
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  type DocumentData,
  type Transaction,
} from "@/lib/firestore";
import { auth, db } from "@/lib/firebase";
import { todayISO } from "@/lib/format";
import {
  canChangeReferrer,
  REFERRAL_STATUS_LABELS,
  referralFor,
  referrerProblem,
  type RewardDecision,
} from "@/lib/referrals";
import { subscribeQuery, toDate } from "./firestore.service";
import {
  REFERRAL_STATUSES,
  REWARD_KIND_KEYS,
  type Referral,
  type ReferralReward,
  type ReferralStatus,
  type ReferredBy,
} from "@/types/models";

const col = () => collection(db, "referrals");
const ref = (id: string) => doc(db, "referrals", id);
const who = () => auth.currentUser?.displayName || auth.currentUser?.email || "Staff";
const when = (v: unknown) => (v ? toDate(v) : null);

const toReward = (v: unknown): ReferralReward | null => {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  return {
    kind: (REWARD_KIND_KEYS as readonly unknown[]).includes(r["kind"])
      ? (r["kind"] as ReferralReward["kind"])
      : "other",
    days: Number(r["days"]) || 0,
    amount: Number(r["amount"]) || 0,
    note: String(r["note"] ?? ""),
  };
};

export const toReferral = (id: string, d: DocumentData): Referral => ({
  id,
  referrerId: String(d["referrerId"] ?? ""),
  referrerName: String(d["referrerName"] ?? ""),
  referrerCode: String(d["referrerCode"] ?? ""),
  newClientId: String(d["newClientId"] ?? id),
  newClientName: String(d["newClientName"] ?? ""),
  newClientCode: String(d["newClientCode"] ?? ""),
  joinedOn: String(d["joinedOn"] ?? ""),
  status: (REFERRAL_STATUSES as readonly unknown[]).includes(d["status"])
    ? (d["status"] as ReferralStatus)
    : "due",
  reward: toReward(d["reward"]),
  reason: String(d["reason"] ?? ""),
  decidedBy: String(d["decidedBy"] ?? ""),
  decidedAt: when(d["decidedAt"]),
  givenOn: String(d["givenOn"] ?? ""),
  createdAt: when(d["createdAt"]),
  updatedAt: when(d["updatedAt"]),
});

type Live = (items: Referral[]) => void;
const oldestFirst = (items: Referral[]) =>
  [...items].sort((a, b) => a.joinedOn.localeCompare(b.joinedOn) || a.id.localeCompare(b.id));
const newestFirst = (key: "joinedOn" | "givenOn") => (items: Referral[]) =>
  [...items].sort((a, b) => b[key].localeCompare(a[key]) || a.id.localeCompare(b.id));

/** Due / promised to-do lists (and the sidebar badge): the friend who has waited longest first. */
export function subscribeReferralsByStatus(
  status: ReferralStatus,
  onData: Live,
  onError: (e: Error) => void,
) {
  return subscribeQuery(
    query(col(), where("status", "==", status), limit(500)),
    toReferral,
    (items) => onData(oldestFirst(items)),
    onError,
  );
}

/** By a YYYY-MM-DD field; "All dates" (0000 … 9999) leaves the open end out. */
function subscribeBetween(
  field: "joinedOn" | "givenOn",
  from: string,
  to: string,
  onData: Live,
  onError: (e: Error) => void,
) {
  const range = [
    ...(from > "2000" ? [where(field, ">=", from)] : []),
    ...(to < "9000" ? [where(field, "<=", to)] : []),
  ];
  // "Given" with no dates still needs the field set: given rewards carry a day, others "".
  if (field === "givenOn" && !range.length) range.push(where("givenOn", ">", ""));
  return subscribeQuery(
    query(col(), ...range, limit(1000)),
    toReferral,
    (items) => onData(newestFirst(field)(items)),
    onError,
  );
}

export const subscribeReferralsGivenBetween = (
  from: string,
  to: string,
  onData: Live,
  onError: (e: Error) => void,
) => subscribeBetween("givenOn", from, to, onData, onError);

export const subscribeReferralsJoinedBetween = (
  from: string,
  to: string,
  onData: Live,
  onError: (e: Error) => void,
) => subscribeBetween("joinedOn", from, to, onData, onError);

/** Friends one member brought (their profile). */
export function subscribeReferralsOf(
  referrerId: string,
  onData: Live,
  onError: (e: Error) => void,
) {
  return subscribeQuery(
    query(col(), where("referrerId", "==", referrerId), limit(200)),
    toReferral,
    (items) => onData(newestFirst("joinedOn")(items)),
    onError,
  );
}

/** The referral that brought this member (null = nobody referred them). */
export function subscribeReferral(
  newClientId: string,
  onData: (r: Referral | null) => void,
  onError: (e: Error) => void,
) {
  return onSnapshot(
    ref(newClientId),
    (s) => onData(s.exists() ? toReferral(s.id, s.data()) : null),
    onError,
  );
}

// ------------------------------------------------------------------ writes

/** The decided reward. Free days are added to the plan separately (Edit plan). */
export async function recordReward(r: Referral, d: RewardDecision) {
  await updateDoc(ref(r.id), {
    status: d.status,
    reward: d.reward,
    reason: d.reason,
    decidedBy: who(),
    decidedAt: serverTimestamp(),
    givenOn: d.status === "given" ? todayISO() : "",
    updatedAt: serverTimestamp(),
  });
}

/** A promised reward handed over (at the renewal desk or on Referrals). */
export async function markRewardGiven(r: Referral) {
  if (r.status !== "promised") throw new Error("Only a promised reward can be marked given.");
  await updateDoc(ref(r.id), {
    status: "given",
    givenOn: todayISO(),
    updatedAt: serverTimestamp(),
  });
}

/** Back to "Reward due": nothing decided (also how a referrer can be changed later). */
export async function reopenReferral(r: Referral) {
  await updateDoc(ref(r.id), {
    status: "due",
    reward: null,
    reason: "",
    decidedBy: "",
    decidedAt: null,
    givenOn: "",
    updatedAt: serverTimestamp(),
  });
}

/** Undo: the decision as it was before. */
export async function restoreReferral(prev: Referral) {
  await updateDoc(ref(prev.id), {
    status: prev.status,
    reward: prev.reward,
    reason: prev.reason,
    decidedBy: prev.decidedBy,
    decidedAt: prev.decidedAt,
    givenOn: prev.givenOn,
    updatedAt: serverTimestamp(),
  });
}

type NewMember = { id: string; fullName: string; clientCode: string; joinedOn: string };

/** Inside the transaction that adds a member: their referral, reward due. */
export function writeNewReferral(tx: Transaction, m: NewMember, by: ReferredBy | null | undefined) {
  if (!by || referrerProblem(m.id, by)) return;
  tx.set(ref(m.id), {
    ...referralFor(m, by, todayISO()),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Sets, changes or removes who referred a member (their profile's Edit details). The referral
 * follows while its reward is still due; once decided, it has to be reopened on Referrals first.
 */
export async function setReferredBy(clientId: string, by: ReferredBy | null) {
  const problem = referrerProblem(clientId, by);
  if (problem) throw new Error(problem);
  await runTransaction(db, async (tx) => {
    const cRef = doc(db, "clients", clientId);
    const cSnap = await tx.get(cRef);
    const rSnap = await tx.get(ref(clientId));
    if (!cSnap.exists()) throw new Error("This member was deleted.");
    const c = cSnap.data();
    const current = rSnap.exists() ? toReferral(rSnap.id, rSnap.data()) : null;
    const before = (c["referredBy"] ?? null) as ReferredBy | null;
    const target = by?.clientId ?? "";
    if ((before?.clientId ?? "") === target && (current?.referrerId ?? "") === target) return;
    if (current && current.referrerId !== target && !canChangeReferrer(current))
      throw new Error(
        `${current.referrerName}'s reward for this member is already decided (${REFERRAL_STATUS_LABELS[current.status]}). Reopen it on Referrals first.`,
      );
    tx.update(cRef, { referredBy: by, updatedAt: serverTimestamp() });
    if (!by) {
      if (current) tx.delete(ref(clientId));
      return;
    }
    if (current)
      tx.update(ref(clientId), {
        referrerId: by.clientId,
        referrerName: by.name,
        referrerCode: by.memberCode,
        newClientName: String(c["fullName"] ?? ""),
        newClientCode: String(c["clientCode"] ?? ""),
        updatedAt: serverTimestamp(),
      });
    else
      writeNewReferral(
        tx,
        {
          id: clientId,
          fullName: String(c["fullName"] ?? ""),
          clientCode: String(c["clientCode"] ?? ""),
          joinedOn: typeof c["joinedOn"] === "string" ? c["joinedOn"] : "",
        },
        by,
      );
  });
}
