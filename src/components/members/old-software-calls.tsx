import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2, MessageCircle, Phone, PhoneCall, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { SearchInput } from "@/components/common/search-input";
import { StatusPill } from "@/components/common/status-pill";
import { useEnrollment } from "@/components/enrollment/enrollment-context";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useLive } from "@/hooks/use-live-query";
import { formatDate, formatDateISO, formatPrice, normalizePhone } from "@/lib/format";
import { CALL_STATUS_LABELS, CALL_STATUSES, type CallStatus } from "@/lib/member-segments";
import { tidyName, type OldMember } from "@/lib/old-data";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp-phone";
import { subscribeClients } from "@/services/clients.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { saveMemberCall, type MemberCall } from "@/services/member-calls.service";
import { addOldToCallList } from "@/services/old-data.service";
import {
  DEFAULT_WHATSAPP_SETTINGS,
  subscribeWhatsAppSettings,
} from "@/services/whatsapp-settings.service";
import type { Client } from "@/types/models";

/**
 * Member calls → Old software: people from the old software who have not come back since the
 * machine was reset. Someone who is a member here with a registered thumb has come back and
 * leaves the list on their own.
 */
export function OldSoftwareCalls({ calls }: { calls: MemberCall[] }) {
  const clients = useLive<Client[]>(subscribeClients, [], []);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | CallStatus>("all");
  const [showBack, setShowBack] = useState(false);
  const [adding, setAdding] = useState(false);

  // The member here, matched by old member ID, else by phone.
  const memberOf = useMemo(() => {
    const byOldId = new Map<string, Client>();
    const byPhone = new Map<string, Client>();
    clients.data.forEach((c) => {
      if (c.oldMemberId) byOldId.set(c.oldMemberId, c);
      byPhone.set(normalizePhone(c.phone), c);
    });
    return (c: MemberCall) => byOldId.get(c.old?.memberId ?? "") ?? byPhone.get(c.phoneKey) ?? null;
  }, [clients.data]);

  const all = useMemo(
    () =>
      calls
        .filter((c) => c.segment === "old" && c.old)
        .map((c) => {
          const member = memberOf(c);
          return { call: c, member, back: !!member?.firstThumbRegistered };
        }),
    [calls, memberOf],
  );
  const notBack = all.filter((r) => !r.back).length;
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return all
      .filter((r) => showBack || !r.back)
      .filter((r) => status === "all" || r.call.status === status)
      .filter(
        (r) =>
          !q ||
          r.call.old!.name.toLowerCase().includes(q) ||
          r.call.old!.memberId.toLowerCase().includes(q) ||
          (digits.length >= 3 && r.call.phoneKey.includes(digits)),
      )
      .sort((a, b) =>
        (a.call.old!.plans[0]?.end ?? "").localeCompare(b.call.old!.plans[0]?.end ?? ""),
      );
  }, [all, search, status, showBack]);

  const bringIn = async () => {
    setAdding(true);
    try {
      const r = await addOldToCallList();
      toast.success(
        r.added
          ? `${r.added} old member${r.added === 1 ? "" : "s"} put on the list`
          : "Nobody new to add",
        {
          description: `Everyone whose old plan runs today and who has no thumb here yet${r.already ? ` (${r.already} already on the list)` : ""}.`,
        },
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-section-title">Old software · not back yet · {notBack}</h2>
          <p className="text-meta mt-1">
            They were members in the old software and have no thumb here yet. Call them; when one
            comes in, tap Add as member. They leave this list once their thumb is registered.
          </p>
        </div>
        <Button variant="outline" disabled={adding} onClick={() => void bringIn()}>
          {adding ? <Loader2 className="animate-spin" aria-hidden /> : <Users aria-hidden />} Bring
          in everyone not back yet
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-[16rem_12rem_auto] sm:items-center">
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Name, phone or old ID…"
          label="Search old members"
        />
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger aria-label="Filter by call status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All call statuses</SelectItem>
            {CALL_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {CALL_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={showBack}
            onChange={(e) => setShowBack(e.target.checked)}
          />
          Show who came back ({all.length - notBack})
        </label>
      </div>
      {!rows.length ? (
        <EmptyState
          icon={PhoneCall}
          title={all.length ? "Nobody here" : "No old members on the list yet"}
          description={
            all.length
              ? "No one matches these filters."
              : "Tap Bring in everyone not back yet, or use Call on Backup → Old members."
          }
        />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {rows.map((r) => (
            <OldCallRow key={r.call.key} call={r.call} member={r.member} back={r.back} />
          ))}
        </ul>
      )}
    </section>
  );
}

function OldCallRow({
  call,
  member,
  back,
}: {
  call: MemberCall;
  member: Client | null;
  back: boolean;
}) {
  const old = call.old as OldMember;
  const { user } = useAuth();
  const { openEnrollment } = useEnrollment();
  const wa = useLive(subscribeWhatsAppSettings, DEFAULT_WHATSAPP_SETTINGS, []);
  const [notes, setNotes] = useState(call.notes);
  useEffect(() => setNotes(call.notes), [call.notes]);
  const name = tidyName(old.name);
  const phone = normalizeWhatsAppPhone(old.phone || call.phoneKey, wa.data.defaultCountryCode);
  const last = old.plans[0];
  const save = async (next: { status?: CallStatus; notes?: string }) => {
    try {
      await saveMemberCall(
        call.key,
        {
          clientId: member?.id ?? "",
          clientName: name,
          segment: "old",
          status: next.status ?? call.status,
          notes: next.notes ?? notes,
        },
        user?.displayName || user?.email || "Staff",
      );
      if (next.status) toast.success(`${name}: ${CALL_STATUS_LABELS[next.status]}`);
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    }
  };
  const facts: [string, string][] = (
    [
      ["Joined", formatDateISO(old.registeredOn)],
      ["Gender", old.gender === "unspecified" ? "" : old.gender],
      ["Date of birth", formatDateISO(old.dob)],
      ["Email", old.email],
      ["Address", old.address],
      ["Counsellor", old.counsellor],
      ["Old status", old.status],
      ["Remark", old.remark],
    ] as [string, string][]
  ).filter(([, v]) => v && v !== "—");

  return (
    <li className="surface-card space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">
            {name} <span className="font-mono text-xs text-muted-foreground">{old.memberId}</span>
          </p>
          <p className="text-meta tabular-nums">{old.phone || call.phoneKey}</p>
          {last ? (
            <p className="mt-1 text-sm">
              Last plan: {last.name} · {formatDateISO(last.start)} → {formatDateISO(last.end)}
              {last.balance > 0 ? ` · balance ${formatPrice(last.balance)}` : " · fully paid"}
            </p>
          ) : null}
        </div>
        {back ? (
          <StatusPill tone="success">Came back</StatusPill>
        ) : member ? (
          <StatusPill tone="warning">Member, thumb pending</StatusPill>
        ) : null}
      </div>
      {facts.length ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
          {facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0 break-words">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {old.plans.length ? (
        <details className="rounded-lg border border-border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">
            All {old.plans.length} old plan{old.plans.length === 1 ? "" : "s"}
          </summary>
          <ul className="divide-y divide-border text-sm">
            {old.plans.map((p, i) => (
              <li key={`${p.start}-${i}`} className="px-3 py-2">
                <p className="font-medium">{p.name}</p>
                <p className="text-meta tabular-nums">
                  {formatDateISO(p.start)} → {formatDateISO(p.end)} · paid{" "}
                  {formatPrice(Math.max(0, p.amount - Math.max(0, p.balance)))} of{" "}
                  {formatPrice(p.amount)}
                  {p.balance > 0 ? ` · balance ${formatPrice(p.balance)}` : ""}
                  {p.bill ? ` · bill ${p.bill}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant="outline">
          <a
            href={`tel:${phone.ok ? `+${phone.value}` : old.phone || call.phoneKey}`}
            onClick={() => call.status === "not_called" && void save({ status: "not_answered" })}
          >
            <Phone aria-hidden /> Call
          </a>
        </Button>
        <Button asChild size="sm" variant="outline" disabled={!phone.ok}>
          <a
            href={phone.ok ? `https://wa.me/${phone.value}` : undefined}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MessageCircle aria-hidden className="text-[#128C7E] dark:text-[#25D366]" /> WhatsApp
          </a>
        </Button>
        {member ? (
          <Button asChild size="sm" variant={back ? "outline" : "default"}>
            <Link to="/clients/$clientId" params={{ clientId: member.id }}>
              Open {member.clientCode ? `#${member.clientCode}` : "member"}
            </Link>
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() =>
              openEnrollment({
                prefill: {
                  fullName: name,
                  phone: old.phone || call.phoneKey,
                  gender: old.gender,
                  dateOfBirth: old.dob || null,
                  oldMemberId: old.memberId,
                },
              })
            }
          >
            <UserPlus aria-hidden /> Add as member
          </Button>
        )}
        <Select value={call.status} onValueChange={(v) => void save({ status: v as CallStatus })}>
          <SelectTrigger className="h-9 w-48" aria-label={`Call status for ${name}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CALL_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {CALL_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Textarea
        rows={2}
        value={notes}
        placeholder="Notes: what they said…"
        aria-label={`Notes for ${name}`}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes !== call.notes && void save({ notes })}
      />
      <p className="text-meta">
        {[
          call.addedAt ? `On the list since ${formatDate(call.addedAt)}` : "",
          call.updatedBy ? `updated by ${call.updatedBy} · ${formatDate(call.updatedAt)}` : "",
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </li>
  );
}
