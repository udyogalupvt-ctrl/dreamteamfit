import { useMemo, useRef, useState } from "react";
import { Loader2, Send, Smartphone, Square } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { FormSection } from "@/components/common/form-section";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { dobPassword } from "@/constants/portal";
import { useLive } from "@/hooks/use-live-query";
import { effectiveMembershipStatus } from "@/lib/format";
import {
  DEFAULT_BILLING_SETTINGS,
  subscribeBusinessSettings,
} from "@/services/business-settings.service";
import { subscribeClients } from "@/services/clients.service";
import { subscribeMemberships } from "@/services/memberships.service";
import { ensureMemberApp } from "@/services/portal.service";
import { sendMemberAppWhatsApp } from "@/services/whatsapp.service";
import {
  DEFAULT_WHATSAPP_SETTINGS,
  isWhatsAppApiLive,
  subscribeWhatsAppSettings,
} from "@/services/whatsapp-settings.service";
import type { Client, Membership } from "@/types/models";

/** Approx. Meta price of one Utility message in India (see WhatsApp usage). */
const UTILITY_RATE = 0.12;

/**
 * Members who joined before the member app: send everyone with a running package their link in
 * one go (new members get it by themselves after their first payment).
 */
export function MemberAppBulkSend() {
  const wa = useLive(subscribeWhatsAppSettings, DEFAULT_WHATSAPP_SETTINGS, []);
  const business = useLive(subscribeBusinessSettings, DEFAULT_BILLING_SETTINGS, []);
  const clients = useLive<Client[]>(subscribeClients, [], []);
  const memberships = useLive<Membership[]>(subscribeMemberships, [], []);
  const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState<{ done: number; sent: number; failed: number } | null>(
    null,
  );
  const stop = useRef(false);

  const groups = useMemo(() => {
    const running = new Set(
      memberships.data
        .filter((m) => effectiveMembershipStatus(m) === "active")
        .map((m) => m.clientId),
    );
    const waiting = clients.data.filter((c) => running.has(c.id) && !c.portalSentAt);
    return {
      ready: waiting.filter((c) => c.whatsappOptIn && dobPassword(c.dateOfBirth)),
      noDob: waiting.filter((c) => !dobPassword(c.dateOfBirth)).length,
      noWhatsApp: waiting.filter((c) => !c.whatsappOptIn && dobPassword(c.dateOfBirth)).length,
    };
  }, [clients.data, memberships.data]);

  const live = isWhatsAppApiLive(wa.data) && !!wa.data.memberAppTemplate;
  const run = async () => {
    setConfirm(false);
    stop.current = false;
    const list = groups.ready;
    let sent = 0;
    let failed = 0;
    setProgress({ done: 0, sent, failed });
    for (let i = 0; i < list.length && !stop.current; i++) {
      const c = list[i]!;
      try {
        const { code } = await ensureMemberApp(c.id);
        const r = await sendMemberAppWhatsApp(c, code, wa.data, business.data);
        if (!r.duplicate) sent++;
      } catch {
        failed++;
      }
      setProgress({ done: i + 1, sent, failed });
    }
    toast.success(`Member app link sent to ${sent} members`, {
      description: failed ? `${failed} could not be sent (see WhatsApp usage).` : undefined,
    });
    setProgress(null);
  };

  return (
    <FormSection
      title="Member app for existing members"
      description="New members get their app link by themselves after the first payment. Send it here to members who joined before."
    >
      <div className="space-y-3 text-sm">
        <div className="flex items-start gap-3">
          <Smartphone className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div>
            <p>
              <b>{groups.ready.length}</b> members with a running package haven't got the link yet.
            </p>
            {groups.noDob ? (
              <p className="text-meta">
                {groups.noDob} more have no date of birth (their password): add it in their profile.
              </p>
            ) : null}
            {groups.noWhatsApp ? (
              <p className="text-meta">
                {groups.noWhatsApp} said no to WhatsApp: use Share on WhatsApp in their profile.
              </p>
            ) : null}
          </div>
        </div>
        {progress ? (
          <div className="space-y-2">
            <Progress value={(progress.done / Math.max(1, groups.ready.length)) * 100} />
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Sending {progress.done} of{" "}
                {groups.ready.length}…
              </span>
              <Button size="sm" variant="outline" onClick={() => (stop.current = true)}>
                <Square aria-hidden /> Stop
              </Button>
            </div>
          </div>
        ) : (
          <Button
            disabled={!live || !groups.ready.length || clients.loading}
            onClick={() => setConfirm(true)}
          >
            <Send aria-hidden /> Send to {groups.ready.length} members
          </Button>
        )}
        {!live ? (
          <p className="text-meta">
            Turn on the WhatsApp Cloud API and add the member app template above first.
          </p>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Send the member app to ${groups.ready.length} members?`}
        description={`Each gets one WhatsApp message with their link (Meta charges about ₹${(groups.ready.length * UTILITY_RATE).toFixed(0)} in total).`}
        confirmLabel="Send now"
        typeToConfirm="SEND"
        cancelLabel="Not now"
        onConfirm={() => void run()}
      />
    </FormSection>
  );
}
