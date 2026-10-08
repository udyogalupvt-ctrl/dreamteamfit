import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { ChevronRight, Loader2, Search } from "lucide-react";
import { StatusPill } from "@/components/common/status-pill";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useLive } from "@/hooks/use-live-query";
import type {
  ActiveRow,
  DashboardPeriod,
  DetailList,
  MoneyRow,
} from "@/hooks/use-dashboard-metrics";
import { attendanceSummary } from "@/lib/attendance-utils";
import { formatDateISO, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { subscribeAttendanceRange } from "@/services/attendance.service";
import { collectedByMonth } from "@/services/finance.service";
import type { AttendanceEvent } from "@/types/models";

/**
 * A dashboard number card (its metric id); tapping one opens its list here: the four main cards
 * and every card under "more numbers".
 */
export type NumberCard = string;

const KIND: Record<MoneyRow["kind"], string> = {
  initial: "Paid on bill",
  balance: "Balance paid",
  refund: "Refund given back",
  bill: "Paid on bill",
  old: "Paid in the old software",
};

const money = (n: number) => (n < 0 ? `−${formatPrice(-n)}` : formatPrice(n));

export function NumberDetails({
  card,
  title,
  period,
  lists,
  allTime = null,
  onClose,
}: {
  card: NumberCard | null;
  /** The card's own label, e.g. "Collected today". */
  title: string;
  period: DashboardPeriod;
  lists: {
    period: MoneyRow[];
    month: MoneyRow[];
    active: ActiveRow[];
    visitsToday: AttendanceEvent[];
    more: Record<string, DetailList>;
  };
  /** All-time total (the "Total collected" card's value), for its by-month list. */
  allTime?: number | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const open = card !== null;
  const goTo = (clientId: string) => {
    if (!clientId) return;
    onClose();
    void navigate({ to: "/clients/$clientId", params: { clientId } });
  };
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        {card === "today-collection" || card === "month-collection" ? (
          <MoneyList
            title={title}
            rows={card === "today-collection" ? lists.period : lists.month}
            oneDay={card === "today-collection" && period.from === period.to}
            goTo={goTo}
          />
        ) : card === "active" ? (
          <ActiveList title={title} rows={lists.active} goTo={goTo} />
        ) : card === "attendance" ? (
          <VisitList title={title} period={period} today={lists.visitsToday} goTo={goTo} />
        ) : card === "collection" ? (
          <ByMonthList title={title} allTime={allTime} />
        ) : card && lists.more[card] ? (
          <DetailListView title={title} list={lists.more[card]} goTo={goTo} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Head({ title, summary }: { title: string; summary: string }) {
  return (
    <SheetHeader className="border-b border-border p-4 pr-12 text-left sm:p-5 sm:pr-12">
      <SheetTitle>{title}</SheetTitle>
      <SheetDescription>{summary}</SheetDescription>
    </SheetHeader>
  );
}

function Row({ onClick, children }: { onClick?: (() => void) | undefined; children: ReactNode }) {
  return (
    <li>
      <button
        type="button"
        disabled={!onClick}
        onClick={onClick}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent sm:px-5"
      >
        {children}
        {onClick ? (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : null}
      </button>
    </li>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-meta p-6 text-center">{text}</p>;
}

/** Collected (today / a period / this month): every payment, with totals by how it was paid. */
function MoneyList({
  title,
  rows,
  oneDay,
  goTo,
}: {
  title: string;
  rows: MoneyRow[];
  oneDay: boolean;
  goTo: (clientId: string) => void;
}) {
  const total = rows.reduce((n, r) => n + r.amount, 0);
  const byMethod = useMemo(() => {
    const m = new Map<string, number>();
    // Old-software money has its own chip: it never came in here as cash / UPI.
    rows.forEach((r) => {
      const key = r.kind === "old" ? "Old software" : r.method || "Other";
      m.set(key, (m.get(key) ?? 0) + r.amount);
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  return (
    <>
      <Head
        title={title}
        summary={`${money(total)} from ${rows.length} payment${rows.length === 1 ? "" : "s"}`}
      />
      {byMethod.length ? (
        <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3 sm:px-5">
          {byMethod.map(([method, amount]) => (
            <span key={method} className="rounded-lg bg-muted px-2.5 py-1 text-sm">
              {method} <b className="tabular-nums">{money(amount)}</b>
            </span>
          ))}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length ? (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <Row key={r.id} onClick={r.clientId ? () => goTo(r.clientId) : undefined}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{r.name || "Member"}</span>
                  <span className="text-meta block">
                    {r.kind === "old"
                      ? formatDateISO(r.date)
                      : oneDay
                        ? format(r.at, "h:mm a")
                        : `${formatDateISO(r.date)}, ${format(r.at, "h:mm a")}`}{" "}
                    · {r.method} · {KIND[r.kind]}
                    {r.bill ? ` · ${r.bill}` : ""}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 font-semibold tabular-nums",
                    r.amount < 0 && "text-destructive",
                  )}
                >
                  {money(r.amount)}
                </span>
              </Row>
            ))}
          </ul>
        ) : (
          <Empty text="No payments in this period." />
        )}
      </div>
    </>
  );
}

/** Members with a running plan, the soonest to end first (who to call about renewing). */
function ActiveList({
  title,
  rows,
  goTo,
}: {
  title: string;
  rows: ActiveRow[];
  goTo: (clientId: string) => void;
}) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s
      ? rows.filter((r) => r.name.toLowerCase().includes(s) || r.code.toLowerCase() === s)
      : rows;
  }, [rows, q]);
  return (
    <>
      <Head
        title={title}
        summary={`${rows.length} member${rows.length === 1 ? "" : "s"} with a running plan · ending soonest first`}
      />
      <div className="border-b border-border px-4 py-3 sm:px-5">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            className="pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find by name or member ID…"
            aria-label="Find an active member"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.length ? (
          <ul className="divide-y divide-border">
            {shown.map((r) => (
              <Row key={r.clientId} onClick={() => goTo(r.clientId)}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{r.name || "Member"}</span>
                  <span className="text-meta block truncate">
                    {r.code ? `ID ${r.code} · ` : ""}
                    {r.plan}
                  </span>
                </span>
                <span className="text-meta shrink-0 text-right">
                  Ends
                  <span className="block font-semibold text-foreground">
                    {formatDateISO(r.endDate)}
                  </span>
                </span>
              </Row>
            ))}
          </ul>
        ) : (
          <Empty text={q ? "No active member matches." : "No member has a running plan."} />
        )}
      </div>
    </>
  );
}

/** Visits (today) or punches (a period): who came, when, and anyone the door turned away. */
function VisitList({
  title,
  period,
  today,
  goTo,
}: {
  title: string;
  period: DashboardPeriod;
  today: AttendanceEvent[];
  goTo: (clientId: string) => void;
}) {
  // Today's visits are already on screen; another period is read only when this list is opened.
  const range = useLive<AttendanceEvent[]>(
    period.isToday
      ? null
      : (ok, fail) => subscribeAttendanceRange(period.from, period.to, ok, fail),
    [],
    [period.isToday, period.from, period.to],
  );
  const rows = period.isToday ? today : range.data;
  const sum = attendanceSummary(rows);
  const oneDay = period.from === period.to;
  return (
    <>
      <Head
        title={title}
        summary={`${sum.visits} visit${sum.visits === 1 ? "" : "s"} · ${sum.unique} ${sum.unique === 1 ? "person" : "people"}${sum.blocked ? ` · ${sum.blocked} turned away` : ""}`}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!period.isToday && range.loading ? (
          <div className="grid place-items-center p-8">
            <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" />
          </div>
        ) : rows.length ? (
          <ul className="divide-y divide-border">
            {rows.map((e) => (
              <Row key={e.id} onClick={e.clientId ? () => goTo(e.clientId) : undefined}>
                <span
                  className={cn(
                    "shrink-0 text-sm font-semibold tabular-nums",
                    oneDay ? "w-20" : "w-32",
                  )}
                >
                  {oneDay ? format(e.timestamp, "h:mm a") : format(e.timestamp, "d MMM, h:mm a")}
                </span>
                <span className="min-w-0 flex-1 truncate">{e.clientNameSnapshot || "Unknown"}</span>
                {e.accessDecision === "blocked" ? (
                  <StatusPill tone="danger">Turned away</StatusPill>
                ) : e.eventType === "check_out" ? (
                  <StatusPill tone="info">Out</StatusPill>
                ) : null}
              </Row>
            ))}
          </ul>
        ) : (
          <Empty text="No visits in this period." />
        )}
      </div>
    </>
  );
}

/** Any "more numbers" card: its summary, totals by kind, and the lines behind it. */
function DetailListView({
  title,
  list,
  goTo,
}: {
  title: string;
  list: DetailList;
  goTo: (clientId: string) => void;
}) {
  return (
    <>
      <Head title={title} summary={list.summary} />
      {list.chips?.length ? (
        <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3 sm:px-5">
          {list.chips.map(([k, v]) => (
            <span key={k} className="rounded-lg bg-muted px-2.5 py-1 text-sm">
              {k} <b className="tabular-nums">{v}</b>
            </span>
          ))}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.rows.length ? (
          <ul className="divide-y divide-border">
            {list.rows.map((r) => (
              <Row key={r.id} onClick={r.clientId ? () => goTo(r.clientId!) : undefined}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{r.title}</span>
                  {r.sub ? <span className="text-meta block">{r.sub}</span> : null}
                </span>
                {r.right ? (
                  <span
                    className={cn(
                      "shrink-0 text-right font-semibold tabular-nums",
                      r.minus && "text-destructive",
                    )}
                  >
                    {r.right}
                  </span>
                ) : null}
              </Row>
            ))}
          </ul>
        ) : (
          <Empty text="Nothing here right now." />
        )}
      </div>
    </>
  );
}

/** Total collected: month by month for the last 6 months (read when opened), then the rest. */
function ByMonthList({ title, allTime }: { title: string; allTime: number | null }) {
  const [months, setMonths] = useState<{ month: string; total: number }[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    collectedByMonth(6).then(
      (m) => live && setMonths(m),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);
  const lastYear = months?.reduce((n, m) => n + m.total, 0) ?? 0;
  const older = allTime !== null && months ? allTime - lastYear : null;
  return (
    <>
      <Head
        title={title}
        summary={`${allTime === null ? "…" : money(allTime)} in all · month by month`}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {failed ? (
          <Empty text="Couldn't add the months up. Try again in a moment." />
        ) : !months ? (
          <div className="grid place-items-center p-8">
            <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" />
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {months.map((m) => (
              <Row key={m.month}>
                <span className="min-w-0 flex-1 font-semibold">
                  {format(new Date(`${m.month}-01T00:00:00`), "MMMM yyyy")}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{money(m.total)}</span>
              </Row>
            ))}
            {older !== null && Math.abs(older) >= 1 ? (
              <Row>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">Before that</span>
                  <span className="text-meta">older payments and bills from the old software</span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{money(older)}</span>
              </Row>
            ) : null}
          </ul>
        )}
      </div>
    </>
  );
}
