import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { NAV_ITEMS } from "@/constants/navigation";
import { cn } from "@/lib/utils";
import type { NavGroupLabel } from "@/types";
import { useNavigationCounts } from "@/hooks/use-navigation-counts";

const GROUPS: NavGroupLabel[] = ["Workspace", "Management"];

interface NavListProps {
  collapsed?: boolean;
  onNavigate?: () => void;
}

export function NavList({ collapsed = false, onNavigate }: NavListProps) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const counts = useNavigationCounts();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  return (
    <nav aria-label="Main" className="flex flex-col gap-5">
      {GROUPS.map((group) => {
        const items = NAV_ITEMS.filter((item) => item.group === group);
        if (!items.length) return null;
        return (
          <div key={group} className="flex flex-col gap-1">
            {!collapsed ? <p className="text-eyebrow px-3 pb-1">{group}</p> : null}
            {items.map((item) => {
              const childActive = item.children?.some((c) => pathname === c.to || pathname.startsWith(`${c.to}/`)) ?? false;
              const active = item.children ? childActive : pathname === item.to || pathname.startsWith(`${item.to}/`);
              const Icon = item.icon;
              const badge = item.to === "/leads" ? (counts.inquiries + counts.followUps) || undefined : undefined;
              if (item.children && !collapsed) {
                const open = openGroups[item.label] ?? childActive;
                return (
                  <div key={item.label}>
                    <button type="button" aria-expanded={open} onClick={() => setOpenGroups((g) => ({ ...g, [item.label]: !open }))}
                      className={cn("relative flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors", active ? "text-foreground" : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground")}>
                      <Icon className="size-[18px] shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                      <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
                    </button>
                    {open ? (
                      <div className="ml-5 mt-1 flex flex-col gap-0.5 border-l border-sidebar-border pl-3">
                        {item.children.map((c) => {
                          const a = pathname === c.to || pathname.startsWith(`${c.to}/`);
                          return (
                            <Link key={c.to} to={c.to} onClick={onNavigate} aria-current={a ? "page" : undefined}
                              className={cn("rounded-md px-3 py-2 text-sm font-semibold transition-colors", a ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground")}>
                              {c.label}
                            </Link>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              }
              return (
                <Link
                  key={item.label}
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
                      {badge ? (
                        <span className="shrink-0 rounded-full bg-primary/20 px-2 py-0.5 text-[11px] font-bold text-foreground tabular-nums">
                          {badge}
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
