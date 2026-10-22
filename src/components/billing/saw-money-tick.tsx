import { Checkbox } from "@/components/ui/checkbox";
import { formatPrice } from "@/lib/format";

/**
 * Billing → Paid online: the member only says they paid. The desk ticks this after finding the
 * money in the gym's UPI or bank app; Record / Confirm payment stay off until then.
 */
export function SawMoneyTick({
  amount,
  checked,
  onChange,
}: {
  amount: number;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      htmlFor="saw-money"
      className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm"
    >
      <Checkbox
        id="saw-money"
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5"
      />
      <span>
        <span className="block font-semibold">
          I found this {formatPrice(amount)} in the gym's account
        </span>
        <span className="text-meta">
          Check the gym's UPI or bank app. Not there? Cancel and tap Not received.
        </span>
      </span>
    </label>
  );
}
