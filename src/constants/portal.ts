/**
 * Member app (/m/<code>) and trainer app (/t/<code>): a private link plus a password, no email.
 *
 * Behind the scenes each link is a Firebase login whose email is made from the link code, so
 * the app signs in straight from the link (Firebase slows down password guessing). The server
 * creates these logins (src/server/portal.ts) with a claim saying who they are:
 *   { portal: "member", clientId }  or  { portal: "trainer", trainerId }
 * Such a login is never staff: Firestore rules and the server check staffAccess / owner email.
 */
import type { WorkoutDay, WorkoutGoal, DietGoal } from "@/types/models";

export type PortalKind = "member" | "trainer";

/** Route prefix of each app. */
export const PORTAL_PATH: Record<PortalKind, string> = { member: "/m/", trainer: "/t/" };

/** Never receives mail: only identifies the login. */
const EMAIL_DOMAIN = "portal.dreamteamfit.vercel.app";
export const portalEmail = (kind: PortalKind, code: string) =>
  `${kind === "member" ? "m" : "t"}-${code.toLowerCase()}@${EMAIL_DOMAIN}`;

/** Link codes: 12 letters/digits without look-alikes (0 o 1 l i). */
export const PORTAL_CODE_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";
export const isPortalCode = (code: string) => /^[a-hjkmnp-z2-9]{12}$/.test(code);

/** "1995-08-25" → "25081995" (the member's password). "" when the date is not usable. */
export function dobPassword(dob: string | null | undefined) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dob ?? ""));
  if (!m) return "";
  const year = Number(m[1]);
  if (year < 1900 || year > new Date().getFullYear()) return "";
  return `${m[3]}${m[2]}${m[1]}`;
}

/** Today in India (plans, visits and ticks all use Indian dates). */
export const indiaToday = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

/** "YYYY-MM-DD" plus n days. */
export function shiftDate(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Non-empty lines of a text box (exercises, meals). */
export const planLines = (text: string | null | undefined) =>
  String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-•*]\s*/, "").trim())
    .filter(Boolean);

export const PLAN_TEXT_MAX = 3000;
export const MAX_WORKOUT_DAYS = 7;

// ------------------------------------------------------------------ what the apps receive

export interface PortalGym {
  name: string;
  logoUrl: string;
  phone: string;
  address: string;
}

/** A plan as the member sees it (gym plan or personal plan from the trainer). */
export interface PortalWorkout {
  assignmentId: string;
  name: string;
  goal: WorkoutGoal | string;
  description: string;
  notes: string;
  startDate: string;
  endDate: string;
  days: WorkoutDay[];
  by: string;
  custom: boolean;
}
export interface PortalDiet {
  assignmentId: string;
  name: string;
  goal: DietGoal | string;
  calories: number;
  description: string;
  notes: string;
  meals: string;
  startDate: string;
  endDate: string;
  by: string;
  custom: boolean;
}
export interface PortalLog {
  date: string;
  workoutDay: number;
  workoutDone: number[];
  dietDone: number[];
}

export interface PortalMembership {
  id: string;
  packageName: string;
  startDate: string;
  endDate: string;
  days: number;
  price: number;
  /** active | pending (starts later) | expired | cancelled | biometric_pending */
  status: string;
  pausedDays: number;
}

export interface MemberPortalData {
  kind: "member";
  gym: PortalGym;
  member: {
    id: string;
    name: string;
    memberId: string;
    photoUrl: string;
    phone: string;
    email: string;
    dateOfBirth: string;
    gender: string;
    address: string;
    emergencyContact: string;
    joinedOn: string;
  };
  today: string;
  current: PortalMembership | null;
  memberships: PortalMembership[];
  pt: {
    packageName: string;
    trainerName: string;
    startDate: string;
    endDate: string;
    status: string;
  }[];
  bills: {
    number: string;
    date: string;
    total: number;
    paid: number;
    balance: number;
    status: string;
    dueDate: string;
    /** Opens the bill page (/invoice/<token>). */
    token: string;
    items: string[];
  }[];
  payments: { date: string; amount: number; method: string; billNumber: string }[];
  balanceDue: number;
  nextDueDate: string;
  /** Days with an allowed entry (YYYY-MM-DD), newest first. */
  visits: string[];
  workout: PortalWorkout | null;
  diet: PortalDiet | null;
  /** Last 14 days of ticks, newest first. */
  logs: PortalLog[];
  /** Active PT trainer: chat is open with them. */
  trainer: { id: string; name: string } | null;
}

export interface TrainerMemberRow {
  clientId: string;
  name: string;
  photoUrl: string;
  phone: string;
  ptPackage: string;
  ptStart: string;
  ptEnd: string;
  membershipEnd: string;
  workoutName: string;
  dietName: string;
  /** Today's ticks: done / total. */
  workoutToday: { done: number; total: number };
  dietToday: { done: number; total: number };
}

export interface TrainerTemplateWorkout {
  id: string;
  name: string;
  goal: string;
  description: string;
  durationWeeks: number;
  days: WorkoutDay[];
}
export interface TrainerTemplateDiet {
  id: string;
  name: string;
  goal: string;
  description: string;
  dailyCalories: number;
  mealStructure: string;
}

export interface TrainerPortalData {
  kind: "trainer";
  gym: PortalGym;
  trainer: { id: string; name: string; phone: string };
  today: string;
  members: TrainerMemberRow[];
  templates: { workout: TrainerTemplateWorkout[]; diet: TrainerTemplateDiet[] };
}

/** One PT member opened in the trainer app. */
export interface TrainerMemberDetail {
  member: {
    id: string;
    name: string;
    photoUrl: string;
    phone: string;
    gender: string;
    age: number | null;
    memberId: string;
  };
  today: string;
  pt: { packageName: string; startDate: string; endDate: string };
  membership: { packageName: string; endDate: string } | null;
  /** Days with an allowed entry in the last 60 days, newest first. */
  visits: string[];
  workout: PortalWorkout | null;
  diet: PortalDiet | null;
  logs: PortalLog[];
}

/** What a trainer sends to give a member a plan. */
export type TrainerAssignInput =
  | {
      clientId: string;
      kind: "workout";
      name: string;
      goal: string;
      description: string;
      notes: string;
      weeks: number;
      days: WorkoutDay[];
    }
  | {
      clientId: string;
      kind: "diet";
      name: string;
      goal: string;
      description: string;
      notes: string;
      weeks: number;
      calories: number;
      meals: string;
    };
