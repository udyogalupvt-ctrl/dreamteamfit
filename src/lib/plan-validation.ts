import { z } from "zod";
import { DIET_GOALS, ASSIGNMENT_STATUSES, WORKOUT_GOALS } from "@/types/models";

const safeText = (label: string, max: number) => z.string().trim().max(max, `${label} must be under ${max} characters`);
const requiredText = (label: string, max: number) => safeText(label, max).min(2, `${label} is required`);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date");

export const workoutPlanSchema = z.object({
  name: requiredText("Plan name", 80),
  goal: z.enum(WORKOUT_GOALS),
  description: safeText("Description", 1000),
  durationWeeks: z.number().int("Duration must be a whole number").positive("Duration must be positive").max(104, "Duration is too long"),
  daysPerWeek: z.number().int().min(1, "Choose at least 1 day").max(7, "Days per week cannot exceed 7"),
  isActive: z.boolean(),
});

export const dietPlanSchema = z.object({
  name: requiredText("Plan name", 80),
  goal: z.enum(DIET_GOALS),
  description: safeText("Description", 1000),
  dailyCalories: z.number().finite("Enter valid calories").min(0, "Calories cannot be negative").max(20000, "Calories are too high"),
  mealStructure: safeText("Meal structure", 3000),
  notes: safeText("Notes", 1500),
  isActive: z.boolean(),
});

export const workoutAssignmentSchema = z.object({
  clientId: z.string().trim().min(1).max(128),
  workoutPlanId: z.string().trim().min(1).max(128),
  startDate: date,
  notes: safeText("Notes", 1000),
});

export const dietAssignmentSchema = z.object({
  clientId: z.string().trim().min(1).max(128),
  dietPlanId: z.string().trim().min(1).max(128),
  startDate: date,
  endDate: date,
  notes: safeText("Notes", 1000),
}).refine((v) => v.endDate >= v.startDate, { path: ["endDate"], message: "End date must be on or after the start date" });

export const assignmentStatusSchema = z.enum(ASSIGNMENT_STATUSES);
