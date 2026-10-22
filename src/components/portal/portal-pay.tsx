import { useState } from "react";
import { Clock, Loader2, MessageSquareWarning, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { PortalPayLinkState } from "@/constants/portal";
import { formatPrice } from "@/lib/format";
import { portalCall } from "@/lib/portal-firebase";

type Target = { kind: "balance"; bill: string } | { kind: "renewal" };

/** Opens /pay/<token> for this bill's balance or the renewal, making the link the first time. */
function usePayOpen(target: Target, link: PortalPayLinkState | null) {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    if (link) return window.location.assign(`/pay/${link.token}`);
    setBusy(true);
    try {
      const { token } = await portalCall<{ token: string }>("/api/portal/pay-link", target);
      window.location.assign(`/pay/${token}`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  };
  return { busy, open };
}

/** A bill with a balance in the Payments tab: Pay by UPI, or "waiting for the gym". */
export function BillPayOnline({
  bill,
  amount,
  link,
}: {
  bill: string;
  amount: number;
  link: PortalPayLinkState | null;
}) {
  const { busy, open } = usePayOpen({ kind: "balance", bill }, link);
  if (link?.status === "member_paid")
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-primary/5 p-3">
        <p className="flex items-start gap-2 text-sm">
          <Clock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          You paid {formatPrice(link.memberAmount)} by UPI. Waiting for the gym to confirm.
        </p>
        <Button size="sm" variant="ghost" onClick={() => void open()}>
          See payment
        </Button>
      </div>
    );
  return (
    <div className="grid gap-2">
      {link?.deskNote ? <DeskNote text={link.deskNote} /> : null}
      <Button size="sm" onClick={() => void open()} disabled={busy} className="w-fit">
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Smartphone aria-hidden />}
        Pay {formatPrice(amount)} by UPI
      </Button>
    </div>
  );
}

/** "Renew online" for the same package (server works out the price). */
export function RenewOnline({
  renewal,
  className,
  onOpen,
}: {
  renewal: { packageName: string; amount: number; link: PortalPayLinkState | null };
  className?: string;
  onOpen?: () => void;
}) {
  const { busy, open } = usePayOpen({ kind: "renewal" }, renewal.link);
  const waiting = renewal.link?.status === "member_paid";
  const go = () => {
    onOpen?.();
    void open();
  };
  return (
    <div className={className}>
      {!waiting && renewal.link?.deskNote ? <DeskNote text={renewal.link.deskNote} /> : null}
      <Button
        size="sm"
        variant={waiting ? "outline" : "default"}
        onClick={go}
        disabled={busy}
        aria-label={
          waiting
            ? "Renewal paid online, waiting for the gym to confirm"
            : `Renew ${renewal.packageName} online for ${formatPrice(renewal.amount)}`
        }
      >
        {busy ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : waiting ? (
          <Clock aria-hidden />
        ) : (
          <Smartphone aria-hidden />
        )}
        {waiting ? "Paid · waiting for the gym" : `Renew online · ${formatPrice(renewal.amount)}`}
      </Button>
    </div>
  );
}

function DeskNote({ text }: { text: string }) {
  return (
    <p className="mb-2 flex items-start gap-2 rounded-lg bg-warning/10 p-2.5 text-sm">
      <MessageSquareWarning className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <span>
        <span className="font-semibold">From the gym: </span>
        {text}
      </span>
    </p>
  );
}
