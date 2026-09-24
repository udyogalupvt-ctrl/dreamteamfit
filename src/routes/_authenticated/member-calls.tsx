import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { MessageCircle, Phone, PhoneCall, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { ClientAvatar } from "@/components/clients/client-avatar";
import { useEnrollment } from "@/components/enrollment/enrollment-context";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadingRows } from "@/components/common/loading-state";
import { PageHeader } from "@/components/common/page-header";
import { SearchInput } from "@/components/common/search-input";
import { SegmentChart } from "@/components/members/segment-chart";
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
import { useMemberSegments } from "@/hooks/use-member-segments";
import { formatDate } from "@/lib/format";
import {
  CALL_STATUS_LABELS,
  CALL_STATUSES,
  callKey,
  SEGMENT_META,
  SEGMENTS,
  type CallStatus,
  type Segment,
  type SegmentMember,
} from "@/lib/member-segments";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp-phone";
import { firestoreErrorMessage } from "@/services/firestore.service";
import {
  saveMemberCall,
  subscribeMemberCalls,
  type MemberCall,
} from "@/services/member-calls.service";
import {
  DEFAULT_WHATSAPP_SETTINGS,
  subscribeWhatsAppSettings,
} from "@/services/whatsapp-settings.service";

export const Route = createFileRoute("/_authenticated/member-calls")({
  validateSearch: z.object({ segment: z.enum(SEGMENTS).optional() }),
  head: () => ({ meta: [{ title: "Member calls — REBUILD FITNESS" }] }),
  component: MemberCallsPage,
});

const ABSENT = [3, 7, 15, 30];
const EXPIRING = [7, 15, 30];

function MemberCallsPage() {
  const initial = Route.useSearch().segment ?? "inactive";
  const [segment, setSegment] = useState<Segment>(initial);
  const [absentDays, setAbsentDays] = useState(7);
  const [expiringDays, setExpiringDays] = useState(7);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | CallStatus>("all");
  const { segments, counts, total, loading, error } = useMemberSegments({
    absentDays,
    expiringDays,
    renewalWindowDays: 365,
  });
  const calls = useLive<MemberCall[]>(subscribeMemberCalls, [], []);
  const callOf = (m: SegmentMember) => calls.data.find((c) => c.key === callKey(m));

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return segments[segment].filter((m) => {
      const st = calls.data.find((c) => c.key === callKey(m))?.status ?? "not_called";
      if (status !== "all" && st !== status) return false;
      return !q || m.client.fullName.toLowerCase().includes(q) || m.client.phone.includes(q);
    });
  }, [segments, segment, search, status, calls.data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Member calls"
        description="Tap a bar to see who is in that group, then call or WhatsApp them and note what they said."
        breadcrumbs={[{ label: "Home", to: "/dashboard" }, { label: "Member calls" }]}
      />
      {error ? <ErrorState error={error} title="Couldn't load members" /> : null}
      <section className="surface-card space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            Inactive after
            <Select value={String(absentDays)} onValueChange={(v) => setAbsentDays(Number(v))}>
              <SelectTrigger className="h-9 w-24" aria-label="Inactive after days">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ABSENT.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {d} days
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex items-center gap-2">
            Expiring within
            <Select value={String(expiringDays)} onValueChange={(v) => setExpiringDays(Number(v))}>
              <SelectTrigger className="h-9 w-24" aria-label="Expiring within days">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRING.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {d} days
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
        {loading ? (
          <LoadingRows rows={3} />
        ) : (
          <SegmentChart counts={counts} total={total} selected={segment} onSelect={setSegment} />
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-section-title">
            {SEGMENT_META[segment].label} · {segments[segment].length}
          </h2>
          <div className="grid gap-2 sm:grid-cols-[16rem_12rem]">
            <SearchInput
              value={search}
              onValueChange={setSearch}
              placeholder="Search name or phone…"
              label="Search members"
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
          </div>
        </div>
        {loading ? (
          <LoadingRows rows={4} />
        ) : !rows.length ? (
          <EmptyState
            icon={PhoneCall}
            title="Nobody here"
            description="No members in this group right now."
          />
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {rows.map((m) => (
              <CallRow key={`${m.segment}-${m.client.id}`} m={m} call={callOf(m)} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CallRow({ m, call }: { m: SegmentMember; call: MemberCall | undefined }) {
  const { user } = useAuth();
  const { openEnrollment } = useEnrollment();
  const wa = useLive(subscribeWhatsAppSettings, DEFAULT_WHATSAPP_SETTINGS, []);
  const [notes, setNotes] = useState(call?.notes ?? "");
  useEffect(() => setNotes(call?.notes ?? ""), [call?.notes]);
  const status: CallStatus = call?.status ?? "not_called";
  const phone = normalizeWhatsAppPhone(
    m.client.whatsappPhone || m.client.phone,
    wa.data.defaultCountryCode,
  );
  const save = async (next: { status?: CallStatus; notes?: string }) => {
    try {
      await saveMemberCall(
        callKey(m),
        {
          clientId: m.client.id,
          clientName: m.client.fullName,
          segment: m.segment,
          status: next.status ?? status,
          notes: next.notes ?? notes,
        },
        user?.displayName || user?.email || "Staff",
      );
      if (next.status) toast.success(`${m.client.fullName}: ${CALL_STATUS_LABELS[next.status]}`);
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    }
  };
  return (
    <li className="surface-card space-y-3 p-4">
      <div className="flex items-start gap-3">
        <ClientAvatar name={m.client.fullName} url={m.client.profilePhotoUrl} size={44} />
        <div className="min-w-0 flex-1">
          <Link
            to="/clients/$clientId"
            params={{ clientId: m.client.id }}
            className="block truncate font-semibold hover:underline"
          >
            {m.client.fullName}
          </Link>
          <p className="text-meta tabular-nums">{m.client.phone}</p>
          <p className="mt-1 text-sm">{m.detail}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant="outline">
          <a
            href={`tel:${phone.ok ? `+${phone.value}` : m.client.phone}`}
            onClick={() => status === "not_called" && void save({ status: "not_answered" })}
          >
            <Phone aria-hidden /> Call
          </a>
        </Button>
        <Button asChild size="sm" variant="outline" disabled={!phone.ok}>
          <a
            href={
              phone.ok
                ? `https://wa.me/${phone.value}${m.message ? `?text=${encodeURIComponent(m.message)}` : ""}`
                : undefined
            }
            target="_blank"
            rel="noopener noreferrer"
          >
            <MessageCircle aria-hidden className="text-[#25D366]" /> WhatsApp
          </a>
        </Button>
        {m.segment === "expiring" || m.segment === "blacklist" ? (
          // Said yes on the call: take the renewal right here.
          <Button size="sm" onClick={() => openEnrollment({ existingClient: m.client })}>
            <RefreshCcw aria-hidden /> Renew
          </Button>
        ) : null}
        <Select value={status} onValueChange={(v) => void save({ status: v as CallStatus })}>
          <SelectTrigger className="h-9 w-48" aria-label={`Call status for ${m.client.fullName}`}>
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
        aria-label={`Notes for ${m.client.fullName}`}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes !== (call?.notes ?? "") && void save({ notes })}
      />
      {call ? (
        <p className="text-meta">
          Updated by {call.updatedBy} · {formatDate(call.updatedAt)}
        </p>
      ) : null}
    </li>
  );
}
