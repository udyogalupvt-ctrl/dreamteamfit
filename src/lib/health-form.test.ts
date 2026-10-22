import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAnswers,
  defaultHealthForm,
  formChanged,
  healthStatus,
  healthSummary,
  newQuestionId,
  nextFormVersion,
  normalizeHealthForm,
  validateAnswers,
  validateFormEdit,
} from "./health-form.ts";

type Input = Record<string, { answer?: string; detail?: string }>;
const form = defaultHealthForm("REBUILD FITNESS");

test("starting form: 10 questions, off, gym name in the consent", () => {
  assert.equal(form.questions.length, 10);
  assert.equal(form.enabled, false);
  assert.equal(form.version, 1);
  assert.equal(form.questions.at(-1)!.kind, "text");
  assert.match(form.consent, /REBUILD FITNESS keeps these answers/);
  assert.equal(validateFormEdit(form), "");
});

test("a missing or broken doc falls back to the starting form", () => {
  assert.deepEqual(normalizeHealthForm(undefined, "X"), defaultHealthForm("X"));
  const n = normalizeHealthForm(
    { enabled: true, version: 3, requiredVersion: 9, questions: [] },
    "X",
  );
  assert.equal(n.enabled, true);
  assert.equal(n.requiredVersion, 3, "never above the version");
  assert.equal(n.questions.length, 10);
});

test("version goes up only when the text changed", () => {
  const same = { ...form, enabled: true, questions: form.questions.map((q) => ({ ...q })) };
  assert.equal(formChanged(form, same), false);
  const saved = { ...form, updatedBy: "Owner" };
  assert.equal(nextFormVersion(saved, same), 1);
  const edited = {
    ...form,
    questions: [
      ...form.questions,
      { id: "q11", text: "Do you smoke?", kind: "yesno" as const, detailOnYes: false },
    ],
  };
  assert.equal(nextFormVersion(saved, edited), 2);
  assert.equal(nextFormVersion(saved, { ...form, consent: form.consent + " More." }), 2);
  assert.equal(
    nextFormVersion(form, edited),
    1,
    "the never-saved starting form: first save stays version 1",
  );
});

test("new question ids never reuse a removed one", () => {
  assert.equal(newQuestionId(form.questions), "q11");
  assert.equal(newQuestionId(form.questions.filter((q) => q.id !== "q10")), "q10");
  assert.equal(newQuestionId([{ id: "q4", text: "x", kind: "yesno", detailOnYes: false }]), "q5");
});

test("owner edits are checked", () => {
  assert.match(validateFormEdit({ ...form, questions: [] }), /at least one question/);
  assert.match(
    validateFormEdit({
      ...form,
      questions: form.questions.map((q, i) => (i === 2 ? { ...q, text: " " } : q)),
    }),
    /Question 3 is empty/,
  );
  assert.match(validateFormEdit({ ...form, consent: "ok" }), /consent/);
  assert.match(
    validateFormEdit({ ...form, questions: form.questions.filter((q) => q.kind === "text") }),
    /Yes \/ No/,
  );
});

test("answers: every yes/no needed, details kept only on yes", () => {
  const input: Input = Object.fromEntries(
    form.questions.map((q) => [q.id, { answer: "no", detail: "x" }]),
  );
  input["q1"] = { answer: "yes", detail: "  BP tablets  " };
  input["q10"] = { detail: "Old knee injury" };
  const answers = buildAnswers(form, input);
  assert.equal(answers[0]!.detail, "BP tablets");
  assert.equal(answers[1]!.detail, "", "no → no details");
  assert.equal(answers[9]!.detail, "Old knee injury");
  assert.equal(validateAnswers(form, answers, "Ravi Kumar", true), "");
  assert.match(validateAnswers(form, answers, "Ravi Kumar", false), /agree/);
  assert.match(validateAnswers(form, answers, " ", true), /full name/);
  delete input["q4"];
  assert.match(validateAnswers(form, buildAnswers(form, input), "Ravi", true), /question 4/);
});

test("summary keeps the yes answers and written notes", () => {
  const input: Input = Object.fromEntries(form.questions.map((q) => [q.id, { answer: "no" }]));
  input["q5"] = { answer: "yes", detail: "Thyroid" };
  input["q10"] = { detail: "Shoulder pain on overhead press" };
  const s = healthSummary(buildAnswers(form, input), 1, "2026-10-22", "app");
  assert.deepEqual(s.flags, ["Do you take regular medicine for a medical condition? — Thyroid"]);
  assert.deepEqual(s.notes, ["Shoulder pain on overhead press"]);
});

test("status: off, pending, done, asked again", () => {
  const on = { enabled: true, requiredVersion: 1 };
  const signed = {
    version: 1,
    signedOn: "2026-10-01",
    method: "app" as const,
    flags: [],
    notes: [],
  };
  assert.equal(healthStatus(signed, { enabled: false, requiredVersion: 1 }), "off");
  assert.equal(healthStatus(null, on), "pending");
  assert.equal(healthStatus(signed, on), "done");
  assert.equal(healthStatus(signed, { enabled: true, requiredVersion: 2 }), "pending");
});
