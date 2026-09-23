import { Link, useRouterState } from "@tanstack/react-router";
import { NAV_ITEMS } from "@/constants/navigation";
import { cn } from "@/lib/utils";
import type { NavGroupLabel } from "@/types";

const GROUPS: NavGroupLabel[] = ["Workspace", "Management"];

interface NavListProps {
  collapsed?: boolean;
  onNavigate?: () => void;
}

export function NavList({ collapsed = false, onNavigate }: NavListProps) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <nav aria-label="Main" className="flex flex-col gap-5">
      {GROUPS.map((group) => {
        const items = NAV_ITEMS.filter((item) => item.group === group);
        if (!items.length) return null;
        return (
          <div key={group} className="flex flex-col gap-1">
            {!collapsed ? <p className="text-eyebrow px-3 pb-1">{group}</p> : null}
            {items.map((item) => {
              const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={onNavigate}
                  title={collapsed ? item.label : undefined}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors duration-150",
                    collapsed && "justify-center px-0",
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
                      {item.badge ? (
                        <span className="shrink-0 rounded-full bg-primary/20 px-2 py-0.5 text-[11px] font-bold text-foreground tabular-nums">
                          {item.badge}
                        </span>
                      ) : null}
                    </>
                  ) : null}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
