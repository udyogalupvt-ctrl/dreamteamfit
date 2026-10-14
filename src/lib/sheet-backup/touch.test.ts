import assert from "node:assert/strict";
import { test } from "node:test";
import { createToucher, MAX_PATHS, watchedPaths } from "./touch.ts";

function fakeTimers() {
  const queue: { fn: () => void; ms: number; live: boolean }[] = [];
  return {
    queue,
    timers: {
      set: (fn: () => void, ms: number) => {
        const t = { fn, ms, live: true };
        queue.push(t);
        return t;
      },
      clear: (h: unknown) => {
        (h as { live: boolean }).live = false;
      },
    },
    fire: () =>
      queue
        .filter((t) => t.live)
        .forEach((t) => {
          t.live = false;
          t.fn();
        }),
  };
}

test("only watched collections, only document paths", () => {
  assert.deepEqual(
    watchedPaths([
      "payments/a",
      "auditLogs/x",
      "biometricCommands/y",
      "clients/c1",
      "payments",
      "payments/a/sub/b",
      "payments/",
      "serverSecrets/sheetBackup",
    ]),
    ["payments/a", "clients/c1"],
  );
});

test("writes to unwatched collections never start a timer", () => {
  const f = fakeTimers();
  const t = createToucher({
    delayMs: () => 5,
    canSend: () => true,
    send: () => undefined,
    timers: f.timers,
  });
  t.note(["auditLogs/1", "whatsappChats/2"]);
  assert.equal(f.queue.length, 0);
  assert.equal(t.pendingCount(), 0);
});

test("changes go in one send after the delay, duplicates once, later ones do not push it back", () => {
  const f = fakeTimers();
  const sent: string[][] = [];
  const t = createToucher({
    delayMs: () => 60_000,
    canSend: () => true,
    send: (p) => void sent.push(p),
    timers: f.timers,
  });
  t.note(["payments/a", "auditLogs/z"]);
  t.note(["payments/a", "invoices/b"]);
  assert.equal(f.queue.length, 1, "one timer");
  assert.equal(f.queue[0]!.ms, 60_000);
  assert.equal(sent.length, 0, "nothing sent before the delay");
  f.fire();
  assert.deepEqual(sent, [["payments/a", "invoices/b"]]);
  t.note(["clients/c"]);
  assert.equal(f.queue.length, 2, "a new wait starts after a send");
});

test("flush sends at once with keepalive and cancels the timer", () => {
  const f = fakeTimers();
  const calls: [string[], boolean][] = [];
  const t = createToucher({
    delayMs: () => 60_000,
    canSend: () => true,
    send: (p, k) => void calls.push([p, k]),
    timers: f.timers,
  });
  t.note(["expenses/e"]);
  t.flush(true);
  assert.deepEqual(calls, [[["expenses/e"], true]]);
  f.fire();
  assert.equal(calls.length, 1, "the cancelled timer does not send again");
  t.flush(true);
  assert.equal(calls.length, 1, "nothing left to flush");
});

test("nobody signed in: nothing is sent", () => {
  const f = fakeTimers();
  let n = 0;
  const t = createToucher({
    delayMs: () => 1,
    canSend: () => false,
    send: () => void n++,
    timers: f.timers,
  });
  t.note(["payments/a"]);
  f.fire();
  assert.equal(n, 0);
});

test("more than 200 paths go in several calls of at most 200", () => {
  const f = fakeTimers();
  const sizes: number[] = [];
  const t = createToucher({
    delayMs: () => 1,
    canSend: () => true,
    send: (p) => void sizes.push(p.length),
    timers: f.timers,
  });
  t.note(Array.from({ length: MAX_PATHS * 2 + 5 }, (_, i) => `payments/p${i}`));
  f.fire();
  assert.deepEqual(sizes, [200, 200, 5]);
});

test("a throwing or rejecting send and a throwing delay never escape", async () => {
  const f = fakeTimers();
  const t = createToucher({
    delayMs: () => {
      throw new Error("no clock");
    },
    canSend: () => true,
    send: () => Promise.reject(new Error("offline")),
    timers: f.timers,
  });
  assert.doesNotThrow(() => t.note(["payments/a"]));
  assert.equal(f.queue[0]!.ms, 60_000, "falls back to 60 s");
  assert.doesNotThrow(() => f.fire());
  const t2 = createToucher({
    delayMs: () => 1,
    canSend: () => true,
    send: () => {
      throw new Error("sync boom");
    },
    timers: f.timers,
  });
  t2.note(["payments/b"]);
  assert.doesNotThrow(() => f.fire());
  await new Promise((r) => setTimeout(r, 5)); // an unhandled rejection would fail the run
});
