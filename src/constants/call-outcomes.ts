import type { FollowUpPriority, InquiryStatus } from "@/types/models";

/** What the person said on the call, and what that means for the next step. */
export interface CallOutcome {
  id: string;
  label: string;
  for: "lead" | "member" | "both";
  status: InquiryStatus | null;
  /** Which date the caller must fill; the next call is scheduled from it. */
  date: "join" | "visit" | "call" | null;
  defaultDays: number;
  nextAction: string;
  priority: FollowUpPriority;
  tone: "good" | "neutral" | "bad";
  /** Joined: opens the joining form (front desk only). */
  convert?: boolean;
}

/** Shared by the front desk (Leads & Follow-ups) and the trainer app (Calls). */
export const CALL_OUTCOME_OPTIONS: CallOutcome[] = [
  {
    id: "join",
    label: "Will join",
    for: "lead",
    status: "expected_to_join",
    date: "join",
    defaultDays: 2,
    nextAction: "Confirm joining",
    priority: "high",
    tone: "good",
  },
  {
    id: "visit",
    label: "Will visit the gym",
    for: "lead",
    status: "interested",
    date: "visit",
    defaultDays: 1,
    nextAction: "Expecting gym visit",
    priority: "high",
    tone: "good",
  },
  {
    id: "renew",
    label: "Will renew / pay",
    for: "member",
    status: null,
    date: "call",
    defaultDays: 2,
    nextAction: "Confirm renewal",
    priority: "high",
    tone: "good",
  },
  {
    id: "call_later",
    label: "Call me later",
    for: "both",
    status: "follow_up",
    date: "call",
    defaultDays: 2,
    nextAction: "Call again",
    priority: "medium",
    tone: "neutral",
  },
  {
    id: "thinking",
    label: "Thinking / needs time",
    for: "both",
    status: "interested",
    date: "call",
    defaultDays: 3,
    nextAction: "Call again",
    priority: "medium",
    tone: "neutral",
  },
  {
    id: "price",
    label: "Price concern",
    for: "both",
    status: "interested",
    date: "call",
    defaultDays: 3,
    nextAction: "Offer / discuss price",
    priority: "medium",
    tone: "neutral",
  },
  {
    id: "no_answer",
    label: "Didn't pick up",
    for: "both",
    status: "contacted",
    date: "call",
    defaultDays: 1,
    nextAction: "Try calling again",
    priority: "medium",
    tone: "neutral",
  },
  {
    id: "joined",
    label: "Joined today",
    for: "lead",
    status: null,
    date: null,
    defaultDays: 0,
    nextAction: "",
    priority: "low",
    tone: "good",
    convert: true,
  },
  {
    id: "not_interested",
    label: "Not interested",
    for: "both",
    status: "lost",
    date: null,
    defaultDays: 0,
    nextAction: "",
    priority: "low",
    tone: "bad",
  },
  {
    id: "wrong",
    label: "Wrong number",
    for: "both",
    status: "lost",
    date: null,
    defaultDays: 0,
    nextAction: "",
    priority: "low",
    tone: "bad",
  },
];
