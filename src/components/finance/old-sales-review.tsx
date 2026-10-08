import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { History, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { OldSoftwareDialog } from "@/components/clients/old-software-dialog";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { doc, getDoc } from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { formatDateISO, formatPrice } from "@/lib/format";
import { getServer } from "@/lib/server-api";
import { COLLECTIONS } from "@/services/firestore.service";
import { mapInvoice } from "@/services/invoices.service";
import { mapMembership } from "@/services/memberships.service";
import type { OldSaleSuspect } from "@/lib/old-data";
import type { Invoice, Membership } from "@/types/models";

type Open = {
  m: Membership;
  bill: Invoice | null;
  s: OldSaleSuspect;
  phone: string;
  oldMemberId: string;
} | null;

/**
 * Income & expenses: sales since the 1st of last month that look like plans paid in the old
 * software (the old data has a paid plan for the same days, or the plan started well before it
 * was paid here). Each one is checked and corrected by the owner; nothing changes by itself.
 */
export function OldSalesReview() {
  const [rows, setRows] = useState<OldSaleSuspect[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Open>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const r = await getServer<{ suspects: OldSaleSuspect[] }>("/api/old-data/suspects");
      setRows(r.suspects);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const check = async (s: OldSaleSuspect) => {
    try {
      const [m, b, c] = await Promise.all([
        getDoc(doc(db, COLLECTIONS.memberships, s.membershipId)),
        getDoc(doc(db, COLLECTIONS.invoices, s.invoiceId)),
        getDoc(doc(db, COLLECTIONS.clients, s.clientId)),
      ]);
      if (!m.exists()) throw new Error("This plan no longer exists.");
      setOpen({
        m: mapMembership(m.id, m.data()),
        bill: b.exists() ? mapInvoice(b.id, b.data()) : null,
        s,
        phone: String(c.data()?.["phone"] ?? ""),
        oldMemberId: String(c.data()?.["oldMemberId"] ?? ""),
      });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (error)
    return (
      <p role="alert" className="surface-card p-4 text-sm text-destructive">
        Couldn't check for old-software sales: {error}
      </p>
    );
  if (!rows?.length) return null;
  const total = rows.reduce((n, r) => n + r.paidHere, 0);
  return (
    <section className="surface-card space-y-3 p-4 sm:p-5" aria-labelledby="old-sales-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="old-sales-title" className="text-section-title flex items-center gap-2">
            <History className="size-5 text-warning" aria-hidden /> Paid in the old software?
          </h2>
          <p className="text-meta mt-1 max-w-2xl">
            {rows.length} sale{rows.length === 1 ? "" : "s"} ({formatPrice(total)}) counted as money
            here may have been paid in the old software. Each one you mark is taken off Collected,
            the Day Book and income; the plan stays. Undo is possible right after.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={busy}>
          <RefreshCw className={busy ? "animate-spin" : undefined} aria-hidden /> Check again
        </Button>
      </div>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {rows.map((s) => (
          <li key={s.invoiceId} className="grid gap-2 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
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
            <Button size="sm" onClick={() => void check(s)} className="justify-self-start">
              Check & mark
            </Button>
          </li>
        ))}
      </ul>
      <OldSoftwareDialog
        membership={open?.m ?? null}
        bill={open?.bill ?? null}
        memberName={open?.s.clientName ?? ""}
        memberPhone={open?.phone}
        oldMemberId={open?.oldMemberId}
        onClose={() => setOpen(null)}
        onDone={() => void load()}
      />
    </section>
  );
}
