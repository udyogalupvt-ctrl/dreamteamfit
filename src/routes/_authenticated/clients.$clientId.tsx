import { useState } from "react";
import { PhotoLinkButtons } from "@/components/clients/photo-link-button";
import { useAccess } from "@/hooks/use-access";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Camera,
  ChevronDown,
  CreditCard,
  Fingerprint,
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
  PauseCircle,
  XCircle,
  MoreHorizontal,
  Trash2,
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
import { ClientActivity } from "@/components/clients/client-activity";
import { DeleteMemberDialog } from "@/components/clients/delete-member-dialog";
import {
  ClientBiometricCard,
  ClientPaymentsList,
  ClientPtSection,
} from "@/components/clients/client-pt-section";
import { useEnrollment } from "@/components/enrollment/enrollment-context";
import { AddWorkoutDialog } from "@/components/clients/add-workout-dialog";
import { AddDietDialog } from "@/components/clients/add-diet-dialog";
import { ClientBookingsSection } from "@/components/clients/client-bookings-section";
import { ClientAttendanceSection } from "@/components/clients/client-attendance-section";
import { ClientFollowUpsSection } from "@/components/clients/client-followups-section";
import { InvoiceActions } from "@/components/billing/invoice-actions";
import { BookingFormDialog } from "@/components/scheduling/booking-form-dialog";
import { AssignmentSection } from "@/components/clients/assignment-section";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isSetupPending } from "@/services/enrollment.service";
import { useLive } from "@/hooks/use-live-query";
import {
  MEMBERSHIP_STATUS_META,
  SOURCE_LABELS,
  effectiveMembershipStatus,
  formatDate,
  formatDateISO,
  formatPrice,
  INVOICE_STATUS_META,
} from "@/lib/format";
import { toneIcon } from "@/lib/tone";
import { cn } from "@/lib/utils";
import { memberIdLabel, subscribeClient, updateClient } from "@/services/clients.service";
import {
  cancelMembership,
  subscribeClientMemberships,
  undoLastPause,
} from "@/services/memberships.service";
import { PausePlanDialog } from "@/components/clients/pause-plan-dialog";
import {
  subscribeClientWorkoutAssignments,
  updateWorkoutAssignmentStatus,
} from "@/services/workout-assignments.service";
import {
  subscribeClientDietAssignments,
  updateDietAssignmentStatus,
} from "@/services/diet-assignments.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { subscribeClientBookings } from "@/services/bookings.service";
import { subscribeClientEnrollments } from "@/services/class-enrollments.service";
import { subscribeGroupClasses } from "@/services/group-classes.service";
import { subscribeClientInvoices } from "@/services/invoices.service";
import type {
  Booking,
  ClassEnrollment,
  Client,
  DietAssignment,
  GroupClass,
  Invoice,
  Membership,
  WorkoutAssignment,
} from "@/types/models";
import type { StatTone } from "@/types";
import { CLOUDINARY_CLIENT_FOLDER } from "@/constants/navigation";

export const Route = createFileRoute("/_authenticated/clients/$clientId")({
  head: () => ({
    meta: [
      { title: "Member profile — REBUILD FITNESS" },
      { name: "description", content: "Member details, memberships and activity." },
      { property: "og:title", content: "Member profile — REBUILD FITNESS" },
      { property: "og:description", content: "Member details, memberships and activity." },
    ],
  }),
  component: ClientProfilePage,
});

function ClientProfilePage() {
  const { clientId } = Route.useParams();
  const client = useLive<Client | null>((ok, fail) => subscribeClient(clientId, ok, fail), null, [
    clientId,
  ]);
  const memberships = useLive<Membership[]>(
    (ok, fail) => subscribeClientMemberships(clientId, ok, fail),
    [],
    [clientId],
  );
  const workouts = useLive<WorkoutAssignment[]>(
    (ok, fail) => subscribeClientWorkoutAssignments(clientId, ok, fail),
    [],
    [clientId],
  );
  const diets = useLive<DietAssignment[]>(
    (ok, fail) => subscribeClientDietAssignments(clientId, ok, fail),
    [],
    [clientId],
  );
  const bookings = useLive<Booking[]>(
    (ok, fail) => subscribeClientBookings(clientId, ok, fail),
    [],
    [clientId],
  );
  const enrollments = useLive<ClassEnrollment[]>(
    (ok, fail) => subscribeClientEnrollments(clientId, ok, fail),
    [],
    [clientId],
  );
  const groupClasses = useLive<GroupClass[]>(subscribeGroupClasses, [], []);
  const invoices = useLive<Invoice[]>(
    (ok, fail) => subscribeClientInvoices(clientId, ok, fail),
    [],
    [clientId],
  );
  const [editOpen, setEditOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const { openEnrollment, resumeSetup } = useEnrollment();
  const [tab, setTab] = useState("overview");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { can } = useAccess();
  const [addWorkoutOpen, setAddWorkoutOpen] = useState(false);
  const [addDietOpen, setAddDietOpen] = useState(false);
  const [addBookingOpen, setAddBookingOpen] = useState(false);
  const [cancelling, setCancelling] = useState<Membership | null>(null);
  const [pausing, setPausing] = useState<Membership | null>(null);

  const crumbs = [
    { label: "Home", to: "/dashboard" },
    { label: "Members", to: "/clients" },
    { label: client.data?.fullName ?? "Profile" },
  ];

  if (client.loading) return <ProfileSkeleton />;
  if (client.error)
    return (
      <div className="space-y-6">
        <PageHeader title="Member profile" breadcrumbs={crumbs} />
        <ErrorState error={client.error} title="Couldn't load this member" />
      </div>
    );
  if (!client.data)
    return (
      <div className="space-y-6">
        <PageHeader title="Member not found" breadcrumbs={crumbs} />
        <EmptyState
          icon={UserRoundX}
          title="This member doesn't exist"
          description="It may have been removed, or the link is wrong."
          action={
            <Button asChild>
              <Link to="/clients">Back to members</Link>
            </Button>
          }
        />
      </div>
    );

  const c = client.data;
  const withStatus = memberships.data.map((m) => ({
    ...m,
    effective: effectiveMembershipStatus(m),
  }));
  const current = withStatus.find((m) => m.effective === "active") ?? null;
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
            <Button
              variant="outline"
              onClick={() => (isSetupPending(c) ? resumeSetup(c) : setEditOpen(true))}
            >
              <Pencil aria-hidden /> Edit
            </Button>
            {isSetupPending(c) ? null : (
              <Button onClick={() => openEnrollment({ existingClient: c })}>
                <Plus aria-hidden /> Renew / add package
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="More actions">
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                  <Pencil aria-hidden /> Edit details only
                </DropdownMenuItem>
                {can("deleteMembers") ? (
                  <DropdownMenuItem
                    onSelect={() => setDeleteOpen(true)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 aria-hidden /> Delete member
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {!c.profilePhotoUrl ? (
        <section className="flex flex-col gap-3 rounded-2xl border border-warning/50 bg-warning/10 p-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="font-bold">Photo missing</p>
            <p className="text-sm text-muted-foreground">
              Every member needs a photo. Edit the member to take it, or send them the upload link.
            </p>
          </div>
          <PhotoLinkButtons client={c} />
        </section>
      ) : null}

      {isSetupPending(c) ? (
        <section
          role="alert"
          className="flex flex-col gap-3 rounded-2xl border border-warning/50 bg-warning/10 p-4 sm:flex-row sm:items-center"
        >
          <Fingerprint className="size-8 shrink-0 text-warning" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-bold">Joining not finished — thumb not registered</p>
            <p className="text-sm text-muted-foreground">
              Payment is saved, but the membership starts and entry opens only after the first thumb
              is registered on the device.
            </p>
          </div>
          <Button size="lg" onClick={() => resumeSetup(c)}>
            <Fingerprint aria-hidden /> Resume setup
          </Button>
        </section>
      ) : null}

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
              {memberIdLabel(c.clientCode)}
            </span>
            {isSetupPending(c) ? (
              <StatusPill tone="warning">Thumb pending</StatusPill>
            ) : c.biometricStatus === "disabled" ? (
              <StatusPill tone="danger">Entry blocked</StatusPill>
            ) : current ? (
              <StatusPill tone="success">Active member</StatusPill>
            ) : (
              <StatusPill tone="info">No active plan</StatusPill>
            )}
          </div>
          <div className="mt-3 flex flex-col gap-1.5 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-x-5">
            <a
              href={`tel:${c.phone}`}
              className="flex items-center gap-1.5 tabular-nums hover:text-foreground"
            >
              <Phone className="size-4" aria-hidden /> {c.phone}
            </a>
            {c.email ? (
              <a
                href={`mailto:${c.email}`}
                className="flex min-w-0 items-center gap-1.5 hover:text-foreground"
              >
                <Mail className="size-4 shrink-0" aria-hidden />{" "}
                <span className="truncate">{c.email}</span>
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
            <p className="mt-1 text-sm text-muted-foreground">
              {withStatus.some((m) => m.effective === "biometric_pending")
                ? "Starts after thumb registration"
                : "None active"}
            </p>
          )}
        </div>
      </section>

      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <div className="no-scrollbar -mx-4 flex items-center gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList className="w-max">
            <TabsTrigger value="overview">Profile</TabsTrigger>
            <TabsTrigger value="membership">Plan</TabsTrigger>
            <TabsTrigger value="billing">Payments</TabsTrigger>
            <TabsTrigger value="attendance">Visits</TabsTrigger>
            <TabsTrigger value="followups">Calls</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={MORE_TABS.some(([v]) => v === tab) ? "secondary" : "ghost"}
                size="sm"
                className="shrink-0"
              >
                {MORE_TABS.find(([v]) => v === tab)?.[1] ?? "More"} <ChevronDown aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {MORE_TABS.map(([v, label]) => (
                <DropdownMenuItem key={v} onSelect={() => setTab(v)}>
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <TabsContent value="overview" className="grid gap-4 lg:grid-cols-2">
          <ClientBiometricCard client={c} />
          <section className="surface-card p-5">
            <h2 className="text-section-title">Profile</h2>
            <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
              <Detail label="Full name" value={c.fullName} />
              <Detail label="Member ID" value={c.clientCode} />
              <Detail label="Date of birth" value={formatDateISO(c.dateOfBirth)} />
              <Detail
                label="Gender"
                value={
                  c.gender === "unspecified" ? "—" : c.gender[0]!.toUpperCase() + c.gender.slice(1)
                }
              />
              <Detail label="Source" value={SOURCE_LABELS[c.source]} />
              <Detail
                label="Origin"
                value={
                  c.inquiryId ? (
                    <Link to="/leads" className="font-semibold underline underline-offset-2">
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
              <Detail
                icon={ShieldAlert}
                label="Emergency contact"
                value={c.emergencyContact || "—"}
              />
              <Detail
                icon={MessageSquareHeart}
                label="WhatsApp"
                value={c.whatsappOptIn ? `Opted in · ${c.whatsappPhone || c.phone}` : "Opted out"}
              />
            </dl>
          </section>
        </TabsContent>

        <TabsContent value="workout">
          <AssignmentSection
            kind="workout"
            items={workouts.data}
            loading={workouts.loading}
            error={workouts.error}
            onAdd={() => setAddWorkoutOpen(true)}
            onClose={(item) =>
              void updateWorkoutAssignmentStatus(item.id, "cancelled").then(
                () =>
                  toast.success("Workout plan cancelled", { description: item.planNameSnapshot }),
                (error) => toast.error(firestoreErrorMessage(error)),
              )
            }
          />
        </TabsContent>

        <TabsContent value="diet">
          <AssignmentSection
            kind="diet"
            items={diets.data}
            loading={diets.loading}
            error={diets.error}
            onAdd={() => setAddDietOpen(true)}
            onClose={(item) =>
              void updateDietAssignmentStatus(item.id, "cancelled").then(
                () => toast.success("Diet plan cancelled", { description: item.planNameSnapshot }),
                (error) => toast.error(firestoreErrorMessage(error)),
              )
            }
          />
        </TabsContent>

        <TabsContent value="bookings">
          <ClientBookingsSection
            bookings={bookings.data}
            enrollments={enrollments.data}
            classes={groupClasses.data}
            loading={bookings.loading || enrollments.loading || groupClasses.loading}
            error={bookings.error ?? enrollments.error ?? groupClasses.error}
            onAdd={() => setAddBookingOpen(true)}
          />
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
              description="Assign a package to start this member's first membership."
              action={
                <Button onClick={() => openEnrollment({ existingClient: c })}>
                  <Plus aria-hidden /> Add membership
                </Button>
              }
            />
          ) : (
            <>
              {current ? (
                <MembershipHero
                  m={current}
                  onCancel={() => setCancelling(current)}
                  onPause={can("packages") ? () => setPausing(current) : undefined}
                  onUndoPause={
                    can("packages")
                      ? () =>
                          void undoLastPause(
                            current,
                            c.currentMembership?.membershipId === current.id,
                          ).then(
                            (end) =>
                              toast.success("Pause undone", {
                                description: `Ends ${formatDateISO(end)} again`,
                              }),
                            (e) => toast.error(firestoreErrorMessage(e)),
                          )
                      : undefined
                  }
                />
              ) : null}
              {upcoming.length ? (
                <p className="text-sm text-muted-foreground">
                  {upcoming.length} upcoming membership{upcoming.length > 1 ? "s" : ""} scheduled.
                </p>
              ) : null}
              <section className="surface-card overflow-hidden">
                <h2 className="text-section-title border-b border-border p-5">
                  Membership history
                </h2>
                <ul className="divide-y divide-border">
                  {withStatus.map((m) => (
                    <li
                      key={m.id}
                      className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{m.packageNameSnapshot}</p>
                        <p className="text-meta">
                          {formatDateISO(m.startDate)} → {formatDateISO(m.endDate)} ·{" "}
                          {m.durationDaysSnapshot} days
                        </p>
                      </div>
                      <div className="flex items-center justify-between gap-3 sm:justify-end">
                        <span className="font-semibold tabular-nums">
                          {formatPrice(m.priceSnapshot)}
                        </span>
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

        <TabsContent value="pt">
          <ClientPtSection client={c} />
        </TabsContent>
        <TabsContent value="billing" className="space-y-4">
          {invoices.loading ? (
            <Shimmer className="h-40 rounded-2xl" />
          ) : invoices.error ? (
            <ErrorState error={invoices.error} title="Couldn't load invoices" />
          ) : invoices.data.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="No billing records yet"
              description="Create a bill for this member to begin their invoice history."
              action={
                <Button asChild>
                  <Link to="/billing" search={{ create: true, clientId: c.id }}>
                    <Plus /> Create bill
                  </Link>
                </Button>
              }
            />
          ) : (
            <section className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ["Total Invoices", String(invoices.data.length)],
                  ["Total Paid", formatPrice(invoices.data.reduce((n, i) => n + i.amountPaid, 0))],
                  ["Outstanding", formatPrice(invoices.data.reduce((n, i) => n + i.balanceDue, 0))],
                ].map(([label, value]) => (
                  <div className="surface-card p-4" key={label}>
                    <p className="text-meta">{label}</p>
                    <p className="mt-1 text-xl font-extrabold">{value}</p>
                  </div>
                ))}
              </div>
              <div className="surface-card divide-y divide-border">
                {invoices.data.map((i) => (
                  <article className="p-4 sm:p-5" key={i.id}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-bold">{i.invoiceNumber}</p>
                          <StatusPill tone={INVOICE_STATUS_META[i.paymentStatus].tone}>
                            {INVOICE_STATUS_META[i.paymentStatus].label}
                          </StatusPill>
                        </div>
                        <p className="text-meta">
                          {formatDateISO(i.invoiceDate)} · Total {formatPrice(i.total)} · Paid{" "}
                          {formatPrice(i.amountPaid)} · Balance {formatPrice(i.balanceDue)}
                        </p>
                      </div>
                      <InvoiceActions invoice={i} />
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
          <ClientPaymentsList clientId={c.id} />
        </TabsContent>
        <TabsContent value="attendance">
          <ClientAttendanceSection client={c} memberships={memberships.data} />
        </TabsContent>
        <TabsContent value="followups">
          <ClientFollowUpsSection client={c} />
        </TabsContent>
        <TabsContent value="activity">
          <ClientActivity client={c} memberships={memberships.data} invoices={invoices.data} />
        </TabsContent>
      </Tabs>

      <ClientFormDialog open={editOpen} onOpenChange={setEditOpen} client={c} />
      <DeleteMemberDialog client={c} open={deleteOpen} onOpenChange={setDeleteOpen} />
      <AddWorkoutDialog open={addWorkoutOpen} onOpenChange={setAddWorkoutOpen} clientId={c.id} />
      <AddDietDialog open={addDietOpen} onOpenChange={setAddDietOpen} clientId={c.id} />
      <BookingFormDialog open={addBookingOpen} onOpenChange={setAddBookingOpen} initialClient={c} />
      <PhotoDialog open={photoOpen} onOpenChange={setPhotoOpen} client={c} />
      <PausePlanDialog
        membership={pausing}
        isCurrent={!!pausing && c.currentMembership?.membershipId === pausing.id}
        onClose={() => setPausing(null)}
      />
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

const MORE_TABS = [
  ["pt", "Personal training"],
  ["workout", "Workout plan"],
  ["diet", "Diet plan"],
  ["bookings", "Bookings"],
] as const;

function MembershipHero({
  m,
  onCancel,
  onPause,
  onUndoPause,
}: {
  m: Membership;
  onCancel: () => void;
  /** Only for logins allowed to change plans. */
  onPause: (() => void) | undefined;
  onUndoPause: (() => void) | undefined;
}) {
  const total = Math.max(1, m.durationDaysSnapshot);
  const daysLeft = Math.max(
    0,
    Math.ceil(
      (new Date(`${m.endDate}T00:00:00`).getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000,
    ),
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
          Paid snapshot{" "}
          <span className="font-semibold tabular-nums">{formatPrice(m.priceSnapshot)}</span>
        </p>
        <div className="flex flex-wrap gap-1">
          {onPause ? (
            <Button variant="outline" size="sm" onClick={onPause}>
              <PauseCircle aria-hidden /> Pause
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <XCircle aria-hidden /> Cancel
          </Button>
        </div>
      </div>
      {m.pauses.length ? (
        <div className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
          {m.pauses.map((p, i) => (
            <p key={i} className="text-meta">
              Paused {p.days} days on {formatDateISO(p.on)} ({p.reason}
              {p.note ? `: ${p.note}` : ""}) by {p.by}
            </p>
          ))}
          {onUndoPause ? (
            <Button variant="link" size="sm" className="h-auto p-0" onClick={onUndoPause}>
              Undo last pause
            </Button>
          ) : null}
        </div>
      ) : null}
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
        label="Member photo"
        squarePhoto
        folder={CLOUDINARY_CLIENT_FOLDER}
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
