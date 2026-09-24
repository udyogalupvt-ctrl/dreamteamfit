import { useState } from "react";
import { Copy, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useLive } from "@/hooks/use-live-query";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp-phone";
import {
  DEFAULT_BILLING_SETTINGS,
  subscribeBusinessSettings,
} from "@/services/business-settings.service";
import { ensurePhotoLink } from "@/services/clients.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import {
  DEFAULT_WHATSAPP_SETTINGS,
  subscribeWhatsAppSettings,
} from "@/services/whatsapp-settings.service";
import type { Client } from "@/types/models";

/** Sends the member a private link to upload their own photo (WhatsApp or copy). */
export function PhotoLinkButtons({
  client,
}: {
  client: Pick<Client, "id" | "fullName" | "phone" | "whatsappPhone">;
}) {
  const wa = useLive(subscribeWhatsAppSettings, DEFAULT_WHATSAPP_SETTINGS, []);
  const business = useLive(subscribeBusinessSettings, DEFAULT_BILLING_SETTINGS, []);
  const [busy, setBusy] = useState(false);
  const link = async () => `${window.location.origin}/photo/${await ensurePhotoLink(client.id)}`;
  const share = async () => {
    const phone = normalizeWhatsAppPhone(
      client.whatsappPhone || client.phone,
      wa.data.defaultCountryCode,
    );
    // Open the window first (in the click) so phones don't block it, then fill in the link.
    const win = window.open("", "_blank", "noopener,noreferrer");
    setBusy(true);
    try {
      const url = await link();
      const first = client.fullName.split(" ")[0] || client.fullName;
      const text = `Hi ${first}, please add your photo for your ${business.data.businessName} membership. Tap the link, then take a selfie: ${url}`;
      const target = `https://wa.me/${phone.ok ? phone.value : ""}?text=${encodeURIComponent(text)}`;
      if (win) win.location.href = target;
      else window.open(target, "_blank", "noopener,noreferrer");
    } catch (e) {
      win?.close();
      toast.error(firestoreErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(await link());
      toast.success("Photo link copied");
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => void share()} disabled={busy}>
        <MessageCircle aria-hidden /> Send photo link on WhatsApp
      </Button>
      <Button size="sm" variant="outline" onClick={() => void copy()}>
        <Copy aria-hidden /> Copy link
      </Button>
    </div>
  );
}
