import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BadgeIndianRupee, CalendarClock, CheckCircle2, Dumbbell, Users, Wallet } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { StatCard } from "@/components/common/stat-card";
import { StatusPill } from "@/components/common/status-pill";
import { EmptyState } from "@/components/common/empty-state";
import { LoadingRows } from "@/components/common/loading-state";
import { useLive } from "@/hooks/use-live-query";
import { BOOKING_STATUS_META, formatDateISO, formatNumber, formatPrice, formatTime, todayISO } from "@/lib/format";
import { subscribePtAssignments, subscribeTrainers } from "@/services/pt.service";
import { subscribeTrainerBookings } from "@/services/bookings.service";
import { subscribePayments, subscribePayouts } from "@/services/finance.service";
import type { Booking, Payment, PtAssignment, Trainer, TrainerPayout } from "@/types/models";

export const Route = createFileRoute("/_authenticated/trainers/$trainerId")({
  head: () => ({ meta: [{ title: "Trainer Profile — REBUILD FITNESS" }, { name: "description", content: "Trainer PT members, sessions, collections and payouts." }, { property: "og:title", content: "Trainer Profile — REBUILD FITNESS" }, { property: "og:description", content: "Trainer PT members, sessions, collections and payouts." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: TrainerProfile,
});

function TrainerProfile() {
  const { trainerId } = Route.useParams();
  const trainers = useLive(subscribeTrainers, [] as Trainer[], []);
  const assignments = useLive(subscribePtAssignments, [] as PtAssignment[], []);
  const sessions = useLive((ok, fail) => subscribeTrainerBookings(trainerId, ok, fail), [] as Booking[], [trainerId]);
  const payouts = useLive(subscribePayouts, [] as TrainerPayout[], []);
  const payments = useLive(subscribePayments, [] as Payment[], []);
  const trainer = trainers.data.find((t) => t.id === trainerId);
  const today = todayISO();
  const s = useMemo(() => {
    const mine = assignments.data.filter((a) => a.trainerId === trainerId);
    const ids = new Set(mine.map((a) => a.id));
    const active = mine.filter((a) => a.status === "active" && a.endDate >= today);
    const pt = sessions.data.filter((b) => b.bookingType === "pt");
    // Collections = money actually received against this trainer's PT assignments (each payment counted once).
    const collected = payments.data.filter((p) => p.ptAssignmentId && ids.has(p.ptAssignmentId)).reduce((n, p) => n + p.ptGymAmount + p.trainerShareAmount, 0);
    const myPayouts = payouts.data.filter((p) => p.trainerId === trainerId && p.status !== "cancelled");
    return {
      active, upcoming: pt.filter((b) => b.status === "scheduled" && b.date >= today), completed: pt.filter((b) => b.status === "completed"),
      collected, share: myPayouts.reduce((n, p) => n + p.trainerShareAmount, 0),
      pending: myPayouts.filter((p) => p.status === "pending").reduce((n, p) => n + p.trainerShareAmount, 0),
    };
  }, [assignments.data, sessions.data, payouts.data, payments.data, trainerId, today]);

  if (trainers.loading) return <LoadingRows rows={4} />;
  if (!trainer) return <EmptyState icon={Users} title="Trainer not found" description="This trainer may have been removed." action={<Link to="/packages" className="font-semibold underline">Back to trainers</Link>} />;
  const cards = [
    { id: "clients", label: "Active PT Members", value: formatNumber(s.active.length), icon: Users, tone: "primary" as const },
    { id: "upcoming", label: "Upcoming PT Sessions", value: formatNumber(s.upcoming.length), icon: CalendarClock, tone: "info" as const },
    { id: "completed", label: "Completed PT Sessions", value: formatNumber(s.completed.length), icon: CheckCircle2, tone: "success" as const },
    { id: "collected", label: "Total PT Collections", value: formatPrice(s.collected), hint: "payments received for this trainer's PT", icon: BadgeIndianRupee, tone: "success" as const },
    { id: "share", label: "Trainer Share", value: formatPrice(s.share), hint: "from payout records", icon: Wallet, tone: "warning" as const },
    { id: "pending", label: "Pending Payout", value: formatPrice(s.pending), icon: Wallet, tone: "danger" as const },
  ];
  return (
    <div className="space-y-6">
      <PageHeader title={trainer.name} description={`${trainer.specialization || "Trainer"} · ${trainer.phone || "no phone"}`} breadcrumbs={[{ label: "Home", to: "/dashboard" }, { label: "Packages", to: "/packages" }, { label: trainer.name }]} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{cards.map((m) => <StatCard key={m.id} metric={m} />)}</div>
      <section className="surface-card overflow-hidden">
        <h2 className="text-card-title border-b border-border p-4">Active PT members</h2>
        {!s.active.length ? <p className="p-4 text-sm text-muted-foreground">No active PT members.</p> : <ul className="divide-y divide-border">{s.active.map((a) => (
          <li key={a.id} className="flex flex-wrap justify-between gap-2 p-4 text-sm"><Link to="/clients/$clientId" params={{ clientId: a.clientId }} className="font-semibold hover:underline">{a.clientNameSnapshot}</Link><span className="text-meta">{a.ptPackageNameSnapshot} · {formatDateISO(a.startDate)} – {formatDateISO(a.endDate)}</span></li>))}</ul>}
      </section>
      <section className="surface-card overflow-hidden">
        <h2 className="text-card-title border-b border-border p-4">Upcoming PT sessions</h2>
        {!s.upcoming.length ? <p className="p-4 text-sm text-muted-foreground">No upcoming sessions.</p> : <ul className="divide-y divide-border">{s.upcoming.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm"><span><b>{formatDateISO(b.date)}</b> · {formatTime(b.startTime)} · {b.clientNameSnapshot}</span><StatusPill tone={BOOKING_STATUS_META[b.status].tone}><Dumbbell className="size-3" /> {BOOKING_STATUS_META[b.status].label}</StatusPill></li>))}</ul>}
      </section>
    </div>
  );
}
