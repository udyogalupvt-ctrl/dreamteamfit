/**
 * Member health form (PAR-Q style questions + consent), kept in settings/healthForm.
 *
 * The owner edits the questions in Settings → Member app. Saving bumps `version` only when the text
 * changed. A member is "done" once they accepted a version at or above `requiredVersion`, so old
 * acceptances stay valid until the owner presses "Ask everyone to accept again".
 *
 * The starting text is a draft for the owner to check ([NEED: owner approval]); it is not legal text.
 */
import type {
  HealthAnswer,
  HealthFormSettings,
  HealthFormSummary,
  HealthQuestion,
} from "../types/models";

export const HEALTH_LIMITS = {
  questions: 30,
  question: 300,
  title: 80,
  intro: 600,
  consent: 3000,
  answer: 500,
  name: 80,
} as const;

const START_QUESTIONS: [string, HealthQuestion["kind"]][] = [
  ["Has a doctor ever said you have a heart condition or high blood pressure?", "yesno"],
  ["Do you get chest pain at rest, in daily life or when you exercise?", "yesno"],
  ["In the last 12 months, have you lost your balance because of dizziness, or fainted?", "yesno"],
  ["Do you have diabetes, asthma, epilepsy or another long-term medical condition?", "yesno"],
  ["Do you take regular medicine for a medical condition?", "yesno"],
  [
    "Do you have a bone, joint, back or muscle problem (now or in the last 12 months) that exercise could make worse?",
    "yesno",
  ],
  ["Have you had surgery or a serious injury in the last 12 months?", "yesno"],
  ["Has a doctor ever told you to exercise only under medical supervision?", "yesno"],
  [
    "Are you pregnant, or did you give birth in the last 6 months? (answer No if this doesn't apply)",
    "yesno",
  ],
  ["Anything else your trainer should know? (optional)", "text"],
];

const startConsent = (gym: string) =>
  `I confirm my answers are true to the best of my knowledge, and I will tell the gym if my health ` +
  `changes. I understand exercise carries some risk of injury. I will follow the trainers' guidance, ` +
  `use equipment safely and stop if I feel unwell. If I answered Yes to any question, the gym advises ` +
  `me to check with my doctor before starting or increasing exercise. ${gym} keeps these answers to ` +
  `keep me safe; only gym staff and my trainer see them.`;

/** The built-in starting form (switched off until the owner checks the text and turns it on). */
export function defaultHealthForm(gymName: string): HealthFormSettings {
  return {
    enabled: false,
    version: 1,
    requiredVersion: 1,
    title: "Health form",
    intro:
      "Please answer honestly. It helps your trainer keep your workouts safe. It takes about 2 minutes.",
    questions: START_QUESTIONS.map(([text, kind], i) => ({
      id: `q${i + 1}`,
      text,
      kind,
      detailOnYes: kind === "yesno",
    })),
    consent: startConsent(gymName.trim() || "The gym"),
    updatedBy: "",
  };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const int = (v: unknown, min: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.floor(v)) : min;

/** settings/healthForm as stored (or missing) → a complete form. */
export function normalizeHealthForm(raw: unknown, gymName: string): HealthFormSettings {
  const base = defaultHealthForm(gymName);
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const questions = Array.isArray(r["questions"])
    ? (r["questions"] as unknown[])
        .map((q) => (q && typeof q === "object" ? (q as Record<string, unknown>) : null))
        .filter((q): q is Record<string, unknown> => !!q && !!str(q["id"]) && !!str(q["text"]))
        .map((q) => ({
          id: str(q["id"]),
          text: str(q["text"]),
          kind: q["kind"] === "text" ? ("text" as const) : ("yesno" as const),
          detailOnYes: q["detailOnYes"] === true,
        }))
    : base.questions;
  const version = int(r["version"], 1);
  return {
    enabled: r["enabled"] === true,
    version,
    requiredVersion: Math.min(int(r["requiredVersion"], 1), version),
    title: str(r["title"]) || base.title,
    intro: typeof r["intro"] === "string" ? r["intro"] : base.intro,
    questions: questions.length ? questions : base.questions,
    consent: str(r["consent"]) || base.consent,
    updatedBy: str(r["updatedBy"]),
  };
}

/** True when what a member reads (title, intro, questions, consent) is different. */
export function formChanged(a: HealthFormSettings, b: HealthFormSettings): boolean {
  const view = (f: HealthFormSettings) =>
    JSON.stringify([
      f.title.trim(),
      f.intro.trim(),
      f.consent.trim(),
      f.questions.map((q) => [q.id, q.text.trim(), q.kind, q.kind === "yesno" && q.detailOnYes]),
    ]);
  return view(a) !== view(b);
}

/** Version to save: one up when the text changed, the same otherwise. */
// The built-in starting form was never saved (no updatedBy), so nobody accepted it: the first
// save stays version 1 whatever the owner changed.
export const nextFormVersion = (saved: HealthFormSettings, edited: HealthFormSettings) =>
  saved.updatedBy && formChanged(saved, edited) ? saved.version + 1 : saved.version;

/** An id not used by any question yet (q11, q12…), so old answers never point at a new question. */
export function newQuestionId(questions: HealthQuestion[]): string {
  const top = questions.reduce((m, q) => Math.max(m, Number(/^q(\d+)$/.exec(q.id)?.[1] ?? 0)), 0);
  return `q${top + 1}`;
}

/** "" when the owner's edited form can be saved, otherwise what to fix. */
export function validateFormEdit(form: HealthFormSettings): string {
  if (!form.title.trim()) return "Give the form a title.";
  if (form.title.length > HEALTH_LIMITS.title) return "The title is too long.";
  if (form.intro.length > HEALTH_LIMITS.intro) return "The intro is too long.";
  if (!form.questions.length) return "Add at least one question.";
  if (form.questions.length > HEALTH_LIMITS.questions)
    return `Keep it to ${HEALTH_LIMITS.questions} questions.`;
  if (!form.questions.some((q) => q.kind === "yesno")) return "Add at least one Yes / No question.";
  const i = form.questions.findIndex((q) => q.text.trim().length < 3);
  if (i >= 0) return `Question ${i + 1} is empty.`;
  const long = form.questions.findIndex((q) => q.text.length > HEALTH_LIMITS.question);
  if (long >= 0) return `Question ${long + 1} is too long.`;
  if (new Set(form.questions.map((q) => q.id)).size !== form.questions.length)
    return "Two questions share an id. Reset and try again.";
  if (form.consent.trim().length < 20) return "Write the consent text members agree to.";
  if (form.consent.length > HEALTH_LIMITS.consent) return "The consent text is too long.";
  return "";
}

/** The member's answers, with each question's text copied in (old answers stay readable). */
export function buildAnswers(
  form: Pick<HealthFormSettings, "questions">,
  input: Record<string, { answer?: unknown; detail?: unknown } | undefined>,
): HealthAnswer[] {
  return form.questions.map((q) => {
    const a = input[q.id] ?? {};
    const answer = q.kind === "yesno" && (a.answer === "yes" || a.answer === "no") ? a.answer : "";
    const keepDetail = q.kind === "text" || (answer === "yes" && q.detailOnYes);
    return {
      id: q.id,
      text: q.text,
      kind: q.kind,
      answer,
      detail: keepDetail ? str(a.detail).trim().slice(0, HEALTH_LIMITS.answer) : "",
    };
  });
}

/** "" when every Yes / No question is answered and the signature is there. */
export function validateAnswers(
  form: Pick<HealthFormSettings, "questions">,
  answers: HealthAnswer[],
  signedName: string,
  agreed: boolean,
): string {
  const missing = form.questions.findIndex(
    (q) => q.kind === "yesno" && answers.find((a) => a.id === q.id)?.answer === "",
  );
  if (missing >= 0) return `Please answer question ${missing + 1}.`;
  if (!agreed) return "Please tick that you agree.";
  if (signedName.trim().length < 2) return "Type your full name to sign.";
  if (signedName.length > HEALTH_LIMITS.name) return "The name is too long.";
  return "";
}

/** Each "Yes", with the member's details: what staff and the trainer must notice. */
export const healthFlags = (answers: HealthAnswer[]) =>
  answers
    .filter((a) => a.kind === "yesno" && a.answer === "yes")
    .map((a) => (a.detail ? `${a.text} — ${a.detail}` : a.text));

/** Written answers ("Anything else…"), for the trainer. */
export const healthNotes = (answers: HealthAnswer[]) =>
  answers.filter((a) => a.kind === "text" && a.detail).map((a) => a.detail);

/** The short copy kept on the member (lists and the profile need no extra reads). */
export function healthSummary(
  answers: HealthAnswer[],
  version: number,
  signedOn: string,
  method: HealthFormSummary["method"],
): HealthFormSummary {
  return {
    version,
    signedOn,
    method,
    flags: healthFlags(answers),
    notes: healthNotes(answers),
  };
}

/** off = the owner hasn't switched the form on; pending = asked to (re)fill it. */
export function healthStatus(
  summary: HealthFormSummary | null | undefined,
  form: Pick<HealthFormSettings, "enabled" | "requiredVersion">,
): "off" | "done" | "pending" {
  if (!form.enabled) return "off";
  return summary && summary.version >= form.requiredVersion ? "done" : "pending";
}
