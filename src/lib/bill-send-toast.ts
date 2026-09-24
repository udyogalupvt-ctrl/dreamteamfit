import { toast } from "sonner";
import type { AutoSendResult } from "@/services/whatsapp.service";

/** Tells staff whether the bill went out on WhatsApp after a payment. */
export function toastBillSend(result: AutoSendResult) {
  if (result.kind === "sent") toast.success("Bill sent to the member on WhatsApp");
  else if (result.kind === "failed")
    toast.error("Bill not sent on WhatsApp", {
      description: `${result.message} Use the WhatsApp button to share it.`,
    });
  else if (result.kind === "no_opt_in")
    toast.info("Bill not sent: this member said no to WhatsApp messages.");
}
