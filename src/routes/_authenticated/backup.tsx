import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArchiveRestore,
  Download,
  FileSpreadsheet,
  Link2,
  Loader2,
  PhoneCall,
  ShieldCheck,
  Upload,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadingRows } from "@/components/common/loading-state";
import { PageHeader } from "@/components/common/page-header";
import { SearchInput } from "@/components/common/search-input";
import { StatusPill } from "@/components/common/status-pill";
import { useEnrollment } from "@/components/enrollment/enrollment-context";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAccess } from "@/hooks/use-access";
import { useLive } from "@/hooks/use-live-query";
import { formatDateISO, formatNumber, formatPrice, normalizePhone } from "@/lib/format";
import { tidyName, type OldDirectoryEntry } from "@/lib/old-data";
import { subscribeClients } from "@/services/clients.service";
import { subscribeMemberCalls, type MemberCall } from "@/services/member-calls.service";
import {
  addOldToCallList,
  downloadOldFile,
  listOldData,
  OLD_KIND_LABELS,
  oldDirectory,
  syncOldData,
  uploadOldData,
  type OldDataIndex,
  type OldFileMeta,
} from "@/services/old-data.service";
import type { Client } from "@/types/models";

export const Route = createFileRoute("/_authenticated/backup")({
  head: () => ({ meta: [{ title: "Backup — REBUILD FITNESS" }] }),
  component: BackupPage,
});

const kb = (n: number) =>
  n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;

function BackupPage() {
  const { owner } = useAccess();
  const [data, setData] = useState<{ files: OldFileMeta[]; index: OldDataIndex | null } | null>(
    null,
  );
  const [error, setError] = useState<Error | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    listOldData().then(
      (r) => live && setData(r),
      (e: unknown) => live && setError(e instanceof Error ? e : new Error(String(e))),
    );
    return () => {
      live = false;
    };
  }, [reload]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Backup"
        description="The old software's data, kept exactly as it was exported, and the old members still to move over."
        breadcrumbs={[{ label: "Home", to: "/dashboard" }, { label: "Backup" }]}
      />
      <p className="flex items-start gap-2 rounded-xl border border-success/40 bg-success/10 p-3 text-sm">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
        <span>
          Kept on the server only: the browser can&apos;t read it directly. Only the owner adds
          files; logins with <b>Backup</b> can download them (each download is in the Activity log).
          While adding a member, the front desk sees only the old record of the phone number they
          typed.
        </span>
      </p>
      {error ? <ErrorState error={error} title="Couldn't load the backup" /> : null}
      <FilesSection
        owner={owner}
        data={data}
        onChanged={() => {
          setReload((n) => n + 1);
        }}
      />
      {data?.index ? <OldMembersSection owner={owner} reload={reload} /> : null}
    </div>
  );
}

function FilesSection({
  owner,
  data,
  onChanged,
}: {
  owner: boolean;
  data: { files: OldFileMeta[]; index: OldDataIndex | null } | null;
  onChanged: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File[]>([]);
  const [busy, setBusy] = useState("");
  const save = async () => {
    setBusy("upload");
    try {
      const r = await uploadOldData(picked);
      setPicked([]);
      if (input.current) input.current.value = "";
      toast.success(
        r.saved.length
          ? `Saved ${r.saved.length} file${r.saved.length === 1 ? "" : "s"}`
          : "Nothing new to save",
        {
          description: [
            r.index
              ? `${formatNumber(r.index.members)} old members, ${formatNumber(r.index.plans)} plans read`
              : "",
            r.skipped.length ? `Skipped: ${r.skipped.join(", ")}` : "",
          ]
            .filter(Boolean)
            .join(" · "),
        },
      );
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };
  const download = async (f: OldFileMeta) => {
    setBusy(f.id);
    try {
      await downloadOldFile(f);
      toast.success("Downloaded", { description: `${f.name} · checked: same as the original` });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };
  const inUse = new Set([data?.index?.customersFile, data?.index?.subscriptionsFile]);

  return (
    <section className="surface-card space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-section-title">Old software data</h2>
          <p className="text-meta mt-1">
            {data?.index
              ? `${formatNumber(data.index.members)} old members · ${formatNumber(data.index.plans)} plans · read ${formatDateISO(data.index.builtAt.slice(0, 10))}`
              : "The files exported from the old software (Customer report and Subscription report)."}
          </p>
        </div>
      </div>

      {owner ? (
        <div className="space-y-2 rounded-xl border border-dashed border-border p-3">
          <p className="text-sm font-semibold">Add files from the old software</p>
          <p className="text-meta">
            Export the <b>Customer report</b> and the <b>Subscription report</b> (CSV) and add both.
            Each file is kept exactly as it is; adding a newer export later updates the old
            members&apos; details.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={input}
              id="old-files"
              type="file"
              multiple
              accept=".csv,.txt,.xlsx,.xls"
              aria-label="Old software files"
              className="max-w-full text-sm file:mr-3 file:rounded-lg file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-semibold"
              onChange={(e) => setPicked(Array.from(e.target.files ?? []))}
            />
            <Button disabled={!picked.length || busy === "upload"} onClick={() => void save()}>
              {busy === "upload" ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Upload aria-hidden />
              )}{" "}
              Save to backup
            </Button>
          </div>
        </div>
      ) : null}

      {!data ? (
        <LoadingRows rows={2} />
      ) : !data.files.length ? (
        <EmptyState
          icon={ArchiveRestore}
          title="No old software data yet"
          description={
            owner
              ? "Add the files exported from the old software above."
              : "The owner adds the old software's files here."
          }
        />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {data.files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 p-3">
              <FileSpreadsheet className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1 basis-56">
                <p className="truncate font-semibold" title={f.name}>
                  {f.name}
                </p>
                <p className="text-meta">
                  {OLD_KIND_LABELS[f.kind]}
                  {f.rows ? ` · ${formatNumber(f.rows)} rows` : ""} · {kb(f.size)} · saved{" "}
                  {formatDateISO(f.uploadedAt.slice(0, 10))}
                  {f.uploadedBy ? ` by ${f.uploadedBy}` : ""}
                </p>
                <p className="text-meta font-mono text-[11px]" title={f.sha256}>
                  SHA-256 {f.sha256.slice(0, 16)}…
                </p>
              </div>
              <div className="flex items-center gap-2 max-sm:w-full max-sm:justify-end">
                {inUse.has(f.id) ? <StatusPill tone="success">In use</StatusPill> : null}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy === f.id}
                  onClick={() => void download(f)}
                  aria-label={`Download ${f.name}`}
                >
                  {busy === f.id ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Download aria-hidden />
                  )}{" "}
                  Download
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type View = "todo" | "added" | "all";

function OldMembersSection({ owner, reload }: { owner: boolean; reload: number }) {
  const { openEnrollment } = useEnrollment();
  const clients = useLive<Client[]>(subscribeClients, [], []);
  const [dir, setDir] = useState<{ entries: OldDirectoryEntry[]; today: string } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [view, setView] = useState<View>("todo");
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(50);
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const calls = useLive<MemberCall[]>(subscribeMemberCalls, [], []);
  // Old members already on Member calls → Old software (by phone + old ID).
  const onCallList = useMemo(
    () =>
      new Set(
        calls.data
          .filter((c) => c.segment === "old" && c.old)
          .map((c) => `${c.phoneKey}|${c.old!.memberId}`),
      ),
    [calls.data],
  );
  const toCallList = async (entries: OldDirectoryEntry[]) => {
    try {
      const r = await addOldToCallList(entries.map((e) => ({ k: e.k, id: e.id })));
      toast.success(
        `${r.added} put on Member calls → Old software${r.already ? ` · ${r.already} already there` : ""}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    let live = true;
    oldDirectory().then(
      (r) => live && setDir(r),
      (e: unknown) => live && setError(e instanceof Error ? e : new Error(String(e))),
    );
    return () => {
      live = false;
    };
  }, [reload]);

  // Who is already in the app: by old member ID, else by phone.
  const added = useMemo(() => {
    const byOldId = new Map<string, Client>();
    const byPhone = new Map<string, Client>();
    clients.data.forEach((c) => {
      if (c.oldMemberId) byOldId.set(c.oldMemberId, c);
      byPhone.set(normalizePhone(c.phone), c);
    });
    return (e: OldDirectoryEntry) => byOldId.get(e.id) ?? byPhone.get(e.k) ?? null;
  }, [clients.data]);

  const today = dir?.today ?? "";
  const running = (e: OldDirectoryEntry) =>
    !!e.pe && e.pe >= today && e.ps <= today && !/inactive/i.test(e.st);
  const rows = useMemo(() => {
    if (!dir) return [];
    const q = search.trim().toLowerCase();
    const qd = q.replace(/\D/g, "");
    return dir.entries
      .map((e) => ({ e, member: added(e), running: running(e) }))
      .filter((r) =>
        view === "todo" ? r.running && !r.member : view === "added" ? !!r.member : true,
      )
      .filter(
        (r) =>
          !q ||
          r.e.n.toLowerCase().includes(q) ||
          r.e.id.toLowerCase().includes(q) ||
          (qd.length >= 3 && r.e.k.includes(qd)),
      )
      .sort((a, b) =>
        view === "todo"
          ? a.e.pe.localeCompare(b.e.pe)
          : (b.e.pe || "").localeCompare(a.e.pe || "") || a.e.n.localeCompare(b.e.n),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, added, view, search, today]);
  const counts = useMemo(() => {
    const all = dir?.entries ?? [];
    return {
      all: all.length,
      running: all.filter(running).length,
      added: all.filter((e) => added(e)).length,
      todo: all.filter((e) => running(e) && !added(e)).length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, added, today]);

  const sync = async () => {
    setSyncOpen(false);
    setSyncing(true);
    try {
      const r = await syncOldData();
      toast.success(`Linked ${r.linked} member${r.linked === 1 ? "" : "s"} to their old data`, {
        description: `${r.joined} joining date${r.joined === 1 ? "" : "s"} set · ${r.already} already linked · ${r.notFound} not in the old data${r.unclear ? ` · ${r.unclear} share a number (link them from their profile)` : ""}`,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <section className="surface-card space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-section-title">Old members</h2>
          <p className="text-meta mt-1">
            Matched to members in the app by phone number. Tap Add to start their joining with the
            old details filled in.
          </p>
        </div>
        {owner ? (
          <Button variant="outline" disabled={syncing} onClick={() => setSyncOpen(true)}>
            {syncing ? <Loader2 className="animate-spin" aria-hidden /> : <Link2 aria-hidden />}{" "}
            Link members already added
          </Button>
        ) : null}
      </div>
      {error ? <ErrorState error={error} title="Couldn't load the old members" /> : null}
      {!dir ? (
        <LoadingRows rows={3} />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                ["Old members", counts.all],
                ["Plan running today", counts.running],
                ["Already in the app", counts.added],
                ["Running, not added yet", counts.todo],
              ] as const
            ).map(([label, n]) => (
              <div key={label} className="rounded-lg border border-border bg-muted/40 p-3">
                <dt className="text-meta">{label}</dt>
                <dd className="text-xl font-extrabold tabular-nums">{formatNumber(n)}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Tabs
              value={view}
              onValueChange={(v) => (setView(v as View), setShown(50))}
              className="no-scrollbar max-w-full overflow-x-auto"
            >
              <TabsList className="w-max">
                <TabsTrigger value="todo">To add ({counts.todo})</TabsTrigger>
                <TabsTrigger value="added">Added ({counts.added})</TabsTrigger>
                <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <SearchInput
                value={search}
                onValueChange={(v) => (setSearch(v), setShown(50))}
                label="Search old members"
                placeholder="Name, phone or old member ID"
                containerClassName="sm:max-w-xs"
              />
              {view === "todo" && rows.some((r) => !onCallList.has(`${r.e.k}|${r.e.id}`)) ? (
                <Button
                  variant="outline"
                  onClick={() =>
                    toCallList(
                      rows.filter((r) => !onCallList.has(`${r.e.k}|${r.e.id}`)).map((r) => r.e),
                    )
                  }
                >
                  <PhoneCall aria-hidden /> Put all shown on the call list
                </Button>
              ) : null}
            </div>
          </div>
          {!rows.length ? (
            <p className="text-meta py-6 text-center">
              {view === "todo" && !search
                ? "Every old member with a running plan is in the app."
                : "No old members match."}
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {rows.slice(0, shown).map(({ e, member, running: run }) => (
                <li key={`${e.k}-${e.id}`} className="flex flex-wrap items-center gap-3 p-3">
                  {/* At least 14rem: on a phone the buttons wrap below instead of squeezing it. */}
                  <div className="min-w-[14rem] flex-1">
                    <p className="font-semibold">
                      {tidyName(e.n)}{" "}
                      <span className="font-mono text-xs text-muted-foreground">{e.id}</span>
                    </p>
                    <p className="text-meta tabular-nums">
                      {e.k} · joined {formatDateISO(e.r)} · {e.c} plan{e.c === 1 ? "" : "s"}
                    </p>
                    {e.p ? (
                      <p className="text-meta">
                        {run ? "Running" : "Last"}: {e.p} · {formatDateISO(e.ps)} →{" "}
                        {formatDateISO(e.pe)}
                        {e.b > 0 ? ` · balance ${formatPrice(e.b)}` : ""}
                      </p>
                    ) : null}
                  </div>
                  {run ? <StatusPill tone="success">Running</StatusPill> : null}
                  {member ? (
                    <Button asChild variant="outline" size="sm">
                      <Link to="/clients/$clientId" params={{ clientId: member.id }}>
                        Open {member.clientCode ? `#${member.clientCode}` : "member"}
                      </Link>
                    </Button>
                  ) : (
                    <>
                      {onCallList.has(`${e.k}|${e.id}`) ? (
                        <StatusPill tone="info">On call list</StatusPill>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => toCallList([e])}>
                          <PhoneCall aria-hidden /> Call
                        </Button>
                      )}
                      <Button
                        size="sm"
                        onClick={() =>
                          openEnrollment({
                            prefill: {
                              fullName: tidyName(e.n),
                              phone: e.k,
                              gender: e.g,
                              dateOfBirth: e.d || null,
                            },
                          })
                        }
                      >
                        <UserPlus aria-hidden /> Add
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          {rows.length > shown ? (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => setShown((n) => n + 100)}>
                Show more ({rows.length - shown} left)
              </Button>
            </div>
          ) : null}
        </>
      )}
      <ConfirmDialog
        open={syncOpen}
        onOpenChange={setSyncOpen}
        title="Link old data to members already added?"
        description="Members whose phone number is in the old data get their old member ID. Where the app has nothing yet, their old joining date, date of birth and gender are filled in. Nothing they already have is changed."
        confirmLabel="Link now"
        onConfirm={() => void sync()}
      />
    </section>
  );
}
