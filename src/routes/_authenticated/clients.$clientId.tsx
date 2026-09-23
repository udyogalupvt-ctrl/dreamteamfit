import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  CalendarCheck,
  Camera,
  CreditCard,
  History,
  Mail,
  MapPin,
  MessageSquareHeart,
  Pencil,
  Phone,
  Plus,
  ShieldAlert,
  UserRoundX,
  Wallet,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Shimmer } from "@/components/common/loading-state";
import { StatusPill } from "@/components/common/status-pill";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { FormDialog } from "@/components/common/form-dialog";
import { ImageUpload } from "@/components/common/image-upload";
import { ClientAvatar } from "@/components/clients/client-avatar";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { AddMembershipDialog } from "@/components/clients/add-membership-dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLive } from "@/hooks/use-live-query";
import {
  MEMBERSHIP_STATUS_META,
  SOURCE_LABELS,
  effectiveMembershipStatus,
  formatDate,
  formatDateISO,
  formatPrice,
} from "@/lib/format";
import { toneIcon } from "@/lib/tone";
import { cn } from "@/lib/utils";
import { subscribeClient, updateClient } from "@/services/clients.service";
import { cancelMembership, subscribeClientMemberships } from "@/services/memberships.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import type { Client, Membership } from "@/types/models";
import type { StatTone } from "@/types";

export const Route = createFileRoute("/_authenticated/clients/$clientId")({
  head: () => ({
    meta: [
      { title: "Client profile — FORGE" },
      { name: "description", content: "Client details, memberships and activity." },
      { property: "og:title", content: "Client profile — FORGE" },
      { property: "og:description", content: "Client details, memberships and activity." },
    ],
  }),
  component: ClientProfilePage,
});

function ClientProfilePage() {
  const { clientId } = Route.useParams();
  const client = useLive<Client | null>(
    (ok, fail) => subscribeClient(clientId, ok, fail),
    null,
    [clientId],
  );
  const memberships = useLive<Membership[]>(
    (ok, fail) => subscribeClientMemberships(clientId, ok, fail),
    [],
    [clientId],
  );
  const [editOpen, setEditOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [cancelling, setCancelling] = useState<Membership | null>(null);

  const crumbs = [
    { label: "Home", to: "/dashboard" },
    { label: "Clients", to: "/clients" },
    { label: client.data?.fullName ?? "Profile" },
  ];

  if (client.loading) return <ProfileSkeleton />;
  if (client.error)
    return (
      <div className="space-y-6">
        <PageHeader title="Client profile" breadcrumbs={crumbs} />
        <ErrorState error={client.error} title="Couldn't load this client" />
      </div>
    );
  if (!client.data)
    return (
      <div className="space-y-6">
        <PageHeader title="Client not found" breadcrumbs={crumbs} />
        <EmptyState
          icon={UserRoundX}
          title="This client doesn't exist"
          description="It may have been removed, or the link is wrong."
          action={
            <Button asChild>
              <Link to="/clients">Back to clients</Link>
            </Button>
          }
        />
      </div>
    );

  const c = client.data;
  const withStatus = memberships.data.map((m) => ({ ...m, effective: effectiveMembershipStatus(m) }));
  const current =
    withStatus.find((m) => m.effective === "active") ?? null;
  const upcoming = withStatus.filter((m) => m.effective === "pending");

  const confirmCancel = async () => {
    if (!cancelling) return;
    const m = cancelling;
    setCancelling(null);
    try {
      await cancelMembership(m, c.currentMembership?.membershipId);
      toast.success("Membership cancelled", { description: m.packageNameSnapshot });
    } catch (err) {
      toast.error(firestoreErrorMessage(err));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={c.fullName}
        breadcrumbs={crumbs}
        actions={
          <>
            <Button variant="outline" asChild className="max-sm:hidden">
              <Link to="/clients">
                <ArrowLeft aria-hidden /> All clients
              </Link>
            </Button>
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil aria-hidden /> Edit
            </Button>
            <Button onClick={() => setAddOpen(true)}>
              <Plus aria-hidden /> Add membership
            </Button>
          </>
        }
      />

      {/* Profile hero */}
      <section className="surface-card flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
        <div className="relative self-start">
          <ClientAvatar name={c.fullName} url={c.profilePhotoUrl} size={88} />
          <button
            type="button"
            onClick={() => setPhotoOpen(true)}
            aria-label="Change profile photo"
            className="absolute -right-1 -bottom-1 grid size-8 cursor-pointer place-items-center rounded-full border border-border bg-surface shadow-sm transition-colors hover:bg-accent"
          >
            <Camera className="size-4" aria-hidden />
          </button>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs font-semibold tabular-nums">
              {c.clientCode}
            </span>
            <StatusPill tone={c.status === "active" ? "success" : "warning"}>
              {c.status === "active" ? "Active client" : "Inactive client"}
            </StatusPill>
          </div>
          <div className="mt-3 flex flex-col gap-1.5 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-x-5">
            <a href={`tel:${c.phone}`} className="flex items-center gap-1.5 tabular-nums hover:text-foreground">
              <Phone className="size-4" aria-hidden /> {c.phone}
            </a>
            {c.email ? (
              <a href={`mailto:${c.email}`} className="flex min-w-0 items-center gap-1.5 hover:text-foreground">
                <Mail className="size-4 shrink-0" aria-hidden /> <span className="truncate">{c.email}</span>
              </a>
            ) : null}
            <span>Joined {formatDate(c.createdAt)}</span>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-muted/40 p-4 sm:min-w-56">
          <p className="text-eyebrow">Current membership</p>
          {current ? (
            <>
              <p className="mt-1 truncate font-semibold">{current.packageNameSnapshot}</p>
              <p className="text-meta">Ends {formatDateISO(current.endDate)}</p>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">None active</p>
          )}
        </div>
      </section>

      <Tabs defaultValue="overview" className="gap-4">
        <div className="no-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList className="w-max">
            <TabsTrigger value="overview">Profile</TabsTrigger>
            <TabsTrigger value="membership">Membership</TabsTrigger>
            <TabsTrigger value="billing">Billing</TabsTrigger>
            <TabsTrigger value="attendance">Attendance</TabsTrigger>
            <TabsTrigger value="followups">Follow-ups</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="grid gap-4 lg:grid-cols-2">
          <section className="surface-card p-5">
            <h2 className="text-section-title">Profile</h2>
            <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
              <Detail label="Full name" value={c.fullName} />
              <Detail label="Client ID" value={c.clientCode} />
              <Detail label="Date of birth" value={formatDateISO(c.dateOfBirth)} />
              <Detail
                label="Gender"
                value={c.gender === "unspecified" ? "—" : c.gender[0]!.toUpperCase() + c.gender.slice(1)}
              />
              <Detail label="Source" value={SOURCE_LABELS[c.source]} />
              <Detail
                label="Origin"
                value={
                  c.inquiryId ? (
                    <Link to="/inquiries" className="font-semibold underline underline-offset-2">
                      Converted inquiry
                    </Link>
                  ) : (
                    "Added directly"
                  )
                }
              />
            </dl>
            {c.notes ? (
              <div className="mt-4">
                <p className="text-meta">Notes</p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{c.notes}</p>
              </div>
            ) : null}
          </section>
          <section className="surface-card p-5">
            <h2 className="text-section-title">Contact information</h2>
            <dl className="mt-4 grid gap-4 text-sm">
              <Detail icon={Phone} label="Phone" value={c.phone} />
              <Detail icon={Mail} label="Email" value={c.email || "—"} />
              <Detail icon={MapPin} label="Address" value={c.address || "—"} />
              <Detail icon={ShieldAlert} label="Emergency contact" value={c.emergencyContact || "—"} />
            </dl>
          </section>
        </TabsContent>

        <TabsContent value="membership" className="space-y-4">
          {memberships.loading ? (
            <Shimmer className="h-32 w-full rounded-2xl" />
          ) : memberships.error ? (
            <ErrorState error={memberships.error} title="Couldn't load memberships" />
          ) : withStatus.length === 0 ? (
            <EmptyState
              icon={CreditCard}
              title="No membership records yet"
              description="Assign a package to start this client's first membership."
              action={
                <Button onClick={() => setAddOpen(true)}>
                  <Plus aria-hidden /> Add membership
                </Button>
              }
            />
          ) : (
            <>
              {current ? <MembershipHero m={current} onCancel={() => setCancelling(current)} /> : null}
              {upcoming.length ? (
                <p className="text-sm text-muted-foreground">
                  {upcoming.length} upcoming membership{upcoming.length > 1 ? "s" : ""} scheduled.
                </p>
              ) : null}
              <section className="surface-card overflow-hidden">
                <h2 className="text-section-title border-b border-border p-5">Membership history</h2>
                <ul className="divide-y divide-border">
                  {withStatus.map((m) => (
                    <li key={m.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{m.packageNameSnapshot}</p>
                        <p className="text-meta">
                          {formatDateISO(m.startDate)} → {formatDateISO(m.endDate)} · {m.durationDaysSnapshot} days
                        </p>
                      </div>
                      <div className="flex items-center justify-between gap-3 sm:justify-end">
                        <span className="font-semibold tabular-nums">{formatPrice(m.priceSnapshot)}</span>
                        <StatusPill tone={MEMBERSHIP_STATUS_META[m.effective].tone}>
                          {MEMBERSHIP_STATUS_META[m.effective].label}
                        </StatusPill>
                        {m.effective === "active" || m.effective === "pending" ? (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Cancel ${m.packageNameSnapshot}`}
                            onClick={() => setCancelling(m)}
                          >
                            <XCircle aria-hidden />
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </TabsContent>

        <TabsContent value="billing">
          <EmptyState
            icon={Wallet}
            title="No billing records yet"
            description="Invoices and payments for this client will appear here once billing is enabled."
          />
        </TabsContent>
        <TabsContent value="attendance">
          <EmptyState
            icon={CalendarCheck}
            title="No attendance records yet"
            description="Check-ins will appear here once attendance tracking is connected."
          />
        </TabsContent>
        <TabsContent value="followups">
          <EmptyState
            icon={MessageSquareHeart}
            title="No follow-ups yet"
            description="Scheduled calls and reminders for this client will appear here."
          />
        </TabsContent>
        <TabsContent value="activity">
          <ActivityTimeline client={c} memberships={memberships.data} />
        </TabsContent>
      </Tabs>

      <ClientFormDialog open={editOpen} onOpenChange={setEditOpen} client={c} />
      <AddMembershipDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        clientId={c.id}
        activeMembership={current}
      />
      <PhotoDialog open={photoOpen} onOpenChange={setPhotoOpen} client={c} />
      <ConfirmDialog
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
        title={`Cancel ${cancelling?.packageNameSnapshot ?? "membership"}?`}
        description="The membership will be marked as cancelled. Its record stays in history."
        confirmLabel="Cancel membership"
        cancelLabel="Keep it"
        destructive
        onConfirm={() => void confirmCancel()}
      />
    </div>
  );
}

function MembershipHero({ m, onCancel }: { m: Membership; onCancel: () => void }) {
  const total = Math.max(1, m.durationDaysSnapshot);
  const daysLeft = Math.max(
    0,
    Math.ceil((new Date(`${m.endDate}T00:00:00`).getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000),
  );
  const pct = Math.min(100, Math.round(((total - daysLeft) / total) * 100));
  return (
    <section className="surface-card relative overflow-hidden p-5">
      <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-success" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-eyebrow">Active membership</p>
          <h2 className="text-section-title mt-1 truncate">{m.packageNameSnapshot}</h2>
          <p className="text-meta">
            {formatDateISO(m.startDate)} → {formatDateISO(m.endDate)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-stat">{daysLeft}</p>
          <p className="text-meta">days left</p>
        </div>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-border">
        <div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          Paid snapshot <span className="font-semibold tabular-nums">{formatPrice(m.priceSnapshot)}</span>
        </p>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <XCircle aria-hidden /> Cancel
        </Button>
      </div>
    </section>
  );
}

function ActivityTimeline({ client, memberships }: { client: Client; memberships: Membership[] }) {
  const items: { id: string; title: string; when: Date; tone: StatTone; icon: typeof History }[] = [
    { id: "created", title: client.inquiryId ? "Converted from inquiry" : "Client profile created", when: client.createdAt, tone: "primary" as StatTone, icon: History },
    ...memberships.map((m) => ({
      id: m.id,
      title: `Membership added · ${m.packageNameSnapshot} (${formatDateISO(m.startDate)} → ${formatDateISO(m.endDate)})`,
      when: m.createdAt,
      tone: "success" as StatTone,
      icon: CreditCard,
    })),
  ].sort((a, b) => b.when.getTime() - a.when.getTime());

  return (
    <section className="surface-card p-5">
      <h2 className="text-section-title">Activity</h2>
      <ul className="mt-3 divide-y divide-border">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <li key={it.id} className="flex items-start gap-3 py-3">
              <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg ring-1 ring-inset", toneIcon[it.tone])}>
                <Icon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{it.title}</p>
                <p className="text-meta">{formatDate(it.when)}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PhotoDialog({
  open,
  onOpenChange,
  client,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  client: Client;
}) {
  const save = async (url: string | null) => {
    try {
      await updateClient(client.id, { profilePhotoUrl: url });
      toast.success(url ? "Profile photo updated" : "Profile photo removed");
    } catch (err) {
      toast.error(firestoreErrorMessage(err));
    }
  };
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Profile photo"
      description="Uploaded securely to your media library."
      footer={<Button onClick={() => onOpenChange(false)}>Done</Button>}
    >
      <ImageUpload
        key={open ? "open" : "closed"}
        label="Client photo"
        folder="forge/clients"
        value={
          client.profilePhotoUrl
            ? { url: client.profilePhotoUrl, publicId: "", width: 0, height: 0, format: "" }
            : null
        }
        onChange={(img) => void save(img?.url ?? null)}
      />
    </FormDialog>
  );
}

function Detail({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  icon?: typeof Phone;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-meta flex items-center gap-1.5">
        {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
        {label}
      </dt>
      <dd className="mt-0.5 break-words font-semibold">{value}</dd>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Shimmer className="h-4 w-40" />
      <Shimmer className="h-9 w-64" />
      <div className="surface-card flex items-center gap-5 p-5">
        <Shimmer className="size-22 rounded-full" />
        <div className="flex-1 space-y-2">
          <Shimmer className="h-4 w-1/3" />
          <Shimmer className="h-4 w-1/2" />
        </div>
      </div>
      <Shimmer className="h-48 w-full rounded-2xl" />
    </div>
  );
}
