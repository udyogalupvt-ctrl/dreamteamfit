import { effectiveMembershipStatus, todayISO } from "@/lib/format";
import type { Membership, PtAssignment } from "@/types/models";

/** The one plan a member is on (or last had), for lists: name, dates and a plain status. */
export interface PlanSummary {
  name: string;
  startDate: string;
  endDate: string;
  /** waiting_thumb = paid, starts when the first thumb is registered. */
  status: "waiting_thumb" | "upcoming" | "active" | "expired";
  /** Days until the end date (negative = ended that many days ago). */
  daysLeft: number;
}

const DAY = 86_400_000;
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

type Row = { name: string; startDate: string; endDate: string; status: string };

function pick(rows: Row[], today: string): Row | undefined {
  const live = rows.filter((r) => r.status !== "cancelled");
  return (
    live.find((r) => r.startDate <= today && r.endDate >= today) ??
    [...live].sort((a, b) => b.endDate.localeCompare(a.endDate))[0]
  );
}

function summarize(r: Row, today: string): PlanSummary {
  const eff =
    r.status === "biometric_pending"
      ? "waiting_thumb"
      : effectiveMembershipStatus({
          status: r.status as Membership["status"],
          startDate: r.startDate,
          endDate: r.endDate,
        });
  const status: PlanSummary["status"] =
    eff === "waiting_thumb"
      ? "waiting_thumb"
      : eff === "pending"
        ? "upcoming"
        : eff === "active"
          ? "active"
          : "expired";
  return {
    name: r.name,
    startDate: r.startDate,
    endDate: r.endDate,
    status,
    daysLeft: daysBetween(today, r.endDate),
  };
}

/**
 * Current (or latest) plan per member from the memberships themselves, so a member waiting for
 * the first thumb still shows the plan and its end date. PT-only members show their PT plan.
 */
export function planByClient(memberships: Membership[], pts: PtAssignment[], today = todayISO()) {
  const gym = new Map<string, Row[]>();
  const pt = new Map<string, Row[]>();
  for (const m of memberships)
    gym.set(m.clientId, [
      ...(gym.get(m.clientId) ?? []),
      { name: m.packageNameSnapshot, startDate: m.startDate, endDate: m.endDate, status: m.status },
    ]);
  for (const p of pts)
    pt.set(p.clientId, [
      ...(pt.get(p.clientId) ?? []),
      {
        name: `PT · ${p.ptPackageNameSnapshot}`,
        startDate: p.startDate,
        endDate: p.endDate,
        status: p.status,
      },
    ]);
  const out = new Map<string, PlanSummary>();
  for (const id of new Set([...gym.keys(), ...pt.keys()])) {
    const r = pick(gym.get(id) ?? [], today) ?? pick(pt.get(id) ?? [], today);
    if (r) out.set(id, summarize(r, today));
  }
  return out;
}

/** "30 days left", "ends today", "ended 3 days ago". */
export function daysLeftLabel(p: PlanSummary) {
  if (p.daysLeft > 1) return `${p.daysLeft} days left`;
  if (p.daysLeft === 1) return "1 day left";
  if (p.daysLeft === 0) return "ends today";
  return p.daysLeft === -1 ? "ended yesterday" : `ended ${-p.daysLeft} days ago`;
}
