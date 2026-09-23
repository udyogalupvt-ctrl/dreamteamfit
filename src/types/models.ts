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
