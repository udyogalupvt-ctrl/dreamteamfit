import { useNavigate } from "@tanstack/react-router";
import { Bell, CalendarPlus, CreditCard, MessageSquareHeart, ReceiptIndianRupee, UserPlus, Users } from "lucide-react";
import { GlobalSearch } from "@/components/layout/global-search";
import { MobileNavDrawer } from "@/components/layout/mobile-nav";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { useEnrollment } from "@/components/enrollment/enrollment-context";
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
  const { openEnrollment } = useEnrollment();

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
              <DropdownMenuItem onSelect={() => openEnrollment()}><Users aria-hidden /> New Member</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate({ to: "/leads" })}><UserPlus aria-hidden /> Inquiry</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate({ to: "/leads", search: { tab: "followups" } })}><MessageSquareHeart aria-hidden /> Follow-up</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate({ to: "/bookings", search: { create: true } })}><CalendarPlus aria-hidden /> Book PT / Class</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate({ to: "/expenses", search: { create: true } })}><ReceiptIndianRupee aria-hidden /> Expense</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate({ to: "/billing", search: { create: true } })}><CreditCard aria-hidden /> Bill (only when needed)</DropdownMenuItem>
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
              <DropdownMenuItem onSelect={() => navigate({ to: "/notifications" })}><Bell aria-hidden /> View automation history</DropdownMenuItem>
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
