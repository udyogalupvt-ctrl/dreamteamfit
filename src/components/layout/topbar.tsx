import { useNavigate } from "@tanstack/react-router";
import { Bell, CalendarPlus, CreditCard, Dumbbell, Package, ReceiptIndianRupee, Salad, UserPlus, Users, UsersRound } from "lucide-react";
import { GlobalSearch } from "@/components/layout/global-search";
import { MobileNavDrawer } from "@/components/layout/mobile-nav";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function Topbar() {
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <MobileNavDrawer />

        <div className="hidden min-w-0 flex-1 md:block">
          <GlobalSearch />
        </div>

        <div className="flex flex-1 items-center justify-end gap-2 md:flex-none">
          <div className="md:hidden"><GlobalSearch compact /></div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="hidden sm:inline-flex">Quick add</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => navigate({ to: "/inquiries" })}><UserPlus aria-hidden /> Inquiry</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate({ to: "/clients" })}><Users aria-hidden /> Client</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate({ to: "/packages" })}><Package aria-hidden /> Package</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate({ to: "/workout-plans", search: { create: true } })}><Dumbbell aria-hidden /> Workout plan</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate({ to: "/diet-plans", search: { create: true } })}><Salad aria-hidden /> Diet plan</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate({ to: "/bookings", search: { create: true } })}><CalendarPlus aria-hidden /> Booking</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate({ to: "/group-classes" })}><UsersRound aria-hidden /> Group class</DropdownMenuItem>
               <DropdownMenuItem onSelect={() => navigate({ to: "/expenses", search: { create: true } })}><ReceiptIndianRupee aria-hidden /> Expense</DropdownMenuItem>
               <DropdownMenuItem onSelect={() => navigate({ to: "/billing", search: { create: true } })}><CreditCard aria-hidden /> Bill</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger
              className="relative grid size-10 cursor-pointer place-items-center rounded-lg border border-border bg-surface transition-colors hover:bg-accent"
              aria-label="Notifications"
            >
              <Bell className="size-[18px]" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 rounded-xl">
              <DropdownMenuLabel>Notifications</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <p className="px-3 py-5 text-center text-sm text-muted-foreground">No notifications yet.</p>
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
