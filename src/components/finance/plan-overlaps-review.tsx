import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CopyX, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { formatDateISO, formatPrice } from "@/lib/format";
import type { OverlapListPlan, OverlapListRow } from "@/lib/plan-overlap";
import { getServer } from "@/lib/server-api";
import { toastWithUndo } from "@/lib/undo-toast";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { markNotDuplicate } from "@/services/memberships.service";

const where = (p: OverlapListPlan) =>
  p.paidInOldSoftware
    ? `old software${p.oldPaid > 0 ? `, paid ${formatPrice(p.oldPaid)} there` : ""}`
    : p.invoiceId
      ? "sold here"
      : "no bill";

function PlanLine({ p }: { p: OverlapListPlan }) {
  return (
    <li className="tabular-nums">
      <span className="font-medium">{p.name}</span> · {formatDateISO(p.startDate)} →{" "}
      {formatDateISO(p.endDate)} · {where(p)}
      {p.status === "expired" ? " · ended" : p.status === "pending" ? " · starts later" : ""}
    </li>
  );
}

/**
 * Income & expenses: one member's gym plans for the same days (both counted, so their money counts
 * twice). Usually one is a copy: the owner removes it from the member's page (bin icon, "added by
 * mistake"), or marks the pair "Not a duplicate". Nothing changes by itself.
 */
export function PlanOverlapsReview() {
  const [rows, setRows] = useState<OverlapListRow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const r = await getServer<{ overlaps: OverlapListRow[] }>("/api/old-data/overlaps");
      setRows(r.overlaps);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const notDuplicate = async (r: OverlapListRow) => {
    try {
      await markNotDuplicate(r.a.id, r.b.id);
      setRows((now) => now?.filter((x) => x !== r) ?? null);
      toastWithUndo(
        "Marked: not a duplicate",
        () => markNotDuplicate(r.a.id, r.b.id, true).then(load),
        `${r.clientName}: ${r.a.name} and ${r.b.name}`,
      );
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    }
  };

  if (error)
    return (
      <p role="alert" className="surface-card p-4 text-sm text-destructive">
        Couldn't check for plans that overlap: {error}
      </p>
    );
  if (!rows?.length) return null;
  return (
    <section className="surface-card space-y-3 p-4 sm:p-5" aria-labelledby="overlaps-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="overlaps-title" className="text-section-title flex items-center gap-2">
            <CopyX className="size-5 text-warning" aria-hidden /> Plans that overlap
          </h2>
          <p className="text-meta mt-1 max-w-2xl">
            {rows.length} member{rows.length === 1 ? " has" : "s have"} two gym plans for the same
            days, and both are counted. If one is a copy, open the member and remove it (bin icon,
            “added by mistake”). If both are right, mark the pair “Not a duplicate”.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={busy}>
          <RefreshCw className={busy ? "animate-spin" : undefined} aria-hidden /> Check again
        </Button>
      </div>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {rows.map((r) => (
          <li
            key={`${r.a.id}|${r.b.id}`}
            className="grid gap-2 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to="/clients/$clientId"
                  params={{ clientId: r.clientId }}
                  className="truncate font-semibold hover:underline"
                >
                  {r.clientName || "Member"}
                </Link>
                {r.clientCode ? <span className="text-meta">#{r.clientCode}</span> : null}
                <StatusPill tone="warning">
                  {r.days} day{r.days === 1 ? "" : "s"} on both
                </StatusPill>
              </div>
              <ul className="text-sm space-y-0.5">
                <PlanLine p={r.a} />
                <PlanLine p={r.b} />
              </ul>
            </div>
            <div className="flex flex-wrap gap-2 justify-self-start">
              <Button asChild size="sm">
                <Link to="/clients/$clientId" params={{ clientId: r.clientId }}>
                  Open member
                </Link>
              </Button>
              <Button size="sm" variant="outline" onClick={() => notDuplicate(r)}>
                Not a duplicate
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
