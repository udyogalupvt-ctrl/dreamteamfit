/** Firestore-backed domain models. Dates without time are stored as "YYYY-MM-DD" strings. */

export interface BaseDoc {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GymPackage extends BaseDoc {
  name: string;
  description: string;
  durationDays: number;
  price: number;
  isActive: boolean;
}

export const INQUIRY_STATUSES = [
  "new",
  "contacted",
  "interested",
  "follow_up",
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
}

export const MEMBERSHIP_STATUSES = ["active", "expired", "cancelled", "pending"] as const;
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
}

export const WORKOUT_GOALS = ["Weight Loss", "Muscle Gain", "Strength", "Fat Loss", "General Fitness", "Endurance", "Custom"] as const;
export type WorkoutGoal = (typeof WORKOUT_GOALS)[number];
export const DIET_GOALS = ["Weight Loss", "Muscle Gain", "Fat Loss", "Maintenance", "General Fitness", "Custom"] as const;
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

export const EXPENSE_CATEGORIES = ["Rent", "Electricity", "Equipment", "Staff Salary", "Maintenance", "Marketing", "Cleaning", "Supplies", "Other"] as const;
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
