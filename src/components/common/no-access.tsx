import { Link } from "@tanstack/react-router";
import { Lock, LogOut } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

/** A page this login isn't allowed to use. */
export function NoAccessPage() {
  return (
    <EmptyState
      icon={Lock}
      title="You don't have access to this page"
      description="Ask the owner to switch this feature on for your login."
      action={
        <Button asChild>
          <Link to="/dashboard">Go to dashboard</Link>
        </Button>
      }
    />
  );
}

/** Signed in, but the owner never gave this account access (or switched it off). */
export function NoAccessScreen() {
  const { user, logout } = useAuth();
  return (
    <div className="grid min-h-dvh place-items-center bg-background p-6">
      <EmptyState
        icon={Lock}
        title="This login has no access"
        description={`${user?.email ?? "This account"} is not set up for this gym, or it was switched off. Ask the owner.`}
        action={
          <Button variant="outline" onClick={() => void logout()}>
            <LogOut aria-hidden /> Sign out
          </Button>
        }
      />
    </div>
  );
}
