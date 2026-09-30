import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { InstallAppButton, useInstallApp } from "@/components/layout/install-app-button";
import { Button } from "@/components/ui/button";
import { disablePush, enablePush, pushStatus, refreshPush, type PushStatus } from "@/lib/push";
import { cn } from "@/lib/utils";

/** This phone's notification state, kept fresh (null while checking). */
export function usePushStatus() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  useEffect(() => {
    void pushStatus().then(setStatus);
    void refreshPush();
  }, []);
  return [status, setStatus] as const;
}

const WHAT = {
  member: "Package ending, payment due, messages from your trainer and gym news.",
  trainer: "New messages from your PT members.",
};

/**
 * "Get the app": install it on the phone and turn on notifications. Shown at the top of the
 * member / trainer app until both are done (or can't be done on this phone).
 */
export function AppSetupCard({ kind }: { kind: "member" | "trainer" }) {
  const app = useInstallApp();
  const [status, setStatus] = usePushStatus();
  const [busy, setBusy] = useState(false);
  const pushTodo = status === "off" || status === "install-first" || status === "blocked";
  if (!app.available && !pushTodo) return null;

  const turnOn = async () => {
    setBusy(true);
    try {
      const next = await enablePush();
      setStatus(next);
      if (next === "on") toast.success("Notifications are on for this phone.");
      else if (next === "blocked") toast.error("Notifications are blocked on this phone.");
    } catch (e) {
      toast.error((e as Error).message || "Couldn't turn on notifications.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="surface-card space-y-3 border-primary/50 p-4" aria-label="Get the app">
      {app.available ? (
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Download className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-bold">Install the app</p>
            <p className="text-meta">Open it from your home screen, like any app.</p>
          </div>
          <InstallAppButton size="default" />
        </div>
      ) : null}
      {pushTodo ? (
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-info text-info-foreground">
            {status === "blocked" ? (
              <BellOff className="size-5" aria-hidden />
            ) : (
              <BellRing className="size-5" aria-hidden />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-bold">
              {status === "blocked" ? "Notifications are blocked" : "Turn on notifications"}
            </p>
            <p className="text-meta">
              {status === "install-first"
                ? "On iPhone: install the app first, open it from your home screen, then turn them on there."
                : status === "blocked"
                  ? "Allow notifications for this app in your phone's settings, then come back."
                  : WHAT[kind]}
            </p>
          </div>
          {status === "off" ? (
            <Button onClick={() => turnOn()} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Bell aria-hidden />} Turn
              on
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** Small on/off line for the bottom of the app ("Notifications on this phone"). */
export function NotificationToggle({
  kind,
  className,
}: {
  kind: "member" | "trainer";
  className?: string;
}) {
  const [status, setStatus] = usePushStatus();
  const [busy, setBusy] = useState(false);
  if (status !== "on" && status !== "off") return null;
  const flip = async () => {
    setBusy(true);
    try {
      setStatus(status === "on" ? await disablePush() : await enablePush());
    } catch (e) {
      toast.error((e as Error).message || "Couldn't change notifications.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={cn("flex items-center gap-3 text-sm", className)}>
      {status === "on" ? (
        <BellRing className="size-4 shrink-0 text-success" aria-hidden />
      ) : (
        <BellOff className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">
          Notifications {status === "on" ? "on" : "off"} on this phone
        </span>
        <span className="text-meta">{WHAT[kind]}</span>
      </span>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => flip()}>
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {status === "on" ? "Turn off" : "Turn on"}
      </Button>
    </div>
  );
}
