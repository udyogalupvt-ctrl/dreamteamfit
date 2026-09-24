import { useMemo } from "react";
import { useLive } from "@/hooks/use-live-query";
import { addDaysISO, todayISO } from "@/lib/format";
import { subscribeClients } from "@/services/clients.service";
import { isSetupPending } from "@/services/enrollment.service";
import { subscribeFollowUps } from "@/services/followups.service";
import { subscribeInvoices } from "@/services/invoices.service";
import { subscribeMemberships } from "@/services/memberships.service";
import type { Client, FollowUp, Invoice, Membership } from "@/types/models";

/** The few things the front desk must act on today. Live, from Firestore. */
export function useAttention() {
  const clients = useLive<Client[]>(subscribeClients, [], []);
  const followUps = useLive<FollowUp[]>(subscribeFollowUps, [], []);
  const invoices = useLive<Invoice[]>(subscribeInvoices, [], []);
  const memberships = useLive<Membership[]>(subscribeMemberships, [], []);

  return useMemo(() => {
    const today = todayISO();
    const in7 = addDaysISO(today, 7);
    const thumbPending = clients.data.filter(isSetupPending).length;
    const callsDue = followUps.data.filter(
      (f) => f.status === "pending" && f.followUpDate <= today,
    ).length;
    const dueBills = invoices.data.filter(
      (i) => i.paymentStatus !== "refunded" && i.balanceDue > 0,
    );
    // Members who already renewed (a later plan is paid for) need no call.
    const renewed = (clientId: string, end: string) =>
      memberships.data.some(
        (x) =>
          x.clientId === clientId &&
          !["cancelled", "expired"].includes(x.status) &&
          x.endDate > end,
      );
    const expiringSoon = clients.data.filter((c) => {
      const m = c.currentMembership;
      return (
        m &&
        m.status === "active" &&
        m.endDate >= today &&
        m.endDate <= in7 &&
        !renewed(c.id, m.endDate)
      );
    }).length;
    return {
      loading: clients.loading || followUps.loading || invoices.loading,
      thumbPending,
      callsDue,
      balanceDueCount: dueBills.length,
      balanceDueAmount: dueBills.reduce((n, i) => n + i.balanceDue, 0),
      expiringSoon,
      total: thumbPending + callsDue + dueBills.length + expiringSoon,
    };
  }, [
    clients.data,
    clients.loading,
    followUps.data,
    followUps.loading,
    invoices.data,
    invoices.loading,
    memberships.data,
  ]);
}
