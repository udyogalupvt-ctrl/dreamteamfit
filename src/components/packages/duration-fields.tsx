import { Field } from "@/components/common/form-dialog";
import { Input } from "@/components/ui/input";

/** One month = 30 days, so 3 months + 5 days = 95 days. */
export const DAYS_PER_MONTH = 30;
export const splitDays = (total: number) => ({
  months: Math.floor(Math.max(0, total) / DAYS_PER_MONTH),
  days: Math.max(0, total) % DAYS_PER_MONTH,
});
export const joinDays = (months: number, days: number) =>
  Math.max(0, Math.floor(months || 0)) * DAYS_PER_MONTH + Math.max(0, Math.floor(days || 0));

/**
 * Duration as months + days, with the final number of days shown. Admins can enter any custom
 * length (e.g. 1 month + 15 days = 45 days).
 */
export function DurationFields({
  idPrefix,
  totalDays,
  onChange,
  error,
}: {
  idPrefix: string;
  totalDays: number;
  onChange: (days: number) => void;
  error?: string;
}) {
  const { months, days } = splitDays(totalDays);
  return (
    <div className="grid gap-2 sm:col-span-2">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Duration · months" htmlFor={`${idPrefix}-months`}>
          <Input
            id={`${idPrefix}-months`}
            type="number"
            inputMode="numeric"
            min={0}
            max={120}
            value={months}
            onChange={(e) => onChange(joinDays(Number(e.target.value), days))}
          />
        </Field>
        <Field label="+ days" htmlFor={`${idPrefix}-days`}>
          <Input
            id={`${idPrefix}-days`}
            type="number"
            inputMode="numeric"
            min={0}
            max={29}
            value={days}
            onChange={(e) => {
              // 45 days typed here becomes 1 month + 15 days.
              onChange(joinDays(months, 0) + Math.max(0, Math.floor(Number(e.target.value) || 0)));
            }}
          />
        </Field>
      </div>
      <p
        className={error ? "text-sm font-semibold text-destructive" : "text-sm font-semibold"}
        role={error ? "alert" : undefined}
      >
        {error || `Final duration: ${totalDays} day${totalDays === 1 ? "" : "s"}`}
      </p>
    </div>
  );
}
