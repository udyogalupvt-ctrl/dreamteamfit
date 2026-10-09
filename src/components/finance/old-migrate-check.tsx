import { useMemo, useState } from "react";
import { format } from "date-fns";
import { History, Play, RotateCcw, Search } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useAccess } from "@/hooks/use-access";
import { useLive } from "@/hooks/use-live-query";
import { where, type DocumentData } from "@/lib/firestore";
import { formatDateISO } from "@/lib/format";
import { COLLECTIONS, subscribeCollection } from "@/services/firestore.service";
import {
  applyOldMigrate,
  previewOldMigrate,
  undoOldMigrate,
  undoOldMigrateRun,
  type MigrateRow,
  type MigrateSkip,
} from "@/services/old-migrate.service";

/** The server applies (and undoes) this many members per request. */
const BATCH = 12;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const strs = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

/** One member's change from the oldSoftwareMoves collection (kind "as-is"). */
interface AsIsMove {
  id: string;
  runId: string;
  clientId: string;
  clientName: string;
  summary: string;
  was: string[];
  now: string[];
  undone: boolean;
  by: string;
  at: Date | null;
}

const mapMove = (id: string, x: DocumentData): AsIsMove => ({
  id,
  runId: str(x["runId"]),
  clientId: str(x["clientId"]),
  clientName: str(x["clientName"]),
  summary: str(x["summary"]),
  was: strs(x["was"]),
  now: strs(x["now"]),
  undone: x["undone"] === true,
  by: str(x["by"]),
  at: (x["createdAt"]?.toDate?.() ?? null) as Date | null,
});

/** The was lines (muted), then an arrow to each now line. */
function WasNow({ was, now }: { was: string[]; now: string[] }) {
  if (!was.length && !now.length) return null;
  return (
    <div className="mt-0.5">
      {was.map((w, i) => (
        <p key={`w-${i}`} className="text-meta break-words">
          {w}
        </p>
      ))}
      {now.map((n, i) => (
        <p key={`n-${i}`} className="break-words">
          <span aria-hidden>→ </span>
          <span className="sr-only">now: </span>
          {n}
        </p>
      ))}
    </div>
  );
}

/**
 * Income & expenses (owner): the one-time "old plans as-is" migration. Check shows every planned
 * change (was → now) and what is left alone, Run applies it member by member, and every change
 * stays listed below with Undo per member and Undo all per run.
 */
export function OldMigrateCheck() {
  const { can } = useAccess();
  const money = can("finance");
  const isOwner = can("owner");
  const [preview, setPreview] = useState<{ rows: MigrateRow[]; skips: MigrateSkip[] } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [applyProgress, setApplyProgress] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRun, setConfirmRun] = useState(false);
  const [undoRunId, setUndoRunId] = useState<string | null>(null);
  const [result, setResult] = useState<{ applied: number; skipped: number } | null>(null);
  const [applyErrors, setApplyErrors] = useState<{ name: string; error: string }[]>([]);
  const [undoErrors, setUndoErrors] = useState<Record<string, { who: string; error: string }[]>>(
    {},
  );

  // Past changes, live (equality filter only; sorted and grouped in code).
  const live = useLive<AsIsMove[]>(
    money
      ? (onData, onError) =>
          subscribeCollection(
            COLLECTIONS.oldSoftwareMoves,
            mapMove,
            onData,
            onError,
            where("kind", "==", "as-is"),
          )
      : null,
    [],
    [money],
  );
  const runs = useMemo(() => {
    const sorted = [...live.data].sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
    const byRun = new Map<string, AsIsMove[]>();
    for (const m of sorted) {
      const key = m.runId || m.id;
      byRun.set(key, [...(byRun.get(key) ?? []), m]);
    }
    return [...byRun.entries()].map(([runId, moves]) => ({ runId, moves }));
  }, [live.data]);

  const totals = useMemo(() => {
    const rows = preview?.rows ?? [];
    return {
      add: rows.filter((r) => r.creates).length,
      carry: rows.reduce((n, r) => n + r.carries, 0),
      fix: rows.reduce((n, r) => n + r.fixes, 0),
      recycle: rows.reduce((n, r) => n + r.recycles, 0),
      left: preview?.skips.length ?? 0,
    };
  }, [preview]);
  const skipGroups = useMemo(() => {
    const byReason = new Map<string, MigrateSkip[]>();
    for (const s of preview?.skips ?? [])
      byReason.set(s.reason, [...(byReason.get(s.reason) ?? []), s]);
    return [...byReason.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [preview]);

  if (!money) return null;

  const check = async () => {
    setBusy("check");
    setResult(null);
    setApplyErrors([]);
    try {
      const rows: MigrateRow[] = [];
      const skips: MigrateSkip[] = [];
      let cursor = 0;
      for (;;) {
        const page = await previewOldMigrate(cursor);
        rows.push(...page.rows);
        skips.push(...page.skips);
        setProgress({ done: page.done, total: page.total });
        if (page.next === null) break;
        cursor = page.next;
      }
      setPreview({ rows, skips });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setProgress(null);
      setBusy(null);
    }
  };

  const run = async () => {
    setConfirmRun(false);
    if (!preview?.rows.length) return;
    const runId = `asis-${Date.now()}`;
    const members = preview.rows.map((r) => ({ phone: r.phone, oldMemberId: r.oldMemberId }));
    const nameOf = (phone: string, oldMemberId: string) =>
      preview.rows.find((r) => r.phone === phone && r.oldMemberId === oldMemberId)?.name ||
      "Member";
    setBusy("run");
    setApplyErrors([]);
    setApplyProgress({ done: 0, total: members.length });
    const errors: { name: string; error: string }[] = [];
    let applied = 0;
    let skipped = 0;
    try {
      for (let i = 0; i < members.length; i += BATCH) {
        const part = members.slice(i, i + BATCH);
        const r = await applyOldMigrate(runId, part);
        applied += r.applied.length;
        skipped += r.skipped.length;
        errors.push(
          ...r.errors.map((e) => ({ name: nameOf(e.phone, e.oldMemberId), error: e.error })),
        );
        setApplyProgress({
          done: Math.min(i + part.length, members.length),
          total: members.length,
        });
      }
      if (errors.length)
        toast.error(
          `${errors.length} member${errors.length === 1 ? "" : "s"} could not be brought over`,
          { description: "The reasons are listed below, in red." },
        );
      else
        toast.success("Migration done", {
          description: `${applied} member${applied === 1 ? "" : "s"} brought over; every change is listed below and can be undone.`,
        });
      setResult({ applied, skipped });
      setPreview(null);
    } catch (e) {
      toast.error((e as Error).message);
      if (applied || skipped) setResult({ applied, skipped });
    } finally {
      setApplyErrors(errors);
      setApplyProgress(null);
      setBusy(null);
    }
  };

  const undoOne = async (moveId: string) => {
    setBusy(`undo:${moveId}`);
    try {
      await undoOldMigrate(moveId);
      toast.success("Change taken back", { description: "Everything is back as it was before." });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const undoAll = async (runId: string) => {
    setUndoRunId(null);
    setBusy("undo-run");
    const errs = new Map<string, { who: string; error: string }>();
    let undone = 0;
    try {
      for (;;) {
        const r = await undoOldMigrateRun(runId);
        undone += r.undone.length;
        r.errors.forEach((e) => errs.set(e.moveId, { who: e.who || "Member", error: e.error }));
        // No progress means the members left can't be undone by this run: stop, show why.
        if (r.remaining === 0 || r.undone.length === 0) break;
      }
      if (errs.size)
        toast.error(`${errs.size} member${errs.size === 1 ? "" : "s"} could not be undone`, {
          description: "The reasons are listed under the run.",
        });
      else
        toast.success("Run taken back", {
          description: `${undone} member${undone === 1 ? "" : "s"} put back as before.`,
        });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUndoErrors((s) => ({ ...s, [runId]: [...errs.values()] }));
      setBusy(null);
    }
  };

  return (
    <section className="surface-card space-y-3 p-4 sm:p-5" aria-labelledby="old-migrate-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="old-migrate-title" className="text-section-title flex items-center gap-2">
            <History className="size-5 text-primary" aria-hidden /> Old software check
          </h2>
          <p className="text-meta mt-1 max-w-2xl">
            Brings every old-software member over with their plan exactly as it was, and fixes plans
            that were typed in by hand. Entries written only in the paper book after the backup: add
            them as normal sales with Paid on.
          </p>
        </div>
        {isOwner ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => check()}
            disabled={!!busy && busy !== "check"}
          >
            <Search aria-hidden /> {preview ? "Check again" : "Check"}
          </Button>
        ) : null}
      </div>
      {!isOwner ? (
        <p className="text-meta">Only the owner&rsquo;s login can run this check.</p>
      ) : null}

      {busy === "check" && progress ? (
        <p className="text-sm" aria-live="polite">
          Checking&hellip; checked <b className="tabular-nums">{progress.done}</b> of{" "}
          <b className="tabular-nums">{progress.total}</b> phone numbers.
        </p>
      ) : null}

      {preview ? (
        preview.rows.length ? (
          <div className="space-y-3">
            <ul className="flex flex-wrap gap-2 text-xs font-semibold">
              {(
                [
                  [totals.add, "members to add"],
                  [totals.carry, "plans to carry"],
                  [totals.fix, "plans to fix"],
                  [totals.recycle, "copies to the Recycle Bin"],
                  [totals.left, "left for the owner"],
                ] as const
              ).map(([n, label]) => (
                <li key={label} className="rounded-full bg-muted px-3 py-1">
                  <b className="tabular-nums">{n}</b> {label}
                </li>
              ))}
            </ul>
            <ul className="max-h-[28rem] divide-y divide-border overflow-y-auto rounded-xl border border-border">
              {preview.rows.map((r, i) => (
                <li key={`${r.phone}-${r.oldMemberId}`} className="flex gap-3 px-3 py-2.5 text-sm">
                  <span className="text-meta w-6 shrink-0 text-right tabular-nums" aria-hidden>
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-3">
                      <span className="font-semibold">{r.name || "Member"}</span>
                      <span className="text-meta tabular-nums">{r.phone}</span>
                      {r.creates ? (
                        <span className="text-meta rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">
                          new member
                        </span>
                      ) : null}
                    </p>
                    <WasNow was={r.was} now={r.now} />
                  </div>
                </li>
              ))}
            </ul>
            {isOwner ? (
              <Button onClick={() => setConfirmRun(true)} disabled={!!busy}>
                <Play aria-hidden /> Run the migration
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="text-sm">Everything from the old software is already in the app.</p>
        )
      ) : null}

      {busy === "run" && applyProgress ? (
        <p className="text-sm" aria-live="polite">
          Running&hellip; applied <b className="tabular-nums">{applyProgress.done}</b> of{" "}
          <b className="tabular-nums">{applyProgress.total}</b> members.
        </p>
      ) : null}
      {result ? (
        <p className="text-sm">
          Brought over <b className="tabular-nums">{result.applied}</b> member
          {result.applied === 1 ? "" : "s"}
          {result.skipped ? `; ${result.skipped} needed nothing (already done)` : ""}
          {applyErrors.length ? `; ${applyErrors.length} failed (below)` : ""}. Check again to see
          what is left.
        </p>
      ) : null}
      {applyErrors.length ? (
        <ul className="space-y-0.5 text-sm text-destructive">
          {applyErrors.map((e, i) => (
            <li key={i} className="break-words">
              <b>{e.name}</b>: {e.error}
            </li>
          ))}
        </ul>
      ) : null}

      {preview && preview.skips.length ? (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold">
            Not changed, and why ({preview.skips.length})
          </summary>
          <div className="mt-2 space-y-2">
            {skipGroups.map(([reason, list]) => (
              <div key={reason}>
                <p className="font-semibold">
                  {reason} <span className="text-meta font-normal">({list.length})</span>
                </p>
                <ul className="text-meta list-disc space-y-0.5 pl-5">
                  {list.map((s, i) => (
                    <li key={`${s.phone}-${i}`} className="break-words">
                      {s.who || "Member"} · {s.what}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {live.error ? (
        <p className="text-sm text-destructive">Couldn&rsquo;t load the past changes list.</p>
      ) : null}
      {runs.length ? (
        <div className="space-y-3">
          <h3 className="text-label">Past changes</h3>
          {runs.map((group) => {
            const open = group.moves.filter((m) => !m.undone).length;
            const at = group.moves[0]?.at ?? null;
            const errs = undoErrors[group.runId] ?? [];
            return (
              <div key={group.runId} className="rounded-xl border border-border">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <b>
                      {group.runId.startsWith("carry-") ? "Added on first visit" : "Migration run"}
                    </b>
                    {at ? ` · ${formatDateISO(format(at, "yyyy-MM-dd"))}` : ""} ·{" "}
                    {group.moves.length} member{group.moves.length === 1 ? "" : "s"}
                    {open < group.moves.length ? ` · ${group.moves.length - open} undone` : ""}
                  </span>
                  {isOwner && open > 0 ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setUndoRunId(group.runId)}
                      disabled={!!busy}
                    >
                      <RotateCcw aria-hidden /> Undo all
                    </Button>
                  ) : null}
                </div>
                {errs.length ? (
                  <ul className="space-y-0.5 border-b border-border px-3 py-2 text-sm text-destructive">
                    {errs.map((e, i) => (
                      <li key={i} className="break-words">
                        <b>{e.who}</b>: {e.error}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <ul className="divide-y divide-border">
                  {group.moves.map((m, i) => (
                    <li key={m.id} className="flex gap-3 px-3 py-2.5 text-sm">
                      <span className="text-meta w-6 shrink-0 text-right tabular-nums" aria-hidden>
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{m.clientName || "Member"}</p>
                        {m.summary ? <p className="text-meta break-words">{m.summary}</p> : null}
                        <WasNow was={m.was} now={m.now} />
                      </div>
                      {m.undone ? (
                        <span className="text-meta shrink-0 self-start">Undone</span>
                      ) : isOwner ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="shrink-0 self-start"
                          onClick={() => undoOne(m.id)}
                          disabled={!!busy && busy !== `undo:${m.id}`}
                        >
                          <RotateCcw aria-hidden /> Undo
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmRun}
        onOpenChange={(o) => !o && setConfirmRun(false)}
        title={`Run the migration for ${preview?.rows.length ?? 0} member${(preview?.rows.length ?? 0) === 1 ? "" : "s"}?`}
        description={`Adds ${totals.add} member${totals.add === 1 ? "" : "s"}, carries ${totals.carry} plan${totals.carry === 1 ? "" : "s"}, fixes ${totals.fix} plan${totals.fix === 1 ? "" : "s"} and puts ${totals.recycle} cop${totals.recycle === 1 ? "y" : "ies"} in the Recycle Bin. Money taken here is never touched. Every change is listed below afterwards, with Undo per member and Undo all.`}
        confirmLabel="Run the migration"
        typeToConfirm="MIGRATE"
        onConfirm={() => void run()}
      />
      <ConfirmDialog
        open={!!undoRunId}
        onOpenChange={(o) => !o && setUndoRunId(null)}
        title="Undo this whole run?"
        description="Every member in it is put back exactly as before the run. A member changed since (money collected, plan edited, thumb registered) is left as they are, with the reason shown."
        confirmLabel="Undo all"
        destructive
        typeToConfirm="UNDO"
        onConfirm={() => {
          const id = undoRunId;
          if (id) void undoAll(id);
        }}
      />
    </section>
  );
}
