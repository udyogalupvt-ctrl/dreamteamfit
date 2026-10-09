/**
 * The member's current plan (`clients.currentMembership`): ONE rule for every place that saves it
 * (a sale, Add old plan, Edit plan, Cancel / Restore, Remove, the thumb, the morning roll, Excel
 * import) and for the member lists. Before, each picked differently, so a member could show as
 * "Renewal due" or "not renewed" while a plan was running.
 *
 * Pure maths only (no database): relative imports, unit-tested with `node --test`.
 */

export interface CurrentSummary {
  membershipId: string;
  packageName: string;
  startDate: string;
  endDate: string;
  status: string;
}

export interface CurrentRow {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
}

/**
 * From the member's gym plans: the one running today (latest start; a plan ended early by a renewal
 * is not running), else the next upcoming, else the latest ended, else the latest cancelled, else none.
 */
export function pickCurrent(
  rows: CurrentRow[],
  today: string,
): { summary: CurrentSummary | null; active: boolean } {
  const sum = (r: CurrentRow, status: string): CurrentSummary => ({
    membershipId: r.id,
    packageName: r.name,
    startDate: r.startDate,
    endDate: r.endDate,
    status,
  });
  const live = rows.filter((r) => r.status !== "cancelled");
  const open = live.filter((r) => r.status !== "expired");
  const running = open
    .filter((r) => r.startDate <= today && r.endDate >= today)
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || a.id.localeCompare(b.id))[0];
  if (running) return { summary: sum(running, "active"), active: true };
  const upcoming = open
    .filter((r) => r.startDate > today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id))[0];
  if (upcoming) return { summary: sum(upcoming, "pending"), active: false };
  const ended = [...live].sort(
    (a, b) => b.endDate.localeCompare(a.endDate) || a.id.localeCompare(b.id),
  )[0];
  if (ended) return { summary: sum(ended, "expired"), active: false };
  const cancelled = rows
    .filter((r) => r.status === "cancelled")
    .sort((a, b) => b.endDate.localeCompare(a.endDate) || a.id.localeCompare(b.id))[0];
  return { summary: cancelled ? sum(cancelled, "cancelled") : null, active: false };
}

/** A plan document's fields as a row for `pickCurrent`. */
export const currentRow = (id: string, d: Record<string, unknown>): CurrentRow => ({
  id,
  name: String(d["packageNameSnapshot"] ?? ""),
  startDate: String(d["startDate"] ?? ""),
  endDate: String(d["endDate"] ?? ""),
  status: String(d["status"] ?? ""),
});

/** The member's saved summary already says this (nothing to write). */
export function sameCurrent(
  saved: Partial<CurrentSummary> | null | undefined,
  next: CurrentSummary | null,
): boolean {
  if (!next) return !saved?.membershipId;
  return (
    !!saved &&
    saved.membershipId === next.membershipId &&
    saved.packageName === next.packageName &&
    saved.startDate === next.startDate &&
    saved.endDate === next.endDate &&
    saved.status === next.status
  );
}
