/**
 * Member app (/m/<code>) and trainer app (/t/<code>): a private link plus a password, no email.
 *
 * Behind the scenes each link is a Firebase login whose email is made from the link code, so
 * the app signs in straight from the link (Firebase slows down password guessing). The server
 * creates these logins (src/server/portal.ts) with a claim saying who they are:
 *   { portal: "member", clientId }  or  { portal: "trainer", trainerId }
 * Such a login is never staff: Firestore rules and the server check staffAccess / owner email.
 */
import type {
  BodyEntry,
  DietGoal,
  HealthAnswer,
  HealthFormSummary,
  HealthQuestion,
  WorkoutDay,
  WorkoutGoal,
} from "@/types/models";

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
  /** Arrival time per visited day ("HH:MM", India time): the first thumb of that day. */
  visitTimes: Record<string, string>;
  workout: PortalWorkout | null;
  diet: PortalDiet | null;
  /** Last 14 days of ticks, newest first. */
  logs: PortalLog[];
  /** Active PT trainer: chat is open with them. */
  trainer: { id: string; name: string } | null;
  /** Plans from the gym's old software, once the front desk linked this member to their old record. */
  oldHistory: { memberId: string; joinedOn: string; plans: PortalOldPlan[] } | null;
  /** Health form; null while the owner hasn't switched it on. */
  health: PortalHealth | null;
  /** Body progress entries, oldest first (bodyProgress/{clientId}). */
  progress: BodyEntry[];
  /** The Google review card; null while the gym has no review link in Settings. */
  review: PortalReview | null;
  /** The newest announcement for this member (Home shows it for 14 days); null = none. */
  announcement: PortalAnnouncement | null;
  /** "Bring a friend": friends who joined through them and the rewards decided so far. */
  referrals: PortalReferrals;
  /** Pay by UPI from the app; null while the gym has no UPI ID in Settings. */
  pay: PortalPay | null;
}

/** A UPI pay link the member already opened (src/server/pay-links.ts). */
export interface PortalPayLinkState {
  token: string;
  /** member_paid = waiting for the gym to confirm. */
  status: "open" | "member_paid";
  /** "Not received" note from the gym. */
  deskNote: string;
  memberAmount: number;
}

export interface PortalPay {
  /** By bill token: the link already made for that bill's balance. */
  bills: Record<string, PortalPayLinkState>;
  /** Renew online with the same package; null = renew at the gym. */
  renewal: { packageName: string; amount: number; link: PortalPayLinkState | null } | null;
}

/** GET /api/pay/<token>: the public pay page (src/routes/pay.$token.tsx). */
export interface PublicPayLink {
  status: "open" | "member_paid" | "confirmed" | "cancelled";
  kind: "balance" | "renewal";
  /** false = the gym switched online pay off. */
  on: boolean;
  amount: number;
  gymName: string;
  /** First name only. */
  memberName: string;
  invoiceNumber: string;
  billToken: string;
  packageName: string;
  upiId: string;
  payeeName: string;
  /** upi://pay link; "" unless the link is open and online pay is on. */
  uri: string;
  utr: string;
  deskNote: string;
  /** Why the link closed, for the member. */
  closedText: string;
}

/** src/server/portal-referral.ts: only given and promised rewards are listed. */
export interface PortalReferrals {
  count: number;
  rewards: { friend: string; label: string; status: "given" | "promised"; givenOn: string }[];
}

/** News from the gym in the member app (src/server/portal-announcements.ts). */
export interface PortalAnnouncement {
  id: string;
  message: string;
  /** YYYY-MM-DD, India time. */
  sentOn: string;
  /** The gym changed the text after posting it. */
  edited: boolean;
}

/** `show` = the card is on Home today (src/lib/review-prompt.ts); the link is always in Feedback. */
export interface PortalReview {
  url: string;
  show: boolean;
}

/** One message the member sent to the gym (src/server/portal-feedback.ts). */
export interface PortalFeedback {
  id: string;
  kind: string;
  message: string;
  wantsCall: boolean;
  status: "new" | "resolved";
  reply: string;
  /** YYYY-MM-DD, "" before the gym replied. */
  repliedOn: string;
  sentOn: string;
}

/** The health form as the member app shows it (src/server/portal-health.ts). */
export interface PortalHealth {
  status: "done" | "pending";
  form: {
    version: number;
    title: string;
    intro: string;
    questions: HealthQuestion[];
    consent: string;
  };
  last: HealthFormSummary | null;
}

/** One acceptance, for "View my answers" (GET /api/portal/health-form). */
export interface PortalHealthRecord {
  version: number;
  title: string;
  signedOn: string;
  signedName: string;
  method: "app" | "paper";
  answers: HealthAnswer[];
  consent: string;
}

/** A plan from the old software, as the member sees it. */
export interface PortalOldPlan {
  name: string;
  start: string;
  end: string;
  price: number;
  discount: number;
  /** Price after discount. */
  amount: number;
  paid: number;
  balance: number;
  bill: string;
  status: string;
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

/** Trainer app → Calls: a lead this trainer counsels (as the gym's counsellor). */
export interface TrainerCallLead {
  inquiryId: string;
  name: string;
  phone: string;
  status: string;
  source: string;
  goal: string;
  notes: string;
  nextCallDate: string;
  lastContactDate: string;
  expectedJoinDate: string;
}
/** Trainer app → Calls: a member this trainer counselled whose package ends soon / ended. */
export interface TrainerCallMember {
  clientId: string;
  name: string;
  phone: string;
  memberId: string;
  packageName: string;
  endDate: string;
  /** ending = 15 days or less left; ended = not renewed (last 60 days). */
  state: "ending" | "ended";
  nextCallDate: string;
  followUpId: string;
}
export interface TrainerCallsData {
  /** false: the trainer isn't linked to a counsellor (staff) profile yet. */
  linked: boolean;
  counsellorName: string;
  today: string;
  leads: TrainerCallLead[];
  members: TrainerCallMember[];
}
/** One call the trainer made (same meaning as the front desk's "Record call"). */
export interface TrainerCallInput {
  inquiryId: string | null;
  clientId: string;
  followUpId: string;
  outcomeId: string;
  said: string;
  /** Joining / visiting / call-again date, when the outcome needs one. */
  date: string;
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
  /** Arrival time per visited day ("HH:MM"): the first thumb of that day. */
  visitTimes: Record<string, string>;
  workout: PortalWorkout | null;
  diet: PortalDiet | null;
  logs: PortalLog[];
  /** Their last health form in short (Yes answers + notes); null = never filled. */
  health: HealthFormSummary | null;
  /** Body progress entries, oldest first. */
  progress: BodyEntry[];
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
