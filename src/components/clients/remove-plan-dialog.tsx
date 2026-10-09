import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/common/form-dialog";
import { useBin } from "@/hooks/use-bin";
import type { RemovalPlan } from "@/lib/plan-remove";
import { previewRemovePlan, removePlan } from "@/services/plan-remove.service";
import type { Client } from "@/types/models";

/** The plan the bin icon was pressed on. */
export interface RemoveTarget {
  kind: "gym" | "pt";
  id: string;
  /** Shown in the title, e.g. "Monthly" or "PT: Monthly PT (Daily)". */
  name: string;
}

/**
 * A gym or PT plan added by mistake: taken out as if it was never added (its bill, payments,
 * refunds and trainer share go with it), not cancelled. It goes to the Recycle Bin, with Undo.
 */
export function RemovePlanDialog({
  client,
  target,
  onClose,
}: {
  client: Client;
  target: RemoveTarget | null;
  onClose: () => void;
}) {
  const bin = useBin();
  const [check, setCheck] = useState<{
    key: string;
    error: string;
    plan: RemovalPlan | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const key = target ? `${target.kind}:${target.id}` : "";
  const clientId = client.id;
  useEffect(() => {
    if (!target) return;
    let live = true;
    const k = `${target.kind}:${target.id}`;
    previewRemovePlan({ id: clientId }, target.kind, target.id).then(
      (plan) => live && setCheck({ key: k, error: plan.error, plan }),
      (e: unknown) =>
        live && setCheck({ key: k, error: e instanceof Error ? e.message : String(e), plan: null }),
    );
    return () => {
      live = false;
    };
  }, [clientId, target]);
  const ready = check && check.key === key ? check : null;
  const remove = async () => {
    if (!target) return;
    setBusy(true);
    const ok = await bin.remove(target.name, (by) =>
      removePlan(client, target.kind, target.id, by),
    );
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <FormDialog
      open={!!target}
      onOpenChange={(o) => !o && onClose()}
      title={`Remove ${target?.name ?? "plan"}?`}
      description="Added by mistake: it is taken out as if it was never added."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {ready?.error ? "Close" : "Keep it"}
          </Button>
          {ready?.error ? null : (
            <Button variant="destructive" disabled={!ready || busy} onClick={() => void remove()}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
              Remove plan
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-3 text-sm">
        {!ready ? (
          <p className="text-meta flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Checking…
          </p>
        ) : ready.error ? (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3">
            {ready.error}
          </p>
        ) : ready.plan ? (
          <>
            <div>
              <p className="text-label mb-1">What goes</p>
              <ul className="divide-y divide-border rounded-xl border border-border">
                {ready.plan.goes.map((line, i) => (
                  <li key={i} className="px-3 py-2">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
            {ready.plan.back.length ? (
              <div>
                <p className="text-label mb-1">Comes back</p>
                <ul className="divide-y divide-border rounded-xl border border-border">
                  {ready.plan.back.map((line, i) => (
                    <li key={i} className="px-3 py-2">
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="font-semibold">{ready.plan.money}</p>
            <p className="text-meta">
              Not for a member who bought it and stopped: use Cancel for that. It goes to the
              Recycle Bin: Undo or Restore puts it all back.
            </p>
          </>
        ) : null}
      </div>
    </FormDialog>
  );
}
