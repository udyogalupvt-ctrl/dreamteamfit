import {
  collection,
  onSnapshot,
  query,
  Timestamp,
  type DocumentData,
  type Query,
  type QueryConstraint,
} from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { CFO_COLLECTIONS } from "@/lib/cfo/types";

/**
 * Shared Firestore helpers. Feature services (packages, inquiries, clients,
 * memberships) build on these instead of scattering Firestore calls in UI code.
 */
export const COLLECTIONS = {
  packages: "packages",
  inquiries: "inquiries",
  clients: "clients",
  memberships: "memberships",
  followups: "followups",
  invoices: "invoices",
  attendance: "attendance",
  settings: "settings",
  workoutPlans: "workoutPlans",
  workoutAssignments: "workoutAssignments",
  dietPlans: "dietPlans",
  dietAssignments: "dietAssignments",
  bookings: "bookings",
  groupClasses: "groupClasses",
  classEnrollments: "classEnrollments",
  expenses: "expenses",
  expenseActivities: "expenseActivities",
  publicInvoices: "publicInvoices",
  biometricDevices: "biometricDevices",
  renewalNotifications: "renewalNotifications",
  birthdayNotifications: "birthdayNotifications",
  notifications: "notifications",
  automationActivities: "automationActivities",
  whatsappMessages: "whatsappMessages",
  whatsappWebhookEvents: "whatsappWebhookEvents",
  ptPackages: "ptPackages",
  trainers: "trainers",
  ptAssignments: "ptAssignments",
  payments: "payments",
  enrollments: "enrollments",
  trainerPayouts: "trainerPayouts",
  manualIncome: "manualIncome",
  importBatches: "importBatches",
  leadLogs: "leadLogs",
  biometricCommands: "biometricCommands",
  auditLogs: "auditLogs",
  staff: "staff",
  staffPrivate: "staffPrivate",
  staffAccess: "staffAccess",
  staffAttendance: "staffAttendance",
  staffPayments: "staffPayments",
  memberCalls: "memberCalls",
  memberIds: "memberIds",
  deviceUsers: "deviceUsers",
  announcements: "announcements",
  cashDays: "cashDays",
  staffDayMarks: "staffDayMarks",
  staffPayroll: "staffPayroll",
  /** The owner's CFO page: settings (page writes), numbers and AI summaries (server writes). */
  cfoSettings: CFO_COLLECTIONS.settings,
  cfoReports: CFO_COLLECTIONS.reports,
  cfoBriefs: CFO_COLLECTIONS.briefs,
  /** Deleted records wait here until the owner restores them or deletes them for good. */
  recycleBin: "recycleBin",
  recycleBinItems: "recycleBinItems",
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

export const col = (name: CollectionName) => collection(db, name);

/** Converts Firestore Timestamps (or pending server timestamps) into Dates. */
export function toDate(value: unknown): Date {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  return new Date();
}

export type Mapper<T> = (id: string, data: DocumentData) => T;

/** Real-time listener for a query; returns the unsubscribe function. */
export function subscribeQuery<T>(
  q: Query,
  map: Mapper<T>,
  onData: (items: T[]) => void,
  onError: (error: Error) => void,
) {
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => map(d.id, d.data()))),
    (err) => onError(err),
  );
}

export function subscribeCollection<T>(
  name: CollectionName,
  map: Mapper<T>,
  onData: (items: T[]) => void,
  onError: (error: Error) => void,
  ...constraints: QueryConstraint[]
) {
  return subscribeQuery(query(col(name), ...constraints), map, onData, onError);
}

/** Human-friendly message for Firestore errors. */
export function firestoreErrorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code ?? "";
  if (code === "permission-denied")
    return "You don't have permission to access this data. Check the database security rules.";
  if (code === "unavailable") return "Can't reach the database. Check your connection.";
  if (code === "failed-precondition")
    return "The database isn't ready yet. Make sure Firestore is enabled for this project.";
  return (error as Error)?.message || "Something went wrong. Please try again.";
}
