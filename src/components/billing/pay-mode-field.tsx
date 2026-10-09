import { Field } from "@/components/common/form-dialog";
import { Input } from "@/components/ui/input";
import { formatPrice } from "@/lib/format";
import { SPLIT_MODE, splitParts, splitProblem, type PayMode } from "@/lib/split-pay";
import { cn } from "@/lib/utils";
import { PAYMENT_METHODS } from "@/types/models";

/** The cash part as typed ("" = not typed yet). */
export const cashPartOf = (text: string) => (text.trim() === "" ? NaN : Number(text));

/**
 * "Paid by": one mode, or Cash + UPI (the total stays in "Amount received"; staff type the cash
 * part, the rest is UPI). Used at the checkout, Collect balance and Edit payment.
 */
export function PayModeField({
  id,
  mode,
  onMode,
  cash,
  onCash,
  total,
  error,
  className,
  disabled,
  label = "Paid by",
  split: offerSplit = true,
  withOther = false,
}: {
  id: string;
  mode: PayMode;
  onMode: (m: PayMode) => void;
  /** The cash part as typed (Cash + UPI only). */
  cash: string;
  onCash: (text: string) => void;
  /** The whole amount received (both parts). */
  total: number;
  /** Shown after a save was tried. */
  error?: string | undefined;
  className?: string | undefined;
  disabled?: boolean | undefined;
  label?: string | undefined;
  /** Offer Cash + UPI (not for money given back). */
  split?: boolean | undefined;
  /** Offer "Other" too (a payment saved with it). */
  withOther?: boolean | undefined;
}) {
  const choices: PayMode[] = [
    ...PAYMENT_METHODS.filter((m) => withOther || m !== "Other"),
    ...(offerSplit ? [SPLIT_MODE] : []),
  ];
  const split = mode === SPLIT_MODE;
  const c = cashPartOf(cash);
  const problem = split ? splitProblem(total, c) : "";
  const parts = split && !problem ? splitParts(total, c) : null;
  return (
    <Field label={label} htmlFor={id} className={className} error={split ? undefined : error}>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" id={id} aria-label={label}>
        {choices.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            disabled={disabled}
            onClick={() => onMode(m)}
            className={cn(
              "rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-60",
              mode === m
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border hover:bg-accent",
            )}
          >
            {m}
          </button>
        ))}
      </div>
      {split ? (
        <div className="mt-1 grid gap-1.5 rounded-xl border border-border p-3">
          <label htmlFor={`${id}-cash`} className="text-label">
            Cash part ₹
          </label>
          <Input
            id={`${id}-cash`}
            type="number"
            inputMode="decimal"
            min={1}
            max={Math.max(1, total - 1)}
            value={cash}
            disabled={disabled}
            onChange={(e) => onCash(e.target.value)}
            aria-describedby={`${id}-parts`}
            className="max-w-40"
          />
          <p
            id={`${id}-parts`}
            role={error && problem ? "alert" : undefined}
            className={
              error && problem
                ? "text-xs font-medium text-destructive"
                : parts
                  ? "text-sm font-semibold tabular-nums"
                  : "text-meta"
            }
          >
            {parts
              ? `UPI ${formatPrice(parts[0]!.amount)} + Cash ${formatPrice(parts[1]!.amount)}`
              : error || Number.isFinite(c)
                ? problem
                : `Type the cash part: the rest of ${formatPrice(total || 0)} is UPI.`}
          </p>
        </div>
      ) : null}
    </Field>
  );
}
