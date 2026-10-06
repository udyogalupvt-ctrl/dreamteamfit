import assert from "node:assert/strict";
import { test } from "node:test";
import { aiConfig } from "../../server/ai.ts";
import { attemptProblem, attemptReason, attemptToShow } from "./ai-status.ts";
import type { CfoBriefAttempt } from "./types.ts";

const attempt = (a: Partial<CfoBriefAttempt> = {}): CfoBriefAttempt => ({
  at: "2026-10-06T10:00:00.000Z",
  status: "failed",
  reason: "the AI service didn't answer (http 404)",
  ...a,
});

/* --------------------------------------------------------------- bug 1: default model */

test("Gemini with no model set uses a model new keys can use", () => {
  const saved = { ...process.env };
  try {
    delete process.env["CFO_AI_PROVIDER"];
    delete process.env["CFO_AI_MODEL"];
    process.env["GEMINI_API_KEY"] = "test-key";
    assert.equal(aiConfig()?.model, "gemini-3.1-flash-lite");
    process.env["CFO_AI_MODEL"] = "gemini-3-flash-preview";
    assert.equal(aiConfig()?.model, "gemini-3-flash-preview");
  } finally {
    process.env = saved;
  }
});

/* ------------------------------------------------ bug 2: a refused write = not connected */

test("a failed try refused for this model means the AI is not connected", () => {
  const a = attempt({ provider: "gemini", model: "gemini-2.5-flash", httpStatus: 404 });
  assert.match(attemptProblem(a, "gemini", "gemini-2.5-flash"), /gemini-2\.5-flash/);
  const key = attempt({ provider: "gemini", model: "gemini-2.5-flash", httpStatus: 403 });
  assert.match(attemptProblem(key, "gemini", "gemini-2.5-flash"), /key was refused/);
  const auth = attempt({ provider: "openai", model: "gpt-4.1-mini", httpStatus: 401 });
  assert.match(attemptProblem(auth, "openai", "gpt-4.1-mini"), /key was refused/);
});

test("other tries do not mark the AI as not connected", () => {
  const same = { provider: "gemini", model: "m" };
  // Busy, timed out or a server error can pass: the next try may work.
  for (const httpStatus of [0, 400, 429, 500, 503])
    assert.equal(attemptProblem(attempt({ ...same, httpStatus }), "gemini", "m"), "");
  // Not a failure.
  for (const status of ["ok", "off", "unverified", "blocked", "skipped"] as const)
    assert.equal(attemptProblem(attempt({ ...same, status, httpStatus: 404 }), "gemini", "m"), "");
  assert.equal(attemptProblem(null, "gemini", "m"), "");
});

test("a refused try for another model or provider no longer counts", () => {
  const a = attempt({ provider: "gemini", model: "gemini-2.5-flash", httpStatus: 404 });
  assert.equal(attemptProblem(a, "gemini", "gemini-3.1-flash-lite"), "");
  assert.equal(attemptProblem(a, "openai", "gemini-2.5-flash"), "");
  // Saved before the model was recorded: unknown, so it can't block the AI.
  assert.equal(attemptProblem(attempt({ httpStatus: 404 }), "gemini", "gemini-2.5-flash"), "");
});

/* ------------------------------------------------------ bug 3: the reason the card shows */

test("an 'off' try shows the reason the server saved", () => {
  const off = attempt({ status: "off", reason: "switched off in CFO settings" });
  assert.equal(attemptReason(off), "switched off in CFO settings");
  assert.equal(
    attemptReason(attempt({ status: "off", reason: "not set up yet" })),
    "not set up yet",
  );
  assert.equal(attemptReason(attempt({ status: "off", reason: "" })), "not set up yet");
});

test("other tries keep the card's own words", () => {
  assert.equal(attemptReason(null), "none has been written yet");
  assert.equal(attemptReason(attempt()), "the AI service didn't answer");
  assert.equal(
    attemptReason(attempt({ status: "unverified", reason: "x" })),
    "couldn't check its numbers",
  );
  assert.equal(
    attemptReason(attempt({ status: "blocked", reason: "personal data check" })),
    "its safety check for personal data stopped it",
  );
  assert.equal(
    attemptReason(attempt({ status: "skipped", reason: "not enough time left" })),
    "there was not enough time to write one",
  );
});

test("an old 'off' try is not shown once the AI is on", () => {
  const off = attempt({ status: "off", reason: "switched off in CFO settings" });
  assert.equal(attemptToShow(off, null, true), null);
  assert.equal(attemptToShow(off, "2026-10-01T00:00:00.000Z", true), null);
  // While the AI is off it is still the latest word.
  assert.equal(attemptToShow(off, null, false), off);
});

test("a failed try is shown only when newer than the last good summary", () => {
  const failed = attempt();
  assert.equal(attemptToShow(failed, null, true), failed);
  assert.equal(attemptToShow(failed, "2026-10-05T00:00:00.000Z", true), failed);
  assert.equal(attemptToShow(failed, "2026-10-07T00:00:00.000Z", true), null);
  assert.equal(attemptToShow(attempt({ status: "ok", reason: "" }), null, true), null);
  assert.equal(attemptToShow(null, null, true), null);
});
