import { Checkbox } from "@/components/ui/checkbox";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatPrice, todayISO } from "@/lib/format";
import { OLD_PAY_METHODS, oldRowsTotal, type OldPayMethod, type OldPayRow } from "@/lib/old-money";

/**
 * "Paid in the old software": when and how much was paid there. One row = all of it on one day
 * (usually the plan's start day); "Paid in parts" adds a row per part. Each row is counted in
 * Collected on its own day, never in the Day Book cash.
 */
export function OldPaidRows({
  id,
  rows,
  onChange,
  disabled,
  note,
  error,
}: {
  id: string;
  rows: OldPayRow[];
  onChange: (rows: OldPayRow[]) => void;
  disabled?: boolean | undefined;
  /** Shown instead of the usual line (e.g. why it can't be changed here). */
  note?: string | undefined;
  error?: string | undefined;
}) {
  const today = todayISO();
  const set = (i: number, patch: Partial<OldPayRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const many = rows.length > 1;
  return (
    <fieldset className="grid gap-2" disabled={disabled}>
      <legend className="text-label mb-1.5">Paid in the old software</legend>
      {rows.map((r, i) => (
        <div
          key={r.id ?? `new-${i}`}
          className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[8rem_10rem_9rem_auto]"
        >
          <label className="grid gap-1">
            <span className="text-meta">{many ? `Part ${i + 1} ₹` : "Amount ₹"}</span>
            <Input
              id={i === 0 ? `${id}-amount` : undefined}
              type="number"
              inputMode="numeric"
              min={0}
              step="1"
              placeholder="0"
              value={Number.isFinite(r.amount) && r.amount !== 0 ? String(r.amount) : ""}
              onChange={(e) =>
                set(i, { amount: e.target.value === "" ? 0 : Number(e.target.value) })
              }
              className="tabular-nums"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-meta">Paid on</span>
            <Input
              type="date"
              max={today}
              value={r.date}
              onChange={(e) => set(i, { date: e.target.value })}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-meta">Mode</span>
            <Select value={r.method} onValueChange={(v) => set(i, { method: v as OldPayMethod })}>
              <SelectTrigger aria-label={`Mode of part ${i + 1}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OLD_PAY_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          {/* A part, or a row not saved yet, can go (never the only saved payment). */}
          {!disabled && (many || !r.id) ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="mb-1 justify-self-start"
              aria-label={`Remove part ${i + 1}`}
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
            >
              <X aria-hidden />
            </Button>
          ) : null}
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {disabled ? (
          <span />
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2"
            onClick={() =>
              onChange([
                ...rows,
                { date: rows[rows.length - 1]?.date || today, amount: 0, method: "Other" },
              ])
            }
          >
            <Plus aria-hidden />{" "}
            {rows.length ? "Paid in parts? Add a part" : "Add what was paid there"}
          </Button>
        )}
        {many ? (
          <span className="text-sm font-semibold tabular-nums">
            Total paid there {formatPrice(oldRowsTotal(rows))}
          </span>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : note ? (
        <p className="text-meta">{note}</p>
      ) : (
        <p className="text-meta">
          Counted in Collected on the day it was paid there, not in today&rsquo;s cash or the Day
          Book drawer.
        </p>
      )}
    </fieldset>
  );
}

/**
 * The old software's balance is often stale (paid there, never updated), so the daily WhatsApp
 * balance reminders go out only when staff tick this after checking with the member.
 */
export function RemindOldBalance({
  checked,
  onChange,
  id = "old-plan-remind",
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  id?: string;
}) {
  return (
    <label
      htmlFor={id}
      className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm"
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5"
      />
      <span>
        <span className="block font-semibold">Send WhatsApp reminders for this balance</span>
        <span className="text-meta">
          Tick only after checking with the member that it is still owed: the old software was not
          always updated when a balance was paid. Unticked, the bill still shows the balance to
          collect at the desk.
        </span>
      </span>
    </label>
  );
}
