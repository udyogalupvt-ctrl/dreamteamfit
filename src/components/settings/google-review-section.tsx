import { useEffect, useId, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/components/common/form-dialog";
import { FormSection } from "@/components/common/form-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLive } from "@/hooks/use-live-query";
import { reviewUrlProblem } from "@/lib/review-prompt";
import { saveGoogleReviewUrl, subscribeMemberAppSettings } from "@/services/feedback.service";
import { firestoreErrorMessage } from "@/services/firestore.service";

/**
 * Settings → Member app: the gym's Google review link. With it set, members who have trained here
 * a while (or just renewed) see a "Rate us on Google" card in their app, and the desk can send it
 * on WhatsApp from a member's profile.
 */
export function GoogleReviewSection() {
  const id = useId();
  const live = useLive(subscribeMemberAppSettings, { googleReviewUrl: "" }, []);
  const saved = live.data.googleReviewUrl;
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setUrl(saved), [saved]);
  const problem = reviewUrlProblem(url);
  const save = async (value: string) => {
    setBusy(true);
    try {
      await saveGoogleReviewUrl(value);
      toast.success(value.trim() ? "Google review link saved" : "Google review link removed");
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <FormSection
      title="Google review link"
      description="Members see a “Rate us on Google” card after 30 days with the gym, or right after they renew. Every member sees the same card; their complaints go to Member feedback, separately."
      footer={
        <>
          {saved ? (
            <Button variant="ghost" disabled={busy} onClick={() => void save("")}>
              Remove link
            </Button>
          ) : null}
          <Button
            disabled={busy || live.loading || !!problem || url.trim() === saved}
            onClick={() => void save(url)}
          >
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Save link
          </Button>
        </>
      }
    >
      <Field
        label="Review link"
        htmlFor={`${id}-url`}
        error={problem || undefined}
        hint="Google Business Profile → Ask for reviews → copy the link (starts with https://g.page/r/…)."
      >
        <Input
          id={`${id}-url`}
          type="url"
          inputMode="url"
          value={url}
          maxLength={500}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://g.page/r/…/review"
          aria-invalid={!!problem}
        />
      </Field>
      {saved && !problem ? (
        <a
          href={saved}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          Open the saved link to check it <ExternalLink className="size-3.5" aria-hidden />
        </a>
      ) : null}
    </FormSection>
  );
}
