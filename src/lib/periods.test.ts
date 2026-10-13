import assert from "node:assert/strict";
import { test } from "node:test";
import { DAY_CHOICES, choiceText, choicesWith, dayText, periodFor, periodSpan } from "./periods.ts";

// Tuesday.
const T = "2026-10-13";

test("the owner's list, in order", () => {
  assert.deepEqual(DAY_CHOICES, [
    "today",
    "yesterday",
    "back2",
    "back3",
    "back4",
    "back5",
    "week",
    "month",
    "date",
    "range",
  ]);
});

test("a page's extras go after This month", () => {
  assert.deepEqual(choicesWith("lastMonth", "year").slice(6), [
    "week",
    "month",
    "lastMonth",
    "year",
    "date",
    "range",
  ]);
  assert.equal(DAY_CHOICES.length, 10);
});

test("today and yesterday", () => {
  assert.deepEqual(periodFor("today", T), {
    from: T,
    to: T,
    label: "today",
    isToday: true,
  });
  assert.deepEqual(periodFor("yesterday", T), {
    from: "2026-10-12",
    to: "2026-10-12",
    label: "yesterday",
    isToday: false,
  });
});

test("N days back is that one day, named with its weekday", () => {
  assert.deepEqual(periodFor("back2", T), {
    from: "2026-10-11",
    to: "2026-10-11",
    label: "Sun 11 Oct",
    isToday: false,
  });
  assert.equal(periodFor("back5", T).from, "2026-10-08");
  assert.equal(periodFor("back5", T).to, "2026-10-08");
  assert.equal(choiceText("back2", T), "2 days back · Sun 11 Oct");
  assert.equal(choiceText("back5", T), "5 days back · Thu 8 Oct");
  // Across a month and a year end.
  assert.equal(periodFor("back3", "2026-03-02").from, "2026-02-27");
  assert.equal(periodFor("back2", "2027-01-01").label, "Wed 30 Dec 2026");
});

test("this week runs Monday to today; on a Monday it is just today", () => {
  assert.deepEqual(periodFor("week", T), {
    from: "2026-10-12",
    to: T,
    label: "this week",
    isToday: false,
  });
  assert.equal(periodFor("week", "2026-10-18").from, "2026-10-12"); // Sunday
  assert.deepEqual(periodFor("week", "2026-10-12"), {
    from: "2026-10-12",
    to: "2026-10-12",
    label: "this week",
    isToday: true,
  });
});

test("this month, last month, this year, all dates", () => {
  assert.deepEqual(periodFor("month", T), {
    from: "2026-10-01",
    to: T,
    label: "this month",
    isToday: false,
  });
  assert.deepEqual(periodFor("lastMonth", T), {
    from: "2026-09-01",
    to: "2026-09-30",
    label: "last month",
    isToday: false,
  });
  assert.equal(periodFor("lastMonth", "2026-03-31").to, "2026-02-28");
  assert.equal(periodFor("lastMonth", "2024-03-05").to, "2024-02-29");
  assert.deepEqual(periodFor("lastMonth", "2027-01-15"), {
    from: "2026-12-01",
    to: "2026-12-31",
    label: "last month",
    isToday: false,
  });
  assert.deepEqual(periodFor("year", T), {
    from: "2026-01-01",
    to: T,
    label: "this year",
    isToday: false,
  });
  const all = periodFor("all", T);
  assert.equal(all.label, "all dates");
  assert.ok("1999-01-01" >= all.from && "2099-12-31" <= all.to);
});

test("a picked date: never after today, named like the presets", () => {
  assert.deepEqual(periodFor("date", T, { day: "2026-10-01" }), {
    from: "2026-10-01",
    to: "2026-10-01",
    label: "Thu 1 Oct",
    isToday: false,
  });
  assert.equal(periodFor("date", T, { day: "2026-12-01" }).from, T);
  assert.equal(periodFor("date", T, { day: "" }).label, "today");
  assert.equal(periodFor("date", T, { day: "2026-10-12" }).label, "yesterday");
});

test("from – to: swapped when backwards, never after today", () => {
  assert.deepEqual(periodFor("range", T, { from: "2026-10-01", to: "2026-10-05" }), {
    from: "2026-10-01",
    to: "2026-10-05",
    label: "Thu 1 Oct – Mon 5 Oct",
    isToday: false,
  });
  assert.deepEqual(periodFor("range", T, { from: "2026-10-05", to: "2026-10-01" }), {
    from: "2026-10-01",
    to: "2026-10-05",
    label: "Thu 1 Oct – Mon 5 Oct",
    isToday: false,
  });
  assert.equal(periodFor("range", T, { from: "2026-10-01", to: "2026-11-30" }).to, T);
  assert.deepEqual(periodFor("range", T, { from: T, to: T }), {
    from: T,
    to: T,
    label: "today",
    isToday: true,
  });
  assert.equal(
    periodFor("range", T, { from: "2025-12-30", to: "2026-01-02" }).label,
    "Tue 30 Dec 2025 – Fri 2 Jan",
  );
});

test("the days a choice covers, shown next to it", () => {
  assert.equal(periodSpan(periodFor("today", T), T), "Tue 13 Oct");
  assert.equal(periodSpan(periodFor("week", T), T), "Mon 12 Oct – Tue 13 Oct");
  assert.equal(periodSpan(periodFor("lastMonth", T), T), "Tue 1 Sep – Wed 30 Sep");
  assert.equal(periodSpan(periodFor("all", T), T), "");
  assert.equal(dayText("2026-10-13", T), "Tue 13 Oct");
  assert.equal(dayText("2025-10-13", T), "Mon 13 Oct 2025");
});

test("option names", () => {
  assert.equal(choiceText("today", T), "Today");
  assert.equal(choiceText("yesterday", T), "Yesterday");
  assert.equal(choiceText("week", T), "This week");
  assert.equal(choiceText("month", T), "This month");
  assert.equal(choiceText("lastMonth", T), "Last month");
  assert.equal(choiceText("year", T), "This year");
  assert.equal(choiceText("all", T), "All dates");
  assert.equal(choiceText("date", T), "Pick a date…");
  assert.equal(choiceText("range", T), "From – to…");
});
