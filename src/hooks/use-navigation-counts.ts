import { useMemo } from "react";
import { useLive } from "@/hooks/use-live-query";
import { todayISO } from "@/lib/format";
import { subscribeOpenInquiries } from "@/services/inquiries.service";
import { subscribeDueFollowUps } from "@/services/followups.service";
import type { FollowUp, Inquiry } from "@/types/models";

/** Live sidebar counters: only open leads and calls due are loaded, not every lead ever. */
export function useNavigationCounts() {
  const today = todayISO();
  const inquiries = useLive<Inquiry[]>(subscribeOpenInquiries, [], []);
  const followUps = useLive<FollowUp[]>(
    (ok, fail) => subscribeDueFollowUps(today, ok, fail),
    [],
    [today],
  );

  return useMemo(
    () => ({ inquiries: inquiries.data.length, followUps: followUps.data.length }),
    [inquiries.data, followUps.data],
  );
}
