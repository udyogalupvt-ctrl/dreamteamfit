import { useMemo } from "react";
import { useLive } from "@/hooks/use-live-query";
import { addDaysISO, todayISO } from "@/lib/format";
import {
  subscribeClientsEndingBetween,
  subscribeSetupPendingClients,
} from "@/services/clients.service";
import { subscribeDueFollowUps } from "@/services/followups.service";
import { subscribeDueInvoices } from "@/services/invoices.service";
import { subscribeQueuedPlans } from "@/services/memberships.service";
import type { Client, FollowUp, Invoice, Membership } from "@/types/models";

/**
 * The few things the front desk must act on today. Live, from Firestore — and only the records
 * that count (this runs on every page: the free plan allows 50,000 reads a day).
 */
export function useAttention() {
  const today = todayISO();
  const in7 = addDaysISO(today, 7);
  const pendingThumb = useLive<Client[]>(subscribeSetupPendingClients, [], []);
  const ending = useLive<Client[]>(
    (ok, fail) => subscribeClientsEndingBetween(today, in7, ok, fail),
    [],
    [today, in7],
  );
  const queued = useLive<Membership[]>(subscribeQueuedPlans, [], []);
  const followUps = useLive<FollowUp[]>(
    (ok, fail) => subscribeDueFollowUps(today, ok, fail),
    [],
    [today],
  );
  const invoices = useLive<Invoice[]>(subscribeDueInvoices, [], []);

  return useMemo(() => {
    const thumbPending = pendingThumb.data.length;
    const callsDue = followUps.data.length;
    const dueBills = invoices.data.filter(
      (i) => i.paymentStatus !== "refunded" && i.balanceDue > 0,
    );
    // Members who already renewed (a later plan is paid for) need no call.
    const renewed = (clientId: string, end: string) =>
      queued.data.some((x) => x.clientId === clientId && x.endDate > end);
    const expiringSoon = ending.data.filter((c) => {
      const m = c.currentMembership;
      return m && m.status === "active" && !renewed(c.id, m.endDate);
    }).length;
    return {
      loading: pendingThumb.loading || followUps.loading || invoices.loading,
      thumbPending,
      callsDue,
      balanceDueCount: dueBills.length,
      balanceDueAmount: dueBills.reduce((n, i) => n + i.balanceDue, 0),
      expiringSoon,
      total: thumbPending + callsDue + dueBills.length + expiringSoon,
    };
  }, [
    pendingThumb.data,
    pendingThumb.loading,
    ending.data,
    queued.data,
    followUps.data,
    followUps.loading,
    invoices.data,
    invoices.loading,
  ]);
}
