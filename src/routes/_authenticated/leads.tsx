import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageHeader } from "@/components/common/page-header";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LeadsView } from "@/components/leads/leads-view";
import { FollowUpsView } from "@/components/leads/followups-view";

type Search = { tab?: "leads" | "followups" };

export const Route = createFileRoute("/_authenticated/leads")({
  validateSearch: (s: Record<string, unknown>): Search => (s["tab"] === "followups" ? { tab: "followups" } : {}),
  head: () => ({
    meta: [
      { title: "Leads & Follow-ups — REBUILD FITNESS" },
      { name: "description", content: "Track every lead, record conversations and convert them into members." },
      { property: "og:title", content: "Leads & Follow-ups — REBUILD FITNESS" },
      { property: "og:description", content: "Track every lead, record conversations and convert them into members." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LeadsPage,
});

function LeadsPage() {
  const { tab = "leads" } = Route.useSearch();
  const navigate = useNavigate({ from: "/leads" });
  return (
    <div className="space-y-5">
      <PageHeader title="Leads & Follow-ups" description="From first enquiry to joining — one place for sales and follow-up calls." breadcrumbs={[{ label: "Home", to: "/dashboard" }, { label: "Leads & Follow-ups" }]} />
      <Tabs value={tab} onValueChange={(v) => void navigate({ search: v === "followups" ? { tab: "followups" } : {} })}>
        <TabsList><TabsTrigger value="leads">Leads</TabsTrigger><TabsTrigger value="followups">Follow-up calls</TabsTrigger></TabsList>
      </Tabs>
      {tab === "followups" ? <FollowUpsView /> : <LeadsView />}
    </div>
  );
}
