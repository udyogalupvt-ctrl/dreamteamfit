/**
 * Member app and trainer app (see src/constants/portal.ts).
 *
 *   GET  /api/portal/hello?kind=member|trainer&code=…  no login: first name + gym for the sign-in page
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
  type TrainerMemberDetail,
  type TrainerMemberRow,
  type TrainerPortalData,
} from "@/constants/portal";
import type { WorkoutDay } from "@/types/models";
import { adminAuth, db, json, localDate, requireFeature } from "./admin";
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

/** The member / trainer behind a request, from their app login's claims. */
async function portalUser(request: Request) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const user = await adminAuth()
    .verifyIdToken(token)
    .catch(() => null);
  if (!user) return null;
  if (user["portal"] === "member" && s(user["clientId"]))
    return { kind: "member" as const, id: s(user["clientId"]) };
  if (user["portal"] === "trainer" && s(user["trainerId"]))
    return { kind: "trainer" as const, id: s(user["trainerId"]) };
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

/** Days a member got in (allowed entries), newest first. */
async function visitDays(clientId: string, since = "") {
  const snap = await byClient("attendance", clientId);
  const days = new Set<string>();
  for (const d of snap.docs) {
    const a = d.data();
    if (a["eventType"] !== "check_in" || a["accessDecision"] !== "allowed") continue;
    const day = s(a["attendanceDate"]);
    if (day && day >= since) days.add(day);
  }
  return [...days].sort().reverse();
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
  const [gym, memberships, invoices, payments, pts, visits, plans, logs] = await Promise.all([
    gymInfo(),
    byClient("memberships", clientId),
    byClient("invoices", clientId),
    byClient("payments", clientId),
    byClient("ptAssignments", clientId),
    visitDays(clientId),
    currentPlans(clientId),
    recentLogs(clientId, today),
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
      joinedOn: (() => {
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
    visits,
    workout: plans.workout,
    diet: plans.diet,
    logs,
    trainer: livePt?.trainerId ? { id: livePt.trainerId, name: livePt.trainerName } : null,
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
    visits,
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
    await deleteMemberApp(clientId, s(c?.["portalUid"]));
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

export async function handlePortal(request: Request, url: URL): Promise<Response> {
  const action = url.pathname.replace(/^\/api\/portal\/?/, "").replace(/\/+$/, "");
  if (request.method === "GET" && action === "hello") return hello(url);
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
  return json({ error: "Not found" }, 404);
}
