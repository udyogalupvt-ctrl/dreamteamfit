import { useState } from "react";
import { Bell, Plus } from "lucide-react";
import { SearchInput } from "@/components/common/search-input";
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
import { NOTIFICATIONS } from "@/constants/demo-data";

export function Topbar() {
  const [search, setSearch] = useState("");

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <MobileNavDrawer />

        <div className="hidden min-w-0 flex-1 md:block">
          <SearchInput value={search} onValueChange={setSearch} containerClassName="max-w-md" />
        </div>

        <div className="flex flex-1 items-center justify-end gap-2 md:flex-none">
          <Button size="sm" className="hidden sm:inline-flex">
            <Plus aria-hidden /> Quick add
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger
              className="relative grid size-10 cursor-pointer place-items-center rounded-lg border border-border bg-surface transition-colors hover:bg-accent"
              aria-label={`Notifications (${NOTIFICATIONS.length} unread)`}
            >
              <Bell className="size-[18px]" aria-hidden />
              <span
                className="absolute top-2 right-2 size-2 rounded-full bg-destructive ring-2 ring-surface"
                aria-hidden
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 rounded-xl">
              <DropdownMenuLabel>Notifications</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {NOTIFICATIONS.map((note) => (
                <DropdownMenuItem key={note.id} className="flex-col items-start gap-0.5 py-2.5">
                  <span className="text-sm font-semibold">{note.title}</span>
                  <span className="text-xs text-muted-foreground">{note.description}</span>
                </DropdownMenuItem>
              ))}
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
