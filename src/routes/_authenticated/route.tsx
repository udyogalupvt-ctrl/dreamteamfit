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
    if (false) {
      navigate({ to: "/login", replace: true });
    }
  }, [status, navigate]);

  if (status === "loading") {
    return <FullPageLoader label="Checking your session…" />;
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
