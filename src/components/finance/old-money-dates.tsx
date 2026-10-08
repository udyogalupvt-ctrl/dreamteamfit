import { useEffect, useState } from "react";
import { format } from "date-fns";
import { CalendarClock, RotateCcw, Search } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useAccess } from "@/hooks/use-access";
import { useAuth } from "@/hooks/use-auth";
import { formatDateISO, formatPrice } from "@/lib/format";
import type { OldSkipReason } from "@/lib/old-money";
import {
  applyOldMoneyDates,
  lastOldMoneyRun,
  previewOldMoneyDates,
  undoOldMoneyDates,
  type OldMoneyPreview,
  type OldMoneyRun,
} from "@/services/old-money.service";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-08" → "Aug 2026". */
const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1] ?? ""} ${m.slice(0, 4)}`;

const WHY: Record<OldSkipReason, string> = {
  cancelled: "cancelled here, not counted",
  "no-amount": "no amount paid there saved: add it in Edit plan",
  "no-date": "no start date",
  "with-gym-plan": "counted with its gym plan (one old plan)",
  "with-pt-plan": "counted with its PT plan (one old plan)",
};

/**
 * Income & expenses (owner): counts the money of plans paid in the old software on the day it
 * was paid there (their start day), for plans saved before this was done by itself. Shows what
 * each month gains before anything changes; Undo takes the run back.
 */
export function OldMoneyDates() {
  const { can } = useAccess();
  const { user } = useAuth();
  const money = can("finance");
  const [preview, setPreview] = useState<OldMoneyPreview | null>(null);
  const [run, setRun] = useState<OldMoneyRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"apply" | "undo" | null>(null);

  useEffect(() => {
    if (!money) return;
    void lastOldMoneyRun()
      .then(setRun)
      .catch(() => undefined);
  }, [money]);
  if (!money) return null;
  const by = { uid: user?.uid ?? "", name: user?.displayName || user?.email || "Owner" };

  const check = async () => {
    setBusy(true);
    try {
      setPreview(await previewOldMoneyDates());
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    setConfirm(null);
    setBusy(true);
    try {
      const r = await applyOldMoneyDates({ canFinance: money, by });
      toast.success(`${formatPrice(r.total)} counted on the real dates`, {
        description: `${r.count} plan${r.count === 1 ? "" : "s"} paid in the old software.`,
      });
      setRun(await lastOldMoneyRun());
      setPreview(await previewOldMoneyDates());
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const undo = async () => {
    setConfirm(null);
    if (!run) return;
    setBusy(true);
    try {
      const r = await undoOldMoneyDates(run.id, money);
      toast.success("Taken back", {
        description: `${r.removed} payment${r.removed === 1 ? "" : "s"} removed${r.kept ? `; ${r.kept} changed since were kept` : ""}.`,
      });
      setRun(await lastOldMoneyRun());
      if (preview) setPreview(await previewOldMoneyDates());
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const skipped = preview?.skipped ?? [];
  return (
    <section className="surface-card space-y-3 p-4 sm:p-5" aria-labelledby="old-dates-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="old-dates-title" className="text-section-title flex items-center gap-2">
            <CalendarClock className="size-5 text-primary" aria-hidden /> Old-software money on its
            real dates
          </h2>
          <p className="text-meta mt-1 max-w-2xl">
            Plans paid in the old software count in Collected on the day they were paid there (their
            start day), never in today&rsquo;s sales or the Day Book cash. New entries do this by
            themselves; check here for plans saved before.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void check()} disabled={busy}>
          <Search aria-hidden /> {preview ? "Check again" : "Check"}
        </Button>
      </div>

      {preview ? (
        preview.add.length ? (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Month</th>
                    <th className="px-3 py-2 text-right font-semibold">Plans</th>
                    <th className="px-3 py-2 text-right font-semibold">Adds to Collected</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {preview.months.map((m) => (
                    <tr key={m.month}>
                      <td className="px-3 py-2">{monthName(m.month)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{m.plans}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        +{formatPrice(m.amount)}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-muted/30">
                    <td className="px-3 py-2 font-semibold">Total</td>
                    <td className="px-3 py-2 text-right tabular-nums">{preview.add.length}</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums">
                      +{formatPrice(preview.total)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold">
                See the {preview.add.length} plan{preview.add.length === 1 ? "" : "s"}
              </summary>
              <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
                {preview.add.map((a) => (
                  <li
                    key={`${a.membershipId ?? ""}-${a.ptAssignmentId ?? ""}`}
                    className="flex items-baseline justify-between gap-3 px-3 py-2"
                  >
                    <span className="min-w-0">
                      <span className="font-semibold">{a.clientName || "Member"}</span>
                      <span className="text-meta block">
                        {a.label}
                        {a.membershipId && a.ptAssignmentId ? " + PT (one old plan)" : ""} · paid{" "}
                        {formatDateISO(a.date)}
                        {a.billNo ? ` · old bill ${a.billNo}` : ""}
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums">{formatPrice(a.amount)}</span>
                  </li>
                ))}
              </ul>
            </details>
            <Button onClick={() => setConfirm("apply")} disabled={busy}>
              Count {formatPrice(preview.total)} on the real dates
            </Button>
          </div>
        ) : (
          <p className="text-sm">
            Every plan paid in the old software is counted on its real date ({preview.counted} plan
            {preview.counted === 1 ? "" : "s"}).
          </p>
        )
      ) : null}

      {preview && skipped.length ? (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold">
            {skipped.length} plan{skipped.length === 1 ? "" : "s"} not added
          </summary>
          <ul className="text-meta mt-2 list-disc space-y-0.5 pl-5">
            {skipped.map((s) => (
              <li key={s.id}>
                {s.clientName || "Member"} · {s.label}: {WHY[s.reason]}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {run && !run.undone ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3 text-sm">
          <span>
            Last counted: <b className="tabular-nums">{formatPrice(run.total)}</b> for {run.count}{" "}
            plan{run.count === 1 ? "" : "s"}
            {run.at ? ` on ${formatDateISO(format(run.at, "yyyy-MM-dd"))}` : ""}
            {run.by ? ` by ${run.by}` : ""}.
          </span>
          <Button variant="outline" size="sm" onClick={() => setConfirm("undo")} disabled={busy}>
            <RotateCcw aria-hidden /> Undo
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirm === "apply"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Count ${preview ? formatPrice(preview.total) : ""} on the real dates?`}
        description={`Each plan's money is added to Collected on the day it was paid there (${(preview?.months ?? []).map((m) => `${monthName(m.month)} +${formatPrice(m.amount)}`).join(", ")}). Today's sales and the Day Book cash don't change. You can undo it.`}
        confirmLabel="Count them"
        onConfirm={() => void apply()}
      />
      <ConfirmDialog
        open={confirm === "undo"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Take back the last count?"
        description="The payments it added are removed again (the plans stay paid in the old software). Plans whose old-software payments were changed since keep them."
        confirmLabel="Take back"
        destructive
        onConfirm={() => void undo()}
      />
    </section>
  );
}
