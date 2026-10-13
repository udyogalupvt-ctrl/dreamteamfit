import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CELL_LIMIT,
  decodeValue,
  EXCLUDED_COLLECTIONS,
  encodeValue,
  recordToRow,
  rowToRecord,
} from "./restore-codec.ts";

// Stand-ins for the firebase-admin constructors (the real script passes the real ones).
class FakeTs {
  d: Date;
  constructor(d: Date) {
    this.d = d;
  }
  toDate() {
    return this.d;
  }
}
const make = {
  ts: (d: Date) => new FakeTs(d),
  geo: (lat: number, lng: number) => ({ latitude: lat, longitude: lng, isEqual: () => true }),
  ref: (path: string) => ({ path, firestore: {} }),
  bytes: (b64: string) => Buffer.from(b64, "base64"),
};

test("a document with nested Timestamps, arrays, nulls and numbers round-trips exactly", () => {
  const when = new Date("2026-10-13T10:00:00Z");
  const doc = {
    name: "Asha Rao",
    amount: 1999.5,
    zero: 0,
    nothing: null,
    flag: false,
    createdAt: { toDate: () => when },
    nested: { list: [1, "two", null, { at: { _seconds: 1760349600, _nanoseconds: 0 } }] },
    place: { latitude: 17.4, longitude: 78.5, isEqual: () => true },
    owner: { path: "clients/c1", firestore: {} },
    raw: Buffer.from("hello"),
    weird: [Number.NaN, Number.POSITIVE_INFINITY],
  };
  const row = recordToRow("p1", doc);
  assert.equal(row[0], "p1");
  assert.equal(row[1], "2026-10-13T10:00:00.000Z");
  const back = rowToRecord(row);
  assert.equal(back.id, "p1");
  const data = decodeValue(back.data, make) as Record<string, unknown>;
  assert.equal((data["createdAt"] as FakeTs).toDate().toISOString(), when.toISOString());
  assert.equal(data["name"], "Asha Rao");
  assert.equal(data["amount"], 1999.5);
  assert.equal(data["zero"], 0);
  assert.equal(data["nothing"], null);
  assert.equal(data["flag"], false);
  const list = (data["nested"] as { list: unknown[] }).list;
  assert.deepEqual(list.slice(0, 3), [1, "two", null]);
  assert.equal(((list[3] as { at: FakeTs }).at).toDate().toISOString(), "2025-10-13T10:00:00.000Z");
  assert.deepEqual((data["place"] as { latitude: number; longitude: number }).latitude, 17.4);
  assert.equal((data["owner"] as { path: string }).path, "clients/c1");
  assert.equal((data["raw"] as Buffer).toString(), "hello");
  const weird = data["weird"] as number[];
  assert.ok(Number.isNaN(weird[0]));
  assert.equal(weird[1], Number.POSITIVE_INFINITY);
});

test("encodeValue uses the tagged JSON shapes and drops undefined", () => {
  assert.deepEqual(encodeValue({ toDate: () => new Date("2026-01-02T03:04:05Z") }), { __ts: "2026-01-02T03:04:05.000Z" });
  assert.deepEqual(encodeValue(new Date("2026-01-02T03:04:05Z")), { __ts: "2026-01-02T03:04:05.000Z" });
  assert.deepEqual(encodeValue({ a: 1, b: undefined }), { a: 1 });
  assert.deepEqual(encodeValue({ path: "x/y", firestore: {} }), { __ref: "x/y" });
  assert.deepEqual(encodeValue(Buffer.from("hi")), { __b64: "aGk=" });
});

test("a 120,000-character value splits into 3 chunks and joins back exactly", () => {
  const big = "x".repeat(120_000);
  const row = recordToRow("big", { note: big });
  assert.equal(row.length, 2 + 3);
  for (const chunk of row.slice(2)) assert.ok(chunk.length <= CELL_LIMIT);
  assert.equal((rowToRecord(row).data as { note: string }).note, big);
});

test("chunks never split an emoji (surrogate pair) in two", () => {
  const text = "a" + "😀".repeat(CELL_LIMIT); // the first cut would land inside a pair
  const row = recordToRow("emoji", { text });
  for (const chunk of row.slice(2)) {
    assert.ok(chunk.length <= CELL_LIMIT);
    const last = chunk.charCodeAt(chunk.length - 1);
    assert.ok(!(last >= 0xd800 && last <= 0xdbff), "chunk ends in a lone high surrogate");
  }
  assert.equal((rowToRecord(row).data as { text: string }).text, text);
});

test("rowToRecord names the id when the JSON is broken", () => {
  assert.throws(() => rowToRecord(["bad-1", "", '{"a":']), /bad-1/);
});

test("EXCLUDED_COLLECTIONS keeps secrets and logs out of the sheet", () => {
  for (const c of ["serverSecrets", "loginVault", "staffPrivate", "auditLogs"]) assert.ok(EXCLUDED_COLLECTIONS.has(c), c);
  assert.ok(!EXCLUDED_COLLECTIONS.has("payments"));
  assert.ok(!EXCLUDED_COLLECTIONS.has("clients"));
});
