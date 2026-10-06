import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  formatCount,
  formatMonths,
  formatRupees,
  formatSignedCount,
  NOT_ENOUGH_DATA,
} from "@/lib/cfo/money";
import type { CfoSettings, CfoSnapshot, CfoTone } from "@/lib/cfo/types";
import { cn } from "@/lib/utils";
import { monthLong, plural, TONE_BAR } from "./cfo-format";
import { ToneWord } from "./cfo-ui";

function HealthCard({
  title,
  subLabel,
  value,
  tone,
  toneLabel,
  className,
  children,
}: {
  title: string;
  /** The spec's name for this number, small and grey. */
  subLabel: string;
  value: string;
  tone: CfoTone;
  toneLabel?: string | undefined;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <article className={cn("surface-card relative overflow-hidden p-4 sm:p-5", className)}>
      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-0.5", TONE_BAR[tone])} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-card-title">{title}</h3>
          <p className="text-meta mt-0.5">{subLabel}</p>
        </div>
        <ToneWord tone={tone} label={toneLabel} />
      </div>
      <p className="text-stat mt-3 break-words">{value}</p>
      {children ? (
        <div className="mt-2.5 space-y-1 text-sm text-muted-foreground">{children}</div>
      ) : null}
    </article>
  );
}

/** The five health cards at the top of the page. */
export function HealthCards({
  snapshot,
  settings,
  onOpenSettings,
}: {
  snapshot: CfoSnapshot;
  settings: CfoSettings;
  onOpenSettings: () => void;
}) {
  const { cash, health } = snapshot;
  const last = snapshot.months.find((m) => m.key === snapshot.lastMonthKey);
  const now = snapshot.months.find((m) => m.key === snapshot.thisMonthKey);
  const needsOpening = !cash.set;

  const askOpening = (
    <>
      <p>Tell me how much money the gym had on one day, and I will keep count from there.</p>
      <Button size="sm" variant="outline" className="mt-1.5" onClick={onOpenSettings}>
        Add opening money
      </Button>
    </>
  );

  const aboveBy =
    snapshot.breakEvenMembers !== null ? snapshot.activeMembers - snapshot.breakEvenMembers : null;

  return (
    <section aria-label="How the gym is doing" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <HealthCard
        title={`${last ? monthLong(last.key) : "Last month"}: profit`}
        subLabel="Profit or loss: earned minus spent"
        value={last?.hasData ? formatRupees(last.profit) : "No expense records yet"}
        tone={health.profit}
        className="sm:col-span-2"
      >
        {last?.hasData ? (
          <p>
            Earned {formatRupees(last.earned.total)} · spent {formatRupees(last.expenses.total)}
          </p>
        ) : (
          <p>
            Add this month&apos;s expenses and the profit will show here.
            {last ? ` Earned ${formatRupees(last.earned.total)}.` : ""}
          </p>
        )}
        {now ? (
          <p className="text-meta">
            {monthLong(now.key)} so far ({now.daysCounted} of {now.daysInMonth} days): earned{" "}
            {formatRupees(now.earned.total)} · spent {formatRupees(now.expenses.total)} · received{" "}
            {formatRupees(now.received)}{" "}
            <span className="whitespace-nowrap">(same as Dashboard)</span>
          </p>
        ) : null}
      </HealthCard>

      <HealthCard
        title="Members"
        subLabel="Active members vs break-even members"
        value={formatCount(snapshot.activeMembers)}
        tone={health.breakEven}
      >
        {snapshot.breakEvenMembers !== null ? (
          <>
            <p>need {formatCount(snapshot.breakEvenMembers)} to cover costs</p>
            {aboveBy !== null && snapshot.aboveBreakEven !== null ? (
              <p className="font-medium text-foreground">
                {snapshot.aboveBreakEven
                  ? `Above break-even by ${formatCount(aboveBy)}`
                  : `Below break-even by ${formatCount(-aboveBy)}`}{" "}
              </p>
            ) : null}
          </>
        ) : (
          <p>Break-even: {NOT_ENOUGH_DATA}</p>
        )}
      </HealthCard>

      <HealthCard
        title="All gym money"
        subLabel="Cash balance: bank + UPI + card + cash drawer"
        value={
          needsOpening
            ? "Not set"
            : cash.balance === null
              ? NOT_ENOUGH_DATA
              : formatRupees(cash.balance)
        }
        tone={needsOpening ? "none" : health.cash}
        toneLabel={needsOpening ? "Set up needed" : undefined}
      >
        {needsOpening ? (
          askOpening
        ) : (
          <p>Not the same as the Day Book, which counts only the cash drawer.</p>
        )}
      </HealthCard>

      <HealthCard
        title="Money that is really yours"
        subLabel="Free cash: gym money minus what you owe"
        value={
          needsOpening
            ? "Not set"
            : cash.freeCash === null
              ? NOT_ENOUGH_DATA
              : formatRupees(cash.freeCash)
        }
        tone={needsOpening ? "none" : health.freeCash}
        toneLabel={needsOpening ? "Set up needed" : undefined}
      >
        {needsOpening ? (
          askOpening
        ) : (
          <>
            {cash.freeCash !== null && cash.freeCash < 0 ? (
              <p className="font-medium text-foreground">
                You have spent {formatRupees(-cash.freeCash)} of members&apos; advance money.
              </p>
            ) : health.freeCash === "warn" && snapshot.avgMonthlyExpenses !== null ? (
              <p>
                That is less than one month of spending ({formatRupees(snapshot.avgMonthlyExpenses)}
                ).
              </p>
            ) : null}
            <p className="text-meta">
              Kept aside: {formatRupees(snapshot.advanceOwed)} paid in advance by members
              {cash.parts.pendingTrainer
                ? ` · ${formatRupees(cash.parts.pendingTrainer)} trainer pay not paid yet`
                : ""}
              {cash.parts.unsettledStaffPaid
                ? ` · ${formatRupees(cash.parts.unsettledStaffPaid)} to pay back to staff`
                : ""}
              {/* The trainers' part of unused PT days is in both the advance and trainer pay; a
                  refund takes it back from the trainer, so it is kept aside only once. */}
              {cash.parts.trainerShareInAdvance
                ? `. ${formatRupees(cash.parts.trainerShareInAdvance)} of the advance is trainer pay for unused PT days, so it is counted once.`
                : ""}
            </p>
          </>
        )}
      </HealthCard>

      <HealthCard
        title="Months you can run"
        subLabel="Cash runway: if no new money comes in"
        value={needsOpening ? "Not set" : formatMonths(cash.runwayMonths)}
        tone={needsOpening ? "none" : health.runway}
        toneLabel={needsOpening ? "Set up needed" : undefined}
      >
        {needsOpening ? (
          askOpening
        ) : (
          <>
            <p>
              {cash.balance !== null && cash.balance <= 0
                ? "The money has run out."
                : "if no new money comes in"}
            </p>
            <p className="text-meta">
              {snapshot.avgBasedOnMonths > 0
                ? `Based on ${snapshot.avgBasedOnMonths} ${plural(snapshot.avgBasedOnMonths, "month", "months")} of spending${
                    snapshot.avgMonthlyExpenses !== null
                      ? ` (${formatRupees(snapshot.avgMonthlyExpenses)} a month)`
                      : ""
                  }. `
                : ""}
              We warn below {settings.runwayWarnMonths}{" "}
              {plural(settings.runwayWarnMonths, "month", "months")}.
            </p>
          </>
        )}
      </HealthCard>
    </section>
  );
}
