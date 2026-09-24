import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { History, Lock } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadingRows } from "@/components/common/loading-state";
import { PageHeader } from "@/components/common/page-header";
import { SearchInput } from "@/components/common/search-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLive } from "@/hooks/use-live-query";
import { cn } from "@/lib/utils";
import { auditGroupOf, subscribeAuditLog, type AuditEntry } from "@/services/audit.service";

export const Route = createFileRoute("/_authenticated/activity-log")({
  head: () => ({
    meta: [
      { title: "Activity Log — REBUILD FITNESS" },
      {
        name: "description",
        content: "Every action in the gym, recorded by the server and read-only.",
      },
    ],
  }),
  component: ActivityLogPage,
});

const GROUPS = [
  ["all", "All"],
  ["money", "Money"],
  ["plan", "Plans & PT"],
  ["calls", "Leads & calls"],
  ["entry", "Members & door"],
  ["messages", "WhatsApp"],
  ["setup", "Setup & settings"],
] as const;

function ActivityLogPage() {
  const log = useLive<AuditEntry[]>((ok, fail) => subscribeAuditLog(500, ok, fail), [], []);
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState<(typeof GROUPS)[number][0]>("all");
  const [actor, setActor] = useState("all");
  const actors = useMemo(
    () => [...new Set(log.data.map((e) => e.actorName).filter(Boolean))].sort(),
    [log.data],
  );
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return log.data.filter(
      (e) =>
        (group === "all" || auditGroupOf(e.collection) === group) &&
        (actor === "all" || e.actorName === actor) &&
        (!q || [e.summary, e.clientName, e.actorName].some((v) => v.toLowerCase().includes(q))),
    );
  }, [log.data, search, group, actor]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Activity Log"
        description="Who did what, and when. Every change is recorded by itself; nobody can edit or delete a line."
        breadcrumbs={[{ label: "Home", to: "/dashboard" }, { label: "Activity Log" }]}
      />
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search member, action or staff…"
          label="Search activity"
          containerClassName="md:max-w-sm"
        />
        <Select value={actor} onValueChange={setActor}>
          <SelectTrigger className="w-full md:w-60" aria-label="Staff">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Everyone</SelectItem>
            {actors.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div
        className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0"
        role="tablist"
        aria-label="Type"
      >
        {GROUPS.map(([v, l]) => (
          <button
            key={v}
            role="tab"
            aria-selected={group === v}
            onClick={() => setGroup(v)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold",
              group === v
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border hover:bg-accent",
            )}
          >
            {l}
          </button>
        ))}
      </div>
      {log.loading ? (
        <LoadingRows rows={6} />
      ) : log.error ? (
        <ErrorState error={log.error} title="Couldn't load the activity log" />
      ) : !rows.length ? (
        <EmptyState
          icon={History}
          title="No activity yet"
          description="Every change made in the app appears here: who did it and when."
        />
      ) : (
        <ol className="surface-card divide-y divide-border">
          {rows.map((e) => (
            <li key={e.id} className="flex items-start gap-3 p-4">
              <Lock
                className="mt-1 size-3.5 shrink-0 text-muted-foreground"
                aria-label="Recorded automatically"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold break-words">{e.summary}</p>
                <p className="text-meta">
                  {format(e.at, "d MMM yyyy, h:mm a")} · {e.actorName || "Unknown"}
                  {e.clientId && e.action !== "deleted" ? (
                    <>
                      {" · "}
                      <Link
                        to="/clients/$clientId"
                        params={{ clientId: e.clientId }}
                        className="underline"
                      >
                        {e.clientName || "open member"}
                      </Link>
                    </>
                  ) : e.clientName && e.collection !== "clients" ? (
                    ` · ${e.clientName}`
                  ) : null}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
