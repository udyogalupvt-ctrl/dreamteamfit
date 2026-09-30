import { useMemo } from "react";
import { useLive } from "@/hooks/use-live-query";
import { buildSegments, SEGMENTS, type Segment, type SegmentOptions } from "@/lib/member-segments";
import {
  DEFAULT_BILLING_SETTINGS,
  subscribeBusinessSettings,
} from "@/services/business-settings.service";
import { subscribeClients } from "@/services/clients.service";
import { subscribeDueInvoices } from "@/services/invoices.service";
import { subscribeQueuedPlans } from "@/services/memberships.service";
import { plansForLists } from "@/lib/member-plans";
import { subscribeOpenPtAssignments } from "@/services/pt.service";
import type { Client, Invoice, Membership, PtAssignment } from "@/types/models";

/** Live member groups (active, inactive, expiring, renewal, payment due, blacklist). */
export function useMemberSegments(opts: Omit<SegmentOptions, "gymName">) {
  const clients = useLive<Client[]>(subscribeClients, [], []);
  // Each member's current plan (on the member) + plans waiting to start: not every plan ever.
  const queued = useLive<Membership[]>(subscribeQueuedPlans, [], []);
  const pts = useLive<PtAssignment[]>(subscribeOpenPtAssignments, [], []);
  // Only bills with money due (what the "payment due" group needs).
  const invoices = useLive<Invoice[]>(subscribeDueInvoices, [], []);
  const business = useLive(subscribeBusinessSettings, DEFAULT_BILLING_SETTINGS, []);
  const segments = useMemo(
    () =>
      // Visits come from each member's last visit date (kept on the member): no visit lists.
      buildSegments(
        clients.data,
        plansForLists(clients.data, queued.data),
        pts.data,
        [],
        invoices.data,
        {
          ...opts,
          gymName: business.data.businessName || "our gym",
        },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      clients.data,
      queued.data,
      pts.data,
      invoices.data,
      business.data,
      opts.absentDays,
      opts.expiringDays,
      opts.renewalWindowDays,
    ],
  );
  const counts = Object.fromEntries(SEGMENTS.map((s) => [s, segments[s].length])) as Record<
    Segment,
    number
  >;
  return {
    segments,
    counts,
    total: clients.data.length,
    loading: clients.loading || queued.loading || invoices.loading,
    error: clients.error ?? queued.error ?? pts.error ?? invoices.error,
  };
}
