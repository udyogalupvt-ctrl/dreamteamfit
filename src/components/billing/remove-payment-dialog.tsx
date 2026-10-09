import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/common/form-dialog";
import { useBin } from "@/hooks/use-bin";
import { formatDateISO, formatPrice } from "@/lib/format";
import { previewRemovePayment, removePayment } from "@/services/payment-remove.service";
import type { Payment } from "@/types/models";

/**
 * The owner removes an entry made by mistake (a payment typed twice, a test, a refund that undid
 * a mistake). It goes to the Recycle Bin, with Undo; its bill shows the money as not paid again.
 */
export function RemovePaymentDialog({
  payment,
  onClose,
}: {
  payment: Payment | null;
  onClose: () => void;
}) {
  const bin = useBin();
  const [check, setCheck] = useState<{ id: string; error: string; line: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!payment) return;
    let live = true;
    previewRemovePayment(payment).then(
      (r) => live && setCheck({ id: payment.id, ...r }),
      (e: unknown) =>
        live &&
        setCheck({ id: payment.id, error: e instanceof Error ? e.message : String(e), line: "" }),
    );
    return () => {
      live = false;
    };
  }, [payment]);
  const ready = check && payment && check.id === payment.id ? check : null;
  const p = payment;
  const what = p
    ? `${p.amount < 0 ? "−" : ""}${formatPrice(Math.abs(p.amount))} · ${p.method} · ${formatDateISO(p.paymentDate)}`
    : "";
  const remove = async () => {
    if (!p) return;
    setBusy(true);
    const ok = await bin.remove(`Payment ${what}`, (by) => removePayment(p, by));
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <FormDialog
      open={!!p}
      onOpenChange={(o) => !o && onClose()}
      title="Remove this entry?"
      description={what}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {ready?.error ? "Close" : "Keep it"}
          </Button>
          {ready?.error ? null : (
            <Button
              variant="destructive"
              disabled={!ready || !!ready.error || busy}
              onClick={() => void remove()}
            >
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
              Remove entry
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
        ) : (
          <>
            <p>
              Only for an entry made by mistake (typed twice, a test, a refund that undid a
              mistake).
            </p>
            <p className="font-semibold">{ready.line}</p>
            <p className="text-meta">
              It goes to the Recycle Bin: Undo or Restore puts it back exactly as it was.
            </p>
          </>
        )}
      </div>
    </FormDialog>
  );
}
