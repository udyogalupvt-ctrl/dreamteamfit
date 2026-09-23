import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { FullPageLoader } from "@/components/common/loading-state";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { status } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (status === "unauthenticated") {
      navigate({ to: "/login", replace: true });
    }
  }, [status, navigate]);

  if (status !== "authenticated") {
    return <FullPageLoader label="Checking your session…" />;
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
