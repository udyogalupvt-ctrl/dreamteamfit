import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { History, RefreshCw } from "lucide-react";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { formatDateISO, formatPrice } from "@/lib/format";
import { getServer } from "@/lib/server-api";
import type { OldNotInRecords, OldSaleSuspect } from "@/lib/old-data";

/**
 * Income & expenses: sales since the 1st of last month (gym plans, and PT plans sold alone) that
 * look like plans paid in the old software (the old data has a paid plan for the same days, this
 * app already has an old-software plan for them, or the plan started well before it was paid
 * here). Each one is checked and corrected by the owner; nothing changes by itself.
 * Also the other way round: plans saved as paid in the old software that its records don't have
 * (money paid here, ticked as old by mistake).
 */
export function OldSalesReview() {
  const [rows, setRows] = useState<OldSaleSuspect[] | null>(null);
  const [notIn, setNotIn] = useState<OldNotInRecords[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const r = await getServer<{ suspects: OldSaleSuspect[]; notInOld?: OldNotInRecords[] }>(
        "/api/old-data/suspects",
      );
      setRows(r.suspects);
      setNotIn(r.notInOld ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (error)
    return (
      <p role="alert" className="surface-card p-4 text-sm text-destructive">
        Couldn't check for old-software sales: {error}
      </p>
    );
  if (!rows?.length && !notIn.length) return null;
  const total = (rows ?? []).reduce((n, r) => n + r.paidHere, 0);
  return (
    <>
      {notIn.length ? (
        <NotInOldRecords rows={notIn} busy={busy} onReload={() => void load()} />
      ) : null}
      {rows?.length ? (
        <section className="surface-card space-y-3 p-4 sm:p-5" aria-labelledby="old-sales-title">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="old-sales-title" className="text-section-title flex items-center gap-2">
                <History className="size-5 text-warning" aria-hidden /> Paid in the old software?
              </h2>
              <p className="text-meta mt-1 max-w-2xl">
                {rows.length} sale{rows.length === 1 ? "" : "s"} ({formatPrice(total)}) counted as
                money here may really be old-software plans. The "Old software check" above fixes
                plans that are in the old records. For money typed in wrongly, open the member and
                use Remove (added by mistake), then sell it again the right way.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={busy}>
              <RefreshCw className={busy ? "animate-spin" : undefined} aria-hidden /> Check again
            </Button>
          </div>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {rows.map((s) => (
              <li
                key={s.invoiceId}
                className="grid gap-2 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to="/clients/$clientId"
                      params={{ clientId: s.clientId }}
                      className="truncate font-semibold hover:underline"
                    >
                      {s.clientName}
                    </Link>
                    {s.clientCode ? <span className="text-meta">#{s.clientCode}</span> : null}
                    <StatusPill tone={s.strength === "strong" ? "warning" : "info"}>
                      {s.strength === "strong" ? "Old software has this plan" : "Please check"}
                    </StatusPill>
                  </div>
                  <p className="text-sm">
                    {s.plan} · {formatDateISO(s.start)} → {formatDateISO(s.end)} · paid here{" "}
                    <b className="tabular-nums">{formatPrice(s.paidHere)}</b> on{" "}
                    {s.paidOn.map(formatDateISO).join(", ")}
                    {s.createdBy ? ` by ${s.createdBy}` : ""}
                  </p>
                  <ul className="text-meta list-disc space-y-0.5 pl-5">
                    {s.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

/**
 * Plans saved as paid in the old software whose days its records don't have. Paid here? Remove
 * the plan (added by mistake) and sell it again with the right mode. Really paid there (sold after
 * the records were exported)? Leave it.
 */
function NotInOldRecords({
  rows,
  busy,
  onReload,
}: {
  rows: OldNotInRecords[];
  busy: boolean;
  onReload: () => void;
}) {
  const total = rows.reduce((n, r) => n + r.paid, 0);
  return (
    <section className="surface-card space-y-3 p-4 sm:p-5" aria-labelledby="old-notin-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="old-notin-title" className="text-section-title flex items-center gap-2">
            <History className="size-5 text-warning" aria-hidden /> Saved as paid in the old
            software, not in its records
          </h2>
          <p className="text-meta mt-1 max-w-2xl">
            {rows.length} plan{rows.length === 1 ? "" : "s"} ({formatPrice(total)}) saved as paid in
            the old software, but its records have no plan for those days. Paid here by cash or UPI?
            Open the member, Remove the plan (added by mistake) and sell it again with the right
            mode, so the Day Book and Collected count it. Really paid there after its records were
            saved? Leave it.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onReload} disabled={busy}>
          <RefreshCw className={busy ? "animate-spin" : undefined} aria-hidden /> Check again
        </Button>
      </div>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {rows.map((r) => (
          <li key={`${r.kind}-${r.planId}`} className="space-y-1 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to="/clients/$clientId"
                params={{ clientId: r.clientId }}
                className="truncate font-semibold hover:underline"
              >
                {r.clientName}
              </Link>
              {r.clientCode ? <span className="text-meta">#{r.clientCode}</span> : null}
              <StatusPill tone="warning">Not in the old records</StatusPill>
            </div>
            <p className="text-sm">
              {r.plan} · {formatDateISO(r.start)} → {formatDateISO(r.end)} · saved as{" "}
              <b className="tabular-nums">{formatPrice(r.paid)}</b> paid there on{" "}
              {r.paidOn.map(formatDateISO).join(", ")}
              {r.createdBy ? ` by ${r.createdBy}` : ""}
            </p>
            <p className="text-meta">{r.reason}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
