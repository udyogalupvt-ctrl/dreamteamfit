import { addDays, format, parseISO } from "date-fns";
import type { AssignmentStatus, BookingStatus, EnrollmentStatus, GroupClassStatus, InquiryStatus, LeadSource, MembershipStatus } from "@/types/models";
import type { StatTone } from "@/types";

/** Digits only, last 10 digits (strips +91 / leading 0) for reliable comparison. */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function todayISO(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function addDaysISO(dateISO: string, days: number): string {
  return format(addDays(parseISO(dateISO), days), "yyyy-MM-dd");
}

export function formatDateISO(value: string | null | undefined): string {
  if (!value) return "—";
  return format(parseISO(value), "d MMM yyyy");
}

export function formatDate(value: Date | null | undefined): string {
  return value ? format(value, "d MMM yyyy") : "—";
}

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
export const formatPrice = (value: number) => inr.format(value);
export const formatNumber = (value: number) => new Intl.NumberFormat("en-IN").format(value);

export function formatDuration(days: number): string {
  const map: Record<number, string> = {
    30: "1 month",
    60: "2 months",
    90: "3 months",
    180: "6 months",
    365: "1 year",
  };
  return map[days] ?? `${days} days`;
}

export const DURATION_OPTIONS = [30, 60, 90, 180, 365] as const;

export const SOURCE_LABELS: Record<LeadSource, string> = {
  walk_in: "Walk-in",
  instagram: "Instagram",
  facebook: "Facebook",
  google: "Google",
  referral: "Referral",
  website: "Website",
  phone: "Phone call",
  other: "Other",
};

export const INQUIRY_STATUS_META: Record<InquiryStatus, { label: string; tone: StatTone }> = {
  new: { label: "New", tone: "info" },
  contacted: { label: "Contacted", tone: "violet" },
  interested: { label: "Interested", tone: "primary" },
  follow_up: { label: "Follow-up", tone: "warning" },
  converted: { label: "Converted", tone: "success" },
  lost: { label: "Lost", tone: "danger" },
};

export const MEMBERSHIP_STATUS_META: Record<MembershipStatus, { label: string; tone: StatTone }> = {
  active: { label: "Active", tone: "success" },
  pending: { label: "Upcoming", tone: "info" },
  expired: { label: "Expired", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "warning" },
};

export const ASSIGNMENT_STATUS_META: Record<AssignmentStatus, { label: string; tone: StatTone }> = {
  active: { label: "Active", tone: "success" },
  completed: { label: "Completed", tone: "info" },
  cancelled: { label: "Cancelled", tone: "warning" },
};

export const BOOKING_STATUS_META: Record<BookingStatus, { label: string; tone: StatTone }> = {
  scheduled: { label: "Scheduled", tone: "primary" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "warning" },
  no_show: { label: "No-show", tone: "danger" },
};

export const GROUP_CLASS_STATUS_META: Record<GroupClassStatus, { label: string; tone: StatTone }> = {
  scheduled: { label: "Scheduled", tone: "primary" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "warning" },
};

export const ENROLLMENT_STATUS_META: Record<EnrollmentStatus, { label: string; tone: StatTone }> = {
  enrolled: { label: "Enrolled", tone: "primary" },
  attended: { label: "Attended", tone: "success" },
  cancelled: { label: "Cancelled", tone: "warning" },
  no_show: { label: "No-show", tone: "danger" },
};

export function formatTime(value: string): string {
  if (!/^\d{2}:\d{2}$/.test(value)) return value || "—";
  const [hours = 0, minutes = 0] = value.split(":").map(Number);
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).format(
    new Date(2000, 0, 1, hours, minutes),
  );
}

/** Status adjusted for dates: an "active" membership past its end date reads as expired. */
export function effectiveMembershipStatus(m: {
  status: MembershipStatus;
  startDate: string;
  endDate: string;
}): MembershipStatus {
  const today = todayISO();
  if (m.status === "active" && m.endDate < today) return "expired";
  if (m.status === "pending" && m.startDate <= today && m.endDate >= today) return "active";
  if (m.status === "pending" && m.endDate < today) return "expired";
  return m.status;
}

export function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?"
  );
}
