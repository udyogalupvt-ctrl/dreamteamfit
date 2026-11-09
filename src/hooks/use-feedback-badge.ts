import { useAccess } from "@/hooks/use-access";
import { useLive } from "@/hooks/use-live-query";
import { subscribeNewAnonFeedback } from "@/services/anon-feedback.service";
import { subscribeNewFeedback } from "@/services/feedback.service";
import type { AnonFeedback, Feedback } from "@/types/models";

/** Menu badge for logins with "Member feedback": messages from members nobody has dealt with. */
export function useFeedbackBadge() {
  const { can } = useAccess();
  const allowed = can("feedback");
  return useLive<Feedback[]>(allowed ? subscribeNewFeedback : null, [], [allowed]).data.length;
}

/** Menu badge for the anonymous QR feedback inbox: messages nobody has dealt with. */
export function useAnonFeedbackBadge() {
  const { can } = useAccess();
  const allowed = can("feedback");
  return useLive<AnonFeedback[]>(allowed ? subscribeNewAnonFeedback : null, [], [allowed]).data
    .length;
}
