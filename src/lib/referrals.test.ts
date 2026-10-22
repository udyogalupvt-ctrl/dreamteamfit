import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canChangeReferrer,
  decideReward,
  memberMatches,
  memberReferralSummary,
  referralFor,
  referrerProblem,
  toReferredBy,
  rewardLabel,
  shareText,
  whatsappShareUrl,
} from "./referrals.ts";

const base = {
  outcome: "given",
  kind: "free_days",
  days: "7",
  amount: "",
  note: "",
  reason: "",
} as const;

test("reward label: days, money off, gift, other", () => {
  assert.equal(rewardLabel({ kind: "free_days", days: 7, amount: 0, note: "" }), "7 free days");
  assert.equal(rewardLabel({ kind: "free_days", days: 1, amount: 0, note: "" }), "1 free day");
  assert.equal(
    rewardLabel({ kind: "discount", days: 0, amount: 1500, note: "at renewal" }),
    "₹1,500 off (at renewal)",
  );
  assert.equal(rewardLabel({ kind: "gift", days: 0, amount: 0, note: "T-shirt" }), "Gift: T-shirt");
  assert.equal(
    rewardLabel({ kind: "other", days: 0, amount: 0, note: "Free diet chart" }),
    "Free diet chart",
  );
  assert.equal(rewardLabel(null), "");
});

test("decide: free days must be a whole number 1 to 365", () => {
  assert.deepEqual(decideReward(base), {
    decision: {
      status: "given",
      reward: { kind: "free_days", days: 7, amount: 0, note: "" },
      reason: "",
    },
  });
  for (const days of ["0", "366", "2.5", "-3", "", "seven"])
    assert.match((decideReward({ ...base, days }) as { error: string }).error, /whole number/);
});

test("decide: money off, gift and other", () => {
  const off = decideReward({ ...base, outcome: "promised", kind: "discount", amount: " 500 " });
  assert.deepEqual(off, {
    decision: {
      status: "promised",
      reward: { kind: "discount", days: 0, amount: 500, note: "" },
      reason: "",
    },
  });
  assert.ok("error" in decideReward({ ...base, kind: "discount", amount: "0" }));
  assert.ok("error" in decideReward({ ...base, kind: "discount", amount: "100001" }));
  assert.deepEqual(decideReward({ ...base, kind: "gift", note: "" }), {
    error: "Say what the gift is.",
  });
  assert.deepEqual(decideReward({ ...base, kind: "other", note: " " }), {
    error: "Describe the reward.",
  });
  const gift = decideReward({ ...base, kind: "gift", note: " Shaker " });
  assert.deepEqual(gift, {
    decision: {
      status: "given",
      reward: { kind: "gift", days: 0, amount: 0, note: "Shaker" },
      reason: "",
    },
  });
  assert.ok("error" in decideReward({ ...base, note: "x".repeat(201) }));
});

test("decide: no reward needs a reason", () => {
  assert.deepEqual(decideReward({ ...base, outcome: "skipped" }), {
    error: "Say why there's no reward.",
  });
  assert.deepEqual(
    decideReward({ ...base, outcome: "skipped", reason: " Friend left in a week " }),
    {
      decision: { status: "skipped", reward: null, reason: "Friend left in a week" },
    },
  );
});

test("referrer: change only while due; never themselves", () => {
  assert.equal(canChangeReferrer(null), true);
  assert.equal(canChangeReferrer({ status: "due" }), true);
  for (const status of ["promised", "given", "skipped"] as const)
    assert.equal(canChangeReferrer({ status }), false);
  assert.equal(referrerProblem("c1", null), "");
  assert.equal(referrerProblem("c1", { clientId: "c2", name: "Ravi", memberCode: "12" }), "");
  assert.match(
    referrerProblem("c1", { clientId: "c1", name: "Ravi", memberCode: "12" }),
    /themselves/,
  );
  assert.match(referrerProblem("c1", { clientId: "", name: "", memberCode: "" }), /Pick/);
});

test("stored referrer: needs a member id", () => {
  assert.deepEqual(toReferredBy({ clientId: "r1", name: "Ravi", memberCode: 101 }), {
    clientId: "r1",
    name: "Ravi",
    memberCode: "101",
  });
  for (const v of [null, undefined, "r1", {}, { clientId: "" }, { clientId: 5 }])
    assert.equal(toReferredBy(v), null);
});

test("new referral doc: due, joined on the member's joining date or today", () => {
  const by = { clientId: "r1", name: "Ravi Kumar", memberCode: "101" };
  const doc = referralFor(
    { id: "n1", fullName: "Sita", clientCode: "205", joinedOn: "" },
    by,
    "2026-10-22",
  );
  assert.deepEqual(doc, {
    referrerId: "r1",
    referrerName: "Ravi Kumar",
    referrerCode: "101",
    newClientId: "n1",
    newClientName: "Sita",
    newClientCode: "205",
    joinedOn: "2026-10-22",
    status: "due",
    reward: null,
    reason: "",
    decidedBy: "",
    decidedAt: null,
    givenOn: "",
  });
  assert.equal(
    referralFor(
      { id: "n1", fullName: "Sita", clientCode: "205", joinedOn: "2026-10-01" },
      by,
      "2026-10-22",
    ).joinedOn,
    "2026-10-01",
  );
});

test("picker search: name, exact ID, 3+ phone digits", () => {
  const c = { fullName: "Ravi Kumar", clientCode: "RF101", phone: "+91 98480 12345" };
  assert.equal(memberMatches(c, "kum"), true);
  assert.equal(memberMatches(c, "rf101"), true);
  assert.equal(memberMatches(c, "RF10"), false);
  assert.equal(memberMatches(c, "12345"), true);
  assert.equal(memberMatches(c, "98480 1"), true);
  assert.equal(memberMatches(c, "12"), false);
  assert.equal(memberMatches(c, "  "), false);
});

test("share text names the member, promises nothing", () => {
  const t = shareText("Rebuild Fitness", "Ravi", "101");
  assert.match(t, /Ravi \(member ID 101\)/);
  assert.doesNotMatch(t, /free|reward|off|₹/i);
  assert.equal(
    shareText("G", "Ravi", ""),
    "I train at G. Come and join me! When you join, tell them Ravi sent you.",
  );
  assert.equal(whatsappShareUrl("a b&c"), "https://wa.me/?text=a%20b%26c");
});

test("member app summary: count all, list only given and promised, first names", () => {
  const reward = { kind: "free_days", days: 7, amount: 0, note: "" } as const;
  const s = memberReferralSummary([
    {
      newClientName: "Sita Devi",
      status: "given",
      reward,
      givenOn: "2026-10-05",
      joinedOn: "2026-10-01",
    },
    { newClientName: "Raju", status: "due", reward: null, givenOn: "", joinedOn: "2026-10-10" },
    {
      newClientName: "Anil K",
      status: "skipped",
      reward: null,
      givenOn: "",
      joinedOn: "2026-10-11",
    },
    { newClientName: "Hari", status: "promised", reward, givenOn: "", joinedOn: "2026-10-12" },
  ]);
  assert.equal(s.count, 4);
  assert.deepEqual(s.rewards, [
    { friend: "Hari", label: "7 free days", status: "promised", givenOn: "" },
    { friend: "Sita", label: "7 free days", status: "given", givenOn: "2026-10-05" },
  ]);
});
