// Pure helpers for showing the backup status in plain words (Backup page card + dashboard row).

export interface SheetCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SheetBackupStatus {
  sheetUrl: string;
  lastOkAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  checks: SheetCheck[];
  pending: number;
  shareWith: string;
}

/** The sheet is "stale" when its last good update is older than this. */
export const STALE_HOURS = 26;

export const failedChecks = (s: SheetBackupStatus) => s.checks.filter((c) => !c.ok);

/** The latest run failed (it came after the last good one). */
const lastRunFailed = (s: SheetBackupStatus) =>
  Boolean(s.lastError) && (!s.lastOkAt || (s.lastRunAt ?? "") > s.lastOkAt);

/** True when the owner should be told: never updated, too old, a failed check, or a failed run. */
export function needsAttention(s: SheetBackupStatus, now: number = Date.now()): boolean {
  if (failedChecks(s).length || lastRunFailed(s) || !s.lastOkAt) return true;
  const t = Date.parse(s.lastOkAt);
  return Number.isNaN(t) || now - t > STALE_HOURS * 3_600_000;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "13 Oct, 10:42 pm" in Indian time, whatever the viewer's own time zone. */
export function formatWhen(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const ist = new Date(t + 5.5 * 3_600_000);
  const h = ist.getUTCHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = String(ist.getUTCMinutes()).padStart(2, "0");
  return `${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]}, ${h12}:${mm} ${h < 12 ? "am" : "pm"}`;
}

export type SheetState =
  | { kind: "ok"; text: string }
  | { kind: "updating"; text: string }
  | { kind: "problem"; text: string; items: string[] };

/** One line for the card: green, amber or red. */
export function describeStatus(s: SheetBackupStatus, now: number = Date.now()): SheetState {
  const bad = failedChecks(s);
  const when = s.lastOkAt ? formatWhen(s.lastOkAt) : "";
  if (bad.length)
    return {
      kind: "problem",
      text: "The sheet does not match the app yet",
      items: bad.map((c) => (c.detail ? `${c.name}: ${c.detail}` : c.name)),
    };
  if (lastRunFailed(s))
    return {
      kind: "problem",
      text: s.lastOkAt
        ? `The last update failed. The sheet still shows ${when}`
        : "The sheet has not been filled yet and the last try failed",
      items: [s.lastError ?? ""],
    };
  if (s.pending > 0)
    return {
      kind: "updating",
      text: `Updating… ${s.pending} step${s.pending === 1 ? "" : "s"} left`,
    };
  if (!s.lastOkAt)
    return {
      kind: "problem",
      text: "The sheet has not been filled yet. Press Sync now.",
      items: [],
    };
  if (needsAttention(s, now))
    return {
      kind: "problem",
      text: `Not updated since ${when}. It should update every night.`,
      items: [],
    };
  return { kind: "ok", text: `Up to date · matches the app · last updated ${when}` };
}
