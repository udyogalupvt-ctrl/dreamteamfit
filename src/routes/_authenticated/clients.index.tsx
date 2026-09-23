import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Plus, Users } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { SearchInput } from "@/components/common/search-input";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadingRows } from "@/components/common/loading-state";
import { StatusPill } from "@/components/common/status-pill";
import { ClientAvatar } from "@/components/clients/client-avatar";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
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
import {
  MEMBERSHIP_STATUS_META,
  effectiveMembershipStatus,
  formatDate,
  formatDateISO,
  normalizePhone,
} from "@/lib/format";
import { subscribeClients } from "@/services/clients.service";
import type { Client } from "@/types/models";

export const Route = createFileRoute("/_authenticated/clients/")({
  head: () => ({
    meta: [
      { title: "Clients — FORGE" },
      { name: "description", content: "Member profiles, memberships and history in one place." },
      { property: "og:title", content: "Clients — FORGE" },
      { property: "og:description", content: "Member profiles, memberships and history in one place." },
    ],
  }),
  component: ClientsPage,
});

type Filter = "all" | "active" | "inactive";

function MembershipCell({ client }: { client: Client }) {
  const m = client.currentMembership;
  if (!m) return <span className="text-muted-foreground">No membership</span>;
  const status = effectiveMembershipStatus(m);
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <span className="max-w-40 truncate font-medium">{m.packageName}</span>
      <StatusPill tone={MEMBERSHIP_STATUS_META[status].tone}>{MEMBERSHIP_STATUS_META[status].label}</StatusPill>
    </div>
  );
}

function ClientsPage() {
  const navigate = useNavigate();
  const { data, loading, error } = useLive<Client[]>(subscribeClients, [], []);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [formOpen, setFormOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qPhone = normalizePhone(search);
    return data.filter((c) => {
      if (filter !== "all" && c.status !== filter) return false;
      if (!q) return true;
      return (
        c.fullName.toLowerCase().includes(q) ||
        c.clientCode.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        (qPhone.length >= 3 && c.phoneNormalized.includes(qPhone))
      );
    });
  }, [data, search, filter]);

  const open = (id: string) => void navigate({ to: "/clients/$clientId", params: { clientId: id } });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients"
        description="Every member, their current plan and when it ends."
        breadcrumbs={[{ label: "Home", to: "/dashboard" }, { label: "Clients" }]}
        actions={
          <Button onClick={() => setFormOpen(true)}>
            <Plus aria-hidden /> New client
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
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="inactive">Inactive</TabsTrigger>
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
          description="Add a client directly, or convert an inquiry once they decide to join."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => setFormOpen(true)}>
                <Plus aria-hidden /> New client
              </Button>
              <Button variant="outline" asChild>
                <Link to="/inquiries">View inquiries</Link>
              </Button>
            </div>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Users} title="No matching clients" description="Try another name, phone or client ID." />
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
                  <TableHead className="w-10">
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
                          <p className="text-meta tabular-nums">{c.clientCode}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{c.phone}</TableCell>
                    <TableCell>
                      <StatusPill tone={c.status === "active" ? "success" : "warning"}>
                        {c.status === "active" ? "Active" : "Inactive"}
                      </StatusPill>
                    </TableCell>
                    <TableCell>
                      <MembershipCell client={c} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDateISO(c.currentMembership?.endDate)}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                      {formatDate(c.createdAt)}
                    </TableCell>
                    <TableCell>
                      <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="grid gap-3 md:hidden">
            {filtered.map((c) => (
              <li key={c.id}>
                <Link
                  to="/clients/$clientId"
                  params={{ clientId: c.id }}
                  className="surface-card flex items-center gap-3 p-4 transition-colors active:bg-accent"
                >
                  <ClientAvatar name={c.fullName} url={c.profilePhotoUrl} size={48} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-semibold">{c.fullName}</p>
                      <StatusPill tone={c.status === "active" ? "success" : "warning"}>
                        {c.status === "active" ? "Active" : "Inactive"}
                      </StatusPill>
                    </div>
                    <p className="text-meta mt-0.5 tabular-nums">
                      {c.clientCode} · {c.phone}
                    </p>
                    <p className="mt-1 truncate text-xs">
                      {c.currentMembership
                        ? `${c.currentMembership.packageName} · ends ${formatDateISO(c.currentMembership.endDate)}`
                        : "No membership"}
                    </p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <ClientFormDialog open={formOpen} onOpenChange={setFormOpen} />
    </div>
  );
}
