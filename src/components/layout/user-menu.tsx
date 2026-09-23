import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { LogOut, Settings, UserRound } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

export function initialsOf(name?: string | null) {
  if (!name) return "ST";
  return name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function UserMenu({ compact = false }: { compact?: boolean }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await logout();
      toast.success("Signed out");
      navigate({ to: "/login", replace: true });
    } catch {
      toast.error("Could not sign out. Please try again.");
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "flex cursor-pointer items-center gap-3 rounded-lg p-1.5 text-left transition-colors hover:bg-accent",
            compact ? "justify-center" : "w-full",
          )}
          aria-label="Account menu"
        >
          <Avatar className="size-8 shrink-0">
            {user?.photoURL ? <AvatarImage src={user.photoURL} alt="" /> : null}
            <AvatarFallback className="bg-primary text-xs font-bold text-primary-foreground">
              {initialsOf(user?.displayName)}
            </AvatarFallback>
          </Avatar>
          {!compact ? (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">
                {user?.displayName ?? "Staff"}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {user?.email ?? "Not signed in"}
              </span>
            </span>
          ) : null}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 rounded-xl">
          <DropdownMenuLabel className="truncate">{user?.email ?? "Account"}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => navigate({ to: "/settings" })}>
            <UserRound aria-hidden /> Profile
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate({ to: "/settings" })}>
            <Settings aria-hidden /> Settings
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={(event) => {
              event.preventDefault();
              setConfirmOpen(true);
            }}
          >
            <LogOut aria-hidden /> Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Log out of FORGE?"
        description="You will need to sign in again to access the gym workspace."
        confirmLabel="Log out"
        destructive
        onConfirm={() => void handleLogout()}
      />
    </>
  );
}
