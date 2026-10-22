import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANNOUNCEMENT_MAX,
  announcementId,
  appAudience,
  appMessageProblem,
  channelOf,
  cleanAppMessage,
  onHome,
} from "./app-announcement.ts";

test("clean: keeps line breaks, squeezes blank lines and trailing spaces", () => {
  assert.equal(
    cleanAppMessage("  Closed Sunday  \r\n\r\n\r\n\r\nOpen Monday 5 AM \n"),
    "Closed Sunday\n\nOpen Monday 5 AM",
  );
  assert.equal(cleanAppMessage("one\ntwo"), "one\ntwo");
  assert.equal(cleanAppMessage("   "), "");
});

test("problem: empty or too long", () => {
  assert.equal(appMessageProblem(""), "Type the message first.");
  assert.equal(appMessageProblem("x".repeat(ANNOUNCEMENT_MAX)), "");
  assert.match(appMessageProblem("x".repeat(ANNOUNCEMENT_MAX + 1)), /500/);
});

test("id: newer sorts first, same length, unique tail", () => {
  const older = announcementId(1_760_000_000_000, 0.1);
  const newer = announcementId(1_760_000_000_001, 0.9);
  assert.ok(newer < older, `${newer} should sort before ${older}`);
  assert.equal(older.length, newer.length);
  assert.match(older, /^\d{13}_[0-9a-z]{6}$/);
  assert.notEqual(announcementId(5, 0.1), announcementId(5, 0.2));
  // A year later still sorts before.
  assert.ok(announcementId(1_791_536_000_000, 0) < older);
});

test("audience: members of the chosen groups once, plus extras", () => {
  const segments = {
    active: [{ client: { id: "A" } }, { client: { id: "B" } }],
    inactive: [{ client: { id: "B" } }, { client: { id: "C" } }],
    blacklist: [{ client: { id: "D" } }],
  };
  assert.deepEqual(appAudience(segments, ["active", "inactive"]), ["A", "B", "C"]);
  assert.deepEqual(appAudience(segments, []), []);
  assert.deepEqual(appAudience(segments, ["blacklist"], ["A", "", "D"]), ["D", "A"]);
  assert.deepEqual(appAudience(segments, ["missing"]), []);
});

test("home card: 14 days from the day it was sent", () => {
  assert.equal(onHome("2026-10-22", "2026-10-22"), true);
  assert.equal(onHome("2026-10-09", "2026-10-22"), true);
  assert.equal(onHome("2026-10-08", "2026-10-22"), false);
  assert.equal(onHome("", "2026-10-22"), false);
  assert.equal(onHome("2026-10-23", "2026-10-22"), true); // phone clock behind the server
});

test("channel: old docs were WhatsApp only", () => {
  assert.equal(channelOf("app"), "app");
  assert.equal(channelOf("whatsapp"), "whatsapp");
  assert.equal(channelOf(undefined), "whatsappOnly");
});
