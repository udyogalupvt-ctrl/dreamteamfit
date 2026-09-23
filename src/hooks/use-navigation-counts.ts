import { useMemo } from "react";
import { useLive } from "@/hooks/use-live-query";
import { todayISO } from "@/lib/format";
import { subscribeInquiries } from "@/services/inquiries.service";
import { subscribeFollowUps } from "@/services/followups.service";
import type { FollowUp, Inquiry } from "@/types/models";

/** Live sidebar counters derived only from actionable inquiry records. */
export function useNavigationCounts() {
  const inquiries = useLive<Inquiry[]>(subscribeInquiries, [], []);
  const followUps = useLive<FollowUp[]>(subscribeFollowUps, [], []);

  return useMemo(() => {
    const actionable = inquiries.data.filter(
      (inquiry) => inquiry.status !== "converted" && inquiry.status !== "lost",
    );
    const today = todayISO();
    return {
      inquiries: actionable.length,
      followUps: followUps.data.filter(
        (item) => item.status === "pending" && item.followUpDate <= today,
      ).length,
    };
  }, [inquiries.data, followUps.data]);
}