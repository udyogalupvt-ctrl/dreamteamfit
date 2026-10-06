import assert from "node:assert/strict";
import { test } from "node:test";
import { computeCfo } from "./numbers.ts";
import {
  CFO_LIST_ROW_CAP,
  CFO_SUMMARY_ROWS,
  DEFAULT_CFO_SETTINGS,
  type CfoComputed,
  type CfoInput,
  type CfoMember,
  type CfoSettings,
} from "./types.ts";
import { allNumbers, bill, gym, gymBilled, input, member, pt, withPlans } from "./testkit.ts";

const META = { computedAt: "2026-10-06T02:30:00.000Z", computedBy: "test" };
const run = (i: CfoInput, s: Partial<CfoSettings> = {}): CfoComputed =>
  computeCfo(i, { ...DEFAULT_CFO_SETTINGS, ...s }, META);

/** A run of consecutive days "2026-09-25" ... as strings. */
function days(from: string, n: number): string[] {
  const out: string[] = [];
  const t = Date.parse(`${from}T00:00:00Z`);
  for (let k = 0; k < n; k++) out.push(new Date(t + k * 86_400_000).toISOString().slice(0, 10));
  return out;
}

type AddOpts = {
  start?: string;
  end?: string;
  price?: number;
  visit?: string[];
  last?: string;
  thumb?: string;
  joined?: string;
  tracked?: boolean;
  plan?: Parameters<typeof gymBilled>[5];
};

/**
 * Today 2026-10-06. Defaults: not coming 14 days, renewals 30 days, new member needs 4 visits,
 * PT chance 12 visits in 30 days, grace 15 days. Every plan is worth Rs 6000 unless stated.
 */
function world() {
  const members: CfoMember[] = [];
  const plans: ReturnType<typeof gymBilled>[] = [];
  const visits: Record<string, string[]> = {};
  const add = (id: string, o: AddOpts = {}) => {
    members.push(
      member({
        id,
        name: `Member ${id}`,
        joinedOn: o.joined ?? "2026-01-01",
        lastVisitDate: o.last ?? (o.visit ? (o.visit[o.visit.length - 1] ?? "") : ""),
        thumbSince: o.thumb ?? "",
        tracked: o.tracked ?? true,
      }),
    );
    if (o.visit) visits[id] = o.visit;
    plans.push(
      gymBilled(
        `g-${id}`,
        id,
        o.start ?? "2026-09-01",
        o.end ?? "2026-12-31",
        o.price ?? 6000,
        o.plan,
      ),
    );
  };

  // ---- not coming / dropping
  add("M1", { last: "2026-09-20", visit: ["2026-09-20"] });
  add("M2", { last: "2026-10-04", visit: ["2026-10-04"] });
  add("M3", { last: "2026-09-01", plan: { plan: { pauses: [{ on: "2026-09-25", days: 20 }] } } });
  add("M4", {
    start: "2026-08-01",
    visit: [
      "2026-09-09",
      "2026-09-11",
      "2026-09-14",
      "2026-09-16",
      "2026-09-18",
      "2026-10-01",
      "2026-10-05",
    ],
  });
  add("M5", { tracked: false });
  add("M6", { start: "2026-09-30", joined: "2026-09-30", thumb: "2026-09-30" });
  add("M7", { thumb: "2026-09-01" });
  add("M8", {
    start: "2026-09-01",
    end: "2026-09-30",
    last: "2026-08-01",
    plan: { plan: { status: "expired" } },
  });
  add("M9", {
    last: "2026-09-20",
    visit: ["2026-09-20"],
    plan: { plan: { pauses: [{ on: "2026-09-21", days: 7 }] } },
  });
  add("M10", { visit: ["2026-09-10", "2026-09-12", "2026-09-15", "2026-09-30"] });
  // M11: plan A ended 08-31, plan B starts 10-01 (gap 30 > grace): the run starts on 10-01.
  add("M11", { start: "2026-07-01", end: "2026-08-31", plan: { plan: { status: "expired" } } });
  plans.push(gymBilled("g-M11b", "M11", "2026-10-01", "2026-12-31", 6000));
  // M12: plan A ended 09-20, plan B starts 09-30 (gap 10 <= grace): one run from 08-01.
  add("M12", { start: "2026-08-01", end: "2026-09-20", plan: { plan: { status: "expired" } } });
  plans.push(gymBilled("g-M12b", "M12", "2026-09-30", "2026-12-31", 6000));

  // ---- renewals (price 3000, visited yesterday)
  const ren = (id: string, end: string, extra: AddOpts = {}) =>
    add(id, { end, price: 3000, last: "2026-10-05", visit: ["2026-10-05"], ...extra });
  ren("R1", "2026-10-20");
  ren("R2", "2026-10-30", { last: "2026-09-15", visit: ["2026-09-15"] });
  ren("R3", "2026-11-05");
  ren("R4", "2026-11-06");
  ren("R5", "2026-10-06");
  ren("R6", "2026-10-20");
  plans.push(gymBilled("g-R6b", "R6", "2026-10-21", "2026-11-20", 3000));

  // ---- new members (price 2000, plan runs to the end of the year)
  const nw = (id: string, joined: string, visit: string[], extra: AddOpts = {}) =>
    add(id, { start: joined, joined, price: 2000, visit, thumb: joined, ...extra });
  nw("N1", "2026-09-20", ["2026-09-21", "2026-09-25"]);
  nw("N2", "2026-10-01", []);
  nw("N3", "2026-09-25", ["2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29"]);
  nw("N4", "2026-09-04", []);
  nw("N5", "2026-09-06", []);
  nw("N6", "2026-09-29", ["2026-09-30"]);
  nw("N7", "2026-09-20", [], {
    tracked: false,
    thumb: "",
    plan: { plan: { status: "biometric_pending" } },
  });
  nw("N8", "2026-09-20", [], { tracked: false, thumb: "" });
  nw("N9", "2026-09-20", [], { plan: { plan: { imported: true } } });
  nw("N10", "2026-09-20", [], { plan: { plan: { pauses: [{ on: "2026-09-30", days: 10 }] } } });

  // ---- PT chances (6000 plans, regular visitors)
  const reg = (id: string, visit: string[]) =>
    add(id, { visit, last: visit[visit.length - 1] ?? "" });
  reg("P1", days("2026-09-25", 12)); // 09-25 .. 10-06
  reg("P2", days("2026-09-26", 11));
  reg("P3", days("2026-09-25", 12));
  reg("P4", days("2026-09-25", 12));
  reg("P5", days("2026-09-25", 12));
  reg("P6", ["2026-09-06", ...days("2026-09-26", 11)]);

  const ptPlans = [
    pt({
      id: "pt3",
      clientId: "P3",
      status: "active",
      startDate: "2026-09-20",
      endDate: "2026-10-20",
    }),
    pt({
      id: "pt4",
      clientId: "P4",
      status: "cancelled",
      cancelledOn: "2026-08-10",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    }),
    pt({
      id: "pt5",
      clientId: "P5",
      status: "completed",
      startDate: "2026-05-01",
      endDate: "2026-05-31",
    }),
  ];

  const base = input({ members, visits, ptPlans, ptPackagePrices: [8000, 5000] });
  return withPlans(base, ...plans);
}

const ids = (c: CfoComputed, key: "atRisk" | "renewals" | "newSlipping" | "ptChances") =>
  c.lists[key].rows.map((r) => r.name.replace("Member ", ""));

test("alerts: nothing breaks and every number is finite", () => {
  for (const n of allNumbers(run(world()))) assert.ok(Number.isFinite(n));
});

test("at risk: no visit for 14+ days, dropping visits, runs of plans; paused and untracked never", () => {
  const c = run(world());
  // Rs 6000: M1 (16 days), M12 (run from 08-01, never visited), M4 (dropping), M7 (35 days).
  // Then R2 (3000, 21 days) and N4, N5, N9 (2000, never visited since their thumb). Ties by name.
  assert.deepEqual(ids(c, "atRisk"), ["M1", "M12", "M4", "M7", "R2", "N4", "N5", "N9"]);
  assert.equal(c.lists.atRisk.count, 8);
  assert.equal(c.lists.atRisk.total, 6000 * 4 + 3000 + 2000 * 3);
  const flagged = new Set(ids(c, "atRisk"));
  for (const paused of ["M3", "M9", "N10"]) assert.ok(!flagged.has(paused), `${paused} is paused`);
  assert.ok(!flagged.has("M5"), "untracked member is not flagged");
  assert.ok(!flagged.has("M11"), "the run of M11 restarted on 10-01");
  assert.ok(!flagged.has("M10"), "only 3 earlier visits: not enough to call it dropping");
  assert.ok(!flagged.has("M6"), "M6 only started 6 days ago");
  assert.ok(!flagged.has("M8"), "the plan of M8 has ended");
});

test("at risk: row fields, kind, reason and money (value of the running plan)", () => {
  const c = run(world());
  const m1 = c.lists.atRisk.rows.find((r) => r.name === "Member M1")!;
  assert.equal(m1.money, 6000);
  assert.equal(m1.kind, "notComing");
  assert.equal(m1.plan, "Monthly");
  assert.equal(m1.endDate, "2026-12-31");
  assert.equal(m1.lastVisit, "2026-09-20");
  assert.equal(m1.top, false);
  assert.equal(m1.clientId, "M1");
  assert.match(m1.reason, /16 days/);
  const m4 = c.lists.atRisk.rows.find((r) => r.name === "Member M4")!;
  assert.equal(m4.kind, "dropping");
  assert.match(m4.reason, /5/);
  assert.match(m4.reason, /2/);
  const m12 = c.lists.atRisk.rows.find((r) => r.name === "Member M12")!;
  assert.equal(m12.money, 6000); // the running plan (B), not the old one
  assert.equal(m12.lastVisit, "");
});

test("at risk: paused days are taken off the days since the last visit", () => {
  const flagged = (pauseDays: number) => {
    const w = withPlans(
      input({
        members: [member({ id: "Z", name: "Member Z", lastVisitDate: "2026-09-20" })],
        visits: { Z: ["2026-09-20"] },
      }),
      gymBilled("gz", "Z", "2026-09-01", "2026-12-31", 6000, {
        plan: { pauses: pauseDays ? [{ on: "2026-09-21", days: pauseDays }] : [] },
      }),
    );
    return run(w).lists.atRisk.count;
  };
  assert.equal(flagged(0), 1); // 16 days
  assert.equal(flagged(2), 1); // 16 - 2 = 14: right at the limit
  assert.equal(flagged(3), 0); // 16 - 3 = 13
});

test("renewals: ends in 0..30 days with no later plan; top priority when also not coming", () => {
  const c = run(world());
  assert.deepEqual(ids(c, "renewals"), ["R1", "R2", "R3", "R5"]);
  const top = c.lists.renewals.rows.filter((r) => r.top).map((r) => r.name);
  assert.deepEqual(top, ["Member R2"]);
  assert.equal(c.lists.renewals.total, 12000);
  assert.match(c.lists.renewals.rows[0]!.reason, /14 days/);
  assert.match(c.lists.renewals.rows[3]!.reason, /today/);
  assert.ok(!ids(c, "renewals").includes("R4")); // 31 days
  assert.ok(!ids(c, "renewals").includes("R6")); // already has a later plan
});

test("a member in two lists keeps the same money in both", () => {
  const c = run(world());
  const r2a = c.lists.atRisk.rows.find((r) => r.name === "Member R2")!;
  const r2b = c.lists.renewals.rows.find((r) => r.name === "Member R2")!;
  assert.equal(r2a.money, 3000);
  assert.equal(r2b.money, r2a.money);
  assert.equal(r2b.top, true);
  assert.equal(r2a.top, false);
});

test("renewals window follows the setting", () => {
  assert.ok(ids(run(world(), { renewalDays: 31 }), "renewals").includes("R4"));
});

test("new members slipping: joined 7..30 days ago, fewer than 4 visits since joining", () => {
  const c = run(world());
  // N1 (2 visits), N5 (30 days ago, 0), N6 (7 days ago, 1), N7 (waiting for its thumb).
  // N2 too new, N3 has 4 visits, N4 too old, N8 cannot be tracked, N9 imported, N10 paused.
  assert.deepEqual(ids(c, "newSlipping"), ["N1", "N5", "N6", "N7"]);
  assert.equal(c.lists.newSlipping.total, 8000);
  assert.match(c.lists.newSlipping.rows[0]!.reason, /2 visits/);
});

test("new members slipping: the minimum visits setting is respected", () => {
  assert.ok(!ids(run(world(), { newMemberMinVisits: 2 }), "newSlipping").includes("N1"));
});

test("PT chances: 12+ visits in the last 30 days and never a non-cancelled PT plan", () => {
  const c = run(world());
  // P1 yes. P2 only 11 visits. P3 has a PT plan now. P4 only a cancelled one -> yes.
  // P5 had a completed PT plan. P6 has 11 visits in the last 30 days (one is older).
  assert.deepEqual(ids(c, "ptChances"), ["P1", "P4"]);
  assert.equal(c.lists.ptChances.rows[0]!.money, 5000); // cheapest active package
  assert.equal(c.lists.ptChances.total, 10000);
  assert.equal(c.snapshot.ptFromPrice, 5000);
});

test("members that cannot be tracked are counted, never named", () => {
  const c = run(world());
  assert.equal(c.snapshot.notTracked, 3); // M5, N7, N8
  assert.ok(c.snapshot.dataNotes.some((n) => /3 /.test(n) && /visit|thumb/i.test(n)));
});

test("snapshot keeps counts and totals of the full list but only the top rows", () => {
  const c = run(world());
  assert.equal(c.snapshot.lists.atRisk.count, c.lists.atRisk.count);
  assert.equal(c.snapshot.lists.atRisk.total, c.lists.atRisk.total);
  assert.deepEqual(c.snapshot.lists.atRisk.rows, c.lists.atRisk.rows);
  assert.equal(c.lists.atRisk.key, "atRisk");
  assert.equal(c.lists.atRisk.computedAt, META.computedAt);
  assert.equal(c.lists.atRisk.truncated, 0);
});

/** Many members who have not visited for a long time. Money is 1..n so the order is known. */
function crowd(n: number, nameLength = 10): CfoInput {
  const members: CfoMember[] = [];
  const plans: ReturnType<typeof gymBilled>[] = [];
  for (let k = 1; k <= n; k++) {
    const id = `c${k}`;
    members.push(
      member({
        id,
        name: `${String(k).padStart(5, "0")}${"x".repeat(nameLength)}`,
        thumbSince: "2026-09-01",
        tracked: true,
      }),
    );
    plans.push(gymBilled(`g${k}`, id, "2026-09-01", "2026-12-31", k));
  }
  return withPlans(input({ members }), ...plans);
}

test("lists: summary keeps 20 rows, the full list is capped at 1000 and says how many were left out", () => {
  const c = run(crowd(1200));
  assert.equal(c.snapshot.lists.atRisk.count, 1200);
  assert.equal(c.snapshot.lists.atRisk.rows.length, CFO_SUMMARY_ROWS);
  assert.equal(c.lists.atRisk.count, 1200);
  assert.equal(c.lists.atRisk.rows.length, CFO_LIST_ROW_CAP);
  assert.equal(c.lists.atRisk.truncated, 200);
  assert.equal(c.lists.atRisk.rows[0]!.money, 1200); // highest money first
  assert.equal(c.lists.atRisk.rows[CFO_LIST_ROW_CAP - 1]!.money, 201);
  assert.equal(c.snapshot.lists.atRisk.total, (1200 * 1201) / 2);
});

test("lists: a list doc is trimmed to stay under 800 KB, lowest-money rows go first", () => {
  const c = run(crowd(1000, 1500));
  const json = JSON.stringify(c.lists.atRisk);
  assert.ok(json.length < 800_000, `list doc is ${json.length} chars`);
  assert.ok(c.lists.atRisk.truncated > 0);
  assert.equal(c.lists.atRisk.rows.length + c.lists.atRisk.truncated, 1000);
  assert.equal(c.lists.atRisk.count, 1000);
  assert.equal(c.lists.atRisk.rows[0]!.money, 1000);
  const last = c.lists.atRisk.rows[c.lists.atRisk.rows.length - 1]!.money;
  assert.equal(last, 1000 - c.lists.atRisk.rows.length + 1);
});

test("alerts: a member whose plan has no bill is still listed, worth Rs 0", () => {
  const i = input({
    members: [member({ id: "q", name: "Member Q", thumbSince: "2026-09-01" })],
    gymPlans: [
      gym({
        id: "gq",
        clientId: "q",
        startDate: "2026-09-01",
        endDate: "2026-12-31",
        invoiceId: null,
      }),
    ],
    bills: [bill({ id: "unrelated", subtotal: 10, clientId: "someone-else" })],
  });
  const c = run(i);
  assert.equal(c.lists.atRisk.rows[0]!.money, 0);
});
