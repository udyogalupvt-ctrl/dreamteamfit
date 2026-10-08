import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { CalendarClock, RotateCcw, Search } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useAccess } from "@/hooks/use-access";
import { useAuth } from "@/hooks/use-auth";
import { formatDateISO, formatPrice } from "@/lib/format";
import { monthChanges, type LatePlan, type LateSkipReason } from "@/lib/late-sales";
import {
  applyLateSales,
  lastLateRun,
  previewLateSales,
  undoLateSales,
  type LateRun,
} from "@/services/late-sales.service";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-09" → "Sep 2026". */
const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1] ?? ""} ${m.slice(0, 4)}`;

const WHY: Record<LateSkipReason, (openFrom: string) => string> = {
  "before-open": (from) =>
    `it is before ${formatDateISO(from)}, which the Day Book has already carried forward`,
  cancelled: () => "the plan was cancelled",
  upgrade: () => "an upgrade: paid on the day it was made",
  "date-set": () => "its day was already chosen by staff (paid that day, or set by hand)",
  "bill-closed": () => "its bill is closed, refunded or removed",
  "old-software": () => "marked paid in the old software",
};

/**
 * Income & expenses (owner): sales typed in after their plan had started count their money on the
 * plan's first day, not the day they were typed in (we don't know when the member paid). New sales
 * do this by themselves; this moves the ones saved before. The owner unticks any that really were
 * paid on the day they were typed in. Undo takes the run back.
 */
export function LateSaleDates() {
  const { can } = useAccess();
  const { user } = useAuth();
  const money = can("finance");
  const [preview, setPreview] = useState<(LatePlan & { openFrom: string }) | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [run, setRun] = useState<LateRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"apply" | "undo" | null>(null);

  useEffect(() => {
    if (!money) return;
    void lastLateRun()
      .then(setRun)
      .catch(() => undefined);
  }, [money]);
  if (!money) return null;
  const by = { uid: user?.uid ?? "", name: user?.displayName || user?.email || "Owner" };

  const check = async () => {
    setBusy(true);
    try {
      setPreview(await previewLateSales());
      setOff(new Set());
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const chosen = (preview?.move ?? []).filter((m) => !off.has(m.paymentId));
  const chosenTotal = chosen.reduce((n, m) => n + m.amount, 0);
  const apply = async () => {
    setConfirm(null);
    setBusy(true);
    try {
      const r = await applyLateSales({
        paymentIds: chosen.map((m) => m.paymentId),
        canFinance: money,
        by,
      });
      toast.success(`${formatPrice(r.total)} moved to the plans' first days`, {
        description: `${r.count} payment${r.count === 1 ? "" : "s"}${r.changed ? `; ${r.changed} changed since the check were left` : ""}.`,
      });
      setRun(await lastLateRun());
      setPreview(await previewLateSales());
      setOff(new Set());
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
      const r = await undoLateSales(run.id, { canFinance: money, by });
      toast.success("Taken back", {
        description: `${r.restored} payment${r.restored === 1 ? "" : "s"} back on the day they were typed in${r.kept ? `; ${r.kept} changed since were kept` : ""}.`,
      });
      setRun(await lastLateRun());
      if (preview) setPreview(await previewLateSales());
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const toggle = (id: string, on: boolean) =>
    setOff((s) => {
      const next = new Set(s);
      if (on) next.delete(id);
      else next.add(id);
      return next;
    });

  const rows = preview?.move ?? [];
  const skipped = preview?.skipped ?? [];
  const monthsText = monthChanges(chosen)
    .map(
      (m) => `${monthName(m.month)} ${m.change > 0 ? "+" : "−"}${formatPrice(Math.abs(m.change))}`,
    )
    .join(", ");
  return (
    <section className="surface-card space-y-3 p-4 sm:p-5" aria-labelledby="late-dates-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="late-dates-title" className="text-section-title flex items-center gap-2">
            <CalendarClock className="size-5 text-primary" aria-hidden /> Sales typed in after the
            plan started
          </h2>
          <p className="text-meta mt-1 max-w-2xl">
            Their money counts on the plan&rsquo;s first day, not the day it was typed in (we
            don&rsquo;t know when the member paid). New sales do this by themselves; check here for
            sales saved before. Cash in the drawer today stays the same.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void check()} disabled={busy}>
          <Search aria-hidden /> {preview ? "Check again" : "Check"}
        </Button>
      </div>

      {preview ? (
        rows.length ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <p>
                <b className="tabular-nums">{chosen.length}</b> of {rows.length} ticked ·{" "}
                <b className="tabular-nums">{formatPrice(chosenTotal)}</b>
                <span className="text-meta block">
                  Untick a sale that really was paid on the day it was typed in.
                </span>
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOff(off.size ? new Set() : new Set(rows.map((m) => m.paymentId)))}
              >
                {off.size ? "Tick all" : "Untick all"}
              </Button>
            </div>
            <ul className="max-h-[28rem] divide-y divide-border overflow-y-auto rounded-xl border border-border">
              {rows.map((m) => {
                const id = `late-${m.paymentId}`;
                return (
                  <li key={m.paymentId} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                    <Checkbox
                      id={id}
                      checked={!off.has(m.paymentId)}
                      onCheckedChange={(v) => toggle(m.paymentId, v === true)}
                      className="mt-0.5"
                    />
                    <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                      <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="font-semibold">{m.clientName || "Member"}</span>
                        <span className="font-semibold tabular-nums">
                          {formatPrice(m.amount)} · {m.method}
                        </span>
                      </span>
                      <span className="text-meta block">
                        {m.plan}
                        {m.invoiceNumber ? ` · ${m.invoiceNumber}` : ""}
                      </span>
                      <span className="block">
                        Typed in {formatDateISO(m.from)} → counts on <b>{formatDateISO(m.to)}</b>{" "}
                        (first day)
                      </span>
                      {m.cashOn ? (
                        <span className="text-meta block">
                          The cash stays in the Day Book on {formatDateISO(m.cashOn)}: its opening
                          cash was typed in after the plan started.
                        </span>
                      ) : null}
                    </label>
                    <Link
                      to="/clients/$clientId"
                      params={{ clientId: m.clientId }}
                      className="text-meta shrink-0 underline-offset-2 hover:underline"
                      aria-label={`Open ${m.clientName || "member"}`}
                    >
                      Open
                    </Link>
                  </li>
                );
              })}
            </ul>
            {monthsText ? <p className="text-meta">Month totals change: {monthsText}.</p> : null}
            <Button onClick={() => setConfirm("apply")} disabled={busy || !chosen.length}>
              Move {chosen.length} to the plan&rsquo;s first day
            </Button>
          </div>
        ) : (
          <p className="text-sm">
            Every sale counts on the right day: none was typed in after its plan started.
          </p>
        )
      ) : null}

      {preview && skipped.length ? (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold">
            {skipped.length} left as {skipped.length === 1 ? "it is" : "they are"}
          </summary>
          <ul className="text-meta mt-2 list-disc space-y-0.5 pl-5">
            {skipped.map((s) => (
              <li key={s.paymentId}>
                {s.clientName || "Member"} · {formatPrice(s.amount)} typed in{" "}
                {formatDateISO(s.from)}, plan from {formatDateISO(s.start)}:{" "}
                {WHY[s.reason](preview.openFrom)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {run && !run.undone ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3 text-sm">
          <span>
            Last moved: <b className="tabular-nums">{formatPrice(run.total)}</b> in {run.count}{" "}
            payment{run.count === 1 ? "" : "s"}
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
        title={`Move ${chosen.length} payment${chosen.length === 1 ? "" : "s"} (${formatPrice(chosenTotal)})?`}
        description={`Each one counts in Collected on its plan's first day instead of the day it was typed in. Bills and amounts don't change; cash in the drawer today stays the same.${monthsText ? ` Month totals: ${monthsText}.` : ""} You can undo it.`}
        confirmLabel="Move them"
        onConfirm={() => void apply()}
      />
      <ConfirmDialog
        open={confirm === "undo"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Take back the last move?"
        description="Each payment goes back to the day it was typed in. Payments changed since keep their date."
        confirmLabel="Take back"
        destructive
        onConfirm={() => void undo()}
      />
    </section>
  );
}
