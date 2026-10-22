import { Suspense, lazy, useMemo, useState } from "react";
import { Pencil, Plus, Ruler, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  canChangeEntry,
  entryLine,
  formatChange,
  formatMetric,
  metricChange,
  metricsWithData,
  photoPair,
  progressSeries,
  type BodyMetric,
} from "@/lib/body-progress";
import { formatDateISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BodyEntry, BodyEntryAuthor, BodyEntryInput } from "@/types/models";
import { BodyEntryDialog } from "./body-entry-dialog";

const ProgressChart = lazy(() => import("./progress-chart"));
const FIRST_ROWS = 20;

type Actor = Pick<BodyEntryAuthor, "kind" | "id">;

/** A tiny trend line for cards (no axes, no library). */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${30 - ((v - min) / span) * 26 - 2}`)
    .join(" ");
  return (
    <svg
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      aria-hidden
      className={cn("h-8 w-20 text-primary", className)}
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function byLabel(e: BodyEntry, actor: Actor) {
  if (e.by.kind === actor.kind && e.by.id === actor.id) return "Added by you";
  if (e.by.kind === "trainer") return `Added by trainer ${e.by.name || ""}`.trim();
  if (e.by.kind === "member")
    return actor.kind === "member" ? "Added by you" : "Added by the member";
  return actor.kind === "staff" && e.by.name ? `Added by ${e.by.name}` : "Added by the gym";
}

/**
 * Body progress for one member: the chart, first-vs-latest photos and every entry. Used by the
 * member app, the trainer app and the desk; `actor` decides which entries can be changed.
 */
export function ProgressPanel({
  entries,
  actor,
  today,
  canAdd,
  onSave,
  onDelete,
}: {
  entries: BodyEntry[];
  actor: Actor;
  today: string;
  canAdd: boolean;
  onSave: (input: BodyEntryInput, id?: string) => Promise<void>;
  onDelete: (entry: BodyEntry) => Promise<void>;
}) {
  const metrics = useMemo(() => metricsWithData(entries), [entries]);
  const [picked, setPicked] = useState<BodyMetric>("weightKg");
  const metric = metrics.some((m) => m.key === picked) ? picked : (metrics[0]?.key ?? "weightKg");
  const info = metrics.find((m) => m.key === metric);
  const points = useMemo(() => progressSeries(entries, metric).length, [entries, metric]);
  const change = useMemo(() => metricChange(entries, metric), [entries, metric]);
  const photos = useMemo(() => photoPair(entries), [entries]);
  const newest = useMemo(() => [...entries].reverse(), [entries]);

  const [editing, setEditing] = useState<BodyEntry | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [removing, setRemoving] = useState<BodyEntry | null>(null);
  const [viewing, setViewing] = useState<{ url: string; date: string } | null>(null);
  const [showAll, setShowAll] = useState(false);

  const open = (e: BodyEntry | null) => {
    setEditing(e);
    setDialogOpen(true);
  };
  const addButton = canAdd ? (
    <Button size="sm" onClick={() => open(null)}>
      <Plus aria-hidden />
      Add entry
    </Button>
  ) : null;

  const thumb = (url: string, date: string, label: string, size = "size-14") => (
    <button
      key={url}
      type="button"
      onClick={() => setViewing({ url, date })}
      className={cn(
        "shrink-0 cursor-pointer overflow-hidden rounded-lg border border-border focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        size,
      )}
      aria-label={label}
    >
      <img src={url} alt="" loading="lazy" className="size-full object-cover" />
    </button>
  );

  return (
    <div className="grid gap-4">
      {entries.length === 0 ? (
        <div className="surface-card grid justify-items-center gap-3 p-6 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Ruler className="size-6" aria-hidden />
          </span>
          <div className="grid gap-1">
            <p className="text-card-title">No progress logged yet</p>
            <p className="text-meta max-w-sm">
              {actor.kind === "member"
                ? "Log your weight and measurements every few weeks to see how you're changing."
                : "Log weight, body fat, measurements or photos to track this member over time."}
            </p>
          </div>
          {addButton}
        </div>
      ) : (
        <>
          <div className="surface-card grid gap-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-0.5">
                <p className="text-label">{info?.label ?? "Progress"}</p>
                {change ? (
                  <>
                    <p className="text-2xl font-semibold tabular-nums">
                      {formatMetric(change.latest.value, metric)}
                    </p>
                    <p className="text-meta">
                      {change.first.date === change.latest.date
                        ? `on ${formatDateISO(change.latest.date)}`
                        : `${formatChange(change.change, metric)} since ${formatDateISO(change.first.date)}`}
                    </p>
                  </>
                ) : (
                  <p className="text-meta">Only photos or notes so far.</p>
                )}
              </div>
              {addButton}
            </div>
            {metrics.length > 1 ? (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Show on the chart">
                {metrics.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    aria-pressed={m.key === metric}
                    onClick={() => setPicked(m.key)}
                    className={cn(
                      "min-h-9 cursor-pointer rounded-full border px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      m.key === metric
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:bg-accent",
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            ) : null}
            {points >= 2 ? (
              <Suspense fallback={<Skeleton className="h-52 w-full sm:h-60" />}>
                <ProgressChart entries={entries} metric={metric} />
              </Suspense>
            ) : change ? (
              <p className="text-meta rounded-lg bg-muted/60 px-3 py-2">
                Add another entry on a later day to see the line.
              </p>
            ) : null}
          </div>

          {photos ? (
            <div className="surface-card grid gap-3 p-4 sm:p-5">
              <p className="text-card-title">Compare photos</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { ...photos.first, label: "First" },
                  { ...photos.latest, label: "Latest" },
                ].map((p) => (
                  <figure key={p.label} className="grid gap-1.5">
                    <button
                      type="button"
                      onClick={() => setViewing(p)}
                      className="aspect-[3/4] cursor-pointer overflow-hidden rounded-xl border border-border focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      aria-label={`${p.label} photo, ${formatDateISO(p.date)}. Open large`}
                    >
                      <img src={p.url} alt="" loading="lazy" className="size-full object-cover" />
                    </button>
                    <figcaption className="text-meta">
                      <span className="font-medium text-foreground">{p.label}</span> ·{" "}
                      {formatDateISO(p.date)}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          ) : null}

          <section className="grid gap-2" aria-label="All entries">
            <p className="text-section-title">Entries</p>
            <ul className="surface-card divide-y divide-border">
              {(showAll ? newest : newest.slice(0, FIRST_ROWS)).map((e) => {
                const mine = canChangeEntry(e, actor);
                return (
                  <li key={e.id} className="grid gap-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="grid min-w-0 gap-0.5">
                        <p className="font-medium">{formatDateISO(e.date)}</p>
                        <p className="text-sm tabular-nums">
                          {entryLine(e) || (e.photos.length ? "Photos" : "Note")}
                        </p>
                        <p className="text-meta">{byLabel(e, actor)}</p>
                      </div>
                      {mine ? (
                        <div className="flex shrink-0 gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => open(e)}
                            aria-label={`Change the entry of ${formatDateISO(e.date)}`}
                          >
                            <Pencil aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setRemoving(e)}
                            aria-label={`Remove the entry of ${formatDateISO(e.date)}`}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        </div>
                      ) : null}
                    </div>
                    {e.photos.length ? (
                      <div className="flex gap-2">
                        {e.photos.map((url, i) =>
                          thumb(
                            url,
                            e.date,
                            `Photo ${i + 1} of ${formatDateISO(e.date)}. Open large`,
                          ),
                        )}
                      </div>
                    ) : null}
                    {e.note ? (
                      <p className="text-sm whitespace-pre-line text-muted-foreground">{e.note}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {!showAll && newest.length > FIRST_ROWS ? (
              <Button variant="outline" onClick={() => setShowAll(true)}>
                Show all {newest.length} entries
              </Button>
            ) : null}
          </section>
        </>
      )}

      <BodyEntryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entry={editing}
        today={today}
        onSave={(input) => onSave(input, editing?.id)}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(v) => !v && setRemoving(null)}
        title="Remove this entry?"
        description={
          removing
            ? `${formatDateISO(removing.date)}: ${entryLine(removing) || "photos and note"}`
            : ""
        }
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          const e = removing;
          setRemoving(null);
          if (e) void onDelete(e);
        }}
      />
      <Dialog open={viewing !== null} onOpenChange={(v) => !v && setViewing(null)}>
        <DialogContent className="max-w-[min(92vw,40rem)] p-3">
          <DialogTitle className="sr-only">Progress photo</DialogTitle>
          <DialogDescription className="px-1 text-sm">
            {viewing ? formatDateISO(viewing.date) : ""}
          </DialogDescription>
          {viewing ? (
            <img
              src={viewing.url}
              alt={`Progress photo, ${formatDateISO(viewing.date)}`}
              className="max-h-[75vh] w-full rounded-lg object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
