import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Menu, Plus } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { BrandMark } from "@/components/layout/brand-mark";
import { NavList } from "@/components/layout/nav-list";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { useQuickActions } from "@/components/layout/quick-actions";
import { APP_NAME, APP_TAGLINE, MOBILE_NAV_PATHS } from "@/constants/navigation";
import { useNavItems } from "@/hooks/use-nav-items";
import { useAttention } from "@/hooks/use-attention";
import { cn } from "@/lib/utils";

export function MobileNavDrawer() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        className="grid size-10 cursor-pointer place-items-center rounded-lg border border-border bg-surface transition-colors hover:bg-accent lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="size-5" aria-hidden />
      </SheetTrigger>
      <SheetContent
        side="left"
        className="flex w-[86vw] max-w-[320px] flex-col gap-0 bg-sidebar p-0"
      >
        <SheetHeader className="border-b border-sidebar-border px-4 py-4 text-left">
          <SheetTitle className="flex items-center gap-3">
            <BrandMark className="size-12" />
            <span className="min-w-0">
              <span className="font-display block truncate text-sm font-extrabold">{APP_NAME}</span>
              <span className="block truncate text-xs font-medium text-muted-foreground">
                {APP_TAGLINE}
              </span>
            </span>
          </SheetTitle>
          <SheetDescription className="sr-only">Main navigation</SheetDescription>
        </SheetHeader>
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <NavList onNavigate={() => setOpen(false)} />
        </div>
        <div className="flex items-center gap-2 border-t border-sidebar-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="min-w-0 flex-1">
            <UserMenu />
          </div>
          <ThemeToggle />
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function MobileBottomNav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const attention = useAttention();
  const actions = useQuickActions();
  const NAV_ITEMS = useNavItems();
  const [open, setOpen] = useState(false);
  const items = MOBILE_NAV_PATHS.map((path) => NAV_ITEMS.find((item) => item.to === path)).filter(
    (x): x is (typeof NAV_ITEMS)[number] => Boolean(x),
  );
  const labels: Record<string, string> = {
    "/dashboard": "Home",
    "/clients": "Members",
    "/leads": "Leads",
    "/billing": "Billing",
  };
  const badges: Record<string, number> = { "/leads": attention.callsDue };

  const cell = (item: (typeof items)[number]) => {
    const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
    const Icon = item.icon;
    const badge = badges[item.to] ?? 0;
    return (
      <li key={item.to}>
        <Link
          to={item.to}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex min-h-[58px] flex-col items-center justify-center gap-1 px-1 text-[11px] font-semibold transition-colors",
            active ? "text-foreground" : "text-muted-foreground",
          )}
        >
          <span
            className={cn(
              "relative grid h-7 w-12 place-items-center rounded-full transition-colors",
              active && "bg-primary/20",
            )}
          >
            <Icon className="size-5" aria-hidden />
            {badge ? (
              <span className="absolute -top-1 right-0.5 min-w-4 rounded-full bg-destructive px-1 text-[10px] leading-4 font-bold text-white tabular-nums">
                {badge > 99 ? "99+" : badge}
              </span>
            ) : null}
          </span>
          <span className="max-w-full truncate">{labels[item.to] ?? item.label}</span>
        </Link>
      </li>
    );
  };

  return (
    <nav
      aria-label="Quick navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="grid grid-cols-5 items-center">
        {items.slice(0, 2).map(cell)}
        <li className="grid place-items-center">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger
              aria-label="Quick add"
              className="-mt-6 grid size-14 cursor-pointer place-items-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background transition-transform active:scale-95"
            >
              <Plus className="size-7" aria-hidden />
            </SheetTrigger>
            <SheetContent
              side="bottom"
              className="rounded-t-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
            >
              <SheetHeader className="text-left">
                <SheetTitle>Quick add</SheetTitle>
                <SheetDescription className="sr-only">Common front-desk actions</SheetDescription>
              </SheetHeader>
              <div className="grid grid-cols-2 gap-2">
                {actions.map((a) => {
                  const Icon = a.icon;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        a.run();
                      }}
                      className={cn(
                        "flex min-h-20 flex-col items-start justify-center gap-1 rounded-xl border p-3 text-left transition-colors active:bg-accent",
                        a.id === "member"
                          ? "col-span-2 border-primary bg-primary/10"
                          : "border-border",
                      )}
                    >
                      <Icon className="size-5" aria-hidden />
                      <span className="text-sm font-bold">{a.label}</span>
                      <span className="text-meta">{a.hint}</span>
                    </button>
                  );
                })}
              </div>
            </SheetContent>
          </Sheet>
        </li>
        {items.slice(2).map(cell)}
      </ul>
    </nav>
  );
}
