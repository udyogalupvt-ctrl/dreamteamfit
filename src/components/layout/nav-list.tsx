import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import { useNavItems } from "@/hooks/use-nav-items";
import { useAttention } from "@/hooks/use-attention";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/types";

interface NavListProps {
  collapsed?: boolean;
  onNavigate?: () => void;
}

const isActive = (pathname: string, to: string) => pathname === to || pathname.startsWith(`${to}/`);

export function NavList({ collapsed = false, onNavigate }: NavListProps) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const attention = useAttention();
  const NAV_ITEMS = useNavItems();
  const more = NAV_ITEMS.filter((i) => i.group === "More");
  const moreActive = more.some((i) => isActive(pathname, i.to));
  const [moreOpen, setMoreOpen] = useState<boolean | null>(null);
  const showMore = moreOpen ?? moreActive;

  const badgeFor = (item: NavItem) => (item.to === "/leads" ? attention.callsDue : 0);

  const link = (item: NavItem, nested = false) => {
    const active = isActive(pathname, item.to);
    const Icon = item.icon;
    const badge = badgeFor(item);
    return (
      <Link
        key={item.to}
        to={item.to}
        onClick={onNavigate}
        title={collapsed ? item.label : undefined}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors duration-150",
          collapsed && "justify-center px-0",
          nested && !collapsed && "min-h-10 text-[13px]",
          active
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
        )}
      >
        {active ? (
          <span
            aria-hidden
            className="absolute top-1/2 left-0 h-6 w-1 -translate-y-1/2 rounded-r-full bg-primary"
          />
        ) : null}
        <Icon className="size-[18px] shrink-0" aria-hidden />
        {!collapsed ? (
          <>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {badge ? (
              <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground tabular-nums">
                {badge}
              </span>
            ) : null}
          </>
        ) : badge ? (
          <span aria-hidden className="absolute top-1.5 right-2 size-2 rounded-full bg-primary" />
        ) : null}
      </Link>
    );
  };

  return (
    <nav aria-label="Main" className="flex flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        {NAV_ITEMS.filter((i) => i.group === "Workspace").map((i) => link(i))}
        {more.length ? (
          <button
            type="button"
            aria-expanded={showMore}
            onClick={() => setMoreOpen(!showMore)}
            title={collapsed ? "More" : undefined}
            className={cn(
              "flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
              collapsed && "justify-center px-0",
              moreActive
                ? "text-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
            )}
          >
            <MoreHorizontal className="size-[18px] shrink-0" aria-hidden />
            {!collapsed ? (
              <>
                <span className="min-w-0 flex-1 truncate text-left">More</span>
                <ChevronDown
                  className={cn("size-4 transition-transform", showMore && "rotate-180")}
                  aria-hidden
                />
              </>
            ) : null}
          </button>
        ) : null}
        {showMore && more.length ? (
          <div
            className={cn(
              "flex flex-col gap-0.5",
              !collapsed && "ml-4 border-l border-sidebar-border pl-2",
            )}
          >
            {more.map((i) => link(i, true))}
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-0.5">
        {!collapsed && NAV_ITEMS.some((i) => i.group === "Management") ? (
          <p className="text-eyebrow px-3 pb-1">Management</p>
        ) : null}
        {NAV_ITEMS.filter((i) => i.group === "Management").map((i) => link(i))}
      </div>
    </nav>
  );
}
