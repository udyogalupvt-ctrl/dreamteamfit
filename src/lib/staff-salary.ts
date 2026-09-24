import { addDaysISO } from "@/lib/format";
import type { StaffAttendanceEvent } from "@/types/models";

/** What staff (admin / receptionist) can set for a day; "auto" = follow the thumb punches. */
export const DAY_MARKS = ["present", "half", "absent", "leave"] as const;
export type DayMark = (typeof DAY_MARKS)[number];
export const DAY_MARK_LABELS: Record<DayMark | "auto", string> = {
  auto: "Auto (thumb)",
  present: "Present",
  half: "Half day",
  absent: "Absent",
  leave: "Paid leave",
};

export type DayStatus = DayMark | "holiday" | "upcoming" | "notJoined";
export const DAY_STATUS_META: Record<
  DayStatus,
  { short: string; className: string; label: string }
> = {
  present: { short: "P", className: "bg-success/20 text-success", label: "Present" },
  half: { short: "½", className: "bg-warning/25 text-warning", label: "Half day" },
  absent: { short: "A", className: "bg-destructive/15 text-destructive", label: "Absent" },
  leave: { short: "L", className: "bg-info/20 text-info", label: "Paid leave" },
  holiday: { short: "S", className: "bg-muted text-muted-foreground", label: "Sunday (holiday)" },
  upcoming: { short: "", className: "bg-transparent text-muted-foreground", label: "Not yet" },
  notJoined: {
    short: "–",
    className: "bg-transparent text-muted-foreground",
    label: "Before joining",
  },
};

export interface DayMarkDoc {
  staffId: string;
  date: string;
  status: DayMark;
}

export interface StaffMonth {
  days: { date: string; status: DayStatus; marked: boolean }[];
  present: number;
  half: number;
  absent: number;
  leave: number;
  /** Paid leaves allowed this month (owner sets; 0 by default). */
  paidLeaves: number;
  daySalary: number;
  /** Days before joining (not employed yet). */
  notJoined: number;
  /** Absent + leave days beyond the paid leaves, half of the half days, and days before joining. */
  deductionDays: number;
  deduction: number;
  payable: number;
}

const isSunday = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay() === 0;

/**
 * One staff member's month: every day is present (thumb punch or marked), half day, absent,
 * paid leave, Sunday holiday, or not yet come. Day salary = monthly ÷ 30.
 */
export function staffMonth(
  staffId: string,
  month: string,
  monthlySalary: number,
  paidLeaves: number,
  punches: Pick<StaffAttendanceEvent, "staffId" | "attendanceDate">[],
  marks: DayMarkDoc[],
  today: string,
  /** Days before this are "before joining": not counted as absent, and not paid. */
  joiningDate = "",
): StaffMonth {
  const punched = new Set(
    punches.filter((p) => p.staffId === staffId).map((p) => p.attendanceDate),
  );
  const marked = new Map(marks.filter((m) => m.staffId === staffId).map((m) => [m.date, m.status]));
  const days: StaffMonth["days"] = [];
  for (let d = `${month}-01`; d.startsWith(month); d = addDaysISO(d, 1)) {
    const mark = marked.get(d);
    const status: DayStatus =
      joiningDate && d < joiningDate
        ? "notJoined"
        : mark
          ? mark
          : d > today
            ? "upcoming"
            : punched.has(d)
              ? "present"
              : isSunday(d)
                ? "holiday"
                : "absent";
    days.push({ date: d, status, marked: !!mark });
  }
  const count = (s: DayStatus) => days.filter((d) => d.status === s).length;
  const present = count("present");
  const half = count("half");
  const absent = count("absent");
  const leave = count("leave");
  const daySalary = monthlySalary / 30;
  const notJoined = count("notJoined");
  const deductionDays = Math.max(0, absent + leave - paidLeaves) + half * 0.5 + notJoined;
  const deduction = Math.round(deductionDays * daySalary);
  return {
    days,
    present,
    half,
    absent,
    leave,
    paidLeaves,
    notJoined,
    daySalary,
    deductionDays,
    deduction,
    payable: Math.max(0, Math.round(monthlySalary - deduction)),
  };
}
