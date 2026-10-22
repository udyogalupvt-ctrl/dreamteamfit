import { Link } from "@tanstack/react-router";
import { ChevronRight, MessageCircle, MessageSquareHeart, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAccess } from "@/hooks/use-access";
import { useLive } from "@/hooks/use-live-query";
import { formatDateISO } from "@/lib/format";
import { reviewAskText, reviewStatusLine } from "@/lib/review-prompt";
import { cn } from "@/lib/utils";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp-phone";
import {
  DEFAULT_BILLING_SETTINGS,
  subscribeBusinessSettings,
} from "@/services/business-settings.service";
import {
  markReviewAsked,
  subscribeMemberAppSettings,
  subscribeMemberFeedback,
} from "@/services/feedback.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import {
  DEFAULT_WHATSAPP_SETTINGS,
  subscribeWhatsAppSettings,
} from "@/services/whatsapp-settings.service";
import type { Client, Feedback } from "@/types/models";

/**
 * Member profile: where their Google review stands (with "Ask on WhatsApp", sent free from the
 * desk's own phone) and the messages they sent from the app (logins with "Member feedback").
 */
export function ReviewFeedbackCard({
  client: c,
  className,
}: {
  client: Client;
  className?: string;
}) {
  const { can } = useAccess();
  const app = useLive(subscribeMemberAppSettings, { googleReviewUrl: "" }, []);
  const business = useLive(subscribeBusinessSettings, DEFAULT_BILLING_SETTINGS, []);
  const wa = useLive(subscribeWhatsAppSettings, DEFAULT_WHATSAPP_SETTINGS, []);
  const seesFeedback = can("feedback");
  const feedback = useLive<Feedback[]>(
    seesFeedback ? (d, e) => subscribeMemberFeedback(c.id, d, e) : null,
    [],
    [c.id, seesFeedback],
  );
  const url = app.data.googleReviewUrl;
  const phone = normalizeWhatsAppPhone(c.whatsappPhone || c.phone, wa.data.defaultCountryCode);
  const fresh = feedback.data.filter((f) => f.status === "new").length;

  const ask = () => {
    if (!phone.ok) return;
    const text = reviewAskText(c.fullName, business.data.businessName, url);
    window.open(
      `https://wa.me/${phone.value}?text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener",
    );
    markReviewAsked(c).then(
      () => toast.success("Noted: asked for a Google review"),
      (e) => toast.error(firestoreErrorMessage(e)),
    );
  };

  return (
    <section className={cn("surface-card space-y-4 p-5", className)}>
      <h2 className="text-section-title">Review & feedback</h2>
      <div className="flex flex-wrap items-center gap-3">
        <Star className="size-5 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Google review</p>
          <p className="text-meta">{reviewStatusLine(c.review, formatDateISO)}</p>
        </div>
        {url && can("members") ? (
          <Button size="sm" variant="outline" disabled={!phone.ok} onClick={ask}>
            <MessageCircle aria-hidden className="text-[#128C7E] dark:text-[#25D366]" /> Ask on
            WhatsApp
          </Button>
        ) : null}
      </div>
      {!url && !app.loading ? (
        <p className="text-meta">
          Add the gym's Google review link in{" "}
          {can("settings") ? (
            <Link
              to="/settings"
              search={{ tab: "memberapp" }}
              className="font-semibold text-primary hover:underline"
            >
              Settings → Member app
            </Link>
          ) : (
            "Settings → Member app"
          )}{" "}
          to ask for reviews.
        </p>
      ) : null}
      {seesFeedback ? (
        <Link
          to="/feedback"
          search={{ client: c.id }}
          className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm transition-colors hover:bg-accent"
        >
          <MessageSquareHeart className="size-5 shrink-0 text-primary" aria-hidden />
          <span className="flex-1">
            {feedback.loading
              ? "Messages from the app…"
              : feedback.data.length
                ? `${feedback.data.length} message${feedback.data.length === 1 ? "" : "s"} from the app${fresh ? ` · ${fresh} new` : ""}`
                : "No messages from the app yet"}
          </span>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </Link>
      ) : null}
    </section>
  );
}
