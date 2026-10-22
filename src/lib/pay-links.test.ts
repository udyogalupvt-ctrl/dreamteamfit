import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDaysIso,
  cleanUtr,
  closeReason,
  isBillToken,
  isPayToken,
  newPayToken,
  paidRateOk,
  renewalAmount,
  renewalOffer,
  upiNote,
  upiUri,
  validateUpiSettings,
} from "./pay-links.ts";

test("UPI settings: empty switches it off, a real UPI ID and name are kept", () => {
  assert.deepEqual(validateUpiSettings({ upiId: "  ", payeeName: "" }), {
    ok: true,
    upiId: "",
    payeeName: "",
  });
  assert.deepEqual(
    validateUpiSettings({ upiId: " Rebuild.Fit@OKHDFCBANK ", payeeName: "  Rebuild   Fitness " }),
    {
      ok: true,
      upiId: "rebuild.fit@okhdfcbank",
      payeeName: "Rebuild Fitness",
    },
  );
});

test("UPI settings: wrong shapes are refused with the field", () => {
  for (const upiId of [
    "rebuild",
    "@ybl",
    "a@b",
    "re build@ybl",
    "x@ybl.com",
    "r@1bank",
    `${"a".repeat(99)}@ybl`,
  ]) {
    const r = validateUpiSettings({ upiId, payeeName: "Gym" });
    assert.equal(r.ok, false, upiId);
    assert.equal(!r.ok && r.field, "upiId", upiId);
  }
  const noName = validateUpiSettings({ upiId: "gym@ybl", payeeName: " " });
  assert.equal(!noName.ok && noName.field, "payeeName");
  const longName = validateUpiSettings({ upiId: "gym@ybl", payeeName: "a".repeat(51) });
  assert.equal(!longName.ok && longName.field, "payeeName");
  const oddName = validateUpiSettings({ upiId: "gym@ybl", payeeName: "Gym <b>" });
  assert.equal(!oddName.ok && oddName.field, "payeeName");
});

test("upi link: amount with paise, @ kept, the rest encoded", () => {
  assert.equal(
    upiUri({
      upiId: "gym.fit@okhdfcbank",
      payeeName: "Rebuild Fitness",
      amount: 1999,
      note: "INV-2026-000123 C501",
    }),
    "upi://pay?pa=gym.fit@okhdfcbank&pn=Rebuild%20Fitness&am=1999.00&cu=INR&tn=INV-2026-000123%20C501",
  );
  assert.equal(
    upiUri({ upiId: "a@ybl", payeeName: "A & B", amount: 10.5, note: "" }),
    "upi://pay?pa=a@ybl&pn=A%20%26%20B&am=10.50&cu=INR",
  );
});

test("upi note: only letters, digits, spaces and dashes, 50 at most", () => {
  assert.equal(upiNote(["INV-2026-000123", "#C501"]), "INV-2026-000123 C501");
  assert.equal(upiNote(["Renew", "C501", "3 Months (Gold) ₹"]), "Renew C501 3 Months Gold");
  assert.equal(upiNote(["x".repeat(80)]).length, 50);
  assert.equal(upiNote(["", "  "]), "");
});

test("UTR: spaces and dashes dropped, 6-35 letters or digits, empty is fine", () => {
  assert.deepEqual(cleanUtr(" 4521 0987 6543 "), { utr: "452109876543" });
  assert.deepEqual(cleanUtr("t2310-ab9"), { utr: "T2310AB9" });
  assert.deepEqual(cleanUtr(""), { utr: "" });
  assert.deepEqual(cleanUtr(undefined), { utr: "" });
  assert.ok("error" in cleanUtr("12345"));
  assert.ok("error" in cleanUtr("1234567;DROP"));
  assert.ok("error" in cleanUtr("9".repeat(36)));
});

test("tokens: 24 URL-safe characters, never the same twice", () => {
  const a = newPayToken();
  const b = newPayToken();
  assert.ok(isPayToken(a), a);
  assert.notEqual(a, b);
  assert.equal(isPayToken("short"), false);
  assert.equal(isPayToken("a".repeat(23) + "/"), false);
  assert.equal(isBillToken("0123456789abcdef0123456789abcdef0123456789abcdef"), true);
  assert.equal(isBillToken("../settings"), false);
  assert.equal(isBillToken("abc"), false);
});

test("I've paid: at most 6 taps a day per link", () => {
  const now = 10 * 86_400_000;
  const five = [1, 2, 3, 4, 5].map((h) => now - h * 3_600_000);
  assert.equal(paidRateOk(five, now), true);
  assert.equal(paidRateOk([...five, now - 60_000], now), false);
  assert.equal(paidRateOk([...five, now - 86_400_001], now), true);
});

test("renewal amount: the package price with the gym's tax", () => {
  assert.equal(renewalAmount(1999, { taxEnabled: false, taxRate: 18 }), 1999);
  assert.equal(renewalAmount(1000, { taxEnabled: true, taxRate: 18 }), 1180);
  assert.equal(renewalAmount(999, { taxEnabled: true, taxRate: 18 }), 1178.82);
});

const plan = (packageId: string, startDate: string, endDate: string, status = "active") => ({
  packageId,
  startDate,
  endDate,
  status,
});

test("renewal offer: the latest plan's package, ending within 7 days or ended", () => {
  const today = "2026-10-22";
  assert.equal(renewalOffer([plan("P1", "2026-09-29", "2026-10-28")], today), "P1");
  assert.equal(renewalOffer([plan("P1", "2026-09-29", "2026-10-29")], today), "P1");
  assert.equal(renewalOffer([plan("P1", "2026-09-29", "2026-10-30")], today), null);
  assert.equal(renewalOffer([plan("P1", "2026-01-01", "2026-03-01", "expired")], today), "P1");
  // The newest plan decides (an old one on another package doesn't).
  assert.equal(
    renewalOffer(
      [plan("OLD", "2026-01-01", "2026-02-01", "expired"), plan("P2", "2026-10-01", "2026-10-25")],
      today,
    ),
    "P2",
  );
  // A plan already queued after today: renewed.
  assert.equal(
    renewalOffer(
      [plan("P1", "2026-09-29", "2026-10-25"), plan("P1", "2026-10-26", "2026-11-25", "upcoming")],
      today,
    ),
    null,
  );
  // Cancelled plans don't count; none left = nothing to renew.
  assert.equal(renewalOffer([plan("P1", "2026-10-01", "2026-10-25", "cancelled")], today), null);
  assert.equal(renewalOffer([plan("", "2026-09-29", "2026-10-25")], today), null);
  assert.equal(renewalOffer([], today), null);
});

test("close reason: an open link closes when it has nothing left to collect", () => {
  const today = "2026-10-22";
  const bal = {
    kind: "balance" as const,
    status: "open" as const,
    expiresOn: "2026-11-20",
    planSeq: 3,
  };
  const ren = { ...bal, kind: "renewal" as const };
  assert.equal(closeReason(bal, { today, billOwed: 500 }), "");
  assert.equal(closeReason(bal, { today, billOwed: 0 }), "paid");
  assert.equal(closeReason(bal, { today, billOwed: null }), "bill");
  assert.equal(
    closeReason({ ...bal, expiresOn: "2026-10-21" }, { today, billOwed: 500 }),
    "expired",
  );
  assert.equal(closeReason(ren, { today, packageSold: true, planSeq: 3 }), "");
  assert.equal(closeReason(ren, { today, packageSold: false, planSeq: 3 }), "package");
  assert.equal(closeReason(ren, { today, packageSold: true, planSeq: 4 }), "changed");
  // Waiting for the desk: never closed by itself, never expires.
  assert.equal(
    closeReason({ ...bal, status: "member_paid", expiresOn: "2026-01-01" }, { today, billOwed: 0 }),
    "",
  );
  assert.equal(closeReason({ ...bal, status: "confirmed" }, { today, billOwed: 0 }), "");
});

test("addDaysIso", () => {
  assert.equal(addDaysIso("2026-10-22", 30), "2026-11-21");
  assert.equal(addDaysIso("2026-12-31", 1), "2027-01-01");
});
