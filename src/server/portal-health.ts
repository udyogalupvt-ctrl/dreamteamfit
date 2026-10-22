/**
 * Member health form (src/lib/health-form.ts).
 *
 *   GET  /api/portal/health-form   member: their acceptances, newest first (for "View my answers")
 *   POST /api/portal/health-form   member: { version, answers: { [questionId]: { answer, detail } },
 *                                            signedName, agreed }
 *
 * The form itself reaches the app inside /api/portal/me (memberHealth). An acceptance is written
 * together with the short copy on the member (clients.healthForm), which lists and the trainer read.
 */
import { FieldValue, type DocumentData } from "firebase-admin/firestore";
import type { PortalHealth, PortalHealthRecord } from "@/constants/portal";
import type { HealthAnswer, HealthFormSettings, HealthFormSummary } from "@/types/models";
import {
  buildAnswers,
  healthStatus,
  healthSummary,
  normalizeHealthForm,
  validateAnswers,
} from "@/lib/health-form";
import { db, json, localDate } from "./admin";
import { appLog, liveMember, s } from "./portal-common";

export async function healthFormSettings(gymName: string): Promise<HealthFormSettings> {
  return normalizeHealthForm((await db().doc("settings/healthForm").get()).data(), gymName);
}

const summaryOf = (c: DocumentData) =>
  c["healthForm"] && typeof c["healthForm"] === "object"
    ? (c["healthForm"] as HealthFormSummary)
    : null;

/** The health form part of /me; null while the owner hasn't switched it on. */
export async function memberHealth(
  c: DocumentData,
  gymName: Promise<string>,
): Promise<PortalHealth | null> {
  const [raw, name] = await Promise.all([db().doc("settings/healthForm").get(), gymName]);
  const form = normalizeHealthForm(raw.data(), name);
  const last = summaryOf(c);
  const status = healthStatus(last, form);
  if (status === "off") return null;
  const { version, title, intro, questions, consent } = form;
  return { status, form: { version, title, intro, questions, consent }, last };
}

export async function healthRecords(clientId: string): Promise<Response> {
  const member = await liveMember(clientId);
  if (!member.ok) return member.response;
  const snap = await db().collection("healthForms").where("clientId", "==", clientId).get();
  const records: PortalHealthRecord[] = snap.docs
    .map((d) => d.data())
    .map((r) => ({
      version: Number(r["version"]) || 1,
      title: s(r["title"]),
      signedOn: s(r["signedOn"]),
      signedName: s(r["signedName"]),
      method: r["method"] === "paper" ? ("paper" as const) : ("app" as const),
      answers: Array.isArray(r["answers"]) ? (r["answers"] as HealthAnswer[]) : [],
      consent: s(r["consent"]),
    }))
    .sort((a, b) => b.signedOn.localeCompare(a.signedOn) || b.version - a.version)
    .slice(0, 10);
  return json({ records });
}

export async function submitHealthForm(
  clientId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const member = await liveMember(clientId);
  if (!member.ok) return member.response;
  const c = member.data;
  const gym = (await db().doc("settings/business").get()).data() ?? {};
  const form = await healthFormSettings(s(gym["businessName"]) || "Our gym");
  if (!form.enabled) return json({ error: "The gym has switched the health form off." }, 400);
  if (Number(body["version"]) !== form.version)
    return json({ error: "The gym just updated the form. Please open it again." }, 409);

  const today = localDate();
  const last = summaryOf(c);
  // Filled in already today: one acceptance a day is plenty (a double tap must not add two).
  if (last && last.signedOn === today && last.version >= form.version)
    return json({ error: "Your health form is already saved for today." }, 409);

  const input = (
    body["answers"] && typeof body["answers"] === "object" ? body["answers"] : {}
  ) as Record<string, { answer?: unknown; detail?: unknown }>;
  const answers = buildAnswers(form, input);
  const signedName = s(body["signedName"]).trim();
  const problem = validateAnswers(form, answers, signedName, body["agreed"] === true);
  if (problem) return json({ error: problem }, 400);

  const summary = healthSummary(answers, form.version, today, "app");
  const ref = db().collection("healthForms").doc();
  const batch = db().batch();
  batch.set(ref, {
    clientId,
    clientName: s(c["fullName"]),
    version: form.version,
    title: form.title,
    answers,
    consent: form.consent,
    signedName,
    method: "app",
    by: "",
    note: "",
    signedOn: today,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.update(db().doc(`clients/${clientId}`), {
    healthForm: summary,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  await appLog({
    collection: "healthForms",
    docId: ref.id,
    action: "created",
    summary: summary.flags.length
      ? `Health form filled in the member app (said Yes to ${summary.flags.length})`
      : "Health form filled in the member app",
    actorName: s(c["fullName"]) || "Member",
    clientId,
    clientName: s(c["fullName"]),
  });
  return json({ ok: true, last: summary });
}
