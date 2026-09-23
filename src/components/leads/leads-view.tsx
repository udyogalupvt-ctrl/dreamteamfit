import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { format, subDays } from "date-fns";
import {
  CalendarClock,
  Eye,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  UserCheck,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { SearchInput } from "@/components/common/search-input";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadingRows } from "@/components/common/loading-state";
import { StatusPill } from "@/components/common/status-pill";
import { Field } from "@/components/common/form-dialog";
import { InquiryFormDialog } from "@/components/inquiries/inquiry-form-dialog";
import { useEnrollment } from "@/components/enrollment/enrollment-context";
import { RecordFollowUpDialog, LeadTimeline } from "@/components/leads/record-followup-dialog";
import { leadFollowUpId } from "@/services/lead-logs.service";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
  INQUIRY_STATUS_META,
  SOURCE_LABELS,
  formatDate,
  formatDateISO,
  normalizePhone,
  todayISO,
} from "@/lib/format";
import { subscribeInquiries, updateInquiry } from "@/services/inquiries.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { INQUIRY_STATUSES, LEAD_SOURCES, type Inquiry, type InquiryStatus } from "@/types/models";

const DATE_FILTERS = {
  all: "Any time",
  today: "Added today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
} as const;
type DateFilter = keyof typeof DATE_FILTERS;

export function LeadsView({
  autoCreate = false,
  onAutoCreateHandled,
}: {
  autoCreate?: boolean;
  onAutoCreateHandled?: () => void;
}) {
  const { data, loading, error } = useLive<Inquiry[]>(subscribeInquiries, [], []);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "due" | "open" | InquiryStatus>("open");
  const [source, setSource] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Inquiry | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const { openEnrollment } = useEnrollment();
  const [recording, setRecording] = useState<Inquiry | null>(null);
  const setConverting = (i: Inquiry) =>
    openEnrollment({
      inquiryId: i.id,
      prefill: {
        fullName: i.name,
        phone: i.phone,
        email: i.email,
        source: i.source,
        notes: [i.fitnessGoal && `Goal: ${i.fitnessGoal}`, i.notes].filter(Boolean).join("\n"),
      },
    });

  const viewing = data.find((i) => i.id === viewingId) ?? null;
  useEffect(() => {
    if (!autoCreate) return;
    setEditing(null);
    setFormOpen(true);
    onAutoCreateHandled?.();
  }, [autoCreate, onAutoCreateHandled]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qPhone = normalizePhone(search);
    const today = todayISO();
    const since =
      dateFilter === "today"
        ? new Date(new Date().setHours(0, 0, 0, 0))
        : dateFilter === "7d"
          ? subDays(new Date(), 7)
          : dateFilter === "30d"
            ? subDays(new Date(), 30)
            : null;
    return data.filter((i) => {
      if (status === "due") {
        if (
          !i.nextFollowUpDate ||
          i.nextFollowUpDate > today ||
          i.status === "converted" ||
          i.status === "lost"
        )
          return false;
      } else if (status === "open") {
        if (i.status === "converted" || i.status === "lost") return false;
      } else if (status !== "all" && i.status !== status) return false;
      if (source !== "all" && i.source !== source) return false;
      if (since && i.createdAt < since) return false;
      if (!q) return true;
      return (
        i.name.toLowerCase().includes(q) ||
        i.email.toLowerCase().includes(q) ||
        i.fitnessGoal.toLowerCase().includes(q) ||
        (qPhone.length >= 3 && i.phoneNormalized.includes(qPhone))
      );
    });
  }, [data, search, status, source, dateFilter]);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (i: Inquiry) => {
    setEditing(i);
    setFormOpen(true);
  };

  const rowActions = (i: Inquiry) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${i.name}`}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={() => setViewingId(i.id)}>
          <Eye aria-hidden /> View
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setRecording(i)}>
          <Phone aria-hidden /> Record follow-up
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openEdit(i)}>
          <Pencil aria-hidden /> Edit
        </DropdownMenuItem>
        {i.convertedToClient && i.clientId ? (
          <DropdownMenuItem asChild>
            <Link to="/clients/$clientId" params={{ clientId: i.clientId }}>
              <UserCheck aria-hidden /> Open client
            </Link>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => setConverting(i)}>
            <UserPlus aria-hidden /> Convert to member
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="space-y-6">
      <div
        className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0"
        role="tablist"
        aria-label="Lead views"
      >
        {(
          [
            ["open", "Open"],
            ["due", "Call today"],
            ["expected_to_join", "Expected to join"],
            ["interested", "Interested"],
            ["new", "New"],
            ["converted", "Joined"],
            ["lost", "Lost"],
            ["all", "All"],
          ] as const
        ).map(([v, l]) => {
          const n =
            v === "all"
              ? data.length
              : v === "open"
                ? data.filter((i) => i.status !== "converted" && i.status !== "lost").length
                : v === "due"
                  ? data.filter(
                      (i) =>
                        i.nextFollowUpDate &&
                        i.nextFollowUpDate <= todayISO() &&
                        i.status !== "converted" &&
                        i.status !== "lost",
                    ).length
                  : data.filter((i) => i.status === v).length;
          return (
            <button
              key={v}
              role="tab"
              aria-selected={status === v}
              onClick={() => setStatus(v)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors",
                status === v
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border hover:bg-accent",
              )}
            >
              {l} <span className="tabular-nums opacity-70">{n}</span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,180px))]">
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search name, phone, goal…"
          label="Search inquiries"
          containerClassName="sm:col-span-2 lg:col-span-1"
        />
        <Button onClick={openCreate} className="h-10 max-sm:order-first">
          <Plus aria-hidden /> New inquiry
        </Button>
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger className="h-10 w-full" aria-label="Filter by source">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            {LEAD_SOURCES.map((s) => (
              <SelectItem key={s} value={s}>
                {SOURCE_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={dateFilter} onValueChange={(v) => setDateFilter(v as DateFilter)}>
          <SelectTrigger className="h-10 w-full" aria-label="Filter by date">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(DATE_FILTERS).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <LoadingRows rows={6} />
      ) : error ? (
        <ErrorState error={error} title="Couldn't load inquiries" />
      ) : data.length === 0 ? (
        <EmptyState
          icon={UserPlus}
          title="No inquiries yet"
          description="Capture your first gym inquiry."
          action={
            <Button onClick={openCreate}>
              <Plus aria-hidden /> New inquiry
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={UserPlus}
          title="No matching inquiries"
          description="Try adjusting your search or filters."
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="surface-card hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="hidden xl:table-cell">Goal</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last contact</TableHead>
                  <TableHead>Next follow-up</TableHead>
                  <TableHead className="hidden lg:table-cell">Expected join</TableHead>

                  <TableHead className="w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((i) => (
                  <TableRow
                    key={i.id}
                    className="cursor-pointer"
                    onClick={() => setViewingId(i.id)}
                  >
                    <TableCell className="max-w-48 truncate font-semibold">{i.name}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{i.phone}</TableCell>
                    <TableCell className="whitespace-nowrap">{SOURCE_LABELS[i.source]}</TableCell>
                    <TableCell className="hidden max-w-40 truncate xl:table-cell">
                      {i.fitnessGoal || "—"}
                    </TableCell>
                    <TableCell>
                      <StatusPill tone={INQUIRY_STATUS_META[i.status].tone}>
                        {INQUIRY_STATUS_META[i.status].label}
                      </StatusPill>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDateISO(i.lastContactDate)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <FollowUpDate inquiry={i} />
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap lg:table-cell">
                      {formatDateISO(i.expectedJoinDate)}
                    </TableCell>

                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {!i.convertedToClient && i.status !== "lost" ? (
                          <Button size="sm" variant="outline" onClick={() => setRecording(i)}>
                            <Phone aria-hidden /> Record call
                          </Button>
                        ) : null}
                        {rowActions(i)}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <ul className="grid gap-3 md:hidden">
            {filtered.map((i) => (
              <li key={i.id} className="surface-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setViewingId(i.id)}
                    className="min-w-0 text-left"
                  >
                    <p className="truncate font-semibold">{i.name}</p>
                    <p className="text-meta mt-0.5 tabular-nums">
                      {i.phone} · {SOURCE_LABELS[i.source]}
                    </p>
                  </button>
                  {rowActions(i)}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <StatusPill tone={INQUIRY_STATUS_META[i.status].tone}>
                    {INQUIRY_STATUS_META[i.status].label}
                  </StatusPill>
                  <span className="text-meta flex items-center gap-1">
                    <CalendarClock className="size-3.5" aria-hidden /> <FollowUpDate inquiry={i} />
                  </span>
                </div>
                {!i.convertedToClient ? (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button className="h-11" onClick={() => setRecording(i)}>
                      <Phone aria-hidden /> Record call
                    </Button>
                    <Button variant="outline" className="h-11" onClick={() => setConverting(i)}>
                      <UserPlus aria-hidden /> Join now
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}

      <InquiryFormDialog open={formOpen} onOpenChange={setFormOpen} inquiry={editing} />

      <InquiryDetailSheet
        inquiry={viewing}
        onClose={() => setViewingId(null)}
        onEdit={(i) => openEdit(i)}
        onConvert={(i) => setConverting(i)}
        onRecord={(i) => setRecording(i)}
      />

      <RecordFollowUpDialog
        target={
          recording
            ? {
                inquiryId: recording.id,
                clientId: recording.clientId ?? "",
                name: recording.name,
                phone: recording.phone,
                currentFollowUpId: leadFollowUpId(recording.id),
              }
            : null
        }
        onClose={() => setRecording(null)}
        onConvert={() => recording && setConverting(recording)}
      />
    </div>
  );
}

function FollowUpDate({ inquiry }: { inquiry: Inquiry }) {
  if (!inquiry.nextFollowUpDate) return <span className="text-muted-foreground">—</span>;
  const overdue =
    inquiry.nextFollowUpDate < todayISO() &&
    inquiry.status !== "converted" &&
    inquiry.status !== "lost";
  return (
    <span className={overdue ? "font-semibold text-destructive" : undefined}>
      {formatDateISO(inquiry.nextFollowUpDate)}
    </span>
  );
}

function InquiryDetailSheet({
  inquiry,
  onClose,
  onEdit,
  onConvert,
  onRecord,
}: {
  inquiry: Inquiry | null;
  onClose: () => void;
  onEdit: (i: Inquiry) => void;
  onConvert: (i: Inquiry) => void;
  onRecord: (i: Inquiry) => void;
}) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const patch = async (data: Parameters<typeof updateInquiry>[1], message: string) => {
    if (!inquiry) return;
    setSaving(true);
    try {
      await updateInquiry(inquiry.id, data);
      toast.success(message);
    } catch (err) {
      toast.error(firestoreErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const addNote = async () => {
    if (!inquiry || !note.trim()) return;
    const stamp = format(new Date(), "d MMM yyyy, h:mm a");
    const entry = `[${stamp}] ${note.trim().slice(0, 1000)}`;
    await patch({ notes: inquiry.notes ? `${inquiry.notes}\n${entry}` : entry }, "Note added");
    setNote("");
  };

  return (
    <Sheet open={!!inquiry} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {inquiry ? (
          <div className="space-y-6 pb-6">
            <SheetHeader className="text-left">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone={INQUIRY_STATUS_META[inquiry.status].tone}>
                  {INQUIRY_STATUS_META[inquiry.status].label}
                </StatusPill>
                <span className="text-meta">Logged {formatDate(inquiry.createdAt)}</span>
              </div>
              <SheetTitle className="text-section-title">{inquiry.name}</SheetTitle>
              <SheetDescription className="flex items-center gap-1.5">
                <Phone className="size-3.5" aria-hidden />
                <a href={`tel:${inquiry.phone}`} className="tabular-nums hover:underline">
                  {inquiry.phone}
                </a>
                {inquiry.email ? <span>· {inquiry.email}</span> : null}
              </SheetDescription>
            </SheetHeader>

            <div className="grid grid-cols-2 gap-3 px-4">
              <Info label="Source" value={SOURCE_LABELS[inquiry.source]} />
              <Info label="Goal" value={inquiry.fitnessGoal || "—"} />
            </div>

            <div className="grid gap-4 px-4 sm:grid-cols-2">
              <Field label="Status" htmlFor="d-status">
                <Select
                  value={inquiry.status}
                  disabled={saving || inquiry.status === "converted"}
                  onValueChange={(v) =>
                    void patch(
                      { status: v as InquiryStatus },
                      `Status set to ${INQUIRY_STATUS_META[v as InquiryStatus].label}`,
                    )
                  }
                >
                  <SelectTrigger id="d-status" className="h-10 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INQUIRY_STATUSES.filter(
                      (s) => s !== "converted" || inquiry.status === "converted",
                    ).map((s) => (
                      <SelectItem key={s} value={s}>
                        {INQUIRY_STATUS_META[s].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Next follow-up" htmlFor="d-follow">
                <Input
                  id="d-follow"
                  type="date"
                  disabled={saving}
                  value={inquiry.nextFollowUpDate ?? ""}
                  onChange={(e) =>
                    void patch(
                      { nextFollowUpDate: e.target.value || null },
                      "Follow-up date updated",
                    )
                  }
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3 px-4">
              <Info label="Last contact" value={formatDateISO(inquiry.lastContactDate)} />
              <Info label="Expected join" value={formatDateISO(inquiry.expectedJoinDate)} />
              <Info label="Expected visit" value={formatDateISO(inquiry.expectedVisitDate)} />
              <Info label="Assigned" value={inquiry.assignedTo || "—"} />
            </div>

            <div className="space-y-3 px-4">
              <div className="flex items-center justify-between">
                <h3 className="text-card-title">Follow-up timeline</h3>
                <Button size="sm" onClick={() => onRecord(inquiry)}>
                  <Phone aria-hidden /> Record follow-up
                </Button>
              </div>
              <LeadTimeline field="inquiryId" id={inquiry.id} />
            </div>

            <div className="space-y-2 px-4">
              <h3 className="text-card-title">Notes</h3>
              {inquiry.notes ? (
                <p className="whitespace-pre-wrap rounded-xl border border-border bg-muted/40 p-3 text-sm">
                  {inquiry.notes}
                </p>
              ) : (
                <p className="text-meta">No notes yet.</p>
              )}
              <label htmlFor="d-note" className="sr-only">
                Add a note
              </label>
              <Textarea
                id="d-note"
                rows={2}
                placeholder="Add a note about this conversation…"
                value={note}
                maxLength={1000}
                onChange={(e) => setNote(e.target.value)}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={!note.trim() || saving}
                onClick={() => void addNote()}
              >
                Add note
              </Button>
            </div>

            <div className="flex flex-wrap gap-2 border-t border-border px-4 pt-4">
              {inquiry.convertedToClient && inquiry.clientId ? (
                <Button asChild>
                  <Link to="/clients/$clientId" params={{ clientId: inquiry.clientId }}>
                    <UserCheck aria-hidden /> Open client profile
                  </Link>
                </Button>
              ) : (
                <Button onClick={() => onConvert(inquiry)}>
                  <UserPlus aria-hidden /> Convert to member
                </Button>
              )}
              <Button variant="outline" onClick={() => onEdit(inquiry)}>
                <Pencil aria-hidden /> Edit
              </Button>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-muted/40 p-3">
      <p className="text-meta">{label}</p>
      <p className="mt-1 truncate font-semibold">{value}</p>
    </div>
  );
}
