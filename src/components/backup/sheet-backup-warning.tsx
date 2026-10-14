import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, TriangleAlert } from "lucide-react";
import { needsAttention } from "@/lib/sheet-backup/status";
import { getSheetBackupStatus } from "@/services/sheet-backup.service";

/**
 * Owner only: one small line on the dashboard when the Google Sheet backup is stale (older than
 * 26 hours) or a check failed. Status is read once per visit; if it can't be read, nothing shows.
 */
export function SheetBackupWarning() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let live = true;
    getSheetBackupStatus().then(
      (s) => live && setShow(needsAttention(s)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  if (!show) return null;
  return (
    <Link
      to="/backup"
      data-testid="sheet-warning"
      className="flex items-center gap-2 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-sm font-medium transition-colors hover:bg-warning/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden />
      <span className="min-w-0 flex-1">Google Sheet backup needs attention</span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
