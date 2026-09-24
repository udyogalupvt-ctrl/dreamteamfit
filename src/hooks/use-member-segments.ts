import { useMemo } from "react";
import { useLive } from "@/hooks/use-live-query";
import { buildSegments, SEGMENTS, type Segment, type SegmentOptions } from "@/lib/member-segments";
import { subscribeAttendance } from "@/services/attendance.service";
import {
  DEFAULT_BILLING_SETTINGS,
  subscribeBusinessSettings,
} from "@/services/business-settings.service";
import { subscribeClients } from "@/services/clients.service";
import { subscribeInvoices } from "@/services/invoices.service";
import { subscribeMemberships } from "@/services/memberships.service";
import { subscribePtAssignments } from "@/services/pt.service";
import type { AttendanceEvent, Client, Invoice, Membership, PtAssignment } from "@/types/models";

/** Live member groups (active, inactive, expiring, renewal, payment due, blacklist). */
export function useMemberSegments(opts: Omit<SegmentOptions, "gymName">) {
  const clients = useLive<Client[]>(subscribeClients, [], []);
  const memberships = useLive<Membership[]>(subscribeMemberships, [], []);
  const pts = useLive<PtAssignment[]>(subscribePtAssignments, [], []);
  const attendance = useLive<AttendanceEvent[]>(subscribeAttendance, [], []);
  const invoices = useLive<Invoice[]>(subscribeInvoices, [], []);
  const business = useLive(subscribeBusinessSettings, DEFAULT_BILLING_SETTINGS, []);
  const segments = useMemo(
    () =>
      buildSegments(clients.data, memberships.data, pts.data, attendance.data, invoices.data, {
        ...opts,
        gymName: business.data.businessName || "our gym",
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      clients.data,
      memberships.data,
      pts.data,
      attendance.data,
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
    loading: clients.loading || memberships.loading || invoices.loading,
    error: clients.error ?? memberships.error ?? pts.error ?? attendance.error ?? invoices.error,
  };
}
