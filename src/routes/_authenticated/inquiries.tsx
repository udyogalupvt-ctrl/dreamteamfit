import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/inquiries")({
  beforeLoad: () => { throw redirect({ to: "/leads", replace: true }); },
});
