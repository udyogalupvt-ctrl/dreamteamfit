/**
 * The Google review card in the member app (spec C). Google forbids "review gating", so the card
 * never depends on how happy the member is: every member who has trained here a while sees the
 * same card, and the feedback box is a separate link that is always there.
 */
import type { ClientReview } from "../types/models";

const DAY = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

/** After "Not now" the card stays away this long. */
export const REVIEW_SNOOZE_DAYS = 60;
/** Members are asked once they have trained here this long... */
export const REVIEW_AFTER_DAYS = 30;
/** ...or in the first days of a renewed plan (a happy moment). */
export const REVIEW_RENEWAL_DAYS = 14;

const GOOGLE_HOSTS = /(^|\.)(google\.[a-z.]+|g\.page|goo\.gl)$/;

/** The owner's review link: https, from Google (g.page/r/…/review, search.google.com, maps.app.goo.gl). */
export function reviewUrlProblem(url: string): string {
  const v = url.trim();
  if (!v) return "";
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return "Paste the full link, starting with https://";
  }
  if (u.protocol !== "https:") return "The link must start with https://";
  if (!GOOGLE_HOSTS.test(u.hostname))
    return "Paste the review link from your Google Business Profile (g.page or google.com).";
  if (v.length > 500 || /\s/.test(v)) return "This link looks broken. Copy it again from Google.";
  return "";
}

/**
 * Whether the member app shows the review card today. `joinedOn` = the day they joined;
 * `renewedOn` = the start of their running plan when it is not their first one ("" otherwise).
 */
export function reviewEligible(x: {
  url: string;
  today: string;
  hasRunningPlan: boolean;
  joinedOn: string;
  renewedOn: string;
  review: ClientReview | null | undefined;
}): boolean {
  if (!x.url || reviewUrlProblem(x.url) || !x.hasRunningPlan) return false;
  const r = x.review;
  if (r?.tappedAt) return false;
  if (r?.dismissedAt && daysBetween(r.dismissedAt, x.today) < REVIEW_SNOOZE_DAYS) return false;
  const trained = !!x.joinedOn && daysBetween(x.joinedOn, x.today) >= REVIEW_AFTER_DAYS;
  const renewed =
    !!x.renewedOn &&
    daysBetween(x.renewedOn, x.today) >= 0 &&
    daysBetween(x.renewedOn, x.today) <= REVIEW_RENEWAL_DAYS;
  return trained || renewed;
}

/** The desk's line on the member profile. */
export function reviewStatusLine(r: ClientReview | null | undefined, day: (d: string) => string) {
  if (r?.tappedAt) return `Opened the review link on ${day(r.tappedAt)}`;
  if (r?.dismissedAt) return `Said "Not now" on ${day(r.dismissedAt)}`;
  if (r?.askedAt) return `Asked on WhatsApp on ${day(r.askedAt)}`;
  return "Not asked yet";
}

/** The WhatsApp message the desk sends from its own phone (free). */
export function reviewAskText(name: string, gymName: string, url: string) {
  const first = name.trim().split(/\s+/)[0] || "there";
  return `Hi ${first}, thank you for training with ${gymName}! If you have a minute, a Google review helps others find us: ${url}`;
}
