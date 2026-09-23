import { useCallback } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageHeader } from "@/components/common/page-header";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LeadsView } from "@/components/leads/leads-view";
import { FollowUpsView } from "@/components/leads/followups-view";
import { useNavigationCounts } from "@/hooks/use-navigation-counts";

type Search = { tab?: "leads" | "followups"; new?: true };

export const Route = createFileRoute("/_authenticated/leads")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    ...(s["tab"] === "followups" ? { tab: "followups" as const } : {}),
    ...(s["new"] === true || s["new"] === "1" || s["new"] === 1 ? { new: true as const } : {}),
  }),
  head: () => ({
    meta: [
      { title: "Leads & Follow-ups — REBUILD FITNESS" },
      {
        name: "description",
        content: "Track every lead, record conversations and convert them into members.",
      },
      { property: "og:title", content: "Leads & Follow-ups — REBUILD FITNESS" },
      {
        property: "og:description",
        content: "Track every lead, record conversations and convert them into members.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LeadsPage,
});

function LeadsPage() {
  const { tab = "leads", new: createNew } = Route.useSearch();
  const navigate = useNavigate({ from: "/leads" });
  const counts = useNavigationCounts();
  const clearNew = useCallback(
    () => void navigate({ search: (s) => (s.tab ? { tab: s.tab } : {}), replace: true }),
    [navigate],
  );
  return (
    <div className="space-y-5">
      <PageHeader
        title="Leads & Follow-ups"
        description="Everyone who visited or called, and who to call today."
        breadcrumbs={[{ label: "Home", to: "/dashboard" }, { label: "Leads & Follow-ups" }]}
      />
      <Tabs
        value={tab}
        onValueChange={(v) =>
          void navigate({ search: v === "followups" ? { tab: "followups" } : {} })
        }
      >
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="leads" className="flex-1 sm:flex-none">
            Leads
          </TabsTrigger>
          <TabsTrigger value="followups" className="flex-1 sm:flex-none">
            Calls to make
            {counts.followUps ? (
              <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground tabular-nums">
                {counts.followUps}
              </span>
            ) : null}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === "followups" ? (
        <FollowUpsView />
      ) : (
        <LeadsView autoCreate={Boolean(createNew)} onAutoCreateHandled={clearNew} />
      )}
    </div>
  );
}
