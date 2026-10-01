import { useState } from "react";
import { Copy, Eye, KeyRound, Loader2, MessageCircle, Power, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAccess } from "@/hooks/use-access";
import { useLive } from "@/hooks/use-live-query";
import { toastWithUndo } from "@/lib/undo-toast";
import {
  DEFAULT_BILLING_SETTINGS,
  subscribeBusinessSettings,
} from "@/services/business-settings.service";
import {
  portalUrl,
  suggestPassword,
  trainerAccess,
  whatsAppShareUrl,
} from "@/services/portal.service";
import type { Trainer } from "@/types/models";

export const trainerAppMessage = (name: string, gym: string, url: string, password: string) =>
  `Hi ${name.split(" ")[0] || name}, your ${gym} trainer app is ready: ${url}\nPassword: ${password}\nOpen the link to see your PT members, give workout and diet plans, and chat with them.`;

/** Trainer app login: link + password, made and kept by the owner. */
export function TrainerLoginCard({ trainer }: { trainer: Trainer }) {
  const { owner } = useAccess();
  const business = useLive(subscribeBusinessSettings, DEFAULT_BILLING_SETTINGS, []);
  const [password, setPassword] = useState(suggestPassword);
  const [shown, setShown] = useState("");
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const code = trainer.portalCode;
  const url = code ? portalUrl("trainer", code) : "";

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const reveal = async () => {
    const r = await trainerAccess(trainer.id, "reveal");
    if (!r.password) throw new Error("Not saved. Set a new password below to save it.");
    setShown(r.password);
    return r.password;
  };
  const share = () => {
    const win = window.open("", "_blank");
    if (win) win.opener = null;
    void run(async () => {
      try {
        const pw = shown || (await reveal());
        const target = whatsAppShareUrl(
          trainer.phone,
          trainerAppMessage(trainer.name, business.data.businessName, url, pw),
        );
        if (win) win.location.href = target;
        else window.open(target, "_blank", "noopener,noreferrer");
      } catch (e) {
        win?.close();
        throw e;
      }
    });
  };

  return (
    <section className="surface-card space-y-3 p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Smartphone className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <h2 className="text-card-title">Trainer app login</h2>
            <StatusPill tone={!code ? "warning" : trainer.portalActive ? "success" : "danger"}>
              {!code ? "No login" : trainer.portalActive ? "Login on" : "Switched off"}
            </StatusPill>
          </div>
          <p className="text-meta mt-0.5">
            {trainer.name.split(" ")[0]} sees their PT members, gives workout and diet plans, and
            chats with them.
          </p>
        </div>
      </div>

      {!owner ? (
        <p className="text-meta">Only the owner can make or change trainer logins.</p>
      ) : !code ? (
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <div className="grid gap-1.5">
            <label htmlFor="tr-pass" className="text-label">
              Password
            </label>
            <Input
              id="tr-pass"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
            />
            <p className="text-meta">
              At least 6 characters. Saved safely so you can send it again.
            </p>
          </div>
          <Button
            className="sm:mt-6"
            disabled={busy || password.trim().length < 6}
            onClick={() =>
              void run(async () => {
                await trainerAccess(trainer.id, "create", password.trim());
                setShown(password.trim());
                toast.success("Trainer login made", {
                  description: "Now send it to them on WhatsApp.",
                });
              })
            }
          >
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <KeyRound aria-hidden />}{" "}
            Make login
          </Button>
        </div>
      ) : (
        <>
          <p className="truncate rounded-lg bg-muted px-3 py-2 font-mono text-xs" title={url}>
            {url}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-meta">Password:</span>
            <span className="font-mono font-bold tracking-wider">{shown || "••••••"}</span>
            {!shown ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(reveal)}>
                <Eye aria-hidden /> Show
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              className="bg-[#128C7E] text-white hover:bg-[#0e7266]"
              disabled={busy || !trainer.portalActive}
              onClick={share}
            >
              <MessageCircle aria-hidden /> Send on WhatsApp
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void run(async () => {
                  await navigator.clipboard.writeText(url);
                  toast.success("Link copied");
                })
              }
            >
              <Copy aria-hidden /> Copy link
            </Button>
            <Button size="sm" variant="outline" onClick={() => setChanging((v) => !v)}>
              <KeyRound aria-hidden /> Change password
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const was = trainer.portalActive;
                  await trainerAccess(trainer.id, was ? "off" : "on");
                  toastWithUndo(was ? "Login switched off" : "Login switched on", () =>
                    trainerAccess(trainer.id, was ? "on" : "off"),
                  );
                })
              }
            >
              <Power aria-hidden /> {trainer.portalActive ? "Switch off" : "Switch on"}
            </Button>
          </div>
          {changing ? (
            <div className="flex gap-2">
              <label htmlFor="tr-new" className="sr-only">
                New password
              </label>
              <Input
                id="tr-new"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
              />
              <Button
                disabled={busy || password.trim().length < 6}
                onClick={() =>
                  void run(async () => {
                    await trainerAccess(trainer.id, "password", password.trim());
                    setShown(password.trim());
                    setChanging(false);
                    toast.success("Password changed", { description: "Send it to the trainer." });
                  })
                }
              >
                Save
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
