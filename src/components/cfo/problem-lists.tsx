import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Download, MessageCircle, Phone, Printer } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { LoadingRows } from "@/components/common/loading-state";
import { SearchInput } from "@/components/common/search-input";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLive } from "@/hooks/use-live-query";
import { formatCount, formatDay, formatRupees } from "@/lib/cfo/money";
import {
  CFO_LIST_KEYS,
  type CfoAlertRow,
  type CfoDueRow,
  type CfoListDoc,
  type CfoListKey,
  type CfoSettings,
  type CfoSnapshot,
} from "@/lib/cfo/types";
import { todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp-phone";
import { getCfoList, recheckCfoRow } from "@/services/cfo.service";
import {
  DEFAULT_BILLING_SETTINGS,
  subscribeBusinessSettings,
} from "@/services/business-settings.service";
import {
  DEFAULT_WHATSAPP_SETTINGS,
  subscribeWhatsAppSettings,
} from "@/services/whatsapp-settings.service";
import { plural } from "./cfo-format";
import { DUE_GROUP_LABEL, LIST_META, downloadListExcel, printList } from "./cfo-export";
import { cfoWhatsAppText } from "./cfo-messages";

type AnyRow = CfoAlertRow | CfoDueRow;
type Loaded = { at: string; doc: CfoListDoc<AnyRow> | null; failed: boolean };

const PAGE = 50;

/** Who to message, and what the gym is called in the message. */
interface Ctx {
  gym: string;
  countryCode: string;
}

const dash = (v: string) => (v ? formatDay(v) : "—");

function lateText(r: CfoDueRow) {
  if (r.daysLate > 0) return `${formatCount(r.daysLate)} ${plural(r.daysLate, "day", "days")} late`;
  if (r.daysLate === 0) return "Due today";
  return `Due in ${formatCount(-r.daysLate)} ${plural(-r.daysLate, "day", "days")}`;
}

/* ------------------------------------------------------------------ row actions */

function RowActions({ listKey, row, ctx }: { listKey: CfoListKey; row: AnyRow; ctx: Ctx }) {
  const phone = normalizeWhatsAppPhone(row.phone, ctx.countryCode);
  const callHref = `tel:${phone.ok ? `+${phone.value}` : row.phone}`;

  // The chat opens only after a quick look that the row is still true (1-2 reads). The window is
  // opened first so the browser does not block it, then pointed at the chat.
  const openWhatsApp = async () => {
    if (!phone.ok) return;
    const w = window.open("", "_blank");
    const check = await recheckCfoRow(listKey, row);
    if (check.stale) {
      w?.close();
      toast.info(`${check.stale} Press Refresh to update the list.`);
      return;
    }
    const text = cfoWhatsAppText(listKey, row, {
      gym: ctx.gym,
      today: todayISO(),
      ...(check.balance !== undefined ? { balance: check.balance } : {}),
    });
    const url = `https://wa.me/${phone.value}?text=${encodeURIComponent(text)}`;
    if (w) {
      w.opener = null;
      w.location.href = url;
    } else window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild size="sm" variant="outline">
        <a href={callHref} aria-label={`Call ${row.name}`}>
          <Phone aria-hidden /> Call
        </a>
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!phone.ok}
        aria-label={`WhatsApp ${row.name}`}
        title={phone.ok ? undefined : "This phone number can't be used for WhatsApp"}
        onClick={openWhatsApp}
      >
        <MessageCircle aria-hidden className="text-[#128C7E] dark:text-[#25D366]" /> WhatsApp
      </Button>
    </div>
  );
}

function NameBlock({ row }: { row: AnyRow }) {
  return (
    <div className="min-w-0">
      <Link
        to="/clients/$clientId"
        params={{ clientId: row.clientId }}
        className="block truncate font-semibold hover:underline"
      >
        {row.name}
      </Link>
      <p className="text-meta tabular-nums">
        {row.code ? `ID ${row.code} · ` : ""}
        {row.phone || "No phone"}
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------------- rows */

function AlertCard({
  row,
  listKey,
  moneyLabel,
  ctx,
}: {
  row: CfoAlertRow;
  listKey: CfoListKey;
  moneyLabel: string;
  ctx: Ctx;
}) {
  return (
    <li className="surface-card space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <NameBlock row={row} />
        <div className="shrink-0 text-right">
          <p className="font-bold tabular-nums">{formatRupees(row.money)}</p>
          <p className="text-meta">{moneyLabel}</p>
        </div>
      </div>
      {row.top ? <StatusPill tone="danger">Top priority</StatusPill> : null}
      <p className="text-sm">{row.reason}</p>
      <p className="text-meta">
        {row.plan || "No plan"} · ends {dash(row.endDate)} · last visit{" "}
        {row.lastVisit ? formatDay(row.lastVisit) : "none yet"}
      </p>
      <RowActions listKey={listKey} row={row} ctx={ctx} />
    </li>
  );
}

function DueCard({ row, ctx }: { row: CfoDueRow; ctx: Ctx }) {
  return (
    <li className="surface-card space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <NameBlock row={row} />
        <div className="shrink-0 text-right">
          <p className="font-bold tabular-nums">{formatRupees(row.balance)}</p>
          <p className="text-meta">Balance</p>
        </div>
      </div>
      <p className="text-sm">
        Bill {row.billNumber}
        {row.items ? ` · ${row.items}` : ""}
      </p>
      <p className="text-meta">
        {row.dueDate ? `Pay by ${formatDay(row.dueDate)}` : "No pay-by date"} · {lateText(row)}
      </p>
      <RowActions listKey="dues" row={row} ctx={ctx} />
    </li>
  );
}

function AlertTable({
  rows,
  listKey,
  moneyLabel,
  ctx,
}: {
  rows: CfoAlertRow[];
  listKey: CfoListKey;
  moneyLabel: string;
  ctx: Ctx;
}) {
  return (
    <div className="surface-card hidden overflow-x-auto md:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Plan</TableHead>
            <TableHead>Ends</TableHead>
            <TableHead>Last visit</TableHead>
            <TableHead className="text-right">{moneyLabel}</TableHead>
            <TableHead>Why</TableHead>
            <TableHead>
              <span className="sr-only">Call or message</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={`${r.clientId}-${r.kind}`}>
              <TableCell className="max-w-56">
                <NameBlock row={r} />
                {r.top ? (
                  <StatusPill tone="danger" className="mt-1">
                    Top priority
                  </StatusPill>
                ) : null}
              </TableCell>
              <TableCell className="max-w-40 truncate">{r.plan || "—"}</TableCell>
              <TableCell className="whitespace-nowrap">{dash(r.endDate)}</TableCell>
              <TableCell className="whitespace-nowrap">
                {r.lastVisit ? formatDay(r.lastVisit) : "None yet"}
              </TableCell>
              <TableCell className="text-right font-bold tabular-nums">
                {formatRupees(r.money)}
              </TableCell>
              <TableCell className="max-w-64 text-sm">{r.reason}</TableCell>
              <TableCell>
                <RowActions listKey={listKey} row={r} ctx={ctx} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function DueTable({ rows, ctx }: { rows: CfoDueRow[]; ctx: Ctx }) {
  return (
    <div className="surface-card hidden overflow-x-auto md:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Bill</TableHead>
            <TableHead>Pay by</TableHead>
            <TableHead className="text-right">Balance</TableHead>
            <TableHead>How late</TableHead>
            <TableHead>
              <span className="sr-only">Call or message</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.billId}>
              <TableCell className="max-w-56">
                <NameBlock row={r} />
              </TableCell>
              <TableCell className="max-w-48">
                <span className="block">{r.billNumber}</span>
                <span className="text-meta block truncate">{r.items}</span>
              </TableCell>
              <TableCell className="whitespace-nowrap">{dash(r.dueDate)}</TableCell>
              <TableCell className="text-right font-bold tabular-nums">
                {formatRupees(r.balance)}
              </TableCell>
              <TableCell className="whitespace-nowrap">{lateText(r)}</TableCell>
              <TableCell>
                <RowActions listKey="dues" row={r} ctx={ctx} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* ------------------------------------------------------------------ summaries */

function tabSentence(key: CfoListKey, snapshot: CfoSnapshot, s: CfoSettings) {
  const { count, total } = snapshot.lists[key];
  const n = formatCount(count);
  const money = formatRupees(total);
  switch (key) {
    case "atRisk":
      return `${n} ${plural(count, "member", "members")} not coming for ${s.atRiskDays}+ days, or coming much less than before. Their next renewals are worth ${money}.`;
    case "renewals":
      return `${n} ${plural(count, "plan ends", "plans end")} in the next ${s.renewalDays} days. Renewing ${count === 1 ? "it is" : "them is"} worth ${money}.`;
    case "newSlipping":
      return `${n} new ${plural(count, "member has", "members have")} visited fewer than ${s.newMemberMinVisits} times since joining. Their plans are worth ${money}.`;
    case "ptChances":
      return `${n} regular ${plural(count, "member has", "members have")} come ${s.ptMinVisits}+ times in 30 days and never tried personal training.${
        snapshot.ptFromPrice !== null
          ? ` Personal training starts from ${formatRupees(snapshot.ptFromPrice)}. If each bought the cheapest package, that is ${money}.`
          : ""
      }`;
    default:
      return `${n} ${plural(count, "bill still has", "bills still have")} money to pay: ${money} in total.`;
  }
}

const EMPTY_TEXT: Record<CfoListKey, string> = {
  atRisk: "Everyone with a running plan is coming to the gym.",
  renewals: "No plans end in this time, or they have already renewed.",
  newSlipping: "Every new member is visiting enough.",
  ptChances: "No regular member is waiting to be asked about personal training.",
  dues: "No bill has money pending.",
};

function DueGroups({ snapshot }: { snapshot: CfoSnapshot }) {
  const g = snapshot.dues.groups;
  const groups = ["notDue", "d0_7", "d8_30", "d30plus"] as const;
  return (
    <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {groups.map((k) => (
        <div key={k} className="rounded-lg border border-border bg-muted/40 p-3">
          <dt className="text-meta">{DUE_GROUP_LABEL[k]}</dt>
          <dd className="mt-0.5 font-bold tabular-nums">{formatRupees(g[k].amount)}</dd>
          <dd className="text-meta">
            {formatCount(g[k].count)} {plural(g[k].count, "bill", "bills")}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------------------------------------------------------------------- main */

export function ProblemLists({
  snapshot,
  settings,
  initialTab,
}: {
  snapshot: CfoSnapshot;
  settings: CfoSettings;
  initialTab?: CfoListKey | undefined;
}) {
  const [tab, setTab] = useState<CfoListKey>(initialTab ?? "atRisk");
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [loaded, setLoaded] = useState<Partial<Record<CfoListKey, Loaded>>>({});
  const asking = useRef(new Set<string>());

  const business = useLive(subscribeBusinessSettings, DEFAULT_BILLING_SETTINGS, []);
  const whatsapp = useLive(subscribeWhatsAppSettings, DEFAULT_WHATSAPP_SETTINGS, []);
  const ctx: Ctx = {
    gym: business.data.businessName || "the gym",
    countryCode: whatsapp.data.defaultCountryCode,
  };

  // The full list is read when its tab opens, and again after a Refresh made new numbers.
  const at = snapshot.computedAt;
  useEffect(() => {
    const have = loaded[tab];
    const id = `${tab}|${at}`;
    if ((have && have.at === at) || asking.current.has(id)) return;
    asking.current.add(id);
    void getCfoList<AnyRow>(tab)
      .then((doc) => setLoaded((l) => ({ ...l, [tab]: { at, doc, failed: false } })))
      .catch(() => setLoaded((l) => ({ ...l, [tab]: { at, doc: null, failed: true } })))
      .finally(() => asking.current.delete(id));
  }, [tab, at, loaded]);

  useEffect(() => setShown(PAGE), [tab, search]);

  const entry = loaded[tab];
  const loading = !entry || entry.at !== at;
  const summaryRows = snapshot.lists[tab].rows as AnyRow[];
  const allRows: AnyRow[] = entry?.doc?.rows ?? summaryRows;
  const total = snapshot.lists[tab].count;
  const truncated = entry?.doc?.truncated ?? 0;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allRows;
    const digits = q.replace(/\D/g, "");
    return allRows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.code.toLowerCase() === q ||
        (digits.length >= 3 && r.phone.replace(/\D/g, "").includes(digits)),
    );
  }, [allRows, search]);
  const visible = rows.slice(0, shown);
  const meta = LIST_META[tab];
  const sentence = tabSentence(tab, snapshot, settings);
  const fullyLoaded = !loading && !entry?.failed;
  const day = todayISO();

  const doExcel = () => downloadListExcel(tab, allRows, day);
  const doPrint = () => {
    if (!printList(tab, allRows, { gym: ctx.gym, line: sentence, day }))
      toast.error("The print window was blocked. Allow pop-ups for this page and try again.");
  };

  return (
    <section aria-labelledby="cfo-problems-title" className="space-y-3">
      <div>
        <h2 id="cfo-problems-title" className="text-section-title">
          Who needs a call
        </h2>
        <p className="text-meta mt-0.5">
          Alert lists. Pick a list, then call or message the member.
        </p>
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as CfoListKey)}>
        <div className="no-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList className="w-max">
            {CFO_LIST_KEYS.map((k) => (
              <TabsTrigger key={k} value={k} className="gap-1.5">
                {LIST_META[k].label}
                <span className="rounded-full bg-background/70 px-1.5 text-xs font-semibold tabular-nums">
                  {formatCount(snapshot.lists[k].count)}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value={tab} className="mt-3 space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <p className="max-w-3xl text-sm font-medium">{sentence}</p>
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!fullyLoaded && !summaryRows.length}
                onClick={doExcel}
              >
                <Download aria-hidden /> Excel
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!fullyLoaded && !summaryRows.length}
                onClick={doPrint}
              >
                <Printer aria-hidden /> Print
              </Button>
            </div>
          </div>
          {tab === "dues" ? <DueGroups snapshot={snapshot} /> : null}

          {total === 0 ? (
            <EmptyState icon={CheckCircle2} title="Nobody here" description={EMPTY_TEXT[tab]} />
          ) : (
            <>
              {total > PAGE / 2 || search ? (
                <div className="max-w-sm">
                  <SearchInput
                    value={search}
                    onValueChange={setSearch}
                    placeholder="Search name, phone or ID…"
                    label={`Search ${meta.label}`}
                  />
                </div>
              ) : null}
              {loading && !summaryRows.length ? <LoadingRows rows={4} /> : null}
              {loading && total > summaryRows.length ? (
                <p className="text-meta" role="status">
                  Showing the first {summaryRows.length}. Loading the full list…
                </p>
              ) : null}
              {entry?.failed ? (
                <p className="text-meta" role="status">
                  Couldn&apos;t load the full list. Showing the first {summaryRows.length} of{" "}
                  {formatCount(total)}.
                </p>
              ) : null}
              {truncated > 0 ? (
                <p className="text-meta">
                  Showing {formatCount(allRows.length)} of {formatCount(total)} (the longest lists
                  are cut short).
                </p>
              ) : null}
              {rows.length === 0 && search ? (
                <EmptyState
                  icon={CheckCircle2}
                  title="No match"
                  description="Nobody on this list matches your search."
                />
              ) : tab === "dues" ? (
                <>
                  <DueTable rows={visible as CfoDueRow[]} ctx={ctx} />
                  <ul className="grid gap-3 md:hidden">
                    {(visible as CfoDueRow[]).map((r) => (
                      <DueCard key={r.billId} row={r} ctx={ctx} />
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  <AlertTable
                    rows={visible as CfoAlertRow[]}
                    listKey={tab}
                    moneyLabel={meta.moneyLabel}
                    ctx={ctx}
                  />
                  <ul className="grid gap-3 md:hidden">
                    {(visible as CfoAlertRow[]).map((r) => (
                      <AlertCard
                        key={`${r.clientId}-${r.kind}`}
                        row={r}
                        listKey={tab}
                        moneyLabel={meta.moneyLabel}
                        ctx={ctx}
                      />
                    ))}
                  </ul>
                </>
              )}
              {rows.length > shown ? (
                <div className={cn("flex justify-center")}>
                  <Button variant="outline" onClick={() => setShown((n) => n + PAGE)}>
                    Show {Math.min(PAGE, rows.length - shown)} more
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </TabsContent>
      </Tabs>
    </section>
  );
}
