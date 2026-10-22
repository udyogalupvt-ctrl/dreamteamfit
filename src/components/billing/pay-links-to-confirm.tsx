import { useEffect, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, Check, Loader2, Smartphone, X } from "lucide-react";
import { toast } from "sonner";
import { BalancePaymentDialog } from "@/components/billing/invoice-actions";
import { FormDialog, Field } from "@/components/common/form-dialog";
import { useEnrollment } from "@/components/enrollment/enrollment-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useLive } from "@/hooks/use-live-query";
import { usePayLinksToConfirm } from "@/hooks/use-pay-links-badge";
import { formatPrice } from "@/lib/format";
import { NOT_RECEIVED_NOTE, PAY_LIMITS } from "@/lib/pay-links";
import { getClientsByIds } from "@/services/clients.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { subscribeInvoice } from "@/services/invoices.service";
import { markNotReceived } from "@/services/pay-links.service";
import type { Invoice, PayLink } from "@/types/models";

/**
 * Billing → "Paid online": members who paid by UPI and tapped "I've paid". Nothing counts as paid
 * until the desk finds the money in the gym's account and confirms it here (Collect / Renew with
 * everything filled in), or marks it Not received with a note the member sees.
 */
export function PayLinksToConfirm() {
  const { data: links } = usePayLinksToConfirm();
  const [collect, setCollect] = useState<PayLink | null>(null);
  const [notReceived, setNotReceived] = useState<PayLink | null>(null);
  if (!links.length) return null;
  return (
    <section
      aria-labelledby="paid-online-title"
      className="surface-card space-y-3 border-primary/40 p-4"
    >
      <div>
        <h2 id="paid-online-title" className="text-card-title flex items-center gap-2">
          <Smartphone className="size-5 text-primary" aria-hidden />
          Paid online: check and confirm ({links.length})
        </h2>
        <p className="text-meta">
          Find each payment in the gym's UPI or bank app first. It counts as paid only after you
          confirm it.
        </p>
      </div>
      <ul className="grid gap-2 lg:grid-cols-2">
        {links.map((l) => (
          <LinkCard
            key={l.id}
            link={l}
            onConfirm={() => setCollect(l)}
            onNotReceived={() => setNotReceived(l)}
          />
        ))}
      </ul>
      {collect?.kind === "balance" ? (
        <ConfirmBalance link={collect} onDone={() => setCollect(null)} />
      ) : null}
      <NotReceivedDialog link={notReceived} onDone={() => setNotReceived(null)} />
    </section>
  );
}

function LinkCard({
  link,
  onConfirm,
  onNotReceived,
}: {
  link: PayLink;
  onConfirm: () => void;
  onNotReceived: () => void;
}) {
  const { openEnrollment } = useEnrollment();
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    if (link.kind === "balance") return onConfirm();
    setBusy(true);
    try {
      const [client] = await getClientsByIds([link.clientId]);
      if (!client) throw new Error("This member is no longer in the app.");
      openEnrollment({ existingClient: client, payLink: link });
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li
      className="flex flex-col gap-3 rounded-xl border border-border p-3"
      data-testid="paid-online-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">
            {link.clientName}
            {link.memberCode ? (
              <span className="text-meta font-normal"> · #{link.memberCode}</span>
            ) : null}
          </p>
          <p className="text-meta">
            {link.kind === "renewal"
              ? `Renewal · ${link.packageName}`
              : `Balance · bill ${link.invoiceNumber}`}
            {link.memberPaidAt ? ` · ${format(link.memberPaidAt, "d MMM, h:mm a")}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-meta">Says paid</p>
          <p className="font-display text-xl font-extrabold tabular-nums">
            {formatPrice(link.memberAmount)}
          </p>
        </div>
      </div>
      <p className="text-sm">
        <span className="text-muted-foreground">UPI reference: </span>
        <span className="font-mono font-semibold">{link.utr || "not given"}</span>
      </p>
      {link.utrSeenBefore ? (
        <p className="flex items-start gap-2 rounded-lg bg-warning/10 p-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          This reference was used for another online payment too. Check it is a new payment.
        </p>
      ) : null}
      <div className="mt-auto flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void confirm()} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
          Money is in · Confirm
        </Button>
        <Button size="sm" variant="outline" onClick={onNotReceived}>
          <X aria-hidden /> Not received
        </Button>
      </div>
    </li>
  );
}

/** Opens Collect balance on the link's bill, with the member's amount, day and reference. */
function ConfirmBalance({ link, onDone }: { link: PayLink; onDone: () => void }) {
  const bill = useLive<Invoice | null>(
    (ok, fail) => subscribeInvoice(link.invoiceId, ok, fail),
    null,
    [link.invoiceId],
  );
  const gone = !bill.loading && !bill.data;
  useEffect(() => {
    if (!gone) return;
    toast.error("That bill isn't there any more. Mark the payment Not received, or check Finance.");
    onDone();
  }, [gone, onDone]);
  if (!bill.data) return null;
  return (
    <BalancePaymentDialog
      invoice={bill.data}
      open
      onOpenChange={(v) => (v ? null : onDone())}
      fromLink={link}
    />
  );
}

function NotReceivedDialog({ link, onDone }: { link: PayLink | null; onDone: () => void }) {
  const { user } = useAuth();
  const [note, setNote] = useState(NOT_RECEIVED_NOTE);
  const [saving, setSaving] = useState(false);
  const [lastId, setLastId] = useState("");
  if ((link?.id ?? "") !== lastId) {
    setLastId(link?.id ?? "");
    setNote(NOT_RECEIVED_NOTE);
  }
  const save = async () => {
    if (!link) return;
    setSaving(true);
    try {
      await markNotReceived(link, note, {
        uid: user?.uid ?? "",
        name: user?.displayName || user?.email || "Staff",
      });
      toast.success("Marked not received", {
        description: `${link.clientName} sees your note and can pay again.`,
      });
      onDone();
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <FormDialog
      open={!!link}
      onOpenChange={(v) => (v ? null : onDone())}
      title={`Not received · ${link?.clientName ?? ""}`}
      description={`${formatPrice(link?.memberAmount ?? 0)} isn't in the gym's account. The member sees this note and the Pay button again.`}
      footer={
        <>
          <Button variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button disabled={saving || !note.trim()} onClick={() => void save()}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Mark not received
          </Button>
        </>
      }
    >
      <Field label="Note for the member" htmlFor="nr-note" required>
        <Textarea
          id="nr-note"
          rows={3}
          value={note}
          maxLength={PAY_LIMITS.deskNote}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
    </FormDialog>
  );
}
