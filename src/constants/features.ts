import type { StaffFeature } from "@/types/models";

/** What each switch on the staff login screen allows, in plain words. */
export const FEATURE_META: Record<StaffFeature, { label: string; hint: string }> = {
  members: { label: "Members", hint: "Add, renew and edit members; birthdays; message history" },
  leads: { label: "Leads & follow-ups", hint: "Inquiries and follow-up calls" },
  billing: { label: "Billing", hint: "Bills and collecting payments" },
  daybook: {
    label: "Day book",
    hint: "Who paid today, expenses, cash and handover; Excel / print",
  },
  attendance: { label: "Attendance", hint: "Member and staff attendance" },
  memberCalls: { label: "Member calls", hint: "Inactive, expiring, renewal and payment-due lists" },
  finance: {
    label: "Income & expenses",
    hint: "Expenses, profit, cash book, salaries, incentives",
  },
  packages: { label: "Packages & trainers", hint: "Change prices, packages and trainers" },
  classes: {
    label: "PT & classes",
    hint: "PT sessions, classes, bookings, workout and diet plans",
  },
  reports: { label: "Reports", hint: "Charts and reports" },
  activity: { label: "Activity log", hint: "Who did what" },
  devices: { label: "Fingerprint devices", hint: "Add and set up devices" },
  settings: { label: "Settings & WhatsApp", hint: "Gym details, WhatsApp, reminders" },
  deleteMembers: { label: "Delete members", hint: "Remove a member completely" },
};

/** Features a new front-desk login starts with. */
export const DEFAULT_STAFF_FEATURES: StaffFeature[] = [
  "members",
  "leads",
  "billing",
  "daybook",
  "attendance",
  "memberCalls",
];

/** Which feature a page belongs to. "owner" = owners only. Pages not listed are open to all staff. */
const PAGE_FEATURES: [prefix: string, feature: StaffFeature | "owner"][] = [
  ["/clients", "members"],
  ["/birthdays", "members"],
  ["/notifications", "members"],
  ["/leads", "leads"],
  ["/inquiries", "leads"],
  ["/follow-ups", "leads"],
  ["/billing", "billing"],
  ["/day-book", "daybook"],
  ["/attendance", "attendance"],
  ["/member-calls", "memberCalls"],
  ["/expenses", "finance"],
  ["/packages", "packages"],
  ["/trainers", "packages"],
  ["/pt-sessions", "classes"],
  ["/group-classes", "classes"],
  ["/bookings", "classes"],
  ["/workout-plans", "classes"],
  ["/diet-plans", "classes"],
  ["/reports", "reports"],
  ["/activity-log", "activity"],
  ["/biometric-devices", "devices"],
  ["/settings", "settings"],
  ["/whatsapp-usage", "settings"],
  ["/staff", "owner"],
];

export function featureForPath(pathname: string): StaffFeature | "owner" | null {
  const hit = PAGE_FEATURES.find(([p]) => pathname === p || pathname.startsWith(`${p}/`));
  return hit ? hit[1] : null;
}
