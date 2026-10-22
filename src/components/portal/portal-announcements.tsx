import { useEffect, useState } from "react";
import { ChevronRight, Loader2, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PortalAnnouncement } from "@/constants/portal";
import { portalCall } from "@/lib/portal-firebase";
import { day } from "./portal-shell";

const sentLine = (a: PortalAnnouncement) => `${day(a.sentOn)}${a.edited ? " · edited" : ""}`;

/** Home: the gym's newest announcement while it's fresh (src/lib/app-announcement.ts onHome). */
export function AnnouncementCard({
  a,
  gymName,
  onOpen,
}: {
  a: PortalAnnouncement;
  gymName: string;
  onOpen: () => void;
}) {
  return (
    <section className="surface-card p-4" aria-label="Latest announcement">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Megaphone className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold">From {gymName}</h2>
          <p className="text-meta">{sentLine(a)}</p>
        </div>
      </div>
      <p className="mt-3 line-clamp-5 text-sm break-words whitespace-pre-wrap">{a.message}</p>
      <Button size="sm" variant="ghost" className="mt-2 -ml-2" onClick={onOpen}>
        All announcements <ChevronRight aria-hidden />
      </Button>
    </section>
  );
}

/** Home's way in to Announcements (also when nothing new is on Home). */
export function AnnouncementsLink({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-border p-3 text-left text-sm hover:bg-accent"
    >
      <Megaphone className="size-4 shrink-0 text-primary" aria-hidden />
      <span className="flex-1">Announcements from the gym</span>
      <span className="font-semibold">Open</span>
    </button>
  );
}

/** Member app → Announcements: news from the gym, newest first. */
export function AnnouncementsView({ gymName }: { gymName: string }) {
  const [items, setItems] = useState<PortalAnnouncement[] | null>(null);
  const [loadError, setLoadError] = useState("");

  const load = () => {
    setLoadError("");
    portalCall<{ items: PortalAnnouncement[] }>("/api/portal/announcements")
      .then((r) => setItems(r.items))
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : "Couldn't load."));
  };
  useEffect(load, []);

  if (loadError)
    return (
      <div className="surface-card space-y-2 p-4 text-sm">
        <p>{loadError}</p>
        <Button size="sm" variant="outline" onClick={load}>
          Try again
        </Button>
      </div>
    );
  if (items === null)
    return (
      <div className="surface-card flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
      </div>
    );
  if (!items.length)
    return (
      <div className="surface-card flex flex-col items-center gap-2 p-8 text-center">
        <Megaphone className="size-8 text-muted-foreground" aria-hidden />
        <p className="font-semibold">No announcements yet</p>
        <p className="text-meta">News from {gymName}, like holiday timings, shows here.</p>
      </div>
    );
  return (
    <ul className="space-y-3" aria-label="Announcements">
      {items.map((a) => (
        <li key={a.id} className="surface-card space-y-2 p-4">
          <p className="text-meta">{sentLine(a)}</p>
          <p className="text-sm break-words whitespace-pre-wrap">{a.message}</p>
        </li>
      ))}
    </ul>
  );
}
