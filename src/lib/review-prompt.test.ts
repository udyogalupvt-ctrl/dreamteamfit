import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewAskText, reviewEligible, reviewStatusLine, reviewUrlProblem } from "./review-prompt.ts";

const URL_OK = "https://g.page/r/CabcDEF123/review";
const base = {
  url: URL_OK,
  today: "2026-10-22",
  hasRunningPlan: true,
  joinedOn: "2026-09-01",
  renewedOn: "",
  review: null,
};

test("review link: https from Google only", () => {
  assert.equal(reviewUrlProblem(""), "");
  assert.equal(reviewUrlProblem(URL_OK), "");
  assert.equal(reviewUrlProblem("https://search.google.com/local/writereview?placeid=ChIJ1"), "");
  assert.equal(reviewUrlProblem("https://maps.app.goo.gl/AbC123"), "");
  assert.equal(reviewUrlProblem("https://www.google.co.in/maps/place/x"), "");
  assert.match(reviewUrlProblem("http://g.page/r/x/review"), /https/);
  assert.match(reviewUrlProblem("g.page/r/x/review"), /full link/);
  assert.match(reviewUrlProblem("https://example.com/review"), /Google Business Profile/);
  assert.match(reviewUrlProblem("https://notgoogle.com/x"), /Google Business Profile/);
  assert.match(reviewUrlProblem("javascript:alert(1)"), /https/);
});

test("eligible after 30 days with a running plan", () => {
  assert.equal(reviewEligible(base), true);
  assert.equal(reviewEligible({ ...base, joinedOn: "2026-09-23" }), false, "29 days");
  assert.equal(reviewEligible({ ...base, joinedOn: "2026-09-22" }), true, "30 days");
  assert.equal(reviewEligible({ ...base, joinedOn: "" }), false);
});

test("eligible in the first 14 days of a renewed plan", () => {
  const fresh = { ...base, joinedOn: "2026-10-20" };
  assert.equal(reviewEligible({ ...fresh, renewedOn: "2026-10-08" }), true, "14 days");
  assert.equal(reviewEligible({ ...fresh, renewedOn: "2026-10-07" }), false, "15 days");
  assert.equal(reviewEligible({ ...fresh, renewedOn: "2026-10-25" }), false, "starts later");
});

test("never without the link or a running plan", () => {
  assert.equal(reviewEligible({ ...base, url: "" }), false);
  assert.equal(reviewEligible({ ...base, url: "https://example.com" }), false);
  assert.equal(reviewEligible({ ...base, hasRunningPlan: false }), false);
});

test("tapped = never again; Not now = back after 60 days", () => {
  assert.equal(reviewEligible({ ...base, review: { tappedAt: "2025-01-01" } }), false);
  assert.equal(reviewEligible({ ...base, review: { dismissedAt: "2026-08-24" } }), false, "59 days");
  assert.equal(reviewEligible({ ...base, review: { dismissedAt: "2026-08-23" } }), true, "60 days");
  assert.equal(reviewEligible({ ...base, review: { askedAt: "2026-10-21" } }), true);
});

test("desk line and the WhatsApp text", () => {
  const day = (d: string) => `[${d}]`;
  assert.equal(reviewStatusLine(null, day), "Not asked yet");
  assert.equal(reviewStatusLine({ askedAt: "2026-10-01" }, day), "Asked on WhatsApp on [2026-10-01]");
  assert.equal(
    reviewStatusLine({ askedAt: "2026-10-01", tappedAt: "2026-10-02" }, day),
    "Opened the review link on [2026-10-02]",
  );
  assert.equal(reviewStatusLine({ dismissedAt: "2026-10-03" }, day), 'Said "Not now" on [2026-10-03]');
  const text = reviewAskText("  Asha Varma ", "Test Gym", URL_OK);
  assert.ok(text.startsWith("Hi Asha, thank you for training with Test Gym!"));
  assert.ok(text.endsWith(URL_OK));
});
