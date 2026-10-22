import { useAccess } from "@/hooks/use-access";
import { useLive } from "@/hooks/use-live-query";
import { subscribeNewFeedback } from "@/services/feedback.service";
import type { Feedback } from "@/types/models";

/** Menu badge for logins with "Member feedback": messages from members nobody has dealt with. */
export function useFeedbackBadge() {
  const { can } = useAccess();
  const allowed = can("feedback");
  return useLive<Feedback[]>(allowed ? subscribeNewFeedback : null, [], [allowed]).data.length;
}
