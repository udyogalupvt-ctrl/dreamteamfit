import { Dumbbell, Fingerprint } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { StatusPill } from "@/components/common/status-pill";
import { useEnrollment } from "@/components/enrollment/enrollment-context";
import { useLive } from "@/hooks/use-live-query";
import { formatDateISO, formatPrice } from "@/lib/format";
import { subscribeClientPtAssignments } from "@/services/pt.service";
import { subscribeClientPayments } from "@/services/finance.service";
import type { Client } from "@/types/models";

export function ClientPtSection({ client }: { client: Client }) {
  const pts = useLive((ok, fail) => subscribeClientPtAssignments(client.id, ok, fail), [], [client.id]);
  const { openEnrollment } = useEnrollment();
  if (!pts.loading && !pts.data.length)
    return <EmptyState icon={Dumbbell} title="No personal training" description="Add PT through a new membership checkout." action={<Button onClick={() => openEnrollment({ existingClient: client })}>Add package / PT</Button>} />;
  return (
    <div className="grid gap-3">
      {pts.data.map((p) => (
        <article key={p.id} className="surface-card p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold">{p.ptPackageNameSnapshot}</p><StatusPill tone={p.status === "active" ? "success" : p.status === "pending" ? "warning" : "info"}>{p.status === "pending" ? "Pending biometric" : p.status}</StatusPill></div>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {[["Trainer", p.trainerNameSnapshot], ["Price", formatPrice(p.ptPrice)], ["Trainer share", `${formatPrice(p.trainerShareAmount)} (${p.trainerShareType === "percentage" ? `${p.trainerShareValue}%` : "fixed"})`], ["Gym share", formatPrice(p.gymShareAmount)], ["Start", formatDateISO(p.startDate)], ["End", formatDateISO(p.endDate)]].map(([k, v]) => (
              <div key={k}><dt className="text-meta">{k}</dt><dd className="font-semibold">{v}</dd></div>))}
          </dl>
        </article>
      ))}
    </div>
  );
}

export function ClientBiometricCard({ client }: { client: Client }) {
  const { openEnrollment } = useEnrollment();
  const allowed = client.biometricStatus === "active" && client.firstThumbRegistered && client.currentMembership?.status === "active";
  return (
    <section className="surface-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-card-title flex items-center gap-2"><Fingerprint className="size-4" /> Biometric</h2>
        <StatusPill tone={allowed ? "success" : "danger"}>{allowed ? "Access allowed" : "Access blocked"}</StatusPill>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        {[["Device", client.biometricDeviceId ? "Linked" : "—"], ["Biometric ID", client.biometricUserId || "—"], ["Status", client.biometricStatus.replace("_", " ")], ["First thumb", client.firstThumbRegistered ? "Registered" : "Not registered"]].map(([k, v]) => (
          <div key={k}><dt className="text-meta">{k}</dt><dd className="font-semibold capitalize">{v}</dd></div>))}
      </dl>
      {!client.firstThumbRegistered && client.enrollmentId ? (
        <Button className="mt-4" onClick={() => openEnrollment({ resumeEnrollmentId: client.enrollmentId })}><Fingerprint /> Complete Biometric Registration</Button>
      ) : null}
    </section>
  );
}

export function ClientPaymentsList({ clientId }: { clientId: string }) {
  const pays = useLive((ok, fail) => subscribeClientPayments(clientId, ok, fail), [], [clientId]);
  if (!pays.data.length) return null;
  return (
    <section className="surface-card overflow-hidden">
      <h3 className="text-card-title border-b border-border p-4">Payments</h3>
      <ul className="divide-y divide-border">
        {pays.data.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
            <span><b>{formatPrice(p.amount)}</b> · {p.method} · {formatDateISO(p.paymentDate)} <span className="text-meta">({p.kind === "balance" ? "balance payment" : "at checkout"} · {p.invoiceNumber})</span></span>
            <span className="text-meta">{p.ptGymAmount || p.trainerShareAmount ? `PT gym ${formatPrice(p.ptGymAmount)} · trainer ${formatPrice(p.trainerShareAmount)}` : `Membership ${formatPrice(p.membershipGymAmount)}`}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
