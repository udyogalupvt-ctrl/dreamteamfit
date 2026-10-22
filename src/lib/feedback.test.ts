import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FEEDBACK_LIMITS,
  cleanFeedback,
  feedbackKindLabel,
  feedbackRateOk,
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

test("rate: 5 in any 24 hours", () => {
  const now = 1_800_000_000_000;
  const h = 3_600_000;
  assert.equal(feedbackRateOk([], now), true);
  assert.equal(feedbackRateOk([now - h, now - 2 * h, now - 3 * h, now - 4 * h], now), true);
  assert.equal(feedbackRateOk([now - h, now - 2 * h, now - 3 * h, now - 4 * h, now - 5 * h], now), false);
  assert.equal(feedbackRateOk([now - 25 * h, now - 26 * h, now - 27 * h, now - 28 * h, now - 29 * h], now), true);
});

test("kind labels", () => {
  assert.equal(feedbackKindLabel("praise"), "Praise");
  assert.equal(feedbackKindLabel("?"), "Message");
});
