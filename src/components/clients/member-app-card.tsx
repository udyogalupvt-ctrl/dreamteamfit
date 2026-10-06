import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Copy,
  KeyRound,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Power,
  Send,
  Smartphone,
} from "lucide-react";
import { toast } from "sonner";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { dobPassword } from "@/constants/portal";
import { useLive } from "@/hooks/use-live-query";
import { formatDate, todayISO } from "@/lib/format";
import { toastWithUndo } from "@/lib/undo-toast";
import { cn } from "@/lib/utils";
import {
  DEFAULT_BILLING_SETTINGS,
  subscribeBusinessSettings,
} from "@/services/business-settings.service";
import { updateClient } from "@/services/clients.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import {
  ensureMemberApp,
  markMemberAppShared,
  memberAppAction,
  memberAppMessage,
  portalUrl,
  whatsAppShareUrl,
} from "@/services/portal.service";
import { sendMemberAppWhatsApp } from "@/services/whatsapp.service";
import {
  DEFAULT_WHATSAPP_SETTINGS,
  isWhatsAppApiLive,
  subscribeWhatsAppSettings,
} from "@/services/whatsapp-settings.service";
import type { Client } from "@/types/models";

type SendState = { kind: "idle" | "sending" | "sent" } | { kind: "failed"; message: string };

/**
 * The member's app: private link + password (date of birth). `auto` (joining flow, right after
 * the payment): makes the link and sends it on WhatsApp by itself, once per member.
 */
export function MemberAppCard({
  client,
  auto = false,
  className,
}: {
  client: Client;
  auto?: boolean;
  className?: string;
}) {
  const wa = useLive(subscribeWhatsAppSettings, DEFAULT_WHATSAPP_SETTINGS, []);
  const business = useLive(subscribeBusinessSettings, DEFAULT_BILLING_SETTINGS, []);
  const [busy, setBusy] = useState(false);
  const [send, setSend] = useState<SendState>({ kind: "idle" });
  const [dob, setDob] = useState(client.dateOfBirth ?? "");
  const autoRan = useRef(false);
  const code = client.portalCode;
  const hasDob = !!dobPassword(client.dateOfBirth);
  const apiLive = isWhatsAppApiLive(wa.data) && !!wa.data.memberAppTemplate;
  const canApi = apiLive && client.whatsappOptIn;
  const url = code ? portalUrl("member", code) : "";

  const make = async () => {
    const r = await ensureMemberApp(client.id);
    if (r.created) toast.success("Member app link made", { description: client.fullName });
    return r.code;
  };
  const sendApi = async (theCode: string, again: boolean) => {
    setSend({ kind: "sending" });
    try {
      const r = await sendMemberAppWhatsApp(client, theCode, wa.data, business.data, again);
      setSend({ kind: "sent" });
      if (again && !r.duplicate) toast.success("Member app link sent on WhatsApp");
    } catch (e) {
      setSend({ kind: "failed", message: firestoreErrorMessage(e) });
    }
  };

  // Joining flow: make the link and send it once, as soon as settings are loaded.
  useEffect(() => {
    if (!auto || autoRan.current || wa.loading || business.loading || !hasDob) return;
    autoRan.current = true;
    void (async () => {
      try {
        const c = code || (await make());
        if (canApi && wa.data.autoSendMemberApp && !client.portalSentAt) await sendApi(c, false);
      } catch (e) {
        setSend({ kind: "failed", message: firestoreErrorMessage(e) });
      }
    })();
  }, [auto, wa.loading, business.loading, hasDob]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const saveDob = () =>
    run(async () => {
      if (!dobPassword(dob)) throw new Error("Enter a valid date of birth.");
      await updateClient(client.id, { dateOfBirth: dob });
      const c = await ensureMemberApp(client.id);
      if (auto && canApi && wa.data.autoSendMemberApp) await sendApi(c.code, false);
      else toast.success("Member app link made");
    });

  const share = () => {
    // Open the window inside the tap so phones allow it, then fill in the link.
    const win = window.open("", "_blank");
    if (win) win.opener = null;
    void run(async () => {
      try {
        const c = code || (await make());
        const target = whatsAppShareUrl(
          client.whatsappPhone || client.phone,
          memberAppMessage(client.fullName, business.data.businessName, portalUrl("member", c)),
          wa.data.defaultCountryCode,
        );
        if (win) win.location.href = target;
        else window.open(target, "_blank", "noopener,noreferrer");
        await markMemberAppShared(client.id);
      } catch (e) {
        win?.close();
        throw e;
      }
    });
  };

  const copy = () =>
    run(async () => {
      const c = code || (await make());
      await navigator.clipboard.writeText(portalUrl("member", c));
      toast.success("Member app link copied");
    });

  const status = !code ? (
    <StatusPill tone="warning">Not made yet</StatusPill>
  ) : !client.portalActive ? (
    <StatusPill tone="danger">Switched off</StatusPill>
  ) : client.portalSentAt || send.kind === "sent" ? (
    <StatusPill tone="success">
      Sent{client.portalSentAt ? ` ${formatDate(client.portalSentAt)}` : ""}
    </StatusPill>
  ) : (
    <StatusPill tone="info">Ready, not sent</StatusPill>
  );

  return (
    <section className={cn("surface-card space-y-3 p-4 sm:p-5", className)}>
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Smartphone className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <h2 className="text-card-title">Member app</h2>
            {status}
          </div>
          <p className="text-meta mt-0.5">
            Their package, visits, payments and workout. Password: date of birth (DDMMYYYY).
          </p>
        </div>
      </div>

      {!hasDob && !code ? (
        <div className="space-y-2 rounded-xl border border-warning/50 bg-warning/10 p-3">
          <p className="text-sm font-semibold">Add the date of birth: it is their password.</p>
          <div className="flex gap-2">
            <label htmlFor={`dob-${client.id}`} className="sr-only">
              Date of birth
            </label>
            <Input
              id={`dob-${client.id}`}
              type="date"
              value={dob}
              max={todayISO()}
              onChange={(e) => setDob(e.target.value)}
              className="flex-1"
            />
            <Button disabled={busy || !dob} onClick={() => saveDob()}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : null} Save
            </Button>
          </div>
        </div>
      ) : (
        <>
          {url ? (
            <p className="truncate rounded-lg bg-muted px-3 py-2 font-mono text-xs" title={url}>
              {url}
            </p>
          ) : null}
          {send.kind === "sending" ? (
            <p className="flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Sending the member app link on
              WhatsApp…
            </p>
          ) : send.kind === "sent" ? (
            <p className="flex items-center gap-2 text-sm font-semibold text-success">
              <CheckCircle2 className="size-4" aria-hidden /> Link sent to{" "}
              {client.whatsappPhone || client.phone} on WhatsApp
            </p>
          ) : send.kind === "failed" ? (
            <p role="alert" className="text-sm font-semibold text-destructive">
              Not sent on WhatsApp: {send.message} Use Share on WhatsApp instead.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {canApi ? (
              <Button
                size="sm"
                disabled={busy || send.kind === "sending" || !client.portalActive}
                onClick={() =>
                  void run(async () => {
                    const c = code || (await make());
                    await sendApi(c, !!client.portalSentAt || send.kind === "sent");
                  })
                }
              >
                <Send aria-hidden />{" "}
                {client.portalSentAt || send.kind === "sent" ? "Send again" : "Send on WhatsApp"}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant={canApi ? "outline" : "default"}
              className={cn(!canApi && "bg-[#128C7E] text-white hover:bg-[#0e7266]")}
              disabled={busy || !client.portalActive}
              onClick={share}
            >
              <MessageCircle aria-hidden /> {canApi ? "Share from this phone" : "Share on WhatsApp"}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => copy()}>
              <Copy aria-hidden /> Copy link
            </Button>
            {code ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost" aria-label="More member app actions">
                    <MoreHorizontal aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    disabled={!hasDob}
                    onSelect={() =>
                      void run(async () => {
                        await memberAppAction(client.id, "reset");
                        toast.success("Password set to the date of birth again");
                      })
                    }
                  >
                    <KeyRound aria-hidden /> Reset password to date of birth
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      void run(async () => {
                        const was = client.portalActive;
                        await memberAppAction(client.id, was ? "off" : "on");
                        toastWithUndo(
                          was ? "Member app switched off" : "Member app switched on",
                          () => memberAppAction(client.id, was ? "on" : "off"),
                        );
                      })
                    }
                  >
                    <Power aria-hidden />{" "}
                    {client.portalActive ? "Switch off member app" : "Switch on member app"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
          {!client.whatsappOptIn && apiLive ? (
            <p className="text-meta">
              This member said no to WhatsApp messages from the gym number: share it from this phone
              instead.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
