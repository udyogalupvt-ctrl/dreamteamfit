/**
 * Member app and trainer app (see src/constants/portal.ts).
 *
 *   GET  /api/portal/hello?kind=member|trainer&code=…  no login: first name + gym for the sign-in page
 *   GET  /api/portal/manifest/m|t/<code>               no login: that link's installable app
 *   GET  /api/portal/me                                 member / trainer login: what their app shows
 *   GET  /api/portal/trainer-member?clientId=…          trainer: one of their PT members
 *   POST /api/portal/trainer-assign                     trainer: give a PT member a personal plan
 *   POST /api/portal/member-access { clientId, action } staff: ensure | reset | off | on | delete
 *   POST /api/portal/trainer-access { trainerId, action, password? }
 *                                                       owner: create | password | off | on | reveal
 *
 * Members and trainers never read gym collections directly: the server picks the fields they
 * may see (no staff notes, no trainer share amounts, nobody else's records). Only chat and the
 * member's own ticks go straight to Firestore, locked down in firestore.rules.
 */
import { randomInt } from "node:crypto";
import { FieldValue, type DocumentData, type DocumentSnapshot } from "firebase-admin/firestore";
import type { DecodedIdToken } from "firebase-admin/auth";
import { CALL_OUTCOME_OPTIONS } from "@/constants/call-outcomes";
import { isOwnerEmail } from "@/constants/owners";
import {
  MAX_WORKOUT_DAYS,
  PLAN_TEXT_MAX,
  PORTAL_CODE_CHARS,
  dobPassword,
  isPortalCode,
  planLines,
  portalEmail,
  shiftDate,
  type MemberPortalData,
  type PortalDiet,
  type PortalGym,
  type PortalKind,
  type PortalLog,
  type PortalMembership,
  type PortalWorkout,
  type TrainerAssignInput,
  type TrainerCallInput,
  type TrainerCallLead,
  type TrainerCallMember,
  type TrainerCallsData,
  type TrainerMemberDetail,
  type TrainerMemberRow,
  type TrainerPortalData,
} from "@/constants/portal";
import type { WorkoutDay } from "@/types/models";
import { adminAuth, db, json, localDate, requireFeature } from "./admin";
import { oldHistoryFor } from "./old-data";
import { readPassword, savePassword } from "./vault";

type D = DocumentData;
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const n = (v: unknown) => Number(v ?? 0) || 0;

// ------------------------------------------------------------------ helpers

function newCode() {
  let code = "";
  for (let i = 0; i < 12; i++) code += PORTAL_CODE_CHARS[randomInt(PORTAL_CODE_CHARS.length)];
  return code;
}

/** Activity-log line written by the server on someone's behalf. */
async function log(entry: {
  collection: string;
  docId: string;
  summary: string;
  actorName: string;
  actorType?: string;
  clientId?: string;
  clientName?: string;
}) {
  await db()
    .collection("auditLogs")
    .add({
      at: FieldValue.serverTimestamp(),
      action: "updated",
      clientId: entry.clientId ?? "",
      clientName: entry.clientName ?? "",
      collection: entry.collection,
      docId: entry.docId,
      summary: entry.summary,
      actorType: entry.actorType ?? "app_user",
      actorUid: "",
      actorName: entry.actorName,
      changes: {},
    })
    .catch((e) => console.error("audit write failed", String(e)));
}

const staffName = (u: DecodedIdToken) => s(u["name"]) || s(u.email) || "Staff";

/** The member / trainer behind a request, from their app login's claims (code: their link). */
export async function portalUser(request: Request) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const user = await adminAuth()
    .verifyIdToken(token)
    .catch(() => null);
  if (!user) return null;
  const code = s(user.email).split("@")[0]!.slice(2);
  if (user["portal"] === "member" && s(user["clientId"]))
    return { kind: "member" as const, id: s(user["clientId"]), code };
  if (user["portal"] === "trainer" && s(user["trainerId"]))
    return { kind: "trainer" as const, id: s(user["trainerId"]), code };
  return null;
}

async function gymInfo(): Promise<PortalGym> {
  const g = (await db().doc("settings/business").get()).data() ?? {};
  return {
    name: s(g["businessName"]) || "Our gym",
    logoUrl: s(g["logoUrl"]),
    phone: s(g["phone"]),
    address: s(g["address"]),
  };
}

const byClient = (collection: string, clientId: string) =>
  db().collection(collection).where("clientId", "==", clientId).get();

/** Plan status as of today in India (same rules as the app's effectiveMembershipStatus). */
function effective(m: D, today: string) {
  const status = s(m["status"]);
  if (status === "active" && s(m["endDate"]) < today) return "expired";
  if (status === "pending" && s(m["startDate"]) <= today && s(m["endDate"]) >= today)
    return "active";
  if (status === "pending" && s(m["endDate"]) < today) return "expired";
  return status;
}

const cleanDays = (x: unknown): WorkoutDay[] =>
  Array.isArray(x)
    ? x
        .map((d: D) => ({ title: s(d?.["title"]).trim(), exercises: s(d?.["exercises"]) }))
        .filter((d) => d.title || d.exercises.trim())
    : [];

/**
 * Days a member got in, newest first, with the arrival time of each (the first thumb that day:
 * members go out and come back, so later punches don't count). Kept in one small doc per member
 * (memberVisits/{clientId}, written at punch time), so opening the app costs one read instead of
 * one per punch ever. A member without that doc yet gets it built once from their punches.
 */
async function visitDays(clientId: string, since = "") {
  const ref = db().doc(`memberVisits/${clientId}`);
  let times = ((await ref.get()).data()?.["days"] ?? null) as Record<string, string> | null;
  if (!times) {
    const snap = await byClient("attendance", clientId);
    const first = new Map<string, number>();
    for (const d of snap.docs) {
      const a = d.data();
      if (a["accessDecision"] !== "allowed") continue;
      const day = s(a["attendanceDate"]);
      const at = (a["timestamp"] as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
      if (day && at && (!first.has(day) || at < first.get(day)!)) first.set(day, at);
    }
    const clock = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    times = Object.fromEntries([...first].map(([day, at]) => [day, clock.format(new Date(at))]));
    await ref.set(
      { clientId, days: times, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  }
  const days = Object.keys(times)
    .filter((d) => d >= since)
    .sort()
    .reverse();
  return { days, times: Object.fromEntries(days.map((d) => [d, s(times![d])])) };
}

/** The member's current workout and diet plan: gym plans as they are now, personal ones as written. */
async function currentPlans(clientId: string) {
  const [w, dt] = await Promise.all([
    byClient("workoutAssignments", clientId),
    byClient("dietAssignments", clientId),
  ]);
  const latestActive = (docs: DocumentSnapshot[]) =>
    docs
      .filter((d) => d.data()?.["status"] === "active")
      .sort(
        (a, b) =>
          s(b.data()?.["startDate"]).localeCompare(s(a.data()?.["startDate"])) ||
          (b.createTime?.toMillis() ?? 0) - (a.createTime?.toMillis() ?? 0),
      )[0];
  const wa = latestActive(w.docs);
  const da = latestActive(dt.docs);
  let workout: PortalWorkout | null = null;
  let diet: PortalDiet | null = null;
  if (wa) {
    const a = wa.data() ?? {};
    const custom = a["custom"] === true;
    const tpl =
      !custom && s(a["workoutPlanId"])
        ? ((
            await db()
              .doc(`workoutPlans/${s(a["workoutPlanId"])}`)
              .get()
          ).data() ?? {})
        : {};
    workout = {
      assignmentId: wa.id,
      name: s(a["planNameSnapshot"]),
      goal: s(a["goalSnapshot"]),
      description: custom ? s(a["description"]) : s(tpl["description"]),
      notes: s(a["notes"]),
      startDate: s(a["startDate"]),
      endDate: s(a["endDate"]),
      days: cleanDays(custom ? a["days"] : tpl["days"]),
      by: s(a["assignedByName"]) || "Gym",
      custom,
    };
  }
  if (da) {
    const a = da.data() ?? {};
    const custom = a["custom"] === true;
    const tpl =
      !custom && s(a["dietPlanId"])
        ? ((
            await db()
              .doc(`dietPlans/${s(a["dietPlanId"])}`)
              .get()
          ).data() ?? {})
        : {};
    diet = {
      assignmentId: da.id,
      name: s(a["planNameSnapshot"]),
      goal: s(a["goalSnapshot"]),
      calories: n(a["dailyCaloriesSnapshot"]),
      description: custom ? s(a["description"]) : s(tpl["description"]),
      notes: s(a["notes"]),
      meals: custom ? s(a["mealStructure"]) : s(tpl["mealStructure"]),
      startDate: s(a["startDate"]),
      endDate: s(a["endDate"]),
      by: s(a["assignedByName"]) || "Gym",
      custom,
    };
  }
  return { workout, diet };
}

const numList = (x: unknown) =>
  Array.isArray(x) ? x.map(Number).filter((v) => Number.isInteger(v) && v >= 0) : [];

/** The member's ticks for the last `days` days (by document id, so no index is needed). */
async function recentLogs(clientId: string, today: string, days = 14): Promise<PortalLog[]> {
  const refs = Array.from({ length: days }, (_, i) =>
    db().doc(`planLogs/${clientId}_${shiftDate(today, -i)}`),
  );
  const snaps = await db().getAll(...refs);
  return snaps
    .filter((x) => x.exists)
    .map((x) => {
      const d = x.data() ?? {};
      return {
        date: s(d["date"]),
        workoutDay: n(d["workoutDay"]),
        workoutDone: numList(d["workoutDone"]),
        dietDone: numList(d["dietDone"]),
      };
    });
}

/** Active PT of this member (with any trainer), newest end first. */
async function activePt(clientId: string, today: string) {
  const snap = await byClient("ptAssignments", clientId);
  return snap.docs
    .map((d) => d.data())
    .filter((p) => p["status"] === "active" && s(p["endDate"]) >= today)
    .sort((a, b) => s(b["endDate"]).localeCompare(s(a["endDate"])));
}

/** Makes sure the chat of this member points at their current PT trainer. */
async function ensureChat(
  clientId: string,
  clientName: string,
  trainerId: string,
  trainerName: string,
) {
  const ref = db().doc(`chats/${clientId}`);
  const t = await ref.get();
  if (t.exists && t.data()?.["trainerId"] === trainerId) return;
  await ref.set(
    {
      clientId,
      clientName,
      trainerId,
      trainerName,
      ...(t.exists
        ? {}
        : { lastText: "", lastFrom: "", lastAt: null, memberReadAt: null, trainerReadAt: null }),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

// ------------------------------------------------------------------ member app data

async function memberData(clientId: string): Promise<Response> {
  const snap = await db().doc(`clients/${clientId}`).get();
  const c = snap.data();
  if (!c) return json({ error: "This member account no longer exists." }, 404);
  if (c["portalActive"] === false)
    return json({ error: "Your member app is switched off. Please contact the gym." }, 403);
  const today = localDate();
  const [gym, memberships, invoices, payments, pts, visits, plans, logs, oldHistory] =
    await Promise.all([
      gymInfo(),
      byClient("memberships", clientId),
      byClient("invoices", clientId),
      byClient("payments", clientId),
      byClient("ptAssignments", clientId),
      visitDays(clientId),
      currentPlans(clientId),
      recentLogs(clientId, today),
      oldHistoryFor(c).catch(() => null),
    ]);

  const plansList: PortalMembership[] = memberships.docs
    .map((d) => {
      const m = d.data();
      return {
        id: d.id,
        packageName: s(m["packageNameSnapshot"]),
        startDate: s(m["startDate"]),
        endDate: s(m["endDate"]),
        days: n(m["durationDaysSnapshot"]),
        price: n(m["priceSnapshot"]),
        status: effective(m, today),
        pausedDays: Array.isArray(m["pauses"])
          ? (m["pauses"] as D[]).reduce((t, p) => t + n(p["days"]), 0)
          : 0,
      };
    })
    .sort((a, b) => b.startDate.localeCompare(a.startDate));

  const bills = invoices.docs
    .map((d) => d.data())
    .map((i) => ({
      number: s(i["invoiceNumber"]),
      date: s(i["invoiceDate"]),
      total: n(i["total"]),
      paid: n(i["amountPaid"]),
      balance: n(i["balanceDue"]),
      status: s(i["paymentStatus"]),
      dueDate: s(i["dueDate"]),
      token: s(i["publicToken"]),
      items: Array.isArray(i["items"]) ? (i["items"] as D[]).map((x) => s(x["name"])) : [],
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
  const open = bills.filter((b) => b.balance > 0 && b.status !== "refunded");

  const ptList = pts.docs
    .map((d) => d.data())
    .map((p) => ({
      packageName: s(p["ptPackageNameSnapshot"]),
      trainerName: s(p["trainerNameSnapshot"]),
      trainerId: s(p["trainerId"]),
      startDate: s(p["startDate"]),
      endDate: s(p["endDate"]),
      status: p["status"] === "active" && s(p["endDate"]) < today ? "completed" : s(p["status"]),
    }))
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  const livePt = ptList
    .filter((p) => p.status === "active")
    .sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
  if (livePt?.trainerId)
    await ensureChat(clientId, s(c["fullName"]), livePt.trainerId, livePt.trainerName);

  const data: MemberPortalData = {
    kind: "member",
    gym,
    member: {
      id: clientId,
      name: s(c["fullName"]),
      memberId: s(c["clientCode"]),
      photoUrl: s(c["profilePhotoUrl"]),
      phone: s(c["phone"]),
      email: s(c["email"]),
      dateOfBirth: s(c["dateOfBirth"]),
      gender: s(c["gender"]),
      address: s(c["address"]),
      emergencyContact: s(c["emergencyContact"]),
      joinedOn:
        (typeof c["joinedOn"] === "string" && c["joinedOn"]) ||
        (() => {
          const at = (c["createdAt"] as { toDate?: () => Date } | undefined)?.toDate?.();
          return at ? localDate(at) : "";
        })(),
    },
    today,
    current:
      plansList
        .filter((m) => m.status === "active")
        .sort((a, b) => a.endDate.localeCompare(b.endDate))[0] ?? null,
    memberships: plansList,
    pt: ptList.map(({ trainerId: _t, ...p }) => p),
    bills,
    payments: payments.docs
      .map((d) => d.data())
      .map((p) => ({
        date: s(p["paymentDate"]),
        amount: n(p["amount"]),
        method: s(p["method"]),
        billNumber: s(p["invoiceNumber"]),
      }))
      .sort((a, b) => b.date.localeCompare(a.date)),
    balanceDue: open.reduce((t, b) => t + b.balance, 0),
    nextDueDate:
      open
        .map((b) => b.dueDate)
        .filter(Boolean)
        .sort()[0] ?? "",
    visits: visits.days,
    visitTimes: visits.times,
    workout: plans.workout,
    diet: plans.diet,
    logs,
    trainer: livePt?.trainerId ? { id: livePt.trainerId, name: livePt.trainerName } : null,
    oldHistory,
  };
  return json(data);
}

// ------------------------------------------------------------------ trainer app data

/** Active PT assignments of a trainer, one row per member. */
async function trainerMembers(trainerId: string, today: string) {
  const snap = await db().collection("ptAssignments").where("trainerId", "==", trainerId).get();
  const byMember = new Map<string, { name: string; pkg: string; start: string; end: string }>();
  for (const d of snap.docs) {
    const p = d.data();
    if (p["status"] !== "active" || s(p["endDate"]) < today) continue;
    const id = s(p["clientId"]);
    const prev = byMember.get(id);
    byMember.set(id, {
      name: s(p["clientNameSnapshot"]),
      pkg: prev && prev.end > s(p["endDate"]) ? prev.pkg : s(p["ptPackageNameSnapshot"]),
      start: prev && prev.start < s(p["startDate"]) ? prev.start : s(p["startDate"]),
      end: prev && prev.end > s(p["endDate"]) ? prev.end : s(p["endDate"]),
    });
  }
  return byMember;
}

const todayCount = (log: PortalLog | undefined, total: number) => ({
  done: log ? Math.min(total || 1, log.workoutDone.length) : 0,
  total,
});

async function trainerData(trainerId: string): Promise<Response> {
  const t = (await db().doc(`trainers/${trainerId}`).get()).data();
  if (!t) return json({ error: "This trainer account no longer exists." }, 404);
  if (t["portalActive"] === false)
    return json({ error: "Your trainer app is switched off. Please contact the gym." }, 403);
  const today = localDate();
  const [gym, mine, wTpl, dTpl] = await Promise.all([
    gymInfo(),
    trainerMembers(trainerId, today),
    db().collection("workoutPlans").where("isActive", "==", true).get(),
    db().collection("dietPlans").where("isActive", "==", true).get(),
  ]);
  const ids = [...mine.keys()];
  const clients = ids.length
    ? await db().getAll(...ids.map((id) => db().doc(`clients/${id}`)))
    : [];
  const rows: TrainerMemberRow[] = await Promise.all(
    ids.map(async (id, i) => {
      const c = clients[i]?.data() ?? {};
      const pt = mine.get(id)!;
      const [plans, logs] = await Promise.all([currentPlans(id), recentLogs(id, today, 1)]);
      await ensureChat(id, s(c["fullName"]) || pt.name, trainerId, s(t["name"]));
      const log = logs[0];
      const exercises = plans.workout
        ? plans.workout.days.length
          ? planLines(plans.workout.days[log?.workoutDay ?? 0]?.exercises).length || 1
          : 1
        : 0;
      const meals = plans.diet ? planLines(plans.diet.meals).length || 1 : 0;
      const cm = c["currentMembership"] as D | null | undefined;
      return {
        clientId: id,
        name: s(c["fullName"]) || pt.name,
        photoUrl: s(c["profilePhotoUrl"]),
        phone: s(c["phone"]),
        ptPackage: pt.pkg,
        ptStart: pt.start,
        ptEnd: pt.end,
        membershipEnd: s(cm?.["endDate"]),
        workoutName: plans.workout?.name ?? "",
        dietName: plans.diet?.name ?? "",
        workoutToday: todayCount(log, exercises),
        dietToday: { done: log ? Math.min(meals || 1, log.dietDone.length) : 0, total: meals },
      };
    }),
  );
  rows.sort((a, b) => a.name.localeCompare(b.name));
  const data: TrainerPortalData = {
    kind: "trainer",
    gym,
    trainer: { id: trainerId, name: s(t["name"]), phone: s(t["phone"]) },
    today,
    members: rows,
    templates: {
      workout: wTpl.docs.map((d) => {
        const p = d.data();
        return {
          id: d.id,
          name: s(p["name"]),
          goal: s(p["goal"]),
          description: s(p["description"]),
          durationWeeks: n(p["durationWeeks"]) || 4,
          days: cleanDays(p["days"]),
        };
      }),
      diet: dTpl.docs.map((d) => {
        const p = d.data();
        return {
          id: d.id,
          name: s(p["name"]),
          goal: s(p["goal"]),
          description: s(p["description"]),
          dailyCalories: n(p["dailyCalories"]),
          mealStructure: s(p["mealStructure"]),
        };
      }),
    },
  };
  return json(data);
}

/** The PT (with this trainer) that lets them see this member, or null. */
async function ptWith(trainerId: string, clientId: string, today: string) {
  return (await activePt(clientId, today)).find((p) => s(p["trainerId"]) === trainerId) ?? null;
}

async function trainerMember(trainerId: string, clientId: string): Promise<Response> {
  const today = localDate();
  const pt = await ptWith(trainerId, clientId, today);
  if (!pt) return json({ error: "This member is not in your PT list." }, 403);
  const c = (await db().doc(`clients/${clientId}`).get()).data() ?? {};
  const [visits, plans, logs] = await Promise.all([
    visitDays(clientId, shiftDate(today, -60)),
    currentPlans(clientId),
    recentLogs(clientId, today),
  ]);
  const dob = s(c["dateOfBirth"]);
  const age = /^\d{4}-\d{2}-\d{2}$/.test(dob)
    ? Math.floor((Date.parse(today) - Date.parse(dob)) / (365.25 * 86_400_000))
    : null;
  const cm = c["currentMembership"] as D | null | undefined;
  const data: TrainerMemberDetail = {
    member: {
      id: clientId,
      name: s(c["fullName"]) || s(pt["clientNameSnapshot"]),
      photoUrl: s(c["profilePhotoUrl"]),
      phone: s(c["phone"]),
      gender: s(c["gender"]),
      age,
      memberId: s(c["clientCode"]),
    },
    today,
    pt: {
      packageName: s(pt["ptPackageNameSnapshot"]),
      startDate: s(pt["startDate"]),
      endDate: s(pt["endDate"]),
    },
    membership: cm ? { packageName: s(cm["packageName"]), endDate: s(cm["endDate"]) } : null,
    visits: visits.days,
    visitTimes: visits.times,
    workout: plans.workout,
    diet: plans.diet,
    logs,
  };
  return json(data);
}

const text = (v: unknown, max: number) => s(v).trim().slice(0, max);

async function trainerAssign(trainerId: string, body: Record<string, unknown>): Promise<Response> {
  const input = body as unknown as TrainerAssignInput;
  const clientId = s(input.clientId);
  const today = localDate();
  const pt = await ptWith(trainerId, clientId, today);
  if (!pt) return json({ error: "This member is not in your PT list." }, 403);
  const trainer = (await db().doc(`trainers/${trainerId}`).get()).data() ?? {};
  const name = text(input.name, 80);
  if (name.length < 2) return json({ error: "Give the plan a name." }, 400);
  const weeks = Math.min(52, Math.max(1, Math.round(n(input.weeks) || 4)));
  const by = `${s(trainer["name"])} (PT trainer)`;
  const common = {
    clientId,
    planNameSnapshot: name,
    goalSnapshot: text(input.goal, 40) || "Custom",
    assignedDate: today,
    startDate: today,
    endDate: shiftDate(today, weeks * 7),
    status: "active",
    notes: text(input.notes, 1000),
    description: text(input.description, 1000),
    custom: true,
    trainerId,
    assignedByName: by,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  let collection: string;
  let fields: D;
  if (input.kind === "workout") {
    const days = cleanDays(input.days)
      .slice(0, MAX_WORKOUT_DAYS)
      .map((d, i) => ({
        title: d.title.slice(0, 60) || `Day ${i + 1}`,
        exercises: d.exercises.slice(0, PLAN_TEXT_MAX),
      }));
    if (!days.some((d) => planLines(d.exercises).length))
      return json({ error: "Add at least one exercise." }, 400);
    collection = "workoutAssignments";
    fields = { ...common, workoutPlanId: "", days };
  } else if (input.kind === "diet") {
    const meals = s(input.meals).slice(0, PLAN_TEXT_MAX);
    if (!planLines(meals).length) return json({ error: "Add at least one meal." }, 400);
    collection = "dietAssignments";
    fields = {
      ...common,
      dietPlanId: "",
      dailyCaloriesSnapshot: Math.min(20000, Math.max(0, Math.round(n(input.calories)))),
      mealStructure: meals,
    };
  } else return json({ error: "Choose workout or diet." }, 400);

  const current = await byClient(collection, clientId);
  const batch = db().batch();
  current.docs
    .filter((d) => d.data()["status"] === "active")
    .forEach((d) =>
      batch.update(d.ref, { status: "completed", updatedAt: FieldValue.serverTimestamp() }),
    );
  const ref = db().collection(collection).doc();
  batch.set(ref, fields);
  await batch.commit();
  await log({
    collection,
    docId: ref.id,
    summary: `${input.kind === "workout" ? "Workout" : "Diet"} plan given by PT trainer: ${name}`,
    actorName: `Trainer ${s(trainer["name"])}`,
    actorType: "trainer",
    clientId,
    clientName: s(pt["clientNameSnapshot"]),
  });
  return json({ id: ref.id });
}

// ------------------------------------------------------------------ logins

/** Finds or makes the Firebase login behind a link, with its claims and password. */
async function ensureLogin(
  kind: PortalKind,
  code: string,
  password: string,
  displayName: string,
  claims: Record<string, string>,
) {
  const email = portalEmail(kind, code);
  let uid: string;
  try {
    uid = (await adminAuth().createUser({ email, password, displayName })).uid;
  } catch (e) {
    if (!String((e as { code?: string }).code ?? "").includes("email-already-exists")) throw e;
    uid = (await adminAuth().getUserByEmail(email)).uid;
    await adminAuth().updateUser(uid, { password, disabled: false });
  }
  await adminAuth().setCustomUserClaims(uid, { portal: kind, ...claims });
  return uid;
}

/** A link code no one has yet. */
async function freshCode(collection: "clients" | "trainers") {
  for (;;) {
    const code = newCode();
    const used = await db().collection(collection).where("portalCode", "==", code).limit(1).get();
    if (used.empty) return code;
  }
}

/**
 * The login uid saved on a member / trainer record is only trusted when it really is that
 * person's app login (the claims ensureLogin set). Staff can edit those records, so a uid typed
 * into one (the owner's, another staff member's) must never be switched off or deleted here.
 */
async function ownPortalUid(uid: string, kind: "member" | "trainer", id: string) {
  if (!uid || !id) return "";
  const u = await adminAuth()
    .getUser(uid)
    .catch(() => null);
  const claims = (u?.customClaims ?? {}) as Record<string, unknown>;
  const key = kind === "member" ? "clientId" : "trainerId";
  return claims["portal"] === kind && claims[key] === id ? uid : "";
}

async function deleteMemberApp(clientId: string, uid: string) {
  if (uid)
    await adminAuth()
      .deleteUser(uid)
      .catch(() => undefined);
  const chat = db().doc(`chats/${clientId}`);
  await db()
    .recursiveDelete(chat)
    .catch(() => undefined);
  const logs = await byClient("planLogs", clientId);
  for (let i = 0; i < logs.docs.length; i += 400) {
    const batch = db().batch();
    logs.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

async function memberAccess(request: Request, body: Record<string, unknown>) {
  const action = s(body["action"]);
  const user = await requireFeature(request, action === "delete" ? "deleteMembers" : "members");
  if (!user) return json({ error: "Not allowed." }, 403);
  const clientId = s(body["clientId"]);
  if (!clientId) return json({ error: "Member is required." }, 400);
  const ref = db().doc(`clients/${clientId}`);
  const snap = await ref.get();
  const c = snap.data();
  if (action === "delete") {
    // Deleted for good from the Recycle Bin: the member record is only in the bin by then.
    const binned = c
      ? null
      : (
          await db().collection("recycleBinItems").where("docId", "==", clientId).limit(5).get()
        ).docs.find((d) => d.data()["collection"] === "clients");
    const saved = s(c?.["portalUid"] ?? (binned?.data()["data"] as D | undefined)?.["portalUid"]);
    await deleteMemberApp(clientId, await ownPortalUid(saved, "member", clientId));
    return json({ ok: true });
  }
  if (!c) return json({ error: "Member not found." }, 404);
  const name = s(c["fullName"]);
  const password = dobPassword(s(c["dateOfBirth"]));
  let code = s(c["portalCode"]);
  let uid = s(c["portalUid"]);

  if (action === "ensure" || action === "reset") {
    if (!password)
      return json(
        {
          error: "Add the member's date of birth first: it is their password.",
          code: "dob_missing",
        },
        400,
      );
    if (code && uid && action === "ensure") return json({ code, created: false });
    const created = !code;
    if (!code) {
      // Claim a code first so two desks at the same moment can't make two logins.
      const fresh = await freshCode("clients");
      code = await db().runTransaction(async (tx) => {
        const now = s((await tx.get(ref)).data()?.["portalCode"]);
        if (now) return now;
        tx.update(ref, {
          portalCode: fresh,
          portalActive: true,
          portalCreatedAt: FieldValue.serverTimestamp(),
        });
        return fresh;
      });
    }
    uid = await ensureLogin("member", code, password, name, { clientId });
    await ref.update({ portalUid: uid, portalActive: true });
    await log({
      collection: "clients",
      docId: clientId,
      clientId,
      clientName: name,
      actorName: staffName(user),
      summary: created
        ? "Member app link made (password: date of birth)"
        : "Member app password set to the date of birth",
    });
    return json({ code, created });
  }
  if (action === "off" || action === "on") {
    if (!uid) return json({ error: "This member has no member app yet." }, 404);
    if (!(await ownPortalUid(uid, "member", clientId)))
      return json(
        { error: "This member's app login doesn't match them. Make the member app link again." },
        409,
      );
    await adminAuth().updateUser(uid, { disabled: action === "off" });
    if (action === "off") await adminAuth().revokeRefreshTokens(uid);
    await ref.update({ portalActive: action === "on" });
    await log({
      collection: "clients",
      docId: clientId,
      clientId,
      clientName: name,
      actorName: staffName(user),
      summary: action === "on" ? "Member app switched on" : "Member app switched off",
    });
    return json({ ok: true });
  }
  return json({ error: "Unknown action." }, 400);
}

async function trainerAccess(request: Request, body: Record<string, unknown>) {
  const user = await requireFeature(request, "packages");
  if (!user || !isOwnerEmail(user.email))
    return json({ error: "Only the owner can manage trainer logins." }, 403);
  const action = s(body["action"]);
  const trainerId = s(body["trainerId"]);
  const ref = db().doc(`trainers/${trainerId}`);
  const t = (await ref.get()).data();
  if (!trainerId || !t) return json({ error: "Trainer not found." }, 404);
  const name = s(t["name"]);
  const owner = s(user.email);
  const note = (summary: string) =>
    log({ collection: "trainers", docId: trainerId, actorName: owner, summary });
  const password = s(body["password"]);
  const code = s(t["portalCode"]);
  const uid = s(t["portalUid"]);

  if (action === "create") {
    if (code && uid) return json({ error: "This trainer already has a login." }, 409);
    if (password.length < 6) return json({ error: "Password must be at least 6 characters." }, 400);
    const fresh = code || (await freshCode("trainers"));
    const newUid = await ensureLogin("trainer", fresh, password, name, { trainerId });
    await ref.update({
      portalCode: fresh,
      portalUid: newUid,
      portalActive: true,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await savePassword("trainer", trainerId, password);
    await note(`Trainer app login made for ${name}`);
    return json({ code: fresh });
  }
  if (!code || !uid) return json({ error: "This trainer has no login yet." }, 404);
  if (action !== "reveal" && !(await ownPortalUid(uid, "trainer", trainerId)))
    return json({ error: "This trainer's login doesn't match them. Make the login again." }, 409);
  if (action === "password") {
    if (password.length < 6) return json({ error: "Password must be at least 6 characters." }, 400);
    await adminAuth().updateUser(uid, { password });
    await savePassword("trainer", trainerId, password);
    await note(`Trainer app password changed for ${name}`);
    return json({ ok: true });
  }
  if (action === "off" || action === "on") {
    await adminAuth().updateUser(uid, { disabled: action === "off" });
    if (action === "off") await adminAuth().revokeRefreshTokens(uid);
    await ref.update({ portalActive: action === "on", updatedAt: FieldValue.serverTimestamp() });
    await note(`Trainer app ${action === "on" ? "switched on" : "switched off"} for ${name}`);
    return json({ ok: true });
  }
  if (action === "reveal") {
    const saved = await readPassword("trainer", trainerId);
    if (saved) await note(`Trainer app password of ${name} viewed by the owner`);
    return json({ password: saved });
  }
  return json({ error: "Unknown action." }, 400);
}

/** Sign-in page greeting. Says nothing more than the photo-upload link does. */
async function hello(url: URL) {
  const kind = url.searchParams.get("kind") === "trainer" ? "trainer" : "member";
  const code = url.searchParams.get("code") ?? "";
  if (!isPortalCode(code)) return json({ error: "This link is not valid." }, 404);
  const snap = await db()
    .collection(kind === "member" ? "clients" : "trainers")
    .where("portalCode", "==", code)
    .limit(1)
    .get();
  const d = snap.docs[0]?.data();
  if (!d) return json({ error: "This link is not valid." }, 404);
  const gym = await gymInfo();
  return json({
    firstName: s(d[kind === "member" ? "fullName" : "name"]).split(" ")[0] || "there",
    gymName: gym.name,
    logoUrl: gym.logoUrl,
    active: d["portalActive"] !== false,
  });
}

// ------------------------------------------------------------------ trainer app: calls

const digits10 = (p: unknown) => s(p).replace(/\D/g, "").slice(-10);

/**
 * The trainer's counsellor (staff) profile: the one the owner picked on the trainer, or else the
 * staff member with the same phone number. Leads and members are counselled by staff profiles.
 */
async function trainerCounsellor(t: D) {
  const picked = s(t["counsellorStaffId"]);
  if (picked) {
    const st = await db().doc(`staff/${picked}`).get();
    if (st.exists) return { id: st.id, name: s(st.data()?.["name"]) };
  }
  const phone = digits10(t["phone"]);
  if (phone.length < 10) return null;
  // A gym has a handful of staff: one small read.
  const staff = await db().collection("staff").get();
  const m = staff.docs.find((d) => digits10(d.data()["phone"]) === phone);
  return m ? { id: m.id, name: s(m.data()["name"]) } : null;
}

const inChunks = async (collection: string, field: string, ids: string[]) => {
  const out: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await db()
      .collection(collection)
      .where(field, "in", ids.slice(i, i + 30))
      .get();
    out.push(...snap.docs);
  }
  return out;
};

/** Leads this trainer counsels, and members they counselled whose package ends soon / ended. */
async function trainerCalls(t: D): Promise<Response> {
  const today = localDate();
  const who = await trainerCounsellor(t);
  const empty: TrainerCallsData = {
    linked: false,
    counsellorName: "",
    today,
    leads: [],
    members: [],
  };
  if (!who) return json(empty);
  const [inq, plans] = await Promise.all([
    db().collection("inquiries").where("counsellorId", "==", who.id).get(),
    db().collection("memberships").where("counsellorId", "==", who.id).get(),
  ]);
  const leads: TrainerCallLead[] = inq.docs
    .map((d) => ({ id: d.id, x: d.data() }))
    .filter(
      ({ x }) => !["converted", "lost"].includes(s(x["status"])) && x["convertedToClient"] !== true,
    )
    .map(({ id, x }) => ({
      inquiryId: id,
      name: s(x["name"]),
      phone: s(x["phone"]),
      status: s(x["status"]) || "new",
      source: s(x["source"]),
      goal: s(x["fitnessGoal"]),
      notes: s(x["notes"]),
      nextCallDate: s(x["nextFollowUpDate"]),
      lastContactDate: s(x["lastContactDate"]),
      expectedJoinDate: s(x["expectedJoinDate"]),
    }))
    .sort(
      (a, b) =>
        (a.nextCallDate || "9999").localeCompare(b.nextCallDate || "9999") ||
        a.name.localeCompare(b.name),
    );

  // Members whose latest plan with this counsellor ends within 15 days or ended in the last 60.
  const from = shiftDate(today, -60);
  const to = shiftDate(today, 15);
  const latest = new Map<string, D>();
  for (const d of plans.docs) {
    const m = d.data();
    if (s(m["status"]) === "cancelled") continue;
    const cur = latest.get(s(m["clientId"]));
    if (!cur || s(m["endDate"]) > s(cur["endDate"])) latest.set(s(m["clientId"]), m);
  }
  const candidates = [...latest.entries()]
    .filter(([, m]) => s(m["endDate"]) >= from && s(m["endDate"]) <= to)
    .map(([id]) => id);
  let members: TrainerCallMember[] = [];
  if (candidates.length) {
    // A renewal sold by anyone else counts too: every plan of these members is checked.
    const [allPlans, clients, fus] = await Promise.all([
      inChunks("memberships", "clientId", candidates),
      db().getAll(...candidates.map((id) => db().doc(`clients/${id}`))),
      inChunks("followups", "clientId", candidates),
    ]);
    const endOf = new Map<string, { end: string; name: string }>();
    for (const d of allPlans) {
      const m = d.data();
      if (s(m["status"]) === "cancelled") continue;
      const id = s(m["clientId"]);
      const cur = endOf.get(id);
      if (!cur || s(m["endDate"]) > cur.end)
        endOf.set(id, { end: s(m["endDate"]), name: s(m["packageNameSnapshot"]) });
    }
    const nextCall = new Map<string, { date: string; id: string }>();
    for (const f of fus) {
      const x = f.data();
      if (x["status"] !== "pending") continue;
      const id = s(x["clientId"]);
      const cur = nextCall.get(id);
      if (!cur || s(x["followUpDate"]) < cur.date)
        nextCall.set(id, { date: s(x["followUpDate"]), id: f.id });
    }
    members = clients
      .filter((c) => c.exists)
      .map((c) => {
        const x = c.data() ?? {};
        const plan = endOf.get(c.id) ?? { end: "", name: "" };
        return {
          clientId: c.id,
          name: s(x["fullName"]),
          phone: s(x["phone"]),
          memberId: s(x["clientCode"]),
          packageName: plan.name,
          endDate: plan.end,
          state: (plan.end < today ? "ended" : "ending") as TrainerCallMember["state"],
          nextCallDate: nextCall.get(c.id)?.date ?? "",
          followUpId: nextCall.get(c.id)?.id ?? "",
        };
      })
      // Renewed since (a later plan than the window): nothing to call about.
      .filter((m) => m.endDate >= from && m.endDate <= to)
      .sort((a, b) =>
        a.state !== b.state
          ? a.state === "ending"
            ? -1
            : 1
          : a.state === "ending"
            ? a.endDate.localeCompare(b.endDate)
            : b.endDate.localeCompare(a.endDate),
      );
  }
  return json({
    linked: true,
    counsellorName: who.name,
    today,
    leads,
    members,
  } satisfies TrainerCallsData);
}

/** A call the trainer made: saved exactly like the front desk's "Record call". */
async function trainerCall(trainerId: string, t: D, body: Record<string, unknown>) {
  const input = body as Partial<TrainerCallInput>;
  const who = await trainerCounsellor(t);
  if (!who) return json({ error: "You are not linked to a counsellor profile yet." }, 403);
  const inquiryId = s(input.inquiryId) || null;
  const clientId = s(input.clientId);
  const outcome = CALL_OUTCOME_OPTIONS.find((o) => o.id === s(input.outcomeId) && !o.convert);
  if (!outcome || (outcome.for !== "both" && outcome.for !== (inquiryId ? "lead" : "member")))
    return json({ error: "Pick what they said." }, 400);
  const date = s(input.date);
  if (outcome.date && !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return json({ error: "Pick a date." }, 400);
  const said = s(input.said).trim().slice(0, 1000);
  const firestore = db();
  let name = "";
  let phone = "";
  if (inquiryId) {
    const lead = (await firestore.doc(`inquiries/${inquiryId}`).get()).data();
    if (!lead || s(lead["counsellorId"]) !== who.id)
      return json({ error: "This lead is not yours." }, 403);
    name = s(lead["name"]);
    phone = s(lead["phone"]);
  } else {
    if (!clientId) return json({ error: "Member is required." }, 400);
    const [c, ms] = await Promise.all([
      firestore.doc(`clients/${clientId}`).get(),
      firestore.collection("memberships").where("clientId", "==", clientId).get(),
    ]);
    if (!c.exists || !ms.docs.some((m) => s(m.data()["counsellorId"]) === who.id))
      return json({ error: "This member is not yours." }, 403);
    name = s(c.data()?.["fullName"]);
    phone = s(c.data()?.["phone"]);
  }
  const today = localDate();
  const by = `${s(t["name"]) || "Trainer"} (trainer)`;
  const nextCallDate = outcome.date ? date : "";
  const now = FieldValue.serverTimestamp();
  const batch = firestore.batch();
  batch.set(firestore.collection("leadLogs").doc(), {
    inquiryId,
    clientId,
    customerSaid: said,
    response: outcome.label,
    nextAction: outcome.nextAction,
    nextCallDate,
    nextCallTime: nextCallDate ? "10:00" : "",
    expectedJoinDate: outcome.date === "join" ? date : "",
    expectedVisitDate: outcome.date === "visit" ? date : "",
    priority: outcome.priority,
    notes: "",
    createdBy: by,
    createdAt: now,
    updatedAt: now,
  });
  const next = nextCallDate
    ? {
        clientId,
        inquiryId,
        clientNameSnapshot: name,
        phoneSnapshot: phone,
        source: inquiryId ? "inquiry" : "renewal",
        reason: outcome.nextAction || "Follow-up call",
        notes: said,
        followUpDate: nextCallDate,
        followUpTime: "10:00",
        status: "pending",
        priority: outcome.priority,
        assignedTo: by,
        lastContactDate: today,
        nextAction: outcome.nextAction,
        outcome: "",
        automated: false,
        parentFollowUpId: s(input.followUpId) || null,
        updatedAt: now,
      }
    : null;
  const done = {
    status: "completed",
    outcome: outcome.label,
    lastContactDate: today,
    updatedAt: now,
  };
  if (inquiryId) {
    batch.update(firestore.doc(`inquiries/${inquiryId}`), {
      lastContactDate: today,
      nextFollowUpDate: nextCallDate || null,
      expectedJoinDate: outcome.date === "join" ? date : null,
      expectedVisitDate: outcome.date === "visit" ? date : null,
      ...(outcome.status ? { status: outcome.status } : {}),
      updatedAt: now,
    });
    // Same single follow-up per lead as the front desk (inquiry_<id>).
    const stable = firestore.doc(`followups/inquiry_${inquiryId}`);
    const pending = await firestore
      .collection("followups")
      .where("inquiryId", "==", inquiryId)
      .get();
    pending.docs
      .filter((d) => d.id !== stable.id && d.data()["status"] === "pending")
      .forEach((d) => batch.update(d.ref, done));
    if (next) batch.set(stable, { ...next, createdAt: now }, { merge: true });
    else if (pending.docs.some((d) => d.id === stable.id && d.data()["status"] === "pending"))
      batch.update(stable, done);
  } else {
    const current = s(input.followUpId);
    if (current) batch.set(firestore.doc(`followups/${current}`), done, { merge: true });
    if (next) batch.set(firestore.collection("followups").doc(), { ...next, createdAt: now });
  }
  await batch.commit();
  await log({
    collection: inquiryId ? "inquiries" : "clients",
    docId: inquiryId ?? clientId,
    summary: `Call by trainer ${s(t["name"])}: ${outcome.label}${nextCallDate ? ` · next call ${nextCallDate}` : ""}`,
    actorName: by,
    clientId: inquiryId ? "" : clientId,
    clientName: inquiryId ? "" : name,
  });
  return json({ ok: true, trainerId });
}

/**
 * Each member's / trainer's own installable app ("Install app" in their link): the icon on the
 * phone opens straight on their link. Same for everyone except the link, so no database read, and
 * Vercel's CDN keeps it (no function run after the first time).
 */
function appManifest(kind: "m" | "t", code: string) {
  if (!isPortalCode(code)) return json({ error: "Not found" }, 404);
  const path = `/${kind}/${code}`;
  const member = kind === "m";
  const icon = (src: string, size: string, purpose: string) => ({
    src,
    sizes: size,
    type: "image/png",
    purpose,
  });
  const manifest = {
    id: path,
    name: member ? "REBUILD FITNESS" : "REBUILD FITNESS Trainer",
    short_name: member ? "Rebuild Fitness" : "RF Trainer",
    description: member
      ? "Your membership, visits, workout, payments and reminders."
      : "Your PT members, their plans and chat.",
    start_url: path,
    scope: path,
    display: "standalone",
    orientation: "portrait",
    background_color: "#121110",
    theme_color: "#121110",
    icons: [
      icon("/icons/icon-192.png", "192x192", "any"),
      icon("/icons/icon-512.png", "512x512", "any"),
      icon("/icons/maskable-192.png", "192x192", "maskable"),
      icon("/icons/maskable-512.png", "512x512", "maskable"),
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=86400, s-maxage=2592000",
    },
  });
}

export async function handlePortal(request: Request, url: URL): Promise<Response> {
  const action = url.pathname.replace(/^\/api\/portal\/?/, "").replace(/\/+$/, "");
  if (request.method === "GET" && action === "hello") return hello(url);
  const manifest = /^manifest\/(m|t)\/([^/]+)$/.exec(action);
  if (request.method === "GET" && manifest)
    return appManifest(manifest[1] as "m" | "t", manifest[2]!);
  if (request.method === "POST" && (action === "member-access" || action === "trainer-access")) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return action === "member-access" ? memberAccess(request, body) : trainerAccess(request, body);
  }
  const who = await portalUser(request);
  if (!who) return json({ error: "Please sign in again." }, 401);
  if (request.method === "GET" && action === "me")
    return who.kind === "member" ? memberData(who.id) : trainerData(who.id);
  if (who.kind !== "trainer") return json({ error: "Not allowed." }, 403);
  const trainer = (await db().doc(`trainers/${who.id}`).get()).data();
  if (!trainer || trainer["portalActive"] === false)
    return json({ error: "Your trainer app is switched off." }, 403);
  if (request.method === "GET" && action === "trainer-member")
    return trainerMember(who.id, url.searchParams.get("clientId") ?? "");
  if (request.method === "POST" && action === "trainer-assign")
    return trainerAssign(
      who.id,
      (await request.json().catch(() => ({}))) as Record<string, unknown>,
    );
  if (request.method === "GET" && action === "trainer-calls") return trainerCalls(trainer);
  if (request.method === "POST" && action === "trainer-call")
    return trainerCall(
      who.id,
      trainer,
      (await request.json().catch(() => ({}))) as Record<string, unknown>,
    );
  return json({ error: "Not found" }, 404);
}
