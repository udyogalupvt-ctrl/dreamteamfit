import type { DeleteSection, StaffFeature } from "@/types/models";

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
  whatsappChats: {
    label: "WhatsApp chats",
    hint: "Read and reply to messages members send to the gym's WhatsApp number",
  },
  announcements: {
    label: "WhatsApp announcements",
    hint: "Send a message to active, inactive or not-renewed members, or any number (Meta charges each)",
  },
  finance: {
    label: "Income & expenses",
    hint: "Expenses, profit, cash book, salaries, incentives. Also opens the CFO page: members' phones, trainer pay and the AI summary",
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
  staff: {
    label: "Staff",
    hint: "Add and edit staff, their thumb on the machine (making logins stays with the owner)",
  },
  recycleBin: {
    label: "Recycle Bin",
    hint: "See everything deleted and put it back (Delete forever stays with the owner)",
  },
  backup: {
    label: "Backup (old software data)",
    hint: "See and download the old software's data, and old members not added yet (adding the data stays with the owner)",
  },
  deleteMembers: { label: "Members", hint: "Members with their plans, bills and visits" },
  deleteLeads: { label: "Leads & follow-ups", hint: "Leads, their calls and follow-ups" },
  deleteBills: { label: "Bills", hint: "Bills with their payments" },
  deletePackages: {
    label: "Packages, trainers & plans",
    hint: "Gym / PT packages, trainers, workout and diet plans",
  },
  deleteExpenses: { label: "Expenses", hint: "Expenses and their payments" },
};

/** Delete rights (each section): only the owner by default, granted per login on the Staff page. */
export const DELETE_FEATURES: StaffFeature[] = [
  "deleteMembers",
  "deleteLeads",
  "deleteBills",
  "deletePackages",
  "deleteExpenses",
];
/** Which delete right covers a section. Staff (people who work here): owners only. */
export const DELETE_FEATURE_OF: Record<DeleteSection, StaffFeature | "owner"> = {
  members: "deleteMembers",
  leads: "deleteLeads",
  bills: "deleteBills",
  packages: "deletePackages",
  expenses: "deleteExpenses",
  staff: "owner",
};

/** Features a new front-desk login starts with. */
export const DEFAULT_STAFF_FEATURES: StaffFeature[] = [
  "members",
  "leads",
  "billing",
  "daybook",
  "attendance",
  "memberCalls",
  "whatsappChats",
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
  ["/whatsapp", "whatsappChats"],
  ["/announcements", "announcements"],
  ["/expenses", "finance"],
  ["/cfo", "finance"],
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
  ["/staff", "staff"],
  ["/recycle-bin", "recycleBin"],
  ["/backup", "backup"],
];

export function featureForPath(pathname: string): StaffFeature | "owner" | null {
  const hit = PAGE_FEATURES.find(([p]) => pathname === p || pathname.startsWith(`${p}/`));
  return hit ? hit[1] : null;
}
