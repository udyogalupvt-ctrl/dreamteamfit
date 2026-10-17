import assert from "node:assert/strict";
import { test } from "node:test";
import { commandOk, pinOk } from "./biometric-guard.ts";

const UPSERT = (pin: string, name = "Ravi K") =>
  `DATA UPDATE USERINFO PIN=${pin}\tName=${name}\tPri=0\tPasswd=\tCard=\tGrp=1\tTZ=0000000100000000\tVerify=0`;

test("pinOk: letters and digits, 1-24 (old machine IDs like IIFM12)", () => {
  assert.equal(pinOk("12"), true);
  assert.equal(pinOk("IIFM12"), true);
  assert.equal(pinOk("A".repeat(24)), true);
  assert.equal(pinOk("A".repeat(25)), false);
  assert.equal(pinOk(""), false);
  assert.equal(pinOk("1\nC:9:CLEAR DATA"), false);
  assert.equal(pinOk("1\tPri=14"), false);
  assert.equal(pinOk("1 2"), false);
});

test("commandOk: nothing with a line break reaches the machine", () => {
  assert.equal(commandOk({ type: "delete_user", command: "DATA DELETE USERINFO PIN=5" }), true);
  assert.equal(
    commandOk({ type: "delete_user", command: "DATA DELETE USERINFO PIN=5\r\nC:9:CLEAR DATA" }),
    false,
  );
  assert.equal(commandOk({ type: "query_fp", command: "DATA QUERY FINGERTMP PIN=5\nCLEAR DATA" }), false);
  assert.equal(commandOk({ type: "restore_fp", command: "DATA UPDATE FINGERTMP PIN=5\tFID=0" }), true);
});

test("commandOk: a user record is exactly the app's, for the record's own PIN", () => {
  assert.equal(commandOk({ type: "user_upsert", biometricUserId: "12", command: UPSERT("12") }), true);
  // the server's door restore for an old-software ID
  assert.equal(
    commandOk({ type: "user_upsert", biometricUserId: "IIFM12", command: UPSERT("IIFM12") }),
    true,
  );
  assert.equal(commandOk({ type: "user_upsert", biometricUserId: "12", command: "CLEAR DATA" }), false);
  assert.equal(commandOk({ type: "user_upsert", biometricUserId: "12", command: UPSERT("13") }), false);
  assert.equal(
    commandOk({ type: "user_upsert", biometricUserId: "12", command: UPSERT("12").replace("Pri=0", "Pri=14") }),
    false,
  );
  assert.equal(
    commandOk({ type: "user_upsert", biometricUserId: "12", command: UPSERT("12", "A\tPri=14") }),
    false,
  );
  assert.equal(commandOk({ type: "user_upsert", biometricUserId: "1 2", command: UPSERT("1 2") }), false);
  assert.equal(commandOk({ type: "user_upsert", command: UPSERT("12") }), false);
});

test("commandOk: thumb registration in either of the machine's two forms", () => {
  assert.equal(
    commandOk({ type: "enroll_fp", biometricUserId: "12", command: "ENROLL_FP PIN=12\tFID=5\tRETRY=3\tOVERWRITE=1" }),
    true,
  );
  assert.equal(
    commandOk({ type: "enroll_fp", biometricUserId: "12", command: "ENROLL_BIO TYPE=1\tPIN=12\tRETRY=3\tOVERWRITE=1" }),
    true,
  );
  assert.equal(
    commandOk({ type: "enroll_fp", biometricUserId: "12", command: "ENROLL_FP PIN=13\tFID=5\tRETRY=3\tOVERWRITE=1" }),
    false,
  );
  assert.equal(commandOk({ type: "enroll_fp", biometricUserId: "12", command: "CLEAR DATA" }), false);
});
