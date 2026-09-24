/** Firestore-backed domain models. Dates without time are stored as "YYYY-MM-DD" strings. */

export interface BaseDoc {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export const PACKAGE_CATEGORIES = [
  "Strength + Cardio",
  "Strength Only",
  "Cardio Only",
  "Custom",
] as const;
export type PackageCategory = (typeof PACKAGE_CATEGORIES)[number];

export interface GymPackage extends BaseDoc {
  name: string;
  category: PackageCategory;
  description: string;
  durationDays: number;
  price: number;
  isActive: boolean;
  /** Highest discount staff may give on this package, ₹; null = no limit. */
  maxDiscount: number | null;
}

export const INQUIRY_STATUSES = [
  "new",
  "contacted",
  "interested",
  "follow_up",
  "expected_to_join",
  "converted",
  "lost",
] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

export const LEAD_SOURCES = [
  "walk_in",
  "instagram",
  "facebook",
  "google",
  "referral",
  "website",
  "phone",
  "other",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export interface Inquiry extends BaseDoc {
  name: string;
  phone: string;
  phoneNormalized: string;
  email: string;
  source: LeadSource;
  fitnessGoal: string;
  notes: string;
  status: InquiryStatus;
  nextFollowUpDate: string | null;
  lastContactDate: string | null;
  expectedJoinDate: string | null;
  expectedVisitDate: string | null;
  assignedTo: string;
  /** Staff member (counsellor) handling this lead. */
  counsellorId: string;
  convertedToClient: boolean;
  clientId: string | null;
}

export const CLIENT_STATUSES = ["active", "inactive"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];
export const GENDERS = ["male", "female", "other", "unspecified"] as const;
export type Gender = (typeof GENDERS)[number];

/** Denormalized summary of the current membership, kept in sync by the memberships service. */
export interface MembershipSummary {
  membershipId: string;
  packageName: string;
  startDate: string;
  endDate: string;
  status: MembershipStatus;
}

export interface Client extends BaseDoc {
  clientCode: string;
  fullName: string;
  phone: string;
  phoneNormalized: string;
  email: string;
  profilePhotoUrl: string | null;
  dateOfBirth: string | null;
  gender: Gender;
  address: string;
  emergencyContact: string;
  source: LeadSource;
  notes: string;
  status: ClientStatus;
  inquiryId: string | null;
  currentMembership: MembershipSummary | null;
  biometricUserId: string;
  biometricDeviceId: string;
  biometricStatus: BiometricStatus;
  whatsappOptIn: boolean;
  whatsappPhone: string;
  whatsappStatus: "opted_out" | "ready" | "invalid";
  lastWhatsappMessageAt: Date | null;
  firstThumbRegistered: boolean;
  enrollmentId: string | null;
  /** Door lock state kept by the cloud: "removed" = taken off the device (plan ended / blocked). */
  deviceAccess: "on" | "removed" | null;
  /** Private link code for the member to upload their own photo; empty once uploaded. */
  photoUploadToken: string;
}

export const BIOMETRIC_STATUSES = ["not_enrolled", "active", "disabled"] as const;
export type BiometricStatus = (typeof BIOMETRIC_STATUSES)[number];

export const DEVICE_MANUFACTURERS = ["eSSL", "ZKTeco", "Other"] as const;
export type DeviceManufacturer = (typeof DEVICE_MANUFACTURERS)[number];
export const DEVICE_STATUSES = ["online", "offline", "unknown", "disabled"] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];
export const DEVICE_CONNECTIONS = ["LAN", "USB", "Cloud", "Other"] as const;
export type DeviceConnection = (typeof DEVICE_CONNECTIONS)[number];
/** adms = device pushes to our cloud endpoint (eSSL / ZKTeco "ADMS" / "Cloud server" setting). */
export const DEVICE_INTEGRATIONS = ["adms", "adapter", "mock", "manual"] as const;
export type DeviceIntegration = (typeof DEVICE_INTEGRATIONS)[number];

export interface BiometricDevice extends BaseDoc {
  name: string;
  manufacturer: DeviceManufacturer;
  model: string;
  serialNumber: string;
  deviceType: string;
  location: string;
  connectionType: DeviceConnection;
  ipAddress: string;
  port: number | null;
  status: DeviceStatus;
  integrationType: DeviceIntegration;
  lastSyncAt: Date | null;
  /** Last time the device contacted the cloud endpoint (ADMS devices only). */
  lastSeenAt: Date | null;
}

export const BIOMETRIC_COMMAND_TYPES = [
  "user_upsert",
  "enroll_fp",
  "query_fp",
  "delete_user",
  "restore_fp",
] as const;
export type BiometricCommandType = (typeof BIOMETRIC_COMMAND_TYPES)[number];
export const BIOMETRIC_COMMAND_STATUSES = [
  "pending",
  "sent",
  "done",
  "failed",
  "cancelled",
] as const;
export type BiometricCommandStatus = (typeof BIOMETRIC_COMMAND_STATUSES)[number];

/** A command queued for an ADMS device. The device picks it up on its next poll. */
export interface BiometricCommand extends BaseDoc {
  deviceId: string;
  serialNumber: string;
  clientId: string;
  enrollmentId: string | null;
  biometricUserId: string;
  /** Door-lock command (remove / restore on the device), not part of thumb registration. */
  door: boolean;
  type: BiometricCommandType;
  command: string;
  order: number;
  status: BiometricCommandStatus;
  cmdNo: number | null;
  returnCode: number | null;
  error: string;
  sentAt: Date | null;
  completedAt: Date | null;
}

export const ATTENDANCE_EVENT_TYPES = ["check_in", "check_out", "unknown"] as const;
export type AttendanceEventType = (typeof ATTENDANCE_EVENT_TYPES)[number];
export const ATTENDANCE_SOURCES = ["biometric", "manual"] as const;
export type AttendanceSource = (typeof ATTENDANCE_SOURCES)[number];
export const ACCESS_REASONS = [
  "ACTIVE_MEMBERSHIP",
  "MEMBERSHIP_EXPIRED",
  "NO_ACTIVE_MEMBERSHIP",
  "BIOMETRIC_DISABLED",
  "MEMBER_NOT_FOUND",
  "DEVICE_NOT_REGISTERED",
] as const;
export type AccessReason = (typeof ACCESS_REASONS)[number];

export interface AttendanceEvent extends BaseDoc {
  clientId: string;
  clientNameSnapshot: string;
  biometricUserId: string;
  deviceId: string;
  deviceNameSnapshot: string;
  eventType: AttendanceEventType;
  attendanceDate: string;
  timestamp: Date;
  source: AttendanceSource;
  accessDecision: "allowed" | "blocked";
  accessReason: AccessReason;
  rawEventReference: string;
  notes: string;
}

export interface AccessDecision {
  allowed: boolean;
  reason: AccessReason;
  clientId: string | null;
  membershipId: string | null;
}

export const MEMBERSHIP_STATUSES = [
  "active",
  "expired",
  "cancelled",
  "pending",
  "biometric_pending",
] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export interface Membership extends BaseDoc {
  clientId: string;
  packageId: string;
  packageNameSnapshot: string;
  priceSnapshot: number;
  durationDaysSnapshot: number;
  startDate: string;
  endDate: string;
  status: MembershipStatus;
  counsellorId: string;
  counsellorName: string;
  /** Pauses (member away): each one moved the end date forward by `days`. */
  pauses: MembershipPause[];
}

export const PAUSE_REASONS = ["Travel", "Medical", "Other"] as const;
export interface MembershipPause {
  /** Day the pause was entered (YYYY-MM-DD). */
  on: string;
  days: number;
  reason: string;
  note: string;
  by: string;
  /** End date before this pause, so it can be undone exactly. */
  previousEnd: string;
}

export const WORKOUT_GOALS = [
  "Weight Loss",
  "Muscle Gain",
  "Strength",
  "Fat Loss",
  "General Fitness",
  "Endurance",
  "Custom",
] as const;
export type WorkoutGoal = (typeof WORKOUT_GOALS)[number];
export const DIET_GOALS = [
  "Weight Loss",
  "Muscle Gain",
  "Fat Loss",
  "Maintenance",
  "General Fitness",
  "Custom",
] as const;
export type DietGoal = (typeof DIET_GOALS)[number];
export const ASSIGNMENT_STATUSES = ["active", "completed", "cancelled"] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export interface WorkoutPlan extends BaseDoc {
  name: string;
  goal: WorkoutGoal;
  description: string;
  durationWeeks: number;
  daysPerWeek: number;
  isActive: boolean;
}

export interface DietPlan extends BaseDoc {
  name: string;
  goal: DietGoal;
  description: string;
  dailyCalories: number;
  mealStructure: string;
  notes: string;
  isActive: boolean;
}

export interface WorkoutAssignment extends BaseDoc {
  clientId: string;
  workoutPlanId: string;
  planNameSnapshot: string;
  goalSnapshot: WorkoutGoal;
  assignedDate: string;
  startDate: string;
  endDate: string;
  status: AssignmentStatus;
  notes: string;
}

export interface DietAssignment extends BaseDoc {
  clientId: string;
  dietPlanId: string;
  planNameSnapshot: string;
  goalSnapshot: DietGoal;
  dailyCaloriesSnapshot: number;
  assignedDate: string;
  startDate: string;
  endDate: string;
  status: AssignmentStatus;
  notes: string;
}

export const BOOKING_TYPES = ["pt", "group_class", "general"] as const;
export type BookingType = (typeof BOOKING_TYPES)[number];
export const BOOKING_STATUSES = ["scheduled", "completed", "cancelled", "no_show"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export const GROUP_CLASS_STATUSES = ["scheduled", "completed", "cancelled"] as const;
export type GroupClassStatus = (typeof GROUP_CLASS_STATUSES)[number];
export const ENROLLMENT_STATUSES = ["enrolled", "cancelled", "attended", "no_show"] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export interface Booking extends BaseDoc {
  clientId: string;
  clientNameSnapshot: string;
  bookingType: BookingType;
  trainerId: string;
  trainerNameSnapshot: string;
  groupClassId: string;
  date: string;
  startTime: string;
  endTime: string;
  status: BookingStatus;
  notes: string;
  /** PT linkage (empty for non-PT bookings). Session trainer is trainerId; assigned trainer kept separately. */
  ptAssignmentId: string;
  ptPackageId: string;
  ptPackageNameSnapshot: string;
  assignedTrainerId: string;
  assignedTrainerNameSnapshot: string;
  trainerOverride: boolean;
  dateOverride: boolean;
}

export interface GroupClass extends BaseDoc {
  name: string;
  description: string;
  trainerId: string;
  trainerNameSnapshot: string;
  date: string;
  startTime: string;
  endTime: string;
  capacity: number;
  bookedCount: number;
  location: string;
  status: GroupClassStatus;
}

export interface ClassEnrollment {
  id: string;
  groupClassId: string;
  clientId: string;
  clientNameSnapshot: string;
  enrolledAt: Date;
  status: EnrollmentStatus;
}

export const EXPENSE_CATEGORIES = [
  "Rent",
  "Electricity",
  "Equipment",
  "Staff Salary",
  "Incentive",
  "Maintenance",
  "Marketing",
  "Cleaning",
  "Supplies",
  "Other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export const EXPENSE_PAYMENT_METHODS = ["Cash", "UPI", "Card", "Bank Transfer", "Other"] as const;
export type ExpensePaymentMethod = (typeof EXPENSE_PAYMENT_METHODS)[number];

export interface Expense extends BaseDoc {
  title: string;
  category: ExpenseCategory;
  amount: number;
  paymentMethod: ExpensePaymentMethod;
  date: string;
  description: string;
  notes: string;
  createdBy: string;
  createdByUid: string;
  /** Who gave the money: "Gym" (gym cash / account) or a person (staff or owner) who paid from their own pocket. */
  paidBy: string;
  /** Money a person paid for the gym: true once the gym has paid it back. Always true when paidBy is "Gym". */
  settled: boolean;
  settledDate: string;
  settledMethod: string;
}

export type ExpenseActivityAction = "created" | "updated" | "deleted";
export interface ExpenseActivity {
  id: string;
  expenseId: string;
  expenseTitleSnapshot: string;
  action: ExpenseActivityAction;
  createdBy: string;
  createdAt: Date;
}

export const INVOICE_PAYMENT_STATUSES = ["paid", "partial", "pending", "refunded"] as const;
export type InvoicePaymentStatus = (typeof INVOICE_PAYMENT_STATUSES)[number];
export const PAYMENT_METHODS = ["Cash", "UPI", "Card", "Bank Transfer", "Other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface InvoiceItem {
  name: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  packageId: string | null;
}

export interface Invoice extends BaseDoc {
  invoiceNumber: string;
  clientId: string;
  clientNameSnapshot: string;
  clientPhoneSnapshot: string;
  clientEmailSnapshot: string;
  membershipId: string | null;
  packageId: string | null;
  items: InvoiceItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  paymentStatus: InvoicePaymentStatus;
  paymentMethod: PaymentMethod;
  invoiceDate: string;
  dueDate: string;
  notes: string;
  pdfUrl: string;
  publicToken: string;
  createdBy: string;
  createdByUid: string;
  ptAssignmentId: string | null;
  paymentId: string | null;
  enrollmentId: string | null;
  membershipGross: number;
  ptGross: number;
  trainerShareTotal: number;
  paymentsTracked: boolean;
  counsellorId: string;
  counsellorName: string;
  /** Part of the discount that is credit for the unused days of an upgraded plan. */
  upgradeCredit: number;
}

export interface PublicInvoice {
  publicToken: string;
  invoiceNumber: string;
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  items: InvoiceItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  paymentStatus: InvoicePaymentStatus;
  paymentMethod: PaymentMethod;
  invoiceDate: string;
  dueDate: string;
  pdfUrl: string;
  business: BusinessBillingSettings;
  /** Part of the discount that is credit for the unused days of an upgraded plan. */
  upgradeCredit: number;
  updatedAt: Date;
}

export interface BusinessBillingSettings {
  businessName: string;
  logoUrl: string;
  address: string;
  phone: string;
  email: string;
  gstin: string;
  taxEnabled: boolean;
  taxRate: number;
  invoicePrefix: string;
  currency: string;
}

export const FOLLOWUP_STATUSES = ["pending", "completed", "cancelled", "overdue"] as const;
export type FollowUpStatus = (typeof FOLLOWUP_STATUSES)[number];
export const FOLLOWUP_PRIORITIES = ["low", "medium", "high"] as const;
export type FollowUpPriority = (typeof FOLLOWUP_PRIORITIES)[number];
export const FOLLOWUP_SOURCES = ["inquiry", "membership", "renewal", "sales", "general"] as const;
export type FollowUpSource = (typeof FOLLOWUP_SOURCES)[number];
export const CALL_OUTCOMES = [
  "Interested",
  "Not Interested",
  "Call Back",
  "Will Visit",
  "Will Join Later",
  "Joined",
  "No Answer",
  "Wrong Number",
  "Other",
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];
export interface FollowUp extends BaseDoc {
  clientId: string;
  inquiryId: string | null;
  clientNameSnapshot: string;
  phoneSnapshot: string;
  source: FollowUpSource;
  reason: string;
  notes: string;
  followUpDate: string;
  followUpTime: string;
  status: FollowUpStatus;
  priority: FollowUpPriority;
  assignedTo: string;
  lastContactDate: string | null;
  nextAction: string;
  outcome: string;
  automated: boolean;
  parentFollowUpId: string | null;
}

export type CommunicationProviderName = "mock" | "whatsapp";
export type AutomationStatus = "pending" | "queued" | "sent" | "failed" | "cancelled";
export interface RenewalNotification extends BaseDoc {
  membershipId: string;
  clientId: string;
  clientNameSnapshot: string;
  phoneSnapshot: string;
  expiryDate: string;
  reminderDate: string;
  type: "renewal_7_days";
  status: AutomationStatus;
  provider: CommunicationProviderName;
  message: string;
  sentAt: Date | null;
}
export interface BirthdayNotification extends BaseDoc {
  clientId: string;
  clientNameSnapshot: string;
  phoneSnapshot: string;
  birthdayDate: string;
  year: number;
  type: "birthday";
  status: AutomationStatus;
  provider: CommunicationProviderName;
  message: string;
  sentAt: Date | null;
}
export type NotificationType = "renewal" | "birthday" | "follow_up" | "absence";
export type NotificationStatus = "scheduled" | AutomationStatus;
export interface Notification extends BaseDoc {
  type: NotificationType;
  referenceId: string;
  clientId: string;
  clientNameSnapshot: string;
  phoneSnapshot: string;
  message: string;
  status: NotificationStatus;
  provider: CommunicationProviderName;
  scheduledFor: string;
  sentAt: Date | null;
  error: string;
}
export interface AutomationActivity extends BaseDoc {
  type:
    | "followup_created"
    | "followup_completed"
    | "renewal_queued"
    | "birthday_queued"
    | "automation_failed";
  referenceId: string;
  clientId: string;
  clientNameSnapshot: string;
  description: string;
}
export interface AutomationSettings {
  automationEnabled: boolean;
  renewalEnabled: boolean;
  renewalDaysBefore: number;
  birthdayEnabled: boolean;
  followUpRemindersEnabled: boolean;
  absenceEnabled: boolean;
  absenceDays: number;
  /** WhatsApp on the next payment date when a balance is due. */ paymentDueEnabled: boolean;
  /** Daily reminders start this many days before the next payment date. */
  paymentDueDaysBefore: number;
  renewalTemplate: string;
  birthdayTemplate: string;
  timezone: string;
}

export const WHATSAPP_MESSAGE_TYPES = [
  "invoice",
  "renewal",
  "birthday",
  "follow_up",
  "announcement",
  "test",
] as const;
export type WhatsAppMessageType = (typeof WHATSAPP_MESSAGE_TYPES)[number];
export const WHATSAPP_MESSAGE_STATUSES = ["queued", "sent", "delivered", "read", "failed"] as const;
export type WhatsAppMessageStatus = (typeof WHATSAPP_MESSAGE_STATUSES)[number];
export interface WhatsAppMessage extends BaseDoc {
  clientId: string;
  clientNameSnapshot: string;
  phoneSnapshot: string;
  normalizedPhone: string;
  type: WhatsAppMessageType;
  referenceId: string;
  provider: CommunicationProviderName;
  templateName: string;
  templateLanguage: string;
  messagePreview: string;
  status: WhatsAppMessageStatus;
  providerMessageId: string;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  failedAt: Date | null;
  errorCode: string;
  errorMessage: string;
}
export interface WhatsAppSettings {
  enabled: boolean;
  mode: CommunicationProviderName;
  defaultCountryCode: string;
  graphApiVersion: string;
  phoneNumberIdHint: string;
  businessAccountIdHint: string;
  templateLanguage: string;
  invoiceTemplate: string;
  /** Send the bill automatically right after a new member's payment is confirmed. */
  autoSendInvoice: boolean;
  renewalTemplate: string;
  /** Sent on a bill's next payment date while a balance is due. */
  paymentDueTemplate: string;
  birthdayTemplate: string;
  /** Sent when a member has not punched in for `absenceDays` days (Settings → Reminders). */
  absenceTemplate: string;
  /** Announcements page: {{1}} name, {{2}} gym, {{3}} the message. */
  announcementTemplate: string;
  followUpTemplate: string;
}

// ---------------- PT, trainers, payments, enrollment, finance, import ----------------
export const PT_DURATION_TYPES = ["day", "monthly", "yearly", "custom"] as const;
export type PtDurationType = (typeof PT_DURATION_TYPES)[number];
export interface PtPackage extends BaseDoc {
  name: string;
  durationType: PtDurationType;
  durationDays: number;
  price: number;
  description: string;
  isActive: boolean;
  /** Highest discount staff may give, ₹; null = no limit. */ maxDiscount: number | null;
}
export const SHARE_TYPES = ["percentage", "fixed"] as const;
export type ShareType = (typeof SHARE_TYPES)[number];
export interface Trainer extends BaseDoc {
  name: string;
  phone: string;
  email: string;
  specialization: string;
  joiningDate: string;
  status: "active" | "inactive";
  defaultShareType: ShareType;
  defaultTrainerShare: number;
  notes: string;
}
export const PT_ASSIGNMENT_STATUSES = ["pending", "active", "completed", "cancelled"] as const;
export type PtAssignmentStatus = (typeof PT_ASSIGNMENT_STATUSES)[number];
export interface ShareSnapshot {
  ptPrice: number;
  trainerShareType: ShareType;
  trainerShareValue: number;
  trainerShareAmount: number;
  gymShareAmount: number;
}
export interface PtAssignment extends BaseDoc, ShareSnapshot {
  clientId: string;
  clientNameSnapshot: string;
  ptPackageId: string;
  ptPackageNameSnapshot: string;
  trainerId: string;
  trainerNameSnapshot: string;
  startDate: string;
  endDate: string;
  status: PtAssignmentStatus;
  invoiceId: string;
  enrollmentId: string | null;
}
export interface Payment extends BaseDoc {
  clientId: string;
  clientNameSnapshot: string;
  invoiceId: string;
  invoiceNumber: string;
  membershipId: string | null;
  ptAssignmentId: string | null;
  amount: number;
  method: PaymentMethod;
  paymentDate: string;
  kind: "initial" | "balance";
  trainerShareAmount: number;
  gymAmount: number;
  membershipGymAmount: number;
  ptGymAmount: number;
  otherGymAmount: number;
  createdBy: string;
  createdByUid: string;
  counsellorId: string;
  counsellorName: string;
}
export const ENROLLMENT_FLOW_STATUSES = [
  "draft",
  "payment_pending",
  "payment_completed",
  "biometric_pending",
  "active",
  "cancelled",
] as const;
export type EnrollmentFlowStatus = (typeof ENROLLMENT_FLOW_STATUSES)[number];
export interface Enrollment extends BaseDoc {
  clientId: string;
  clientNameSnapshot: string;
  status: EnrollmentFlowStatus;
  membershipId: string | null;
  ptAssignmentId: string | null;
  invoiceId: string;
  paymentId: string | null;
  biometricDeviceId: string;
  biometricUserId: string;
  firstThumbRegistered: boolean;
  lastError: string;
  /** When staff shared the bill on WhatsApp (manual link or API). */
  invoiceSharedAt: Date | null;
}
export const PAYOUT_STATUSES = ["pending", "paid", "cancelled"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];
export interface TrainerPayout extends BaseDoc {
  trainerId: string;
  trainerNameSnapshot: string;
  clientId: string;
  clientNameSnapshot: string;
  ptAssignmentId: string;
  ptPackageNameSnapshot: string;
  invoiceId: string;
  grossAmount: number;
  trainerShareAmount: number;
  gymShareAmount: number;
  paymentDate: string;
  status: PayoutStatus;
  paidAt: string | null;
}
export interface ManualIncome extends BaseDoc {
  title: string;
  category: string;
  amount: number;
  method: PaymentMethod;
  date: string;
  notes: string;
  createdBy: string;
}
export const IMPORT_TYPES = ["packages", "trainers", "clients", "memberships", "expenses"] as const;
export type ImportType = (typeof IMPORT_TYPES)[number];
export interface ImportBatch extends BaseDoc {
  filename: string;
  uploadedBy: string;
  uploadedAt: Date;
  dataType: ImportType;
  rowsFound: number;
  rowsImported: number;
  rowsSkipped: number;
  rowsFailed: number;
  duplicates: number;
  status: ImportBatchStatus;
  fingerprint: string;
}
export type ImportBatchStatus = "processing" | "completed" | "completed_with_errors" | "failed";
export const CUSTOMER_RESPONSES = [
  "Interested",
  "Not Interested",
  "Call Back",
  "Will Visit",
  "Will Join Later",
  "Needs Time",
  "Price Concern",
  "Needs Family Approval",
  "No Answer",
  "Wrong Number",
  "Other",
] as const;
export const NEXT_ACTIONS = [
  "Call Again",
  "Customer Will Call",
  "Customer Will Visit",
  "Schedule Gym Visit",
  "Send Details",
  "Waiting for Decision",
  "Other",
] as const;
export interface LeadLog extends BaseDoc {
  inquiryId: string | null;
  clientId: string;
  customerSaid: string;
  response: string;
  nextAction: string;
  nextCallDate: string;
  nextCallTime: string;
  expectedJoinDate: string;
  expectedVisitDate: string;
  priority: FollowUpPriority;
  notes: string;
  createdBy: string;
}

// ------------------------------------------------------------------ staff, logins, permissions

/** Features an owner can switch on for each staff login (Staff page). */
export const STAFF_FEATURES = [
  "members",
  "leads",
  "billing",
  "daybook",
  "attendance",
  "memberCalls",
  "announcements",
  "finance",
  "packages",
  "classes",
  "reports",
  "activity",
  "devices",
  "settings",
  "deleteMembers",
] as const;
export type StaffFeature = (typeof STAFF_FEATURES)[number];

/** A person who works at the gym (front desk, counsellor, manager, cleaner…). */
export interface Staff extends BaseDoc {
  name: string;
  phone: string;
  role: string;
  joiningDate: string;
  active: boolean;
  /** Shown in the "Counsellor" list when a member joins or renews. */
  isCounsellor: boolean;
  biometricUserId: string;
  biometricDeviceId: string;
  firstThumbRegistered: boolean;
  loginUid: string;
  loginEmail: string;
}

export const INCENTIVE_TYPES = ["none", "percentage", "fixed"] as const;
export type IncentiveType = (typeof INCENTIVE_TYPES)[number];

/** Pay details, visible only to owners and staff with the finance feature. */
export interface StaffPrivate {
  staffId: string;
  monthlySalary: number;
  /** percentage = % of money collected on members they counselled; fixed = ₹ per joining/renewal. */
  incentiveType: IncentiveType;
  incentiveValue: number;
}

export interface StaffAccess {
  uid: string;
  staffId: string;
  name: string;
  email: string;
  active: boolean;
  /** Admin = every feature, like an owner (except creating logins). */
  admin: boolean;
  permissions: StaffFeature[];
}

export interface StaffAttendanceEvent extends BaseDoc {
  staffId: string;
  staffNameSnapshot: string;
  attendanceDate: string;
  timestamp: Date;
  eventType: "check_in" | "check_out";
  source: "biometric" | "manual";
  deviceId: string;
}

export type StaffPaymentKind = "salary" | "incentive";
export interface StaffPayment extends BaseDoc {
  staffId: string;
  staffNameSnapshot: string;
  kind: StaffPaymentKind;
  /** Month paid for, "2026-09". */
  period: string;
  amount: number;
  method: ExpensePaymentMethod;
  date: string;
  expenseId: string;
  notes: string;
  createdBy: string;
}

// ------------------------------------------------------------------ WhatsApp announcements

/** Member groups an announcement can go to (see member-segments). */
export const ANNOUNCEMENT_GROUPS = ["active", "inactive", "blacklist"] as const;
export type AnnouncementGroup = (typeof ANNOUNCEMENT_GROUPS)[number];

export interface AnnouncementRecipient {
  /** "" for a number typed by staff that is not a member. */
  clientId: string;
  name: string;
  /** Digits with country code, e.g. 919849834102. */
  phone: string;
}

/** One WhatsApp announcement (Announcements page). Each number gets it once. */
export interface Announcement extends BaseDoc {
  message: string;
  groups: AnnouncementGroup[];
  typedNumbers: number;
  recipients: AnnouncementRecipient[];
  total: number;
  sent: number;
  failed: number;
  /** Members left out: said no to WhatsApp or no valid number. */
  skipped: number;
  status: "sending" | "done";
  createdByUid: string;
  createdByName: string;
}
