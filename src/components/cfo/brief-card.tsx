import { useMemo } from "react";
import { Play, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { templateBrief } from "@/lib/cfo/template";
import type {
  CfoAiStatus,
  CfoBrief,
  CfoBriefAttempt,
  CfoSettings,
  CfoSnapshot,
} from "@/lib/cfo/types";
import { cfoErrorMessage, requestCfoBrief } from "@/services/cfo.service";
import { clockText, dayText, whenText } from "./cfo-format";

/** Why there is no summary, in the owner's words (a short phrase, no full stop). */
function fallbackReason(attempt: CfoBriefAttempt | null, aiEnabled: boolean) {
  if (!aiEnabled) return "switched off in CFO settings";
  if (!attempt) return "none has been written yet";
  switch (attempt.status) {
    case "off":
      return "not set up yet";
    case "unverified":
      return "couldn't check its numbers";
    case "blocked":
      return "its safety check for personal data stopped it";
    case "skipped":
      return "there was not enough time to write one";
    case "failed":
      return "the AI service didn't answer";
    default:
      return "none has been written yet";
  }
}

/** Plain text with a few simple headings; nothing from the AI is ever treated as HTML. */
function BriefText({ text }: { text: string }) {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim());
  return (
    <div className="space-y-1.5 text-sm leading-relaxed">
      {lines.map((raw, i) => {
        if (!raw) return <div key={i} className="h-1.5" aria-hidden />;
        const marked = /^(?:#{1,4}\s*|\*\*)(.+?)(?:\*\*)?:?$/.exec(raw);
        // A short line with no digits or full stop, right after a gap, is a heading ("Do this week").
        const plain =
          !marked && raw.length <= 40 && !/[\d.]/.test(raw) && (i === 0 || !lines[i - 1])
            ? [raw, raw.replace(/:$/, "")]
            : null;
        const heading = marked ?? plain;
        if (heading)
          return (
            <h4 key={i} className="text-card-title pt-1.5">
              {heading[1]!.replace(/\*\*/g, "")}
            </h4>
          );
        return <p key={i}>{raw.replace(/\*\*/g, "").replace(/^[-*]\s+/, "• ")}</p>;
      })}
    </div>
  );
}

const PROVIDER_NAMES: Record<string, string> = {
  gemini: "Gemini",
  openai: "OpenAI",
  claude: "Claude",
};
const providerName = (p: string) => PROVIDER_NAMES[p] ?? p;

export function BriefCard({
  brief,
  attempt,
  snapshot,
  settings,
  aiStatus,
  briefsLeft,
  onStart,
  now,
}: {
  brief: CfoBrief | null;
  attempt: CfoBriefAttempt | null;
  snapshot: CfoSnapshot;
  settings: CfoSettings;
  /** null while the page is still asking the server. */
  aiStatus: CfoAiStatus | null;
  /** "New AI summary" presses left today (the server allows a few a day). */
  briefsLeft: number;
  /** Switches the AI summary on and asks for the first one. */
  onStart: () => Promise<void>;
  now: number;
}) {
  const connected = aiStatus?.connected === true;
  const aiOn = connected && settings.aiEnabled;
  // The AI's text when there is a good one; otherwise the app writes the summary itself.
  const showAi = aiOn && brief !== null;
  const appText = useMemo(() => templateBrief(snapshot, settings), [snapshot, settings]);
  const aiName = connected ? providerName(aiStatus.provider) : "";

  // Say why the button is off instead of letting the server refuse it.
  const offReason =
    briefsLeft <= 0 ? "3 AI summaries were made today. You can make a new one tomorrow." : "";
  const newer = brief && brief.snapshotComputedAt !== snapshot.computedAt;
  const failedSince =
    attempt && attempt.status !== "ok" && (!brief || attempt.at > brief.createdAt) ? attempt : null;

  const askForNew = async () => {
    try {
      const res = await requestCfoBrief();
      if (res.status === "ok") toast.success("New AI summary written");
      else toast.info(res.reason || "The AI summary could not be written. The numbers are fine.");
    } catch (e) {
      toast.error(cfoErrorMessage(e));
    }
  };

  const start = async () => {
    try {
      await onStart();
    } catch (e) {
      toast.error(cfoErrorMessage(e));
    }
  };

  return (
    <section aria-labelledby="cfo-brief-title" className="surface-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="cfo-brief-title" className="text-section-title flex items-center gap-2">
            <Sparkles className="size-4 text-muted-foreground" aria-hidden /> This week&apos;s
            summary
          </h2>
          <p className="text-meta mt-0.5">
            {showAi
              ? "AI brief. The AI only explains; every number is worked out by the app."
              : "Written by the app from your numbers."}
          </p>
        </div>
        {connected && !settings.aiEnabled ? (
          <Button size="sm" onClick={start}>
            <Play aria-hidden /> Start AI summary
          </Button>
        ) : aiOn ? (
          <Button
            size="sm"
            variant="outline"
            disabled={Boolean(offReason)}
            onClick={askForNew}
            aria-describedby={offReason ? "cfo-brief-off" : undefined}
          >
            <Sparkles aria-hidden /> New AI summary
          </Button>
        ) : null}
      </div>
      {aiOn && offReason ? (
        <p id="cfo-brief-off" className="text-meta mt-2">
          {offReason}
        </p>
      ) : null}

      {showAi ? (
        <div className="mt-4 space-y-3">
          <BriefText text={brief.text} />
          <p className="text-meta">
            {newer
              ? `Written ${dayText(brief.createdAt)} with that morning's numbers; numbers below are newer.`
              : `Written ${dayText(brief.createdAt)} at ${clockText(new Date(brief.createdAt))} with these numbers.`}
            {brief.provider ? ` Written by ${providerName(brief.provider)}.` : ""}
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
            {aiStatus === null ? (
              <p className="text-muted-foreground">The app wrote this summary from your numbers.</p>
            ) : (
              <>
                <p className="font-medium">AI summary is not available right now.</p>
                <p className="mt-0.5 text-muted-foreground">
                  {aiOn ? (
                    <>
                      Reason: {fallbackReason(attempt, true)}. The app wrote the summary below from
                      the same numbers.
                    </>
                  ) : connected ? (
                    <>
                      {aiName} is connected. Press{" "}
                      <b className="text-foreground">Start AI summary</b> to let it write this
                      summary every week. Until then the app writes it from your numbers.
                    </>
                  ) : aiStatus.problem ? (
                    `An AI key is set, but ${aiStatus.problem}. The app wrote the summary below from your numbers; a Start button appears here once the AI works.`
                  ) : (
                    "AI is not connected yet, so the app wrote the summary below from your numbers. When an AI key is added, a Start button appears here."
                  )}
                </p>
              </>
            )}
          </div>
          <BriefText text={appText} />
          <p className="text-meta">
            Written by the app at {clockText(new Date(snapshot.computedAt))} with these numbers.
          </p>
        </div>
      )}

      {failedSince && showAi ? (
        <p className="text-meta mt-2">
          The last try ({whenText(failedSince.at, now)}) didn&apos;t work:{" "}
          {fallbackReason(failedSince, true)}. The summary above is the last good one.
        </p>
      ) : null}
    </section>
  );
}
