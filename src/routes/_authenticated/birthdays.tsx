import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { differenceInYears, parseISO } from "date-fns";
import { Cake, MessageCircle, Phone } from "lucide-react";
import { ClientAvatar } from "@/components/clients/client-avatar";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadingRows } from "@/components/common/loading-state";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLive } from "@/hooks/use-live-query";
import { daysBetween } from "@/lib/member-plans";
import { birthdayMonthDay, indiaToday } from "@/lib/retention-dates";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp-phone";
import {
  DEFAULT_BILLING_SETTINGS,
  subscribeBusinessSettings,
} from "@/services/business-settings.service";
import { subscribeClients } from "@/services/clients.service";
import type { Client } from "@/types/models";

export const Route = createFileRoute("/_authenticated/birthdays")({
  head: () => ({ meta: [{ title: "Birthdays — REBUILD FITNESS" }] }),
  component: Birthdays,
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "09-24" → "24 Sep". */
const monthDay = (md: string) => `${Number(md.slice(3))} ${MONTHS[Number(md.slice(0, 2)) - 1]}`;

function Birthdays() {
  const live = useLive<Client[]>(subscribeClients, [], []);
  const business = useLive(subscribeBusinessSettings, DEFAULT_BILLING_SETTINGS, []);
  const today = indiaToday();
  const { current, upcoming } = useMemo(() => {
    const md = today.slice(5);
    const all = live.data
      .filter((c) => c.dateOfBirth)
      .sort((a, b) =>
        birthdayMonthDay(a.dateOfBirth ?? "").localeCompare(birthdayMonthDay(b.dateOfBirth ?? "")),
      );
    return {
      current: all.filter((c) => birthdayMonthDay(c.dateOfBirth ?? "") === md),
      upcoming: all.filter((c) => birthdayMonthDay(c.dateOfBirth ?? "") > md).slice(0, 30),
    };
  }, [live.data, today]);

  const card = (c: Client, isToday: boolean) => {
    const md = birthdayMonthDay(c.dateOfBirth ?? "");
    const next = `${today.slice(0, 4)}-${md}`;
    const inDays = daysBetween(today, next);
    const age = differenceInYears(parseISO(next), parseISO(c.dateOfBirth ?? today));
    const first = c.fullName.split(" ")[0] || c.fullName;
    const phone = normalizeWhatsAppPhone(c.whatsappPhone || c.phone);
    const wish = `Happy birthday ${first}! 🎂 Wishing you a strong and healthy year ahead from everyone at ${business.data.businessName || "the gym"}.`;
    return (
      <article className="surface-card flex items-center gap-3 p-4" key={c.id}>
        <ClientAvatar name={c.fullName} url={c.profilePhotoUrl} size={48} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{c.fullName}</p>
          <p className="text-meta">
            Turns {age} · {monthDay(md)}
            {isToday ? " · today" : ` · in ${inDays} day${inDays === 1 ? "" : "s"}`}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" asChild disabled={!phone.ok}>
              <a
                href={`https://wa.me/${phone.ok ? phone.value : ""}?text=${encodeURIComponent(wish)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle aria-hidden /> Wish on WhatsApp
              </a>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={`tel:${c.phone}`}>
                <Phone aria-hidden /> Call
              </a>
            </Button>
          </div>
        </div>
      </article>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Birthdays"
        description="Members with a birthday today or coming up. With the WhatsApp API on, they get a birthday wish at 8 AM by themselves; you can also wish them yourself."
        breadcrumbs={[{ label: "Home", to: "/dashboard" }, { label: "Birthdays" }]}
      />
      {live.loading ? (
        <LoadingRows />
      ) : live.error ? (
        <ErrorState error={live.error} title="Couldn't load birthdays" />
      ) : (
        <Tabs defaultValue="today">
          <TabsList>
            <TabsTrigger value="today">Today ({current.length})</TabsTrigger>
            <TabsTrigger value="upcoming">Coming up ({upcoming.length})</TabsTrigger>
          </TabsList>
          {(
            [
              ["today", current, "No birthdays today"],
              ["upcoming", upcoming, "No more birthdays this year"],
            ] as const
          ).map(([tab, items, empty]) => (
            <TabsContent key={tab} value={tab} className="mt-4">
              {items.length ? (
                <div className="grid gap-3 lg:grid-cols-2">
                  {items.map((c) => card(c, tab === "today"))}
                </div>
              ) : (
                <EmptyState
                  icon={Cake}
                  title={empty}
                  description="Birthdays come from the date of birth on each member's profile."
                />
              )}
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}
