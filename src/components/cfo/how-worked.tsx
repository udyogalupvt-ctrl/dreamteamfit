import type { ReactNode } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  formatCount,
  formatMonths,
  formatPercent,
  formatRupees,
  formatSignedCount,
} from "@/lib/cfo/money";
import type { CfoSettings, CfoSnapshot, CfoTrainerRow } from "@/lib/cfo/types";
import { cn } from "@/lib/utils";
import { monthLong } from "./cfo-format";

const R = formatRupees;

function Entry({ title, name, children }: { title: string; name: string; children: ReactNode }) {
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <p className="font-semibold">
        {title} <span className="text-meta font-normal">· {name}</span>
      </p>
      <p className="mt-0.5 text-muted-foreground">{children}</p>
    </div>
  );
}

function numbers(s: CfoSettings) {
  return [
    {
      title: "Income this month",
      name: "Earned income",
      text: `A plan's price is spread over the days it runs. A ${R(3000)} plan for 30 days earns ${R(100)} a day, so if 10 of its days fall in October, October earns ${R(1000)} from it, however the member paid. For personal training only the gym's share counts, not the trainer's.`,
    },
    {
      title: "Profit or loss",
      name: "Profit or loss",
      text: `Earned minus spent. Earned ${R(200000)} − spent ${R(150000)} = profit ${R(50000)}. The card shows the last full month, because rent and salaries are paid early in the month; this month so far is underneath.`,
    },
    {
      title: "Money received",
      name: "Same as the Dashboard",
      text: `The money that actually came in, by the day it was paid. It can differ from earned income: a member who pays ${R(12000)} for a year in October brings ${R(12000)} received in October, but only ${R(1000)} earned each month.`,
    },
    {
      title: "Members needed to cover costs",
      name: "Break-even members",
      text: `Average monthly spending ÷ what each member brings in a month, rounded up. Spending ${R(150000)} and ${R(1500)} per member needs ${formatCount(100)} members.`,
    },
    {
      title: "Members today",
      name: "Active members",
      text: "Members with a gym or personal training plan that covers today. A paused plan still counts.",
    },
    {
      title: "Paid in advance by members",
      name: "Advance money owed",
      text: `Money members paid for days they have not used yet. A member paid ${R(12000)} for 12 months and has used 3: ${R(9000)} is still owed to them in gym days.`,
    },
    {
      title: "All gym money",
      name: "Cash balance",
      text: `The money you counted on the opening date, plus everything received since, minus everything spent and paid to trainers. ${R(100000)} + ${R(60000)} received − ${R(40000)} spent = ${R(120000)}.`,
    },
    {
      title: "Money that is really yours",
      name: "Free cash",
      text: `All gym money minus what the gym owes: members' advance money, trainer pay not paid yet, and expenses staff paid from their pocket. ${R(120000)} − ${R(50000)} − ${R(10000)} = ${R(60000)}. The trainer's part of unused PT days is taken off once, as trainer pay (if the member is refunded, it comes back off the trainer's pay).`,
    },
    {
      title: "Months you can run",
      name: "Cash runway",
      text: `All gym money ÷ average monthly spending, if no new money comes in. ${R(300000)} ÷ ${R(150000)} = ${formatMonths(2)}. We warn below ${s.runwayWarnMonths} ${s.runwayWarnMonths === 1 ? "month" : "months"}.`,
    },
    {
      title: "Members who came back",
      name: "Renewal rate",
      text: `Of the members whose plan ended in the month, the share who started a new plan within ${s.graceDays} days of the end. 8 renewed ÷ (8 renewed + 2 not renewed) = ${formatPercent(0.8)}. Members still inside the ${s.graceDays} days are not counted yet.`,
    },
    {
      title: "Members gained or lost",
      name: "Net member growth",
      text: `New members − not renewed (the Blacklist) − left early. 12 new − 5 not renewed − 1 left early = ${formatSignedCount(6)}.`,
    },
    {
      title: "Money members still owe",
      name: "Pending dues",
      text: `The balance left on bills. Lateness counts from the pay-by date (from the bill date when there is none). The total is the same as "Balance due" on the Dashboard.`,
    },
    {
      title: "Personal training by trainer",
      name: "PT income per trainer",
      text: `What a trainer's clients paid, how much of it is the trainer's share, and what the gym keeps. The trainer's share is not an expense; the gym's income counts only what it keeps.`,
    },
  ];
}

const CHANGES = [
  'A member is "dropping" only if they came at least 4 times in the earlier 14 days. With fewer visits, "half" is just noise.',
  "New members are checked from day 7. Earlier than that is too soon to judge.",
  "The profit card shows the last full month, with this month so far underneath, because rent and salaries are paid early in the month.",
  "Personal training counts as the gym's share only (PT income minus the trainer's share).",
];

function TrainerTable({
  trainers,
  which,
}: {
  trainers: CfoTrainerRow[];
  which: "thisMonth" | "lastMonth";
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[22rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th scope="col" className="px-2 py-1.5 text-left font-semibold">
              Trainer
            </th>
            <th scope="col" className="px-2 py-1.5 text-right font-semibold">
              PT income
            </th>
            <th scope="col" className="px-2 py-1.5 text-right font-semibold">
              Trainer&apos;s share
            </th>
            <th scope="col" className="px-2 py-1.5 text-right font-semibold">
              Gym keeps
            </th>
            <th scope="col" className="px-2 py-1.5 text-right font-semibold">
              Salary
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border tabular-nums">
          {trainers.map((t) => (
            <tr key={t.trainerId}>
              <th scope="row" className="px-2 py-1.5 text-left font-medium">
                {t.name}
              </th>
              <td className="px-2 py-1.5 text-right">{R(t[which].income)}</td>
              <td className="px-2 py-1.5 text-right">{R(t[which].trainerShare)}</td>
              <td className="px-2 py-1.5 text-right">{R(t[which].gymKeeps)}</td>
              <td className="px-2 py-1.5 text-right">
                {t.monthlySalary === null ? "—" : R(t.monthlySalary)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HowWorked({
  snapshot,
  settings,
}: {
  snapshot: CfoSnapshot;
  settings: CfoSettings;
}) {
  const last = snapshot.months.find((m) => m.key === snapshot.lastMonthKey);
  const now = snapshot.months.find((m) => m.key === snapshot.thisMonthKey);
  const cats = [
    ...new Set([
      ...Object.keys(last?.expenses.byCategory ?? {}),
      ...Object.keys(now?.expenses.byCategory ?? {}),
    ]),
  ]
    .map((c) => ({
      c,
      last: last?.expenses.byCategory[c] ?? 0,
      now: now?.expenses.byCategory[c] ?? 0,
    }))
    .filter((r) => r.last || r.now)
    .sort((a, b) => b.last - a.last || b.now - a.now || a.c.localeCompare(b.c));

  const notes = [
    ...snapshot.dataNotes,
    "Active today includes members who only have a personal training plan, and plans waiting for a thumb. The Dashboard counts only active gym plans, so its number can be a little different.",
    "Earned income leaves out GST. All gym money includes it, because that is what you actually hold.",
  ];

  return (
    <section aria-labelledby="cfo-how-title" className="surface-card p-4 sm:p-5">
      <h2 id="cfo-how-title" className="text-section-title">
        How these numbers are worked out
      </h2>
      <p className="text-meta mt-0.5">
        The app does all the maths. The AI only explains it. Open a part to read more.
      </p>
      <Accordion type="multiple" className="mt-2" defaultValue={notes.length > 2 ? ["notes"] : []}>
        <AccordionItem value="numbers">
          <AccordionTrigger>Each number, in plain words</AccordionTrigger>
          <AccordionContent>
            <div className="divide-y divide-border">
              {numbers(settings).map((n) => (
                <Entry key={n.name} title={n.title} name={n.name}>
                  {n.text}
                </Entry>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="changes">
          <AccordionTrigger>What is different from the original plan</AccordionTrigger>
          <AccordionContent>
            <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
              {CHANGES.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="categories">
          <AccordionTrigger>Where the money went (expenses by category)</AccordionTrigger>
          <AccordionContent>
            {cats.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[18rem] border-collapse text-sm tabular-nums">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th scope="col" className="px-2 py-1.5 text-left font-semibold">
                        Category
                      </th>
                      <th scope="col" className="px-2 py-1.5 text-right font-semibold">
                        {last ? monthLong(last.key) : "Last month"}
                      </th>
                      <th scope="col" className="px-2 py-1.5 text-right font-semibold">
                        {now ? `${monthLong(now.key)} so far` : "This month"}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {cats.map((r) => (
                      <tr key={r.c}>
                        <th scope="row" className="px-2 py-1.5 text-left font-medium">
                          {r.c}
                        </th>
                        <td className="px-2 py-1.5 text-right">{R(r.last)}</td>
                        <td className="px-2 py-1.5 text-right">{R(r.now)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-muted-foreground">No expenses in these two months.</p>
            )}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="pt">
          <AccordionTrigger>Personal training by trainer</AccordionTrigger>
          <AccordionContent>
            {snapshot.trainers.length ? (
              <div className="space-y-4">
                <div>
                  <p className="mb-1 font-semibold">{last ? monthLong(last.key) : "Last month"}</p>
                  <TrainerTable trainers={snapshot.trainers} which="lastMonth" />
                </div>
                <div>
                  <p className="mb-1 font-semibold">
                    {now ? `${monthLong(now.key)} so far` : "This month so far"}
                  </p>
                  <TrainerTable trainers={snapshot.trainers} which="thisMonth" />
                </div>
                <p className="text-meta">
                  A salary shows only when it is saved on the Staff page. Income and salary are
                  shown side by side so you can see if each trainer pays for themselves.
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground">No personal training in these two months.</p>
            )}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="notes" className={cn("border-b-0")}>
          <AccordionTrigger>Things to know about your data</AccordionTrigger>
          <AccordionContent>
            <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </section>
  );
}
