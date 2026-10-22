/**
 * The Google review card and member feedback (src/lib/review-prompt.ts, src/lib/feedback.ts).
 *
 *   POST /api/portal/review    member: { action: "tapped" | "later" }
 *   GET  /api/portal/feedback  member: their last 20 messages, with the gym's replies
 *   POST /api/portal/feedback  member: { kind, message, wantsCall }
 *
 * The card itself comes inside /api/portal/me (memberReview). Staff read and answer feedback
 * straight from Firestore (the /feedback page); POST /api/push/feedback then tells the member.
 */
import { FieldValue, type DocumentData } from "firebase-admin/firestore";
import type { PortalFeedback, PortalReview } from "@/constants/portal";
import { cleanFeedback, feedbackKindLabel, nextFeedbackRate, validateFeedback } from "@/lib/feedback";
import { reviewEligible, reviewUrlProblem } from "@/lib/review-prompt";
import { db, json, localDate } from "./admin";
import { appLog, liveMember, s } from "./portal-common";

/** The owner's Google review link (settings/memberApp), "" when unset or not a Google link. */
export async function reviewLink(): Promise<string> {
  const url = s((await db().doc("settings/memberApp").get()).data()?.["googleReviewUrl"]).trim();
  return url && !reviewUrlProblem(url) ? url : "";
}

/** What /me says about the review card. `plans` = the member's plans, newest first. */
export function memberReview(
  c: DocumentData,
  x: {
    url: string;
    today: string;
    joinedOn: string;
    current: { id: string; startDate: string } | null;
    plans: { id: string; startDate: string }[];
  },
): PortalReview | null {
  if (!x.url) return null;
  const cur = x.current;
  const renewed = !!cur && x.plans.some((p) => p.id !== cur.id && p.startDate < cur.startDate);
  const review = c["review"] && typeof c["review"] === "object" ? c["review"] : null;
  return {
    url: x.url,
    show: reviewEligible({
      url: x.url,
      today: x.today,
      hasRunningPlan: !!cur,
      joinedOn: x.joinedOn,
      renewedOn: renewed && cur ? cur.startDate : "",
      review,
    }),
  };
}

/** The member tapped "Write a review" (never asked again) or "Not now" (asked again later). */
export async function reviewAnswer(clientId: string, body: Record<string, unknown>) {
  const action = s(body["action"]);
  if (action !== "tapped" && action !== "later") return json({ error: "Unknown answer." }, 400);
  const member = await liveMember(clientId);
  if (!member.ok) return member.response;
  const review = member.data["review"] as { tappedAt?: string } | undefined;
  if (action === "tapped" && review?.tappedAt) return json({ ok: true, today: review.tappedAt });
  const today = localDate();
  await db()
    .doc(`clients/${clientId}`)
    .update({ [action === "tapped" ? "review.tappedAt" : "review.dismissedAt"]: today });
  if (action === "tapped")
    await appLog({
      collection: "clients",
      docId: clientId,
      summary: "Opened the Google review link from the member app",
      actorName: s(member.data["fullName"]),
      clientId,
      clientName: s(member.data["fullName"]),
    });
  return json({ ok: true, today });
}

const millis = (v: unknown) => (v as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;
const dayOf = (v: unknown) => {
  const ms = millis(v);
  return ms ? localDate(new Date(ms)) : "";
};

/** All of a member's messages, newest first (a handful each: at most 5 a day). */
async function messagesOf(clientId: string) {
  const snap = await db().collection("feedback").where("clientId", "==", clientId).get();
  return snap.docs.sort((a, b) => millis(b.data()["createdAt"]) - millis(a.data()["createdAt"]));
}

const toPortal = (id: string, f: DocumentData): PortalFeedback => ({
  id,
  kind: s(f["kind"]),
  message: s(f["message"]),
  wantsCall: f["wantsCall"] === true,
  status: f["status"] === "resolved" ? "resolved" : "new",
  reply: s(f["reply"]),
  repliedOn: dayOf(f["repliedAt"]),
  sentOn: dayOf(f["createdAt"]),
});

export async function memberFeedback(clientId: string) {
  const member = await liveMember(clientId);
  if (!member.ok) return member.response;
  const docs = await messagesOf(clientId);
  return json({ items: docs.slice(0, 20).map((d) => toPortal(d.id, d.data())) });
}

export async function sendFeedback(clientId: string, body: Record<string, unknown>) {
  const input = cleanFeedback(body);
  const problem = validateFeedback(input);
  if (problem) return json({ error: problem }, 400);
  const member = await liveMember(clientId);
  if (!member.ok) return member.response;
  const c = member.data;
  const ref = db().collection("feedback").doc();
  const doc = {
    clientId,
    clientName: s(c["fullName"]),
    memberCode: s(c["clientCode"]),
    phone: s(c["phone"]),
    ...input,
    status: "new",
    reply: "",
    repliedBy: "",
    repliedAt: null,
    resolvedBy: "",
    resolvedAt: null,
    createdAt: FieldValue.serverTimestamp(),
  };
  // The day's counter and the message are written together, so parallel sends can't pass 5.
  const rateRef = db().doc(`feedbackRate/${clientId}`);
  const today = localDate();
  const sent = await db().runTransaction(async (tx) => {
    const next = nextFeedbackRate((await tx.get(rateRef)).data(), today);
    if (!next) return false;
    tx.set(rateRef, next);
    tx.set(ref, doc);
    return true;
  });
  if (!sent)
    return json({ error: "You have sent 5 messages today. Please try again tomorrow." }, 429);
  await appLog({
    collection: "feedback",
    docId: ref.id,
    action: "created",
    summary: `Sent ${feedbackKindLabel(input.kind).toLowerCase()} from the member app`,
    actorName: s(c["fullName"]),
    clientId,
    clientName: s(c["fullName"]),
  });
  return json({
    item: { ...toPortal(ref.id, { ...doc, createdAt: null }), sentOn: today },
  });
}
