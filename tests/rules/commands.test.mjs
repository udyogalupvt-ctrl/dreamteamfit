// S3: a staff login may queue only the machine commands the app itself builds.
import { after, before, test } from "node:test";
import { env, seed, LOGINS, staff, owner, assertFails, assertSucceeds } from "./helpers.mjs";

let t;
const UPSERT =
  "DATA UPDATE USERINFO PIN=12\tName=Ravi K\tPri=0\tPasswd=\tCard=\tGrp=1\tTZ=0000000100000000\tVerify=0";
const ENROLL = "ENROLL_FP PIN=12\tFID=5\tRETRY=3\tOVERWRITE=1";
const cmd = (extra) => ({
  type: "user_upsert",
  clientId: "c1",
  staffId: "",
  deviceId: "d1",
  serialNumber: "SN1",
  enrollmentId: null,
  biometricUserId: "12",
  command: UPSERT,
  order: 1,
  status: "pending",
  cmdNo: null,
  returnCode: null,
  error: "",
  sentAt: null,
  completedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...extra,
});
const note = (type, extra = {}) =>
  cmd({ type, command: "", biometricUserId: "", order: 0, door: true, ...extra });

before(async () => {
  t = await env();
  await seed(t, {
    ...LOGINS,
    "biometricCommands/p1": cmd({ status: "pending" }),
    "biometricCommands/s1": cmd({ status: "sent" }),
    "biometricCommands/x1": cmd({ status: "cancelled" }),
    "biometricCommands/d1": cmd({ status: "done" }),
  });
});
after(() => t.cleanup());

const add = (db, data) => db.collection("biometricCommands").doc().set(data);

test("raw machine commands are refused", async () => {
  const desk = staff(t, "desk");
  await assertFails(add(desk, cmd({ command: "CLEAR DATA" })));
  await assertFails(add(desk, cmd({ command: UPSERT.replace("Pri=0", "Pri=14") })));
  await assertFails(add(desk, cmd({ command: UPSERT + "\nC:9:CLEAR DATA" })));
  await assertFails(add(desk, cmd({ type: "delete_user", command: "DATA DELETE USERINFO PIN=5" })));
  await assertFails(add(owner(t), cmd({ command: "CLEAR DATA" })));
});

test("the app's own registration commands are accepted", async () => {
  const desk = staff(t, "desk");
  await assertSucceeds(add(desk, cmd({})));
  await assertSucceeds(add(desk, cmd({ type: "enroll_fp", order: 2, command: ENROLL })));
  await assertSucceeds(add(desk, cmd({ command: UPSERT.replace("Ravi K", "") })));
  await assertSucceeds(add(desk, cmd({ command: UPSERT.replace("Ravi K", "A".repeat(24)) })));
});

test("a command's PIN must be the member's own", async () => {
  const desk = staff(t, "desk");
  await assertFails(add(desk, cmd({ type: "enroll_fp", command: ENROLL.replace("PIN=12", "PIN=13") })));
  await assertFails(add(desk, cmd({ command: UPSERT.replace("PIN=12", "PIN=13") })));
  await assertFails(add(desk, cmd({ biometricUserId: "IIFM12", command: UPSERT.replace("12", "IIFM12") })));
  await assertFails(add(desk, cmd({ status: "sent" })));
});

test("door notes carry no command and a clean machine ID", async () => {
  const desk = staff(t, "desk");
  await assertSucceeds(add(desk, note("door_check")));
  await assertSucceeds(add(desk, note("photo_sync")));
  await assertSucceeds(add(desk, note("forget", { biometricUserId: "IIFM12" })));
  await assertSucceeds(add(desk, note("bin_off", { biometricUserId: "12" })));
  await assertSucceeds(add(desk, note("staff_off", { biometricUserId: "7", staffId: "s1" })));
  await assertFails(add(desk, note("forget", { biometricUserId: "1\nC:9:CLEAR DATA" })));
  await assertFails(add(desk, note("forget", { biometricUserId: "1 2" })));
  await assertFails(add(desk, note("door_check", { command: "CLEAR DATA" })));
  await assertFails(add(desk, note("users_gone")));
});

test("a waiting command may only be withdrawn", async () => {
  const desk = staff(t, "desk");
  const at = new Date();
  await assertSucceeds(desk.doc("biometricCommands/p1").update({ status: "cancelled", updatedAt: at }));
  await assertSucceeds(desk.doc("biometricCommands/s1").update({ status: "cancelled", updatedAt: at }));
  await assertFails(desk.doc("biometricCommands/x1").update({ status: "pending", updatedAt: at }));
  await assertFails(desk.doc("biometricCommands/d1").update({ status: "cancelled", updatedAt: at }));
  await seed(t, { "biometricCommands/p2": cmd({}) });
  await assertFails(desk.doc("biometricCommands/p2").update({ command: "CLEAR DATA" }));
  await assertFails(
    desk.doc("biometricCommands/p2").update({ status: "cancelled", command: "CLEAR DATA" }),
  );
});

test("deleting a command needs Delete members or Devices", async () => {
  await seed(t, { "biometricCommands/z1": cmd({}), "biometricCommands/z2": cmd({}) });
  await assertFails(staff(t, "desk").doc("biometricCommands/z1").delete());
  await assertSucceeds(staff(t, "delmem").doc("biometricCommands/z1").delete());
  await assertSucceeds(staff(t, "dev").doc("biometricCommands/z2").delete());
});

test("staff still read commands (live thumb panel)", async () => {
  await assertSucceeds(staff(t, "desk").doc("biometricCommands/p1").get());
  await assertSucceeds(
    staff(t, "desk").collection("biometricCommands").where("clientId", "==", "c1").get(),
  );
});
