import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Fingerprint, Plus, Users } from "lucide-react";
import { z } from "zod";
import { PageHeader } from "@/components/common/page-header";
import { SearchInput } from "@/components/common/search-input";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadingRows } from "@/components/common/loading-state";
import { StatusPill } from "@/components/common/status-pill";
import { ClientAvatar } from "@/components/clients/client-avatar";
import { useEnrollment } from "@/components/enrollment/enrollment-context";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLive } from "@/hooks/use-live-query";
import { formatDate, formatDateISO, normalizePhone } from "@/lib/format";
import { daysLeftLabel, planByClient, type PlanSummary } from "@/lib/member-plans";
import { subscribeClients } from "@/services/clients.service";
import { subscribeMemberships } from "@/services/memberships.service";
import { subscribePtAssignments } from "@/services/pt.service";
import { isSetupPending } from "@/services/enrollment.service";
import type { Client, Membership, PtAssignment } from "@/types/models";

const FILTERS = ["all", "active", "pending", "expired", "none"] as const;
type Filter = (typeof FILTERS)[number];

export const Route = createFileRoute("/_authenticated/clients/")({
  validateSearch: z.object({ filter: z.enum(FILTERS).optional() }),
  head: () => ({
    meta: [
      { title: "Members — REBUILD FITNESS" },
      { name: "description", content: "Member profiles, memberships and history in one place." },
      { property: "og:title", content: "Clients — REBUILD FITNESS" },
      {
        property: "og:description",
        content: "Member profiles, memberships and history in one place.",
      },
    ],
  }),
  component: ClientsPage,
});

/** One status a front-desk person understands at a glance. */
function memberState(c: Client, plan: PlanSummary | undefined): Exclude<Filter, "all"> {
  if (isSetupPending(c)) return "pending";
  if (!plan) return "none";
  return plan.status === "active" || plan.status === "upcoming" ? "active" : "expired";
}

const PLAN_PILL: Record<
  PlanSummary["status"],
  { label: string; tone: "success" | "warning" | "danger" | "info" }
> = {
  waiting_thumb: { label: "Starts after thumb", tone: "warning" },
  upcoming: { label: "Upcoming", tone: "info" },
  active: { label: "Active", tone: "success" },
  expired: { label: "Expired", tone: "danger" },
};

const STATE_PILL: Record<
  Exclude<Filter, "all">,
  { label: string; tone: "success" | "warning" | "danger" | "info" }
> = {
  active: { label: "Active", tone: "success" },
  pending: { label: "Thumb pending", tone: "warning" },
  expired: { label: "Expired", tone: "danger" },
  none: { label: "No plan", tone: "info" },
};

function MembershipCell({ plan }: { plan: PlanSummary | undefined }) {
  if (!plan) return <span className="text-muted-foreground">No membership</span>;
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <span className="max-w-40 truncate font-medium">{plan.name}</span>
      <StatusPill tone={PLAN_PILL[plan.status].tone}>{PLAN_PILL[plan.status].label}</StatusPill>
    </div>
  );
}

function ExpiryCell({ plan }: { plan: PlanSummary | undefined }) {
  if (!plan) return <span className="text-muted-foreground">—</span>;
  const soon = plan.daysLeft >= 0 && plan.daysLeft <= 7;
  return (
    <div className="flex flex-col">
      <span className="tabular-nums">{formatDateISO(plan.endDate)}</span>
      <span
        className={
          soon || plan.daysLeft < 0 ? "text-xs font-semibold text-destructive" : "text-meta"
        }
      >
        {daysLeftLabel(plan)}
      </span>
    </div>
  );
}

function ClientsPage() {
  const navigate = useNavigate();
  const { data, loading, error } = useLive<Client[]>(subscribeClients, [], []);
  const memberships = useLive<Membership[]>(subscribeMemberships, [], []);
  const pts = useLive<PtAssignment[]>(subscribePtAssignments, [], []);
  const plans = useMemo(
    () => planByClient(memberships.data, pts.data),
    [memberships.data, pts.data],
  );
  const stateOf = (c: Client) => memberState(c, plans.get(c.id));
  const [search, setSearch] = useState("");
  const initial = Route.useSearch().filter ?? "all";
  const [filter, setFilter] = useState<Filter>(initial);
  const { openEnrollment, resumeSetup } = useEnrollment();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qPhone = normalizePhone(search);
    return data.filter((c) => {
      if (filter !== "all" && stateOf(c) !== filter) return false;
      if (!q) return true;
      return (
        c.fullName.toLowerCase().includes(q) ||
        c.clientCode.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        (qPhone.length >= 3 && c.phoneNormalized.includes(qPhone))
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, search, filter, plans]);

  const open = (id: string) =>
    void navigate({ to: "/clients/$clientId", params: { clientId: id } });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Members"
        description="Every member, their current plan and when it ends."
        breadcrumbs={[{ label: "Home", to: "/dashboard" }, { label: "Members" }]}
        actions={
          <Button onClick={() => openEnrollment()}>
            <Plus aria-hidden /> New member
          </Button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search name, phone or client ID…"
          label="Search clients"
          containerClassName="sm:max-w-md"
        />
        <Tabs
          value={filter}
          onValueChange={(v) => setFilter(v as Filter)}
          className="no-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"
        >
          <TabsList className="w-max">
            <TabsTrigger value="all">
              All <Count n={data.length} />
            </TabsTrigger>
            <TabsTrigger value="active">
              Active <Count n={data.filter((c) => stateOf(c) === "active").length} />
            </TabsTrigger>
            <TabsTrigger value="pending">
              Thumb pending <Count n={data.filter((c) => stateOf(c) === "pending").length} />
            </TabsTrigger>
            <TabsTrigger value="expired">
              Expired <Count n={data.filter((c) => stateOf(c) === "expired").length} />
            </TabsTrigger>
            <TabsTrigger value="none">
              No plan <Count n={data.filter((c) => stateOf(c) === "none").length} />
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {loading ? (
        <LoadingRows rows={6} />
      ) : error ? (
        <ErrorState error={error} title="Couldn't load clients" />
      ) : data.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No clients yet"
          description="Create your first client to start managing memberships."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => openEnrollment()}>
                <Plus aria-hidden /> New member
              </Button>
              <Button variant="outline" asChild>
                <Link to="/leads">View inquiries</Link>
              </Button>
            </div>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No matching clients"
          description="Try another name, phone or client ID."
        />
      ) : (
        <>
          <div className="surface-card hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Current membership</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead className="hidden lg:table-cell">Joined</TableHead>
                  <TableHead className="w-24">
                    <span className="sr-only">Open</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => open(c.id)}>
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-3">
                        <ClientAvatar name={c.fullName} url={c.profilePhotoUrl} size={36} />
                        <div className="min-w-0">
                          <Link
                            to="/clients/$clientId"
                            params={{ clientId: c.id }}
                            className="block max-w-48 truncate font-semibold hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {c.fullName}
                          </Link>
                          <p className="text-meta tabular-nums">
                            {c.clientCode}
                            {!c.profilePhotoUrl ? (
                              <span className="ml-1 font-semibold text-warning">· no photo</span>
                            ) : null}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{c.phone}</TableCell>
                    <TableCell>
                      <StatusPill tone={STATE_PILL[stateOf(c)].tone}>
                        {STATE_PILL[stateOf(c)].label}
                      </StatusPill>
                    </TableCell>
                    <TableCell>
                      <MembershipCell plan={plans.get(c.id)} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <ExpiryCell plan={plans.get(c.id)} />
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                      {formatDate(c.createdAt)}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {isSetupPending(c) ? (
                        <Button size="sm" onClick={() => resumeSetup(c)}>
                          <Fingerprint aria-hidden /> Resume
                        </Button>
                      ) : (
                        <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="grid gap-3 md:hidden">
            {filtered.map((c) => (
              <li key={c.id} className="space-y-2">
                <Link
                  to="/clients/$clientId"
                  params={{ clientId: c.id }}
                  className="surface-card flex items-center gap-3 p-4 transition-colors active:bg-accent"
                >
                  <ClientAvatar name={c.fullName} url={c.profilePhotoUrl} size={48} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-semibold">{c.fullName}</p>
                      <StatusPill tone={STATE_PILL[stateOf(c)].tone}>
                        {STATE_PILL[stateOf(c)].label}
                      </StatusPill>
                    </div>
                    <p className="text-meta mt-0.5 tabular-nums">
                      {c.clientCode} · {c.phone}
                      {!c.profilePhotoUrl ? (
                        <span className="font-semibold text-warning"> · no photo</span>
                      ) : null}
                    </p>
                    <p className="mt-1 truncate text-xs">
                      {plans.get(c.id)
                        ? `${plans.get(c.id)!.name} · ends ${formatDateISO(plans.get(c.id)!.endDate)} (${daysLeftLabel(plans.get(c.id)!)})`
                        : "No membership"}
                    </p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
                {isSetupPending(c) ? (
                  <Button className="h-11 w-full" onClick={() => resumeSetup(c)}>
                    <Fingerprint aria-hidden /> Finish joining — register thumb
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Count({ n }: { n: number }) {
  return <span className="ml-1 tabular-nums opacity-60">{n}</span>;
}
