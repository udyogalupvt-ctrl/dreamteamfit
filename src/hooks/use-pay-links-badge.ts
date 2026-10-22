import { useAccess } from "@/hooks/use-access";
import { useLive } from "@/hooks/use-live-query";
import { subscribeLinksToConfirm } from "@/services/pay-links.service";
import type { PayLink } from "@/types/models";

/** Logins with Billing: members who said they paid by UPI and wait for the desk to confirm. */
export function usePayLinksToConfirm() {
  const { can } = useAccess();
  const allowed = can("billing");
  return useLive<PayLink[]>(allowed ? subscribeLinksToConfirm : null, [], [allowed]);
}
