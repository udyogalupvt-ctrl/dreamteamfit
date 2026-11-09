import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANON_LIMITS,
  anonSummary,
  cleanAnonFeedback,
  cleanLinkName,
  feedbackUrl,
  hourWindow,
  isFeedbackToken,
  newFeedbackToken,
  nextDayCount,
  toHour,
  validateAnonFeedback,
  validateLinkName,
} from "./anon-feedback.ts";

test("clean: known kind, a whole 1-5 rating or 0, tidy text", () => {
  assert.deepEqual(
    cleanAnonFeedback({ kind: "praise", rating: 5, message: "  Great  \n\n\n\nstaff " }),
    {
      kind: "praise",
      rating: 5,
      message: "Great\n\nstaff",
    },
  );
  assert.equal(cleanAnonFeedback({ kind: "spam" }).kind, "idea");
  for (const bad of [0, 6, 2.5, "3", -1, null, Number.NaN])
    assert.equal(cleanAnonFeedback({ rating: bad }).rating, 0, String(bad));
  assert.deepEqual(cleanAnonFeedback(null), { kind: "idea", rating: 0, message: "" });
  assert.deepEqual(cleanAnonFeedback([1, 2]), { kind: "idea", rating: 0, message: "" });
});

test("validate: a few words, at most the limit", () => {
  assert.equal(
    validateAnonFeedback({ kind: "idea", rating: 0, message: "ok" }),
    "Write a few words.",
  );
  assert.equal(validateAnonFeedback({ kind: "idea", rating: 0, message: "AC off" }), "");
  assert.match(
    validateAnonFeedback({ kind: "idea", rating: 0, message: "x".repeat(ANON_LIMITS.message + 1) }),
    /under 1000/,
  );
});

test("link names: one line, 2 to 60 characters", () => {
  assert.equal(cleanLinkName("  Front \n  desk "), "Front desk");
  assert.match(validateLinkName("A"), /Give the QR a name/);
  assert.equal(validateLinkName("Changing room"), "");
  assert.match(validateLinkName("x".repeat(61)), /under 60/);
});

test("tokens: 24 URL-safe characters, different every time", () => {
  const a = newFeedbackToken();
  const b = newFeedbackToken();
  assert.ok(isFeedbackToken(a), a);
  assert.notEqual(a, b);
  assert.equal(isFeedbackToken("short"), false);
  assert.equal(isFeedbackToken(`${a.slice(0, 23)}/`), false);
  assert.equal(feedbackUrl("https://gym.app/", a), `https://gym.app/f/${a}`);
});

test("day counter: counts up to the limit, starts again the next day", () => {
  assert.deepEqual(nextDayCount(undefined, "2026-11-09", 5), { day: "2026-11-09", count: 1 });
  assert.deepEqual(nextDayCount({ day: "2026-11-09", count: 4 }, "2026-11-09", 5), {
    day: "2026-11-09",
    count: 5,
  });
  assert.equal(nextDayCount({ day: "2026-11-09", count: 5 }, "2026-11-09", 5), null);
  assert.deepEqual(nextDayCount({ day: "2026-11-08", count: 99 }, "2026-11-09", 5), {
    day: "2026-11-09",
    count: 1,
  });
  assert.deepEqual(nextDayCount({ day: "2026-11-09", count: "junk" }, "2026-11-09", 5), {
    day: "2026-11-09",
    count: 1,
  });
});

test("time is kept only to the hour", () => {
  const t = Date.UTC(2026, 10, 9, 14, 42, 17, 5);
  assert.equal(toHour(t), Date.UTC(2026, 10, 9, 14, 0, 0, 0));
  const at = (h: number) => new Date(2026, 10, 9, h);
  assert.equal(hourWindow(at(19)), "7–8 pm");
  assert.equal(hourWindow(at(11)), "11 am–12 pm");
  assert.equal(hourWindow(at(23)), "11 pm–12 am");
  assert.equal(hourWindow(at(0)), "12–1 am");
});

test("summary: average of rated ones only, complaints counted", () => {
  assert.deepEqual(
    anonSummary([
      { rating: 5, kind: "praise" },
      { rating: 2, kind: "complaint" },
      { rating: 0, kind: "complaint" },
    ]),
    { total: 3, rated: 2, average: 3.5, complaints: 2 },
  );
  assert.deepEqual(anonSummary([]), { total: 0, rated: 0, average: 0, complaints: 0 });
});
