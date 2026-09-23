import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Package, Search, UserPlus, Users } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useLive } from "@/hooks/use-live-query";
import { normalizePhone } from "@/lib/format";
import { subscribeClients } from "@/services/clients.service";
import { subscribeInquiries } from "@/services/inquiries.service";
import { subscribePackages } from "@/services/packages.service";
import type { Client, GymPackage, Inquiry } from "@/types/models";

export function GlobalSearch({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const clients = useLive<Client[]>(subscribeClients, [], []);
  const inquiries = useLive<Inquiry[]>(subscribeInquiries, [], []);
  const packages = useLive<GymPackage[]>(subscribePackages, [], []);
  const q = query.trim().toLowerCase();
  const phone = normalizePhone(query);

  const results = useMemo(() => ({
    clients: q
      ? clients.data.filter((item) =>
          item.fullName.toLowerCase().includes(q) ||
          item.clientCode.toLowerCase().includes(q) ||
          (phone.length >= 3 && item.phoneNormalized.includes(phone)),
        ).slice(0, 5)
      : [],
    inquiries: q
      ? inquiries.data.filter((item) =>
          item.name.toLowerCase().includes(q) ||
          (phone.length >= 3 && item.phoneNormalized.includes(phone)),
        ).slice(0, 5)
      : [],
    packages: q
      ? packages.data.filter((item) =>
          item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q),
        ).slice(0, 5)
      : [],
  }), [clients.data, inquiries.data, packages.data, phone, q]);

  const go = (to: "/clients/$clientId" | "/inquiries" | "/packages", clientId?: string) => {
    setOpen(false);
    setQuery("");
    if (to === "/clients/$clientId" && clientId) {
      void navigate({ to, params: { clientId } });
    } else if (to === "/inquiries" || to === "/packages") {
      void navigate({ to });
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={compact
          ? "grid size-10 place-items-center rounded-lg border border-border bg-surface text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          : "flex h-10 w-full max-w-md items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm text-muted-foreground transition-colors hover:border-ring"}
        aria-label="Search clients, inquiries and packages"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        {!compact ? <span>Search clients, inquiries and packages…</span> : null}
      </button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput value={query} onValueChange={setQuery} placeholder="Search real gym records…" />
        <CommandList>
          <CommandEmpty>{q ? "No matching records found." : "Start typing to search."}</CommandEmpty>
          {results.clients.length ? (
            <CommandGroup heading="Clients">
              {results.clients.map((item) => (
                <CommandItem key={item.id} value={`client ${item.fullName} ${item.clientCode}`} onSelect={() => go("/clients/$clientId", item.id)}>
                  <Users aria-hidden /><span className="min-w-0 truncate">{item.fullName}</span><span className="ml-auto text-xs text-muted-foreground">{item.clientCode}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {results.inquiries.length ? (
            <CommandGroup heading="Inquiries">
              {results.inquiries.map((item) => (
                <CommandItem key={item.id} value={`inquiry ${item.name} ${item.phone}`} onSelect={() => go("/inquiries")}>
                  <UserPlus aria-hidden /><span className="min-w-0 truncate">{item.name}</span><span className="ml-auto text-xs text-muted-foreground">{item.phone}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {results.packages.length ? (
            <CommandGroup heading="Packages">
              {results.packages.map((item) => (
                <CommandItem key={item.id} value={`package ${item.name}`} onSelect={() => go("/packages")}>
                  <Package aria-hidden /><span className="min-w-0 truncate">{item.name}</span><span className="ml-auto text-xs text-muted-foreground">{item.durationDays} days</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </CommandDialog>
    </>
  );
}