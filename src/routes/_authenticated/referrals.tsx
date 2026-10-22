import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, Gift, Pencil, RotateCcw } from "lucide-react";
import { z } from "zod";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadingRows } from "@/components/common/loading-state";
import { usePeriodPicker } from "@/components/common/period-picker";
import { PageHeader } from "@/components/common/page-header";
import { SearchInput } from "@/components/common/search-input";
import { StatusPill } from "@/components/common/status-pill";
import {
  REFERRAL_TONE,
  RewardDialog,
  useReferralActions,
} from "@/components/referrals/reward-dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAccess } from "@/hooks/use-access";
import { useLive } from "@/hooks/use-live-query";
import { useReferralsBadge } from "@/hooks/use-referrals-badge";
import { formatDate, formatDateISO, formatNumber, formatPrice, todayISO } from "@/lib/format";
import { choicesWith } from "@/lib/periods";
import { REFERRAL_STATUS_LABELS, rewardLabel } from "@/lib/referrals";
import { getClientsByIds } from "@/services/clients.service";
import {
  subscribeReferralsByStatus,
  subscribeReferralsGivenBetween,
  subscribeReferralsJoinedBetween,
} from "@/services/referrals.service";
import type { Client, Referral } from "@/types/models";

const TABS = ["due", "promised", "given", "all"] as const;
type Tab = (typeof TABS)[number];

export const Route = createFileRoute("/_authenticated/referrals")({
  validateSearch: z.object({ tab: z.enum(TABS).optional() }),
  head: () => ({ meta: [{ title: "Referrals — REBUILD FITNESS" }] }),
  component: ReferralsPage,
});

/** Members as they are now (names change, members get deleted); undefined = still loading. */
function useCurrentMembers(rows: Referral[]) {
  const [known, setKnown] = useState<Map<string, Client | null>>(new Map());
  const ids = useMemo(
    () => [...new Set(rows.flatMap((r) => [r.referrerId, r.newClientId]))].sort().join(","),
    [rows],
  );
  useEffect(() => {
    const missing = ids.split(",").filter((id) => id && !known.has(id));
    if (!missing.length) return;
    let live = true;
    getClientsByIds(missing)
      .then((found) => {
        if (!live) return;
        setKnown((prev) => {
          const next = new Map(prev);
          for (const id of missing) next.set(id, found.find((c) => c.id === id) ?? null);
          return next;
        });
      })
      .catch(() => undefined); // the stored names still show
    return () => {
      live = false;
    };
    // `known` is read only to skip ids already fetched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);
  return known;
}

function planText(c: Client | null | undefined) {
  if (c === undefined) return "";
  if (c === null) return "Member deleted";
  const end = c.currentMembership?.endDate ?? "";
  if (!end) return "No plan";
  return end >= todayISO() ? `Plan till ${formatDateISO(end)}` : `Plan ended ${formatDateISO(end)}`;
}

function ReferralsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const tab: Tab = search.tab ?? "due";
  const setTab = (t: Tab) => void navigate({ search: { tab: t }, replace: true });
  const { can } = useAccess();
  const canDecide = can("referrals");
  const dueCount = useReferralsBadge();
  const given = usePeriodPicker("month", choicesWith("lastMonth", "all"), "Given between");
  const joined = usePeriodPicker("month", choicesWith("lastMonth", "all"), "Joined between");
  const [q, setQ] = useState("");
  const [deciding, setDeciding] = useState<Referral | null>(null);

  // Due and Promised: every open one, however old. Given and All: a period.
  const live = useLive<Referral[]>(
    tab === "due" || tab === "promised"
      ? (d, e) => subscribeReferralsByStatus(tab, d, e)
      : tab === "given"
        ? (d, e) => subscribeReferralsGivenBetween(given.period.from, given.period.to, d, e)
        : (d, e) => subscribeReferralsJoinedBetween(joined.period.from, joined.period.to, d, e),
    [],
    [tab, given.period.from, given.period.to, joined.period.from, joined.period.to],
  );
  const members = useCurrentMembers(live.data);

  // Current names when we have them (the stored ones are a fallback).
  const withNames = useMemo(
    () =>
      live.data.map((r) => ({
        ...r,
        referrerName: members.get(r.referrerId)?.fullName || r.referrerName,
        referrerCode: members.get(r.referrerId)?.clientCode || r.referrerCode,
        newClientName: members.get(r.newClientId)?.fullName || r.newClientName,
        newClientCode: members.get(r.newClientId)?.clientCode || r.newClientCode,
      })),
    [live.data, members],
  );

  const rows = useMemo(() => {
    const text = q.trim().toLowerCase();
    if (!text) return withNames;
    return withNames.filter(
      (r) =>
        r.referrerName.toLowerCase().includes(text) ||
        r.newClientName.toLowerCase().includes(text) ||
        r.referrerCode.toLowerCase() === text ||
        r.newClientCode.toLowerCase() === text,
    );
  }, [withNames, q]);

  const givenTotals = useMemo(() => {
    let days = 0;
    let off = 0;
    for (const r of rows) {
      if (r.status !== "given" || !r.reward) continue;
      if (r.reward.kind === "free_days") days += r.reward.days;
      if (r.reward.kind === "discount") off += r.reward.amount;
    }
    return { days, off };
  }, [rows]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Referrals"
        description="Members who brought a friend. Decide each reward here; free days go on their plan with Edit plan, money off at their next bill."
        breadcrumbs={[{ label: "Home", to: "/dashboard" }, { label: "Referrals" }]}
      />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList>
            <TabsTrigger value="due">
              Reward due
              {dueCount ? <span className="tabular-nums"> · {dueCount}</span> : null}
            </TabsTrigger>
            <TabsTrigger value="promised">Promised</TabsTrigger>
            <TabsTrigger value="given">Given</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="grid gap-2 sm:grid-cols-[16rem_auto]">
          <SearchInput
            value={q}
            onValueChange={setQ}
            placeholder="Search name or member ID…"
            label="Search referrals"
          />
          {tab === "given" ? given.picker : tab === "all" ? joined.picker : null}
        </div>
      </div>

      {tab === "given" && rows.length ? (
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground tabular-nums">{rows.length}</span> reward
          {rows.length === 1 ? "" : "s"} given
          {givenTotals.days ? (
            <>
              {" · "}
              <span className="tabular-nums">{formatNumber(givenTotals.days)}</span> free days
            </>
          ) : null}
          {givenTotals.off ? (
            <>
              {" · "}
              <span className="tabular-nums">{formatPrice(givenTotals.off)}</span> off bills
            </>
          ) : null}
        </p>
      ) : null}

      {live.error ? <ErrorState error={live.error} title="Couldn't load referrals" /> : null}
      {live.loading ? (
        <LoadingRows rows={3} />
      ) : !rows.length ? (
        <EmptyState
          icon={Gift}
          title={
            q.trim()
              ? "No one matches"
              : tab === "due"
                ? "No rewards waiting"
                : tab === "promised"
                  ? "No promised rewards"
                  : "Nothing here"
          }
          description={
            q.trim()
              ? "Try another name or member ID."
              : tab === "due"
                ? "When a new member's Source is Referral, pick who sent them in Referred by. They show up here."
                : tab === "promised"
                  ? "Rewards you promise for a member's next renewal wait here until you mark them given."
                  : "Nothing in these dates."
          }
        />
      ) : (
        <ul aria-label="Referrals" className="grid gap-3 xl:grid-cols-2">
          {rows.map((r) => (
            <ReferralCard
              key={r.id}
              item={r}
              referrer={members.get(r.referrerId)}
              friend={members.get(r.newClientId)}
              canDecide={canDecide}
              onDecide={() => setDeciding(r)}
            />
          ))}
        </ul>
      )}
      {deciding ? (
        <RewardDialog referral={deciding} onOpenChange={(v) => !v && setDeciding(null)} />
      ) : null}
    </div>
  );
}

function Person({
  id,
  name,
  code,
  member,
}: {
  id: string;
  name: string;
  code: string;
  member: Client | null | undefined;
}) {
  const label = (
    <>
      {name || "Member"}
      {code ? <span className="font-normal text-muted-foreground"> #{code}</span> : null}
    </>
  );
  return (
    <div className="min-w-0">
      {member === null ? (
        <p className="truncate font-semibold text-muted-foreground">{label}</p>
      ) : (
        <Link
          to="/clients/$clientId"
          params={{ clientId: id }}
          className="block truncate font-semibold hover:underline"
        >
          {label}
        </Link>
      )}
      <p className="text-meta">{planText(member)}</p>
    </div>
  );
}

function ReferralCard({
  item: r,
  referrer,
  friend,
  canDecide,
  onDecide,
}: {
  item: Referral;
  referrer: Client | null | undefined;
  friend: Client | null | undefined;
  canDecide: boolean;
  onDecide: () => void;
}) {
  const { busy, markGiven, reopen } = useReferralActions();
  const reward = rewardLabel(r.reward);
  return (
    <li className="surface-card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={REFERRAL_TONE[r.status]}>{REFERRAL_STATUS_LABELS[r.status]}</StatusPill>
        {reward ? <span className="text-sm font-semibold">{reward}</span> : null}
        <span className="ml-auto text-meta tabular-nums">Joined {formatDateISO(r.joinedOn)}</span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-3">
        <Person id={r.referrerId} name={r.referrerName} code={r.referrerCode} member={referrer} />
        <ArrowRight className="mt-1 size-4 text-muted-foreground" aria-label="brought" />
        <Person id={r.newClientId} name={r.newClientName} code={r.newClientCode} member={friend} />
      </div>
      {r.status === "skipped" && r.reason ? (
        <p className="text-sm break-words">
          <span className="text-muted-foreground">Why: </span>
          {r.reason}
        </p>
      ) : null}
      {r.status !== "due" && r.decidedBy ? (
        <p className="text-meta">
          {r.status === "given" && r.givenOn
            ? `Given ${formatDateISO(r.givenOn)}`
            : `Decided ${formatDate(r.decidedAt)}`}{" "}
          · by {r.decidedBy}
        </p>
      ) : null}
      {canDecide ? (
        <div className="mt-auto flex flex-wrap items-center gap-2">
          {r.status === "due" ? (
            <Button size="sm" onClick={onDecide}>
              <Gift aria-hidden /> Record reward
            </Button>
          ) : null}
          {r.status === "promised" ? (
            <Button size="sm" disabled={busy} onClick={() => void markGiven(r)}>
              <CheckCircle2 aria-hidden /> Mark given
            </Button>
          ) : null}
          {r.status !== "due" ? (
            <>
              <Button size="sm" variant="outline" onClick={onDecide}>
                <Pencil aria-hidden /> Change
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void reopen(r)}>
                <RotateCcw aria-hidden /> Reopen
              </Button>
            </>
          ) : null}
        </div>
      ) : r.status === "due" ? (
        <p className="text-meta">The owner decides the reward.</p>
      ) : null}
    </li>
  );
}
