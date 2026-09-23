import { Link } from "@tanstack/react-router";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { BrandMark } from "@/components/layout/brand-mark";
import { NavList } from "@/components/layout/nav-list";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { APP_NAME, APP_TAGLINE } from "@/constants/navigation";
import { cn } from "@/lib/utils";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function DesktopSidebar({ collapsed, onToggle }: SidebarProps) {
  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 lg:flex",
        collapsed ? "w-[76px]" : "w-[264px]",
      )}
    >
      <div
        className={cn(
          "flex h-16 items-center gap-3 border-b border-sidebar-border px-4",
          collapsed && "justify-center px-0",
        )}
      >
        <Link to="/dashboard" className="flex min-w-0 items-center gap-3 rounded-lg">
          <BrandMark className={collapsed ? "size-12" : "size-12"} />
          {!collapsed ? (
            <span className="min-w-0">
              <span className="font-display block truncate text-sm font-extrabold tracking-tight">
                {APP_NAME}
              </span>
              <span className="block truncate text-xs text-muted-foreground">{APP_TAGLINE}</span>
            </span>
          ) : null}
        </Link>
      </div>

      <div className="no-scrollbar flex-1 overflow-y-auto px-3 py-4">
        <NavList collapsed={collapsed} />
      </div>

      <div
        className={cn(
          "flex flex-col gap-3 border-t border-sidebar-border p-3",
          collapsed && "items-center",
        )}
      >
        {!collapsed ? <ThemeToggle className="w-full justify-between" /> : null}
        <UserMenu compact={collapsed} />
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
            collapsed && "justify-center px-0",
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" aria-hidden />
          ) : (
            <>
              <PanelLeftClose className="size-4" aria-hidden /> Collapse
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
