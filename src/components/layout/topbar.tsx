import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bell, ChevronDown, CreditCard, Fingerprint, Phone, RefreshCcw } from "lucide-react";
import { GlobalSearch } from "@/components/layout/global-search";
import { MobileNavDrawer } from "@/components/layout/mobile-nav";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { useQuickActions } from "@/components/layout/quick-actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAttention } from "@/hooks/use-attention";
import { formatPrice } from "@/lib/format";

export function Topbar() {
  const navigate = useNavigate();
  const actions = useQuickActions();
  const a = useAttention();
  const alerts = [
    {
      id: "thumbPending",
      n: a.thumbPending,
      label: `${a.thumbPending} member${a.thumbPending === 1 ? "" : "s"} waiting for thumb registration`,
      icon: Fingerprint,
      go: () => navigate({ to: "/clients", search: { filter: "pending" } }),
    },
    {
      id: "callsDue",
      n: a.callsDue,
      label: `${a.callsDue} follow-up call${a.callsDue === 1 ? "" : "s"} due`,
      icon: Phone,
      go: () => navigate({ to: "/leads", search: { tab: "followups" } }),
    },
    {
      id: "balanceDueCount",
      n: a.balanceDueCount,
      label: `${formatPrice(a.balanceDueAmount)} balance due on ${a.balanceDueCount} bill${a.balanceDueCount === 1 ? "" : "s"}`,
      icon: CreditCard,
      go: () => navigate({ to: "/billing" }),
    },
    {
      id: "expiringSoon",
      n: a.expiringSoon,
      label: `${a.expiringSoon} membership${a.expiringSoon === 1 ? "" : "s"} ending in 7 days`,
      icon: RefreshCcw,
      go: () => navigate({ to: "/clients", search: { filter: "active" } }),
    },
  ].filter((x) => x.n > 0);

  // The red count shows only what is new since the bell was last opened.
  const [seen, setSeen] = useState<Record<string, number>>({});
  useEffect(() => setSeen(readSeen()), []);
  const countsKey = alerts.map((x) => `${x.id}:${x.n}`).join("|");
  useEffect(() => {
    if (a.loading) return;
    // A count that went down is lowered too, so a later rise shows as new again.
    const lowered = Object.fromEntries(
      Object.entries(readSeen()).map(([k, v]) => [
        k,
        Math.min(v, alerts.find((x) => x.id === k)?.n ?? 0),
      ]),
    );
    setSeen(lowered);
    writeSeen(lowered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countsKey, a.loading]);
  const unseen = alerts.filter((x) => x.n > (seen[x.id] ?? 0)).length;
  const markSeen = (open: boolean) => {
    if (!open) return;
    const next = Object.fromEntries(alerts.map((x) => [x.id, x.n]));
    setSeen(next);
    writeSeen(next);
  };

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <MobileNavDrawer />

        <div className="hidden min-w-0 flex-1 md:block">
          <GlobalSearch />
        </div>

        <div className="flex flex-1 items-center justify-end gap-2 md:flex-none">
          <div className="md:hidden">
            <GlobalSearch compact />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="hidden lg:inline-flex">
                Quick add <ChevronDown aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {actions.map((x) => {
                const Icon = x.icon;
                return (
                  <DropdownMenuItem key={x.id} onSelect={x.run} className="py-2">
                    <Icon aria-hidden />
                    <span className="flex flex-col">
                      <span className="font-semibold">{x.label}</span>
                      <span className="text-meta">{x.hint}</span>
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu onOpenChange={markSeen}>
            <DropdownMenuTrigger
              className="relative grid size-10 cursor-pointer place-items-center rounded-lg border border-border bg-surface transition-colors hover:bg-accent"
              aria-label={
                alerts.length ? `${alerts.length} things need attention` : "Nothing needs attention"
              }
            >
              <Bell className="size-[18px]" aria-hidden />
              {unseen ? (
                <span className="absolute -top-1 -right-1 min-w-5 rounded-full bg-destructive px-1 text-[11px] leading-5 font-bold text-white tabular-nums">
                  {unseen}
                </span>
              ) : alerts.length ? (
                <span
                  aria-hidden
                  className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-muted-foreground/60"
                />
              ) : null}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 rounded-xl">
              <DropdownMenuLabel>Needs attention</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {alerts.length ? (
                alerts.map((x) => {
                  const Icon = x.icon;
                  return (
                    <DropdownMenuItem key={x.label} onSelect={() => void x.go()} className="py-2.5">
                      <Icon aria-hidden /> <span className="whitespace-normal">{x.label}</span>
                    </DropdownMenuItem>
                  );
                })
              ) : (
                <p className="px-2 py-3 text-sm text-muted-foreground">
                  All clear. Nothing pending right now.
                </p>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <ThemeToggle className="hidden lg:inline-flex" />

          <div className="lg:hidden">
            <UserMenu compact />
          </div>
        </div>
      </div>
    </header>
  );
}

const SEEN_KEY = "rf.attention-seen";
function readSeen(): Record<string, number> {
  try {
    return JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}
function writeSeen(v: Record<string, number>) {
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(v));
  } catch {
    /* private mode: badge just shows again next visit */
  }
}
