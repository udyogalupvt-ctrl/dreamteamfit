import { Link, useRouterState } from "@tanstack/react-router";
import { Menu } from "lucide-react";
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
import { APP_NAME, GYM_NAME, MOBILE_NAV_PATHS, NAV_ITEMS } from "@/constants/navigation";
import { cn } from "@/lib/utils";
import { useState } from "react";

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
      <SheetContent side="left" className="w-[86vw] max-w-[320px] bg-sidebar p-0">
        <SheetHeader className="border-b border-sidebar-border px-4 py-4 text-left">
          <SheetTitle className="flex items-center gap-3">
            <BrandMark />
            <span className="min-w-0">
              <span className="font-display block truncate text-sm font-extrabold">{APP_NAME}</span>
              <span className="block truncate text-xs font-medium text-muted-foreground">
                {GYM_NAME}
              </span>
            </span>
          </SheetTitle>
          <SheetDescription className="sr-only">Main navigation</SheetDescription>
        </SheetHeader>
        <div className="no-scrollbar h-[calc(100dvh-9.5rem)] overflow-y-auto px-3 py-4">
          <NavList onNavigate={() => setOpen(false)} />
        </div>
        <div className="flex items-center gap-2 border-t border-sidebar-border p-3">
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
  const items = MOBILE_NAV_PATHS.map((path) => NAV_ITEMS.find((item) => item.to === path)!).filter(
    Boolean,
  );

  return (
    <nav
      aria-label="Quick navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="grid grid-cols-4">
        {items.map((item) => {
          const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
          const Icon = item.icon;
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
                    "grid h-7 w-12 place-items-center rounded-full transition-colors",
                    active && "bg-primary/20",
                  )}
                >
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="max-w-full truncate">{item.label.split(" ")[0]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
