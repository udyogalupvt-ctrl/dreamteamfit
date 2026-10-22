import assert from "node:assert/strict";
import { test } from "node:test";
import type { BodyEntry } from "../types/models";
import {
  bodyNumber,
  canChangeEntry,
  cleanBodyEntry,
  entryLine,
  formatChange,
  metricChange,
  metricsWithData,
  photoPair,
  progressSeries,
  putEntry,
  readEntries,
  validateBodyEntry,
} from "./body-progress.ts";

const today = "2026-10-22";
const member = { kind: "member" as const, id: "C1", name: "Asha" };
const entry = (over: Partial<BodyEntry> & { id: string; date: string }): BodyEntry => ({
  ...cleanBodyEntry({}),
  by: member,
  at: 1,
  ...over,
});

test("numbers: commas, rounding to 0.1, blanks and junk are 'not measured'", () => {
  assert.equal(bodyNumber("72,46"), 72.5);
  assert.equal(bodyNumber(" 80 "), 80);
  assert.equal(bodyNumber(""), 0);
  assert.equal(bodyNumber("abc"), 0);
  assert.equal(bodyNumber(-5), 0);
  const e = cleanBodyEntry({
    date: "2026-10-01",
    weightKg: "72.44",
    measurements: { waist: "81.06", chest: "x" },
    photos: ["  https://a  ", "", 5],
    note: "  after Diwali  ",
  });
  assert.equal(e.weightKg, 72.4);
  assert.deepEqual(e.measurements, { chest: 0, waist: 81.1, hips: 0, arm: 0, thigh: 0 });
  assert.deepEqual(e.photos, ["https://a"]);
  assert.equal(e.note, "after Diwali");
});

test("entries are checked: ranges, date, something to save", () => {
  const ok = (over: Record<string, unknown>) =>
    validateBodyEntry(cleanBodyEntry({ date: "2026-10-20", ...over }), today);
  assert.equal(ok({ weightKg: 72 }), "");
  assert.match(ok({ weightKg: 19 }), /Weight must be between 20 and 300 kg/);
  assert.match(ok({ weightKg: 301 }), /Weight/);
  assert.match(ok({ bodyFatPct: 1.5 }), /Body fat must be between 2 and 70/);
  assert.match(ok({ measurements: { arm: 9 } }), /Arm must be between 10 and 250 cm/);
  assert.match(ok({}), /at least one number or add a photo/);
  assert.equal(
    ok({ photos: ["https://res.cloudinary.com/x/image/upload/a.jpg"] }),
    "",
    "a photo alone",
  );
  assert.match(ok({ photos: ["a", "b", "c", "d"] }), /Up to 3 photos/);
  assert.match(ok({ weightKg: 70, note: "x".repeat(301) }), /note is too long/);
  assert.match(
    validateBodyEntry(cleanBodyEntry({ date: "2026-10-23", weightKg: 70 }), today),
    /future/,
  );
  assert.match(
    validateBodyEntry(cleanBodyEntry({ date: "22-10-2026", weightKg: 70 }), today),
    /date/,
  );
});

test("chart series: date order, one point per day (the last entry that day), gaps skipped", () => {
  const entries = [
    entry({ id: "c", date: "2026-10-10", weightKg: 71, at: 5 }),
    entry({ id: "a", date: "2026-10-01", weightKg: 73, at: 1 }),
    entry({ id: "b", date: "2026-10-10", weightKg: 71.5, at: 9 }),
    entry({ id: "d", date: "2026-10-05", bodyFatPct: 20, at: 3 }),
  ];
  assert.deepEqual(progressSeries(entries, "weightKg"), [
    { date: "2026-10-01", value: 73 },
    { date: "2026-10-10", value: 71.5 },
  ]);
  assert.deepEqual(progressSeries(entries, "bodyFatPct"), [{ date: "2026-10-05", value: 20 }]);
  assert.deepEqual(
    metricsWithData(entries).map((m) => m.key),
    ["weightKg", "bodyFatPct"],
  );
});

test("change since the first entry, with its sign", () => {
  const entries = [
    entry({ id: "a", date: "2026-09-01", weightKg: 80 }),
    entry({ id: "b", date: "2026-10-01", weightKg: 77.6 }),
  ];
  const c = metricChange(entries, "weightKg")!;
  assert.equal(c.change, -2.4);
  assert.equal(c.first.date, "2026-09-01");
  assert.equal(c.latest.value, 77.6);
  assert.equal(formatChange(c.change, "weightKg"), "−2.4 kg");
  assert.equal(formatChange(1.5, "waist"), "+1.5 cm");
  assert.equal(formatChange(0, "weightKg"), "No change");
  assert.equal(metricChange(entries, "waist"), null);
});

test("list line shows only what was measured", () => {
  const e = cleanBodyEntry({
    date: today,
    weightKg: 72.5,
    bodyFatPct: 18,
    measurements: { waist: 82 },
  });
  assert.equal(entryLine(e), "72.5 kg · Body fat 18% · Waist 82 cm");
});

test("who may change an entry: desk any, member/trainer their own", () => {
  const e = entry({ id: "a", date: today, weightKg: 70 });
  assert.equal(canChangeEntry(e, { kind: "member", id: "C1" }), true);
  assert.equal(canChangeEntry(e, { kind: "member", id: "C2" }), false);
  assert.equal(canChangeEntry(e, { kind: "trainer", id: "C1" }), false);
  assert.equal(canChangeEntry(e, { kind: "staff", id: "anyone" }), true);
});

test("put: adds in date order; an edit keeps the author and first-saved time", () => {
  const a = entry({ id: "a", date: "2026-10-05", weightKg: 72, at: 10 });
  const b = entry({ id: "b", date: "2026-10-01", weightKg: 73, at: 20 });
  const list = putEntry([a], b);
  assert.deepEqual(
    list.map((e) => e.id),
    ["b", "a"],
  );
  const desk = { kind: "staff" as const, id: "u1", name: "Desk" };
  const edited = putEntry(list, { ...a, weightKg: 71, by: desk, at: 99 });
  const a2 = edited.find((e) => e.id === "a")!;
  assert.equal(a2.weightKg, 71);
  assert.deepEqual(a2.by, member);
  assert.equal(a2.at, 10);
  assert.equal(edited.length, 2);
});

test("stored doc → entries: broken rows dropped, oldest first", () => {
  const list = readEntries({
    entries: [
      {
        id: "x",
        date: "2026-10-09",
        weightKg: 70,
        by: { kind: "trainer", id: "T1", name: "K" },
        at: 2,
      },
      { date: "2026-10-01", weightKg: 70 },
      "junk",
      { id: "y", date: "2026-10-02", weightKg: "71", by: { kind: "weird" }, at: "1" },
    ],
  });
  assert.deepEqual(
    list.map((e) => e.id),
    ["y", "x"],
  );
  assert.equal(list[0]!.weightKg, 71);
  assert.equal(
    list[0]!.by.kind,
    "staff",
    "unknown author kind → staff (only the desk can change it)",
  );
  assert.deepEqual(readEntries(undefined), []);
});

test("compare photos: first vs latest day with photos", () => {
  const p = (id: string, date: string, url: string) => entry({ id, date, photos: [url] });
  assert.equal(photoPair([p("a", "2026-10-01", "u1")]), null);
  assert.deepEqual(
    photoPair([p("b", "2026-10-20", "u2"), p("a", "2026-10-01", "u1"), p("c", "2026-10-10", "u3")]),
    { first: { date: "2026-10-01", url: "u1" }, latest: { date: "2026-10-20", url: "u2" } },
  );
});
