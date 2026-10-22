import { useEffect, useState } from "react";
import { Clock, Loader2, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PortalPayLinkState } from "@/constants/portal";
import { formatPrice } from "@/lib/format";

type BillPay = { on: boolean; amount: number; link: PortalPayLinkState | null };

/**
 * The public bill's "Pay by UPI" (src/server/pay-links.ts): shown only while UPI is on and the
 * bill has a balance. Opens /pay/<token> for that balance.
 */
export function BillPayOnline({ billToken }: { billToken: string }) {
  const [state, setState] = useState<BillPay | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const url = `/api/pay/bill/${encodeURIComponent(billToken)}`;
  useEffect(() => {
    let live = true;
    fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<BillPay>) : null))
      .then((d) => live && setState(d))
      .catch(() => live && setState(null));
    return () => {
      live = false;
    };
  }, [url]);
  if (!state?.on) return null;
  const open = async () => {
    if (state.link) return window.location.assign(`/pay/${state.link.token}`);
    setBusy(true);
    setError("");
    try {
      const res = await fetch(url, { method: "POST" });
      const d = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
      if (!res.ok || !d.token) throw new Error(d.error || "Please try again.");
      window.location.assign(`/pay/${d.token}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const waiting = state.link?.status === "member_paid";
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between print:hidden">
      <div className="text-sm">
        {waiting ? (
          <p className="flex items-start gap-2">
            <Clock className="mt-0.5 size-4 shrink-0 text-slate-500" aria-hidden />
            <span>
              You said you paid {formatPrice(state.link!.memberAmount)} by UPI. The gym will confirm
              it soon.
            </span>
          </p>
        ) : (
          <>
            <p className="font-semibold">Pay the balance by UPI</p>
            <p className="text-slate-600">
              {state.link?.deskNote || "Any UPI app: GPay, PhonePe, Paytm and more."}
            </p>
          </>
        )}
        {error ? (
          <p role="alert" className="mt-1 text-xs font-medium text-red-700">
            {error}
          </p>
        ) : null}
      </div>
      <Button
        onClick={() => void open()}
        disabled={busy}
        variant={waiting ? "outline" : "default"}
        className="shrink-0"
      >
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Smartphone aria-hidden />}
        {waiting ? "See payment" : `Pay ${formatPrice(state.amount)}`}
      </Button>
    </div>
  );
}
