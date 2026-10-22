/**
 * "Bring a friend" in the member app (src/lib/referrals.ts): how many friends joined through this
 * member and the rewards the gym decided. Comes inside /api/portal/me; the share text is made on
 * the phone. Rewards still waiting for a decision (and "No reward") are never shown.
 */
import type { PortalReferrals } from "@/constants/portal";
import { memberReferralSummary } from "@/lib/referrals";
import { REFERRAL_STATUSES, type ReferralReward, type ReferralStatus } from "@/types/models";
import { db } from "./admin";
import { s } from "./portal-common";

const toReward = (v: unknown): ReferralReward | null => {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  return {
    kind: r["kind"] as ReferralReward["kind"],
    days: Number(r["days"]) || 0,
    amount: Number(r["amount"]) || 0,
    note: s(r["note"]),
  };
};

export async function memberReferrals(clientId: string): Promise<PortalReferrals> {
  const snap = await db()
    .collection("referrals")
    .where("referrerId", "==", clientId)
    .limit(50)
    .get();
  return memberReferralSummary(
    snap.docs.map((d) => {
      const r = d.data();
      const status = (REFERRAL_STATUSES as readonly unknown[]).includes(r["status"])
        ? (r["status"] as ReferralStatus)
        : "due";
      return {
        newClientName: s(r["newClientName"]),
        status,
        reward: toReward(r["reward"]),
        givenOn: s(r["givenOn"]),
        joinedOn: s(r["joinedOn"]),
      };
    }),
  );
}
