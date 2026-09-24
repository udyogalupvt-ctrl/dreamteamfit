import { Outlet, createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { FullPageLoader } from "@/components/common/loading-state";
import { NoAccessPage, NoAccessScreen } from "@/components/common/no-access";
import { featureForPath } from "@/constants/features";
import { AccessProvider, useAccess } from "@/hooks/use-access";
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
    <AccessProvider>
      <AccessGate />
    </AccessProvider>
  );
}

/** Pages follow the features the owner switched on for this login. */
function AccessGate() {
  const access = useAccess();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (access.loading) return <FullPageLoader label="Loading your access…" />;
  if (!access.active) return <NoAccessScreen />;
  const feature = featureForPath(pathname);
  return <AppShell>{feature && !access.can(feature) ? <NoAccessPage /> : <Outlet />}</AppShell>;
}
