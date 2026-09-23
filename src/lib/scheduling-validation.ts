import { z } from "zod";
import { BOOKING_STATUSES, BOOKING_TYPES, ENROLLMENT_STATUSES, GROUP_CLASS_STATUSES } from "@/types/models";

const text = (label: string, max: number) => z.string().trim().max(max, `${label} must be under ${max} characters`);
const required = (label: string, max: number) => text(label, max).min(1, `${label} is required`);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a valid time");

export const normalizeTrainerId = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

export const bookingSchema = z.object({
  clientId: z.string().trim().max(128),
  clientNameSnapshot: text("Client name", 120),
  bookingType: z.enum(BOOKING_TYPES),
  trainerId: z.string().trim().max(128),
  trainerNameSnapshot: text("Trainer name", 120),
  groupClassId: z.string().trim().max(128),
  date,
  startTime: time,
  endTime: time,
  status: z.enum(BOOKING_STATUSES),
  notes: text("Notes", 1000),
  ptAssignmentId: z.string().max(128).default(""),
  ptPackageId: z.string().max(128).default(""),
  ptPackageNameSnapshot: text("PT package", 120).default(""),
  assignedTrainerId: z.string().max(128).default(""),
  assignedTrainerNameSnapshot: text("Assigned trainer", 120).default(""),
  trainerOverride: z.boolean().default(false),
  dateOverride: z.boolean().default(false),
}).superRefine((value, ctx) => {
  if (value.endTime <= value.startTime) ctx.addIssue({ code: "custom", path: ["endTime"], message: "End time must be after start time" });
  if (value.bookingType !== "group_class" && !value.clientId) ctx.addIssue({ code: "custom", path: ["clientId"], message: "Client is required" });
  if (value.bookingType === "pt" && !value.ptAssignmentId) ctx.addIssue({ code: "custom", path: ["clientId"], message: "No active PT package for this client." });
  if (value.bookingType === "pt" && !value.trainerId) ctx.addIssue({ code: "custom", path: ["trainerNameSnapshot"], message: "Trainer is required" });
  if (value.bookingType === "group_class" && !value.groupClassId) ctx.addIssue({ code: "custom", path: ["groupClassId"], message: "Group class is required" });
});

export const groupClassSchema = z.object({
  name: required("Class name", 100),
  description: text("Description", 1000),
  trainerNameSnapshot: required("Trainer name", 120),
  date,
  startTime: time,
  endTime: time,
  capacity: z.number().int("Capacity must be a whole number").positive("Capacity must be positive").max(500, "Capacity is too high"),
  location: required("Location", 160),
  status: z.enum(GROUP_CLASS_STATUSES),
}).refine((value) => value.endTime > value.startTime, { path: ["endTime"], message: "End time must be after start time" });

export const enrollmentStatusSchema = z.enum(ENROLLMENT_STATUSES);
export const bookingStatusSchema = z.enum(BOOKING_STATUSES);
