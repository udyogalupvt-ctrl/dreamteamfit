import {
  addDoc,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  writeBatch,
  type DocumentData,
} from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { callServer } from "@/lib/server-api";
import type { DayMark, DayMarkDoc } from "@/lib/staff-salary";
import type {
  BiometricDevice,
  ExpensePaymentMethod,
  IncentiveType,
  StaffPayment,
  StaffPaymentKind,
  Staff,
  StaffAccess,
  StaffAttendanceEvent,
  StaffFeature,
  StaffPrivate,
} from "@/types/models";
import { col, COLLECTIONS, subscribeCollection, toDate } from "./firestore.service";

export const mapStaff = (id: string, d: DocumentData): Staff => ({
  id,
  name: d["name"] ?? "",
  phone: d["phone"] ?? "",
  role: d["role"] ?? "",
  joiningDate: d["joiningDate"] ?? "",
  active: d["active"] !== false,
  isCounsellor: Boolean(d["isCounsellor"]),
  biometricUserId: d["biometricUserId"] ?? "",
  biometricDeviceId: d["biometricDeviceId"] ?? "",
  firstThumbRegistered: Boolean(d["firstThumbRegistered"]),
  loginUid: d["loginUid"] ?? "",
  loginEmail: d["loginEmail"] ?? "",
  createdAt: toDate(d["createdAt"]),
  updatedAt: toDate(d["updatedAt"]),
});

export const subscribeStaff = (ok: (x: Staff[]) => void, fail: (e: Error) => void) =>
  subscribeCollection(COLLECTIONS.staff, mapStaff, ok, fail, orderBy("createdAt", "asc"));

export type StaffInput = Pick<
  Staff,
  "name" | "phone" | "role" | "joiningDate" | "active" | "isCounsellor"
>;

export async function saveStaff(input: StaffInput, id?: string) {
  const data = {
    ...input,
    name: input.name.trim(),
    phone: input.phone.trim(),
    updatedAt: serverTimestamp(),
  };
  if (id) {
    await setDoc(doc(db, COLLECTIONS.staff, id), data, { merge: true });
    return id;
  }
  const ref = await addDoc(col(COLLECTIONS.staff), {
    ...data,
    biometricUserId: "",
    biometricDeviceId: "",
    firstThumbRegistered: false,
    loginUid: "",
    loginEmail: "",
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

// ------------------------------------------------------------------ pay details (finance only)

export const mapStaffPrivate = (id: string, d: DocumentData | undefined): StaffPrivate => ({
  staffId: id,
  monthlySalary: Number(d?.["monthlySalary"] ?? 0),
  incentiveType: (d?.["incentiveType"] as IncentiveType) ?? "none",
  incentiveValue: Number(d?.["incentiveValue"] ?? 0),
});

export async function getStaffPrivate(staffId: string) {
  return mapStaffPrivate(
    staffId,
    (await getDoc(doc(db, COLLECTIONS.staffPrivate, staffId))).data(),
  );
}

export const subscribeStaffPrivate = (ok: (x: StaffPrivate[]) => void, fail: (e: Error) => void) =>
  onSnapshot(
    col(COLLECTIONS.staffPrivate),
    (s) => ok(s.docs.map((d) => mapStaffPrivate(d.id, d.data()))),
    fail,
  );

export async function saveStaffPrivate(p: StaffPrivate) {
  await setDoc(
    doc(db, COLLECTIONS.staffPrivate, p.staffId),
    {
      monthlySalary: Math.max(0, p.monthlySalary),
      incentiveType: p.incentiveType,
      incentiveValue: Math.max(0, p.incentiveValue),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

// ------------------------------------------------------------------ logins (owner only, server)

export const subscribeStaffAccess = (ok: (x: StaffAccess[]) => void, fail: (e: Error) => void) =>
  onSnapshot(
    col(COLLECTIONS.staffAccess),
    (s) =>
      ok(
        s.docs.map((d) => ({
          uid: d.id,
          staffId: String(d.data()["staffId"] ?? ""),
          name: String(d.data()["name"] ?? ""),
          email: String(d.data()["email"] ?? ""),
          active: d.data()["active"] === true,
          admin: d.data()["admin"] === true,
          permissions: (d.data()["permissions"] ?? []) as StaffFeature[],
        })),
      ),
    fail,
  );

export const createStaffLogin = (input: {
  staffId: string;
  email: string;
  password: string;
  admin: boolean;
  permissions: StaffFeature[];
}) => callServer<{ uid: string }>("/api/staff/create-login", input);

export const updateStaffLogin = (input: {
  staffId: string;
  admin?: boolean;
  permissions?: StaffFeature[];
  active?: boolean;
  password?: string;
}) => callServer<{ ok: true }>("/api/staff/update-login", input);

// ------------------------------------------------------------------ thumb on the fingerprint device

/** Staff IDs on the device start at 9001, so they never clash with member IDs. */
export async function suggestStaffBiometricId() {
  const snap = await getDocs(col(COLLECTIONS.staff));
  const max = snap.docs.reduce(
    (n, d) => Math.max(n, Number.parseInt(String(d.data()["biometricUserId"] ?? ""), 10) || 0),
    9000,
  );
  return String(max + 1);
}

const deviceName = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24) || "Staff";

/** Sends "add user + enroll thumb" to the device for a staff member. */
export async function requestStaffFingerprint(staff: Staff, device: BiometricDevice, pin: string) {
  pin = pin.trim();
  if (!/^\d{1,9}$/.test(pin)) throw new Error("Biometric ID must be a number (up to 9 digits).");
  if (device.integrationType !== "adms" || !device.serialNumber)
    throw new Error("Staff thumbs need a cloud (ADMS) fingerprint device with its serial number.");
  const [members, others] = await Promise.all([
    getDocs(query(col(COLLECTIONS.clients), where("biometricUserId", "==", pin))),
    getDocs(query(col(COLLECTIONS.staff), where("biometricUserId", "==", pin))),
  ]);
  if (!members.empty || others.docs.some((d) => d.id !== staff.id))
    throw new Error(`ID ${pin} is already used on the device. Pick another number.`);
  const earlier = await getDocs(
    query(col(COLLECTIONS.biometricCommands), where("staffId", "==", staff.id)),
  );
  const batch = writeBatch(db);
  const now = serverTimestamp();
  earlier.docs
    .filter((d) => d.data()["status"] === "pending")
    .forEach((d) => batch.update(d.ref, { status: "cancelled", updatedAt: now }));
  batch.update(doc(db, COLLECTIONS.staff, staff.id), {
    biometricUserId: pin,
    biometricDeviceId: device.id,
    firstThumbRegistered: false,
    updatedAt: now,
  });
  const base = {
    deviceId: device.id,
    serialNumber: device.serialNumber,
    clientId: "",
    staffId: staff.id,
    enrollmentId: null,
    biometricUserId: pin,
    status: "pending",
    door: false,
    cmdNo: null,
    returnCode: null,
    error: "",
    sentAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  batch.set(doc(col(COLLECTIONS.biometricCommands)), {
    ...base,
    type: "user_upsert",
    order: 1,
    command: `DATA UPDATE USERINFO PIN=${pin}\tName=${deviceName(staff.name)}\tPri=0\tPasswd=\tCard=\tGrp=1\tTZ=0000000100000000\tVerify=0`,
  });
  batch.set(doc(col(COLLECTIONS.biometricCommands)), {
    ...base,
    type: "enroll_fp",
    order: 2,
    command: `ENROLL_FP PIN=${pin}\tFID=5\tRETRY=3\tOVERWRITE=1`,
  });
  await batch.commit();
}

/** Latest device command states for one staff member (for the live thumb panel). */
export const subscribeStaffCommands = (
  staffId: string,
  ok: (x: { type: string; status: string; error: string; createdAt: Date }[]) => void,
  fail: (e: Error) => void,
) =>
  onSnapshot(
    query(col(COLLECTIONS.biometricCommands), where("staffId", "==", staffId)),
    (s) =>
      ok(
        s.docs
          .map((d) => ({
            type: String(d.data()["type"] ?? ""),
            status: String(d.data()["status"] ?? ""),
            error: String(d.data()["error"] ?? ""),
            createdAt: toDate(d.data()["createdAt"]),
          }))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      ),
    fail,
  );

// ------------------------------------------------------------------ staff attendance

export const mapStaffAttendance = (id: string, d: DocumentData): StaffAttendanceEvent => ({
  id,
  staffId: d["staffId"] ?? "",
  staffNameSnapshot: d["staffNameSnapshot"] ?? "",
  attendanceDate: d["attendanceDate"] ?? "",
  timestamp: toDate(d["timestamp"]),
  eventType: d["eventType"] === "check_out" ? "check_out" : "check_in",
  source: d["source"] === "manual" ? "manual" : "biometric",
  deviceId: d["deviceId"] ?? "",
  createdAt: toDate(d["createdAt"]),
  updatedAt: toDate(d["updatedAt"]),
});

export const subscribeStaffAttendance = (
  ok: (x: StaffAttendanceEvent[]) => void,
  fail: (e: Error) => void,
) =>
  subscribeCollection(
    COLLECTIONS.staffAttendance,
    mapStaffAttendance,
    ok,
    fail,
    orderBy("timestamp", "desc"),
  );

/** For days the device was off, or a staff member without a thumb yet. */
export async function markStaffAttendance(
  staff: Pick<Staff, "id" | "name">,
  date: string,
  time: string,
  eventType: "check_in" | "check_out",
) {
  await addDoc(col(COLLECTIONS.staffAttendance), {
    staffId: staff.id,
    staffNameSnapshot: staff.name,
    attendanceDate: date,
    timestamp: Timestamp.fromDate(new Date(`${date}T${time}:00+05:30`)),
    eventType,
    source: "manual",
    deviceId: "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// ------------------------------------------------------------------ salaries & incentives

export const mapStaffPayment = (id: string, d: DocumentData): StaffPayment => ({
  id,
  staffId: d["staffId"] ?? "",
  staffNameSnapshot: d["staffNameSnapshot"] ?? "",
  kind: d["kind"] === "incentive" ? "incentive" : "salary",
  period: d["period"] ?? "",
  amount: Number(d["amount"] ?? 0),
  method: d["method"] ?? "Cash",
  date: d["date"] ?? "",
  expenseId: d["expenseId"] ?? "",
  notes: d["notes"] ?? "",
  createdBy: d["createdBy"] ?? "",
  createdAt: toDate(d["createdAt"]),
  updatedAt: toDate(d["updatedAt"]),
});

export const subscribeStaffPayments = (ok: (x: StaffPayment[]) => void, fail: (e: Error) => void) =>
  subscribeCollection(
    COLLECTIONS.staffPayments,
    mapStaffPayment,
    ok,
    fail,
    orderBy("date", "desc"),
  );

/**
 * Pays a salary or incentive: one staff-pay record plus the matching expense (category
 * "Staff Salary" or "Incentive"), saved together so profit and the cash book stay right.
 */
export async function payStaff(input: {
  staff: Pick<Staff, "id" | "name">;
  kind: StaffPaymentKind;
  period: string;
  periodLabel: string;
  amount: number;
  method: ExpensePaymentMethod;
  date: string;
  notes: string;
  by: { uid: string; name: string };
}) {
  if (!(input.amount > 0)) throw new Error("Enter an amount greater than zero.");
  const batch = writeBatch(db);
  const now = serverTimestamp();
  const expenseRef = doc(col(COLLECTIONS.expenses));
  const title = `${input.kind === "salary" ? "Salary" : "Incentive"} · ${input.staff.name} · ${input.periodLabel}`;
  batch.set(expenseRef, {
    title,
    category: input.kind === "salary" ? "Staff Salary" : "Incentive",
    amount: input.amount,
    paymentMethod: input.method,
    date: input.date,
    description: "",
    notes: input.notes,
    paidBy: "Gym",
    settled: true,
    settledDate: "",
    settledMethod: "",
    createdBy: input.by.name,
    createdByUid: input.by.uid,
    createdAt: now,
    updatedAt: now,
  });
  batch.set(doc(col(COLLECTIONS.expenseActivities)), {
    expenseId: expenseRef.id,
    expenseTitleSnapshot: title,
    action: "created",
    createdBy: input.by.name,
    createdAt: now,
  });
  batch.set(doc(col(COLLECTIONS.staffPayments)), {
    staffId: input.staff.id,
    staffNameSnapshot: input.staff.name,
    kind: input.kind,
    period: input.period,
    amount: input.amount,
    method: input.method,
    date: input.date,
    expenseId: expenseRef.id,
    notes: input.notes,
    createdBy: input.by.name,
    createdAt: now,
    updatedAt: now,
  });
  await batch.commit();
}

// ------------------------------------------------------------------ day marks & paid leaves

export const subscribeDayMarks = (ok: (x: DayMarkDoc[]) => void, fail: (e: Error) => void) =>
  onSnapshot(
    col(COLLECTIONS.staffDayMarks),
    (s) =>
      ok(
        s.docs.map((d) => ({
          staffId: String(d.data()["staffId"] ?? ""),
          date: String(d.data()["date"] ?? ""),
          status: d.data()["status"] as DayMark,
        })),
      ),
    fail,
  );

/** Admin / receptionist sets a day (present, half day, absent, paid leave), or "auto" to follow the thumb. */
export async function setDayMark(
  staff: Pick<Staff, "id" | "name">,
  date: string,
  status: DayMark | "auto",
  by: string,
) {
  const ref = doc(db, COLLECTIONS.staffDayMarks, `${staff.id}_${date}`);
  if (status === "auto") {
    await deleteDoc(ref);
    return;
  }
  await setDoc(ref, {
    staffId: staff.id,
    staffNameSnapshot: staff.name,
    date,
    status,
    by,
    updatedAt: serverTimestamp(),
  });
}

/** Paid leaves allowed for one staff member in one month ("2026-09"); 0 unless the owner adds them. */
export const subscribePaidLeaves = (
  ok: (x: Record<string, number>) => void,
  fail: (e: Error) => void,
) =>
  onSnapshot(
    col(COLLECTIONS.staffPayroll),
    (s) => ok(Object.fromEntries(s.docs.map((d) => [d.id, Number(d.data()["paidLeaves"] ?? 0)]))),
    fail,
  );

export async function setPaidLeaves(staffId: string, period: string, paidLeaves: number) {
  await setDoc(
    doc(db, COLLECTIONS.staffPayroll, `${staffId}_${period}`),
    {
      staffId,
      period,
      paidLeaves: Math.max(0, Math.floor(paidLeaves)),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}
