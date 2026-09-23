import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/follow-ups")({
  beforeLoad: () => { throw redirect({ to: "/leads", search: { tab: "followups" }, replace: true }); },
});
