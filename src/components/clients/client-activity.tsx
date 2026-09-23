import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  CalendarCheck,
  CreditCard,
  DoorOpen,
  Fingerprint,
  History,
  Lock,
  MessageCircle,
  Phone,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import { Shimmer } from "@/components/common/loading-state";
import { useLive } from "@/hooks/use-live-query";
import { ACCESS_REASON_LABELS } from "@/lib/attendance-utils";
import { formatDateISO, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { subscribeClientAttendance } from "@/services/attendance.service";
import { subscribeClientAudit, auditGroupOf, type AuditEntry } from "@/services/audit.service";
import { subscribeClientBiometricCommands } from "@/services/biometric-devices.service";
import { subscribeClientPayments } from "@/services/finance.service";
import { subscribeLeadLogs } from "@/services/lead-logs.service";
import type {
  AttendanceEvent,
  BiometricCommand,
  Client,
  Invoice,
  LeadLog,
  Membership,
  Payment,
} from "@/types/models";

type Group = "money" | "plan" | "calls" | "entry" | "visits" | "messages" | "setup" | "other";
interface Item {
  key: string;
  at: Date;
  title: string;
  detail?: string;
  group: Group;
  actor: string;
  locked: boolean;
  changes?: AuditEntry["changes"];
}

const FILTERS: [Group | "all", string][] = [
  ["all", "All"],
  ["money", "Payments"],
  ["plan", "Plan & PT"],
  ["calls", "Calls"],
  ["entry", "Thumb & door"],
  ["visits", "Visits"],
  ["messages", "WhatsApp"],
];
const ICON: Record<Group, LucideIcon> = {
  money: CreditCard,
  plan: CalendarCheck,
  calls: Phone,
  entry: Fingerprint,
  visits: DoorOpen,
  messages: MessageCircle,
  setup: Settings2,
  other: History,
};

const COMMAND_TEXT: Record<string, [string, string]> = {
  user_upsert: ["Member sent to the fingerprint device", "Device"],
  enroll_fp: ["Thumb registration requested on the device", "Device"],
  query_fp: ["Device asked to confirm the new thumb", "Device"],
  delete_user: ["Removed from the door device", "System (automatic)"],
  restore_fp: ["Thumb restored on the door device", "System (automatic)"],
};

/**
 * Everything that happened to a member, newest first. Lines marked with a lock come from the
 * server-written activity log: they show which staff account did it and cannot be edited.
 */
export function ClientActivity({
  client,
  memberships,
  invoices,
}: {
  client: Client;
  memberships: Membership[];
  invoices: Invoice[];
}) {
  const audit = useLive<AuditEntry[]>(
    (ok, fail) => subscribeClientAudit(client.id, ok, fail),
    [],
    [client.id],
  );
  const visits = useLive<AttendanceEvent[]>(
    (ok, fail) => subscribeClientAttendance(client.id, ok, fail),
    [],
    [client.id],
  );
  const commands = useLive<BiometricCommand[]>(
    (ok, fail) => subscribeClientBiometricCommands(client.id, ok, fail),
    [],
    [client.id],
  );
  const payments = useLive<Payment[]>(
    (ok, fail) => subscribeClientPayments(client.id, ok, fail),
    [],
    [client.id],
  );
  const calls = useLive<LeadLog[]>(
    (ok, fail) => subscribeLeadLogs("clientId", client.id, ok, fail),
    [],
    [client.id],
  );
  const [filter, setFilter] = useState<Group | "all">("all");
  const [open, setOpen] = useState<string | null>(null);

  const items = useMemo(() => {
    const logged = new Set(
      audit.data.filter((a) => a.action === "created").map((a) => `${a.collection}:${a.docId}`),
    );
    const out: Item[] = audit.data.map((a) => ({
      key: `audit-${a.id}`,
      at: a.at,
      title: a.summary,
      group: auditGroupOf(a.collection) as Group,
      actor: a.actorName || "Unknown",
      locked: true,
      changes: a.changes,
    }));
    const add = (collection: string, id: string, item: Omit<Item, "key" | "locked">) => {
      if (!logged.has(`${collection}:${id}`))
        out.push({ ...item, key: `${collection}-${id}`, locked: false });
    };
    // Records from before the activity log existed (or kept elsewhere) fill the gaps.
    add("clients", client.id, {
      at: client.createdAt,
      title: `Member added (${client.clientCode})`,
      group: "other",
      actor: "from records",
    });
    memberships.forEach((m) =>
      add("memberships", m.id, {
        at: m.createdAt,
        title: `Plan added: ${m.packageNameSnapshot}`,
        detail: `${formatDateISO(m.startDate)} → ${formatDateISO(m.endDate)} · ${m.status.replace("_", " ")}`,
        group: "plan",
        actor: "from records",
      }),
    );
    invoices.forEach((i) =>
      add("invoices", i.id, {
        at: i.createdAt,
        title: `Bill ${i.invoiceNumber}: ${formatPrice(i.total)}`,
        detail: `Paid ${formatPrice(i.amountPaid)} · balance ${formatPrice(i.balanceDue)}`,
        group: "money",
        actor: i.createdBy || "from records",
      }),
    );
    payments.data.forEach((p) =>
      add("payments", p.id, {
        at: p.createdAt,
        title: `Payment ${formatPrice(p.amount)} by ${p.method}`,
        detail: `${p.invoiceNumber}${p.kind === "balance" ? " · balance" : ""}`,
        group: "money",
        actor: p.createdBy || "from records",
      }),
    );
    calls.data.forEach((l) =>
      add("leadLogs", l.id, {
        at: l.createdAt,
        title: `Call recorded: ${l.response}`,
        detail: [
          l.customerSaid && `“${l.customerSaid}”`,
          l.nextCallDate && `next call ${formatDateISO(l.nextCallDate)}`,
        ]
          .filter(Boolean)
          .join(" · "),
        group: "calls",
        actor: l.createdBy || "from records",
      }),
    );
    commands.data
      .filter((c) => c.status !== "cancelled" && COMMAND_TEXT[c.type])
      .forEach((c) => {
        const [title, actor] = COMMAND_TEXT[c.type]!;
        out.push({
          key: `cmd-${c.id}`,
          at: c.createdAt,
          title: c.status === "failed" ? `${title} — failed` : title,
          detail:
            c.status === "failed"
              ? c.error
              : c.status === "pending"
                ? "waiting for the device"
                : c.status === "sent"
                  ? "device received it"
                  : "device confirmed",
          group: "entry",
          actor,
          locked: false,
        });
      });
    visits.data.slice(0, 60).forEach((v) =>
      out.push({
        key: `visit-${v.id}`,
        at: v.timestamp,
        title:
          v.accessDecision === "allowed"
            ? v.eventType === "check_out"
              ? "Left the gym"
              : "Entered the gym"
            : "Entry refused",
        detail:
          v.accessDecision === "allowed"
            ? v.deviceNameSnapshot
            : ACCESS_REASON_LABELS[v.accessReason],
        group: "visits",
        actor: v.source === "manual" ? "Staff (by hand)" : "Fingerprint device",
        locked: false,
      }),
    );
    return out.sort((a, b) => b.at.getTime() - a.at.getTime());
  }, [
    audit.data,
    visits.data,
    commands.data,
    payments.data,
    calls.data,
    memberships,
    invoices,
    client,
  ]);

  const shown = filter === "all" ? items : items.filter((i) => i.group === filter);
  const loading = audit.loading || visits.loading || payments.loading;

  return (
    <section className="surface-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-section-title">Activity</h2>
        <span className="text-meta flex items-center gap-1">
          <Lock className="size-3.5" aria-hidden /> = recorded by the server, can't be edited
        </span>
      </div>
      <div
        className="no-scrollbar -mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0"
        role="tablist"
        aria-label="Activity type"
      >
        {FILTERS.map(([v, l]) => (
          <button
            key={v}
            role="tab"
            aria-selected={filter === v}
            onClick={() => setFilter(v)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1 text-xs font-semibold",
              filter === v
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border hover:bg-accent",
            )}
          >
            {l}
          </button>
        ))}
      </div>
      {loading ? (
        <Shimmer className="mt-4 h-40 w-full rounded-xl" />
      ) : !shown.length ? (
        <p className="text-meta py-8 text-center">Nothing here yet.</p>
      ) : (
        <ol className="mt-3 divide-y divide-border">
          {shown.map((it) => {
            const Icon = ICON[it.group];
            const changes = it.changes ? Object.entries(it.changes) : [];
            return (
              <li key={it.key} className="flex items-start gap-3 py-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted">
                  <Icon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold break-words">
                    {it.locked ? (
                      <Lock
                        className="mr-1 inline size-3 text-muted-foreground"
                        aria-label="Server recorded"
                      />
                    ) : null}
                    {it.title}
                  </p>
                  {it.detail ? <p className="text-meta break-words">{it.detail}</p> : null}
                  <p className="text-meta">
                    {format(it.at, "d MMM yyyy, h:mm a")} · {it.actor}
                  </p>
                  {changes.length ? (
                    <button
                      type="button"
                      className="text-meta mt-1 underline"
                      onClick={() => setOpen(open === it.key ? null : it.key)}
                    >
                      {open === it.key
                        ? "Hide changes"
                        : `Show ${changes.length} change${changes.length === 1 ? "" : "s"}`}
                    </button>
                  ) : null}
                  {open === it.key ? (
                    <dl className="mt-2 space-y-1 rounded-lg bg-muted/60 p-2 text-xs">
                      {changes.map(([k, v]) => (
                        <div key={k} className="break-words">
                          <dt className="inline font-semibold">{k}: </dt>
                          <dd className="inline">
                            {String(v.from ?? "—")} → {String(v.to ?? "—")}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
