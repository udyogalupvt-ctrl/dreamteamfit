import { useMemo, useState, type ReactNode } from "react";
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
import type { ActiveRow, DashboardPeriod, MoneyRow } from "@/hooks/use-dashboard-metrics";
import { attendanceSummary } from "@/lib/attendance-utils";
import { formatDateISO, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { subscribeAttendanceRange } from "@/services/attendance.service";
import type { AttendanceEvent } from "@/types/models";

/** The four number cards on the dashboard; tapping one opens its list here. */
export type NumberCard = "today-collection" | "month-collection" | "active" | "attendance";

const KIND: Record<MoneyRow["kind"], string> = {
  initial: "Paid on bill",
  balance: "Balance paid",
  refund: "Refund given back",
  bill: "Paid on bill",
};

const money = (n: number) => (n < 0 ? `−${formatPrice(-n)}` : formatPrice(n));

export function NumberDetails({
  card,
  title,
  period,
  lists,
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
  };
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
    rows.forEach((r) => m.set(r.method || "Other", (m.get(r.method || "Other") ?? 0) + r.amount));
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
                    {oneDay
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
