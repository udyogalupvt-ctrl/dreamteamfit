/**
 * Reading the last summary try (`cfoBriefs/status`): is the AI really able to write, and what
 * the card says about a try that gave no AI summary. Pure, shared by the server and the page.
 */

import type { CfoBriefAttempt } from "./types.ts";

/**
 * Why the AI can't write with today's settings, from the last try ("" when that try says
 * nothing about it). A model-info check can pass while writing is refused (a model closed to new
 * keys answers 404 only when asked to write), so a try refused for the SAME provider and model
 * means "not connected". Busy, slow or server errors don't count: the next try may work.
 */
export function attemptProblem(
  attempt: CfoBriefAttempt | null,
  provider: string,
  model: string,
): string {
  if (!attempt || attempt.status !== "failed") return "";
  if (!attempt.model || attempt.provider !== provider || attempt.model !== model) return "";
  if (attempt.httpStatus === 404) return `the AI model "${model}" can't be used with this key`;
  if (attempt.httpStatus === 401 || attempt.httpStatus === 403)
    return "the AI key was refused (check the key on the server)";
  return "";
}

/** Why the last try gave no AI summary, in the owner's words (a short phrase, no full stop). */
export function attemptReason(attempt: CfoBriefAttempt | null): string {
  if (!attempt) return "none has been written yet";
  switch (attempt.status) {
    case "off":
      // "switched off in CFO settings" or "not set up yet": only the server knows which.
      return attempt.reason || "not set up yet";
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

/**
 * The last try, when it is still news: not OK, newer than the last good summary, and not an
 * "off" try from before the AI was switched on (it can't be off and on at once).
 */
export function attemptToShow(
  attempt: CfoBriefAttempt | null,
  briefCreatedAt: string | null,
  aiOn: boolean,
): CfoBriefAttempt | null {
  if (!attempt || attempt.status === "ok") return null;
  if (aiOn && attempt.status === "off") return null;
  if (briefCreatedAt && attempt.at <= briefCreatedAt) return null;
  return attempt;
}
