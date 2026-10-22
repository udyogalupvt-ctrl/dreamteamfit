/**
 * Referral rewards (spec D): a member who brings a friend gets a reward the owner decides (free
 * days, money off, a gift). One referrals/{newClientId} doc per friend who joined. Nothing is
 * applied by itself: free days are added with Edit plan, money off at the next bill.
 */
import type {
  Referral,
  ReferralReward,
  ReferralStatus,
  ReferredBy,
  RewardKind,
} from "../types/models";

export const REWARD_KINDS: { key: RewardKind; label: string }[] = [
  { key: "free_days", label: "Free days" },
  { key: "discount", label: "Money off" },
  { key: "gift", label: "Gift" },
  { key: "other", label: "Other" },
];

export const REFERRAL_STATUS_LABELS: Record<ReferralStatus, string> = {
  due: "Reward due",
  promised: "Promised",
  given: "Given",
  skipped: "No reward",
};

export const REFERRAL_LIMITS = { note: 200, reason: 200, days: 365, amount: 100000 } as const;

/** "7 free days", "₹500 off (at renewal)", "Gift: T-shirt", or the note for "Other". */
export function rewardLabel(r: ReferralReward | null): string {
  if (!r) return "";
  const note = r.note.trim();
  if (r.kind === "gift") return `Gift: ${note}`;
  if (r.kind === "other") return note;
  const main =
    r.kind === "free_days"
      ? `${r.days} free day${r.days === 1 ? "" : "s"}`
      : `₹${r.amount.toLocaleString("en-IN")} off`;
  return note ? `${main} (${note})` : main;
}

/** given = handed over now · promised = at their next renewal · skipped = no reward (say why). */
export type RewardOutcome = "given" | "promised" | "skipped";

export interface RewardInput {
  outcome: RewardOutcome;
  kind: RewardKind;
  days: string | number;
  amount: string | number;
  note: string;
  reason: string;
}

export type RewardDecision =
  | { status: "given" | "promised"; reward: ReferralReward; reason: "" }
  | { status: "skipped"; reward: null; reason: string };

const wholeNumber = (v: string | number) => {
  const s = String(v).trim();
  return /^\d+$/.test(s) ? Number(s) : NaN;
};

/** The reward form, checked and tidied; a sentence for the desk when something is missing. */
export function decideReward(x: RewardInput): { error: string } | { decision: RewardDecision } {
  const note = x.note.trim();
  if (x.outcome === "skipped") {
    const reason = x.reason.trim();
    if (!reason) return { error: "Say why there's no reward." };
    if (reason.length > REFERRAL_LIMITS.reason)
      return { error: `Keep the reason under ${REFERRAL_LIMITS.reason} characters.` };
    return { decision: { status: "skipped", reward: null, reason } };
  }
  if (note.length > REFERRAL_LIMITS.note)
    return { error: `Keep the note under ${REFERRAL_LIMITS.note} characters.` };
  let days = 0;
  let amount = 0;
  if (x.kind === "free_days") {
    days = wholeNumber(x.days);
    if (!(days >= 1 && days <= REFERRAL_LIMITS.days))
      return { error: `Free days must be a whole number from 1 to ${REFERRAL_LIMITS.days}.` };
  } else if (x.kind === "discount") {
    amount = wholeNumber(x.amount);
    if (!(amount >= 1 && amount <= REFERRAL_LIMITS.amount))
      return { error: "Money off must be a whole number of rupees, 1 or more." };
  } else if (!note) {
    return { error: x.kind === "gift" ? "Say what the gift is." : "Describe the reward." };
  }
  return {
    decision: { status: x.outcome, reward: { kind: x.kind, days, amount, note }, reason: "" },
  };
}

/** A stored referredBy field (client or lead), or null when there's no usable referrer. */
export function toReferredBy(v: unknown): ReferredBy | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o["clientId"] !== "string" || !o["clientId"]) return null;
  return {
    clientId: o["clientId"],
    name: String(o["name"] ?? ""),
    memberCode: String(o["memberCode"] ?? ""),
  };
}

/** The referrer can be changed or removed only while nothing has been decided. */
export const canChangeReferrer = (r: Pick<Referral, "status"> | null) => !r || r.status === "due";

export function referrerProblem(newClientId: string, by: ReferredBy | null): string {
  if (!by) return "";
  if (!by.clientId) return "Pick the member who referred them.";
  if (by.clientId === newClientId) return "A member can't refer themselves.";
  return "";
}

type NewMember = { id: string; fullName: string; clientCode: string; joinedOn: string };

/** A new referrals/{member id} doc (without timestamps): reward due, nothing decided. */
export function referralFor(m: NewMember, by: ReferredBy, today: string) {
  return {
    referrerId: by.clientId,
    referrerName: by.name,
    referrerCode: by.memberCode,
    newClientId: m.id,
    newClientName: m.fullName,
    newClientCode: m.clientCode,
    joinedOn: m.joinedOn || today,
    status: "due" as ReferralStatus,
    reward: null,
    reason: "",
    decidedBy: "",
    decidedAt: null,
    givenOn: "",
  };
}

/** Member picker search: name contains, exact member ID, or 3+ phone digits. */
export function memberMatches(
  c: { fullName: string; clientCode: string; phone: string },
  q: string,
): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return false;
  if (c.fullName.toLowerCase().includes(s)) return true;
  if (c.clientCode && c.clientCode.toLowerCase() === s) return true;
  const digits = s.replace(/[\s+-]/g, "");
  return /^\d{3,}$/.test(digits) && c.phone.replace(/\D/g, "").includes(digits);
}

/** What a member sends a friend from the app. No reward promises: the owner decides those. */
export const shareText = (gymName: string, name: string, code: string) =>
  `I train at ${gymName}. Come and join me! When you join, tell them ${name}${code ? ` (member ID ${code})` : ""} sent you.`;

export const whatsappShareUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;

export interface MemberReferralSummary {
  count: number;
  rewards: { friend: string; label: string; status: "given" | "promised"; givenOn: string }[];
}

/** Member app: how many friends joined through them, and the rewards decided so far. */
export function memberReferralSummary(
  docs: Pick<Referral, "newClientName" | "status" | "reward" | "givenOn" | "joinedOn">[],
): MemberReferralSummary {
  const rewards = docs
    .filter((d) => (d.status === "given" || d.status === "promised") && d.reward)
    .sort((a, b) => b.joinedOn.localeCompare(a.joinedOn))
    .map((d) => ({
      friend: d.newClientName.trim().split(/\s+/)[0] ?? "",
      label: rewardLabel(d.reward),
      status: d.status as "given" | "promised",
      givenOn: d.givenOn,
    }));
  return { count: docs.length, rewards };
}
