import { useEffect, useState } from "react";
import { ArchiveRestore, Link2, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { formatDateISO, formatPrice, joinedOnOf } from "@/lib/format";
import {
  oldJoinedOn,
  pickOldMember,
  runningOldPlan,
  tidyName,
  type OldMember,
  type OldPlan,
} from "@/lib/old-data";
import { updateClient, type ClientUpdateInput } from "@/services/clients.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { lookupOldMembers } from "@/services/old-data.service";
import type { Client } from "@/types/models";

/**
 * The member's record in the old gym software (from the Backup page): when they joined there and
 * every plan with its money and bill number. Shows nothing when the phone isn't in the old data.
 */
export function OldHistoryCard({ client, className }: { client: Client; className?: string }) {
  const [found, setFound] = useState<{ phone: string; members: OldMember[]; today: string }>({
    phone: "",
    members: [],
    today: "",
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    lookupOldMembers(client.phone).then(
      (r) => live && setFound({ phone: client.phone, ...r }),
      // No "Members" access or no old data: the card stays hidden.
      () => live && setFound({ phone: client.phone, members: [], today: "" }),
    );
    return () => {
      live = false;
    };
  }, [client.phone]);

  if (found.phone !== client.phone || !found.members.length) return null;

  const linked = client.oldMemberId
    ? (found.members.find((m) => m.memberId === client.oldMemberId) ?? null)
    : null;

  const link = async (m: OldMember) => {
    setBusy(true);
    const joined = oldJoinedOn(m);
    const patch: ClientUpdateInput = { oldMemberId: m.memberId };
    // The old joining date only moves it earlier, never over a date someone typed in.
    if (!client.joinedOn && joined && joined < joinedOnOf(client)) patch.joinedOn = joined;
    if (!client.dateOfBirth && m.dob) patch.dateOfBirth = m.dob;
    if (client.gender === "unspecified" && m.gender !== "unspecified") patch.gender = m.gender;
    try {
      await updateClient(client.id, patch);
      toast.success("Linked to the old software", {
        description: patch.joinedOn
          ? `Joining date set to ${formatDateISO(patch.joinedOn)}`
          : `Old member ID ${m.memberId}`,
      });
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (m: OldMember) => {
    setBusy(true);
    const patch: ClientUpdateInput = { oldMemberId: "" };
    if (client.joinedOn && client.joinedOn === oldJoinedOn(m)) patch.joinedOn = "";
    try {
      await updateClient(client.id, patch);
      toast.success("Unlinked from the old software");
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!linked) {
    const best = pickOldMember(found.members, client.fullName);
    return (
      <section
        className={`rounded-2xl border border-info/40 bg-info/10 p-5 ${className ?? ""}`}
        aria-label="Old software"
      >
        <h2 className="text-section-title flex items-center gap-2">
          <ArchiveRestore className="size-5" aria-hidden /> Found in the old software
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {client.oldMemberId
            ? `Linked to old member ${client.oldMemberId}, which isn't in the latest old data. Pick the right one:`
            : "This phone number is in the old software. Link it to see the old plans here and in the member app."}
        </p>
        <ul className="mt-3 space-y-2">
          {found.members.map((m) => (
            <li
              key={m.memberId || m.name}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-background/70 p-3"
            >
              <div className="min-w-0">
                <p className="font-semibold">
                  {tidyName(m.name)}{" "}
                  <span className="font-mono text-xs text-muted-foreground">{m.memberId}</span>
                  {best === m && found.members.length > 1 ? (
                    <span className="ml-1 text-xs font-normal text-success">(name matches)</span>
                  ) : null}
                </p>
                <p className="text-meta">
                  Joined {formatDateISO(oldJoinedOn(m))} · {m.plans.length} plan
                  {m.plans.length === 1 ? "" : "s"}
                  {m.plans[0] ? ` · last: ${m.plans[0].name}` : ""}
                </p>
              </div>
              <Button size="sm" disabled={busy} onClick={() => void link(m)}>
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Link2 aria-hidden />}
                Link
              </Button>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const running = found.today ? runningOldPlan(linked, found.today) : null;
  const balance = linked.plans.reduce((s, p) => s + Math.max(0, p.balance), 0);
  const paid = linked.plans.reduce((s, p) => s + paidOf(p), 0);
  const details: [string, string][] = (
    [
      ["Old member ID", linked.memberId],
      ["Joined the gym", formatDateISO(oldJoinedOn(linked))],
      ["Registered", formatDateISO(linked.registeredOn)],
      ["Status there", linked.status],
      ["Date of birth", linked.dob ? formatDateISO(linked.dob) : ""],
      ["Married", linked.married],
      ["Anniversary", linked.anniversary ? formatDateISO(linked.anniversary) : ""],
      ["Counsellor", linked.counsellor],
      ["Email", linked.email],
      ["Address", linked.address],
      ["Remark", linked.remark],
    ] as [string, string][]
  ).filter(([, v]) => v && v !== "—");

  return (
    <section
      className={`surface-card overflow-hidden ${className ?? ""}`}
      aria-label="Old software"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
        <div className="min-w-0">
          <h2 className="text-section-title flex items-center gap-2">
            <ArchiveRestore className="size-5" aria-hidden /> Old software record
          </h2>
          <p className="text-meta mt-0.5">
            {tidyName(linked.name)} · {linked.plans.length} plan
            {linked.plans.length === 1 ? "" : "s"} · paid {formatPrice(paid)}
            {balance > 0 ? ` · balance ${formatPrice(balance)}` : ""}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void unlink(linked)}
          title="Unlink this old record"
        >
          <X aria-hidden /> Not this person
        </Button>
      </div>
      <dl className="grid gap-4 p-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {details.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-meta">{label}</dt>
            <dd className="mt-0.5 font-medium break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {linked.plans.length ? (
        <>
          <h3 className="border-t border-border px-5 pt-4 text-sm font-semibold">
            Plans in the old software
          </h3>
          <ul className="divide-y divide-border">
            {linked.plans.map((p, i) => (
              <li key={`${p.start}-${p.name}-${i}`} className="space-y-1 px-5 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 font-semibold">{p.name || "Plan"}</p>
                  <PlanState plan={p} running={running === p} today={found.today} />
                  {p.balance > 0 ? (
                    <StatusPill tone="warning">Balance {formatPrice(p.balance)}</StatusPill>
                  ) : null}
                </div>
                <p className="text-meta tabular-nums">
                  {formatDateISO(p.start)} → {formatDateISO(p.end)}
                  {p.balance > 0 && p.nextPayment
                    ? ` · balance promised ${formatDateISO(p.nextPayment)}`
                    : ""}
                </p>
                <p className="text-meta tabular-nums">
                  Price {formatPrice(p.price)}
                  {p.discount ? ` · discount ${formatPrice(p.discount)}` : ""} · to pay{" "}
                  {formatPrice(p.amount)} · paid {formatPrice(paidOf(p))}
                  {p.bill ? ` · bill no. ${p.bill}` : ""}
                  {p.counsellor ? ` · ${p.counsellor}` : ""}
                </p>
                {p.remark && !/^bill\s*no\W*\w+$/i.test(p.remark) ? (
                  <p className="text-meta italic">{p.remark}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

/**
 * From the dates: the old software leaves every plan "Active" even after it ended, so only a
 * different word it used (Inactive, Cancelled…) is shown as it is.
 */
function PlanState({ plan, running, today }: { plan: OldPlan; running: boolean; today: string }) {
  if (plan.status && !/^active$/i.test(plan.status))
    return <StatusPill tone="violet">{plan.status}</StatusPill>;
  if (running) return <StatusPill tone="success">Running</StatusPill>;
  if (!today || !plan.end) return null;
  if (plan.start > today) return <StatusPill tone="info">Upcoming</StatusPill>;
  return plan.end < today ? <StatusPill tone="violet">Ended</StatusPill> : null;
}

/** Paid in the old software: the amount to be paid less what was still due. */
const paidOf = (p: OldPlan) => Math.max(0, p.amount - Math.max(0, p.balance));
