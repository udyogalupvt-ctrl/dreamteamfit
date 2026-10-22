import { useAccess } from "@/hooks/use-access";
import { useLive } from "@/hooks/use-live-query";
import { subscribeReferralsByStatus } from "@/services/referrals.service";
import type { Referral } from "@/types/models";

const subscribeDue = (onData: (items: Referral[]) => void, onError: (e: Error) => void) =>
  subscribeReferralsByStatus("due", onData, onError);

/** Menu badge for logins with "Referral rewards": friends who joined with no reward decided yet. */
export function useReferralsBadge() {
  const { can } = useAccess();
  const allowed = can("referrals");
  return useLive<Referral[]>(allowed ? subscribeDue : null, [], [allowed]).data.length;
}
