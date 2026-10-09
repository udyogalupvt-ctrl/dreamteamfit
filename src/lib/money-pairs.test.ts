import assert from "node:assert/strict";
import { test } from "node:test";
import { foldTakenBack, type PairRow } from "./money-pairs.ts";

const at = (h: number, m = 0) => new Date(2026, 9, 9, h, m);
const row = (o: Partial<PairRow> & Pick<PairRow, "id">): PairRow => ({
  clientId: "c1",
  amount: 5000,
  method: "Cash",
  kind: "initial",
  bill: "RF-1",
  at: at(9),
  ...o,
});

test("the screenshot's day: Sri Devi's cash paid and given back fold away; Sai Ram's UPI in, cash out stay", () => {
  const rows = [
    row({
      id: "hrudai",
      clientId: "h",
      amount: 1800,
      method: "UPI",
      bill: "RF-88",
      at: at(10, 49),
    }),
    row({
      id: "sai-back",
      clientId: "s",
      amount: -5000,
      kind: "refund",
      bill: "RF-81",
      at: at(10, 20),
    }),
    row({
      id: "sri-back",
      clientId: "d",
      amount: -10000,
      kind: "refund",
      bill: "RF-82",
      at: at(9, 58),
    }),
    row({ id: "sri", clientId: "d", amount: 10000, bill: "RF-82", at: at(8, 47) }),
    row({
      id: "sai",
      clientId: "s",
      amount: 5000,
      method: "UPI",
      kind: "balance",
      bill: "RF-81",
      at: at(8),
    }),
  ];
  const r = foldTakenBack(rows);
  assert.deepEqual(
    r.shown.map((x) => x.id),
    ["hrudai", "sai-back", "sai"],
  );
  assert.deepEqual(
    r.folded.map(([a, b]) => [a.id, b.id]),
    [["sri", "sri-back"]],
  );
  // Totals unchanged: the folded pair adds up to 0.
  const sum = (xs: PairRow[]) => xs.reduce((n, x) => n + x.amount, 0);
  assert.equal(sum(r.shown), sum(rows));
});

test("only an equal amount, same member, and a payment made before the refund", () => {
  const r = foldTakenBack([
    row({ id: "p", amount: 4000 }),
    row({ id: "other", clientId: "c2" }),
    row({ id: "later", at: at(12) }),
    row({ id: "back", amount: -5000, kind: "refund", at: at(11) }),
  ]);
  assert.equal(r.folded.length, 0);
});

test("two payments, one refund: the same bill's payment is the one folded", () => {
  const r = foldTakenBack([
    row({ id: "a", bill: "RF-1", at: at(8) }),
    row({ id: "b", bill: "RF-2", at: at(9) }),
    row({ id: "back", amount: -5000, kind: "refund", bill: "RF-1", at: at(10) }),
  ]);
  assert.deepEqual(
    r.folded.map(([a]) => a.id),
    ["a"],
  );
  assert.deepEqual(
    r.shown.map((x) => x.id),
    ["b"],
  );
});

test("old-software money is never paired with a refund here", () => {
  const r = foldTakenBack([
    row({ id: "old", kind: "old" }),
    row({ id: "back", amount: -5000, kind: "refund", at: at(10) }),
  ]);
  assert.equal(r.folded.length, 0);
});
