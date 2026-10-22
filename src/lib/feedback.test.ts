import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FEEDBACK_LIMITS,
  cleanFeedback,
  feedbackKindLabel,
  nextFeedbackRate,
  validateFeedback,
  validateReply,
} from "./feedback.ts";

test("clean: known kind, trimmed text, a real yes for the call", () => {
  assert.deepEqual(cleanFeedback({ kind: "complaint", message: "  AC off \r\n\r\n\r\n\r\nagain ", wantsCall: true }), {
    kind: "complaint",
    message: "AC off\n\nagain",
    wantsCall: true,
  });
  assert.deepEqual(cleanFeedback({ kind: "hack", message: 5, wantsCall: "yes" }), {
    kind: "idea",
    message: "5",
    wantsCall: false,
  });
  assert.deepEqual(cleanFeedback(null), { kind: "idea", message: "", wantsCall: false });
});

test("validate: a few words, under 1000 characters", () => {
  assert.equal(validateFeedback(cleanFeedback({ message: "ok" })), "Write a few words.");
  assert.equal(validateFeedback(cleanFeedback({ message: "More cardio machines please" })), "");
  assert.match(validateFeedback(cleanFeedback({ message: "x".repeat(FEEDBACK_LIMITS.message + 1) })), /1000/);
  assert.equal(validateFeedback(cleanFeedback({ message: "x".repeat(FEEDBACK_LIMITS.message) })), "");
  assert.equal(validateReply("Thanks, fixed today."), "");
  assert.match(validateReply("y".repeat(1001)), /1000/);
});

test("rate: 5 a day, counted per day", () => {
  assert.deepEqual(nextFeedbackRate(undefined, "2026-10-22"), { day: "2026-10-22", count: 1 });
  assert.deepEqual(nextFeedbackRate({ day: "2026-10-22", count: 4 }, "2026-10-22"), {
    day: "2026-10-22",
    count: 5,
  });
  assert.equal(nextFeedbackRate({ day: "2026-10-22", count: 5 }, "2026-10-22"), null);
  assert.deepEqual(nextFeedbackRate({ day: "2026-10-21", count: 5 }, "2026-10-22"), {
    day: "2026-10-22",
    count: 1,
  });
  assert.deepEqual(nextFeedbackRate({ day: "2026-10-22", count: "junk" }, "2026-10-22"), {
    day: "2026-10-22",
    count: 1,
  });
});

test("kind labels", () => {
  assert.equal(feedbackKindLabel("praise"), "Praise");
  assert.equal(feedbackKindLabel("?"), "Message");
});
