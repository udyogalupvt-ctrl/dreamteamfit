import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Clock, LineChart, RefreshCcw, Settings2, Wrench } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { BriefCard } from "@/components/cfo/brief-card";
import { clockText, useNow, whenText } from "@/components/cfo/cfo-format";
import { HealthCards } from "@/components/cfo/health-cards";
import { HowWorked } from "@/components/cfo/how-worked";
import { ProblemLists } from "@/components/cfo/problem-lists";
import { CfoSettingsDialog } from "@/components/cfo/settings-dialog";
import { Trends } from "@/components/cfo/trends";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { PageHeader } from "@/components/common/page-header";
import { StatCardSkeleton } from "@/components/common/stat-card";
import { Button } from "@/components/ui/button";
import { useLive } from "@/hooks/use-live-query";
import {
  CFO_LIST_KEYS,
  CFO_MAX_MANUAL_BRIEFS_PER_DAY,
  DEFAULT_CFO_SETTINGS,
} from "@/lib/cfo/types";
import { indiaToday } from "@/lib/retention-dates";
import { cn } from "@/lib/utils";
import {
  CFO_LOADING,
  cfoErrorMessage,
  refreshCfo,
  subscribeCfoBrief,
  subscribeCfoBriefStatus,
  subscribeCfoReport,
  subscribeCfoSettings,
} from "@/services/cfo.service";

export const Route = createFileRoute("/_authenticated/cfo")({
  validateSearch: z.object({ tab: z.enum(CFO_LIST_KEYS).optional() }),
  // A problem on this page stays on this page (the menu and other pages keep working).
  errorComponent: ({ error }) => <ErrorState error={error} title="The CFO page didn't load" />,
  head: () => ({
    meta: [
      { title: "CFO — REBUILD FITNESS" },
      {
        name: "description",
        content: "How the gym is doing with money, and who to call this week.",
      },
    ],
  }),
  component: CfoPage,
});

/** A report older than this is flagged (the morning job runs once a day). */
const STALE_HOURS = 26;
/** After the server says "too soon", the button waits this long before trying again. */
const TOO_SOON_WAIT_MS = 60_000;

function CfoPage() {
  const { tab } = Route.useSearch();
  const report = useLive(subscribeCfoReport, CFO_LOADING, []);
  const brief = useLive(subscribeCfoBrief, CFO_LOADING, []);
  const attempt = useLive(subscribeCfoBriefStatus, CFO_LOADING, []);
  const settingsLive = useLive(subscribeCfoSettings, CFO_LOADING, []);
  const now = useNow();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [askRefresh, setAskRefresh] = useState(false);
  const [lockUntil, setLockUntil] = useState(0);
  const [lockNote, setLockNote] = useState("");

  // While the very first numbers are worked out the report holds only the lock mark: treat
  // anything without computed numbers as "no numbers yet".
  const raw = report.data.value;
  const snapshot =
    raw && typeof raw.computedAt === "string" && Array.isArray(raw.months) ? raw : null;
  const settings = settingsLive.data.value ?? DEFAULT_CFO_SETTINGS;
  const denied = report.data.denied || settingsLive.data.denied;
  const error = report.error ?? settingsLive.error;
  const loading = report.loading || settingsLive.loading;

  const computedMs = snapshot ? Date.parse(snapshot.computedAt) : NaN;
  const ageHours = Number.isFinite(computedMs) ? (now - computedMs) / 3_600_000 : 0;
  const stale = ageHours > STALE_HOURS;
  const runningSince = raw?.runningSince ? Date.parse(raw.runningSince) : NaN;
  // A recompute that started in the last 3 minutes is still going; an older mark is left over.
  const working = Number.isFinite(runningSince) && now - runningSince < 180_000;
  // The server says when Refresh is allowed again; grey the button until then instead of asking
  // and being refused.
  const serverNext = snapshot?.nextRefreshAt ? Date.parse(snapshot.nextRefreshAt) : NaN;
  const openAt = Math.max(lockUntil, Number.isFinite(serverNext) ? serverNext : 0);
  const locked = now < openAt;
  const refreshOff = locked || working;
  const refreshWhy = working
    ? "The numbers are being worked out now…"
    : locked
      ? (openAt === lockUntil && lockNote) ||
        `Worked out a few minutes ago. You can refresh again at ${clockText(new Date(openAt))}.`
      : "";
  const briefsUsed =
    snapshot?.manualBriefs && snapshot.manualBriefs.date === indiaToday()
      ? snapshot.manualBriefs.count
      : 0;

  const refresh = async (showProgress = false) => {
    const id = showProgress ? toast.loading("Working out the numbers…") : undefined;
    try {
      const res = await refreshCfo();
      const next = Date.parse(res.nextRefreshAt);
      setLockUntil(Number.isFinite(next) ? next : 0);
      setLockNote("");
      toast.success("The numbers are worked out again");
    } catch (e) {
      const message = cfoErrorMessage(e);
      if (/refresh again/i.test(message)) {
        setLockUntil(Date.now() + TOO_SOON_WAIT_MS);
        setLockNote(message);
        toast.info(message);
      } else toast.error(message);
    } finally {
      if (id !== undefined) toast.dismiss(id);
    }
  };

  const actions = (
    <>
      {snapshot ? (
        <Button
          variant="outline"
          disabled={refreshOff}
          onClick={() => refresh()}
          title={refreshWhy || undefined}
        >
          <RefreshCcw aria-hidden /> Refresh
        </Button>
      ) : null}
      <Button variant="outline" onClick={() => setSettingsOpen(true)}>
        <Settings2 aria-hidden /> Settings
      </Button>
    </>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="CFO"
        description="How the gym is doing with money, and who to call this week."
        breadcrumbs={[{ label: "Home", to: "/dashboard" }, { label: "CFO" }]}
        actions={actions}
      />

      {denied ? (
        <EmptyState
          icon={Wrench}
          title="CFO is being set up"
          description="This page needs one more step on the server before it can show your numbers. It will start working by itself once that is done. Try again in a little while."
        />
      ) : error ? (
        <ErrorState error={error} title="Couldn't load the CFO numbers" />
      ) : loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <StatCardSkeleton key={i} className={i === 0 ? "sm:col-span-2" : ""} />
          ))}
          <span className="sr-only">Loading</span>
        </div>
      ) : !snapshot ? (
        <EmptyState
          icon={LineChart}
          title="Your CFO is ready to start"
          description="The CFO works out your profit, your cash, who may leave, and who to call. It reads your members, plans, payments and expenses once, and keeps the answer here. First, add your opening money in Settings if you want the cash numbers."
          action={
            <Button size="lg" disabled={working} onClick={() => refresh(true)}>
              <RefreshCcw aria-hidden />{" "}
              {working ? "Working out your numbers…" : "Work out my numbers"}
            </Button>
          }
        />
      ) : (
        <>
          <div
            className={cn(
              "flex flex-wrap items-center gap-x-3 gap-y-1 text-sm",
              stale ? "text-warning" : "text-muted-foreground",
            )}
          >
            <span className="inline-flex items-center gap-1.5 font-medium">
              <Clock className="size-4" aria-hidden /> Worked out{" "}
              {whenText(snapshot.computedAt, now)}
            </span>
            {working || locked ? <span className="text-meta">{refreshWhy}</span> : null}
          </div>

          {stale ? (
            <div
              role="status"
              className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <p>
                <b>These numbers may be old.</b> They were worked out{" "}
                {whenText(snapshot.computedAt, now)}. Press Refresh to work them out again.
              </p>
            </div>
          ) : null}

          <HealthCards
            snapshot={snapshot}
            settings={settings}
            onOpenSettings={() => setSettingsOpen(true)}
          />
          <BriefCard
            brief={brief.data.value}
            attempt={attempt.data.value}
            snapshotComputedAt={snapshot.computedAt}
            hasSnapshot
            aiEnabled={settings.aiEnabled}
            briefsLeft={Math.max(0, CFO_MAX_MANUAL_BRIEFS_PER_DAY - briefsUsed)}
            now={now}
          />
          <ProblemLists snapshot={snapshot} settings={settings} initialTab={tab} />
          <Trends snapshot={snapshot} />
          <HowWorked snapshot={snapshot} settings={settings} />
        </>
      )}

      <CfoSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onSaved={() => setAskRefresh(true)}
      />
      <ConfirmDialog
        open={askRefresh}
        onOpenChange={setAskRefresh}
        title="Work out the numbers again now?"
        description="Your settings are saved. The numbers on this page change only after they are worked out again."
        confirmLabel="Work out now"
        cancelLabel="Later"
        onConfirm={() => void refresh(true)}
      />
    </div>
  );
}
