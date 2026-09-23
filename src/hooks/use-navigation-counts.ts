import { useMemo } from "react";
import { useLive } from "@/hooks/use-live-query";
import { todayISO } from "@/lib/format";
import { subscribeInquiries } from "@/services/inquiries.service";
import type { Inquiry } from "@/types/models";

/** Live sidebar counters derived only from actionable inquiry records. */
export function useNavigationCounts() {
  const inquiries = useLive<Inquiry[]>(subscribeInquiries, [], []);

  return useMemo(() => {
    const actionable = inquiries.data.filter(
      (inquiry) => inquiry.status !== "converted" && inquiry.status !== "lost",
    );
    const today = todayISO();
    return {
      inquiries: actionable.length,
      followUps: actionable.filter(
        (inquiry) => inquiry.nextFollowUpDate && inquiry.nextFollowUpDate <= today,
      ).length,
    };
  }, [inquiries.data]);
}