import { addDoc, deleteDoc, doc, getDocs, limit, orderBy, query, serverTimestamp, updateDoc, where, type DocumentData } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { workoutPlanSchema } from "@/lib/plan-validation";
import type { WorkoutPlan } from "@/types/models";
import { col, COLLECTIONS, subscribeCollection, toDate } from "./firestore.service";

export type WorkoutPlanInput = Pick<WorkoutPlan, "name" | "goal" | "description" | "durationWeeks" | "daysPerWeek" | "isActive">;
const mapPlan = (id: string, d: DocumentData): WorkoutPlan => ({ id, name: d["name"] ?? "", goal: d["goal"] ?? "Custom", description: d["description"] ?? "", durationWeeks: Number(d["durationWeeks"] ?? 0), daysPerWeek: Number(d["daysPerWeek"] ?? 0), isActive: Boolean(d["isActive"]), createdAt: toDate(d["createdAt"]), updatedAt: toDate(d["updatedAt"]) });
export const subscribeWorkoutPlans = (onData: (v: WorkoutPlan[]) => void, onError: (e: Error) => void) => subscribeCollection(COLLECTIONS.workoutPlans, mapPlan, onData, onError, orderBy("createdAt", "desc"));
export async function createWorkoutPlan(input: WorkoutPlanInput) { const safe = workoutPlanSchema.parse(input); return (await addDoc(col(COLLECTIONS.workoutPlans), { ...safe, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })).id; }
export async function updateWorkoutPlan(id: string, input: Partial<WorkoutPlanInput>) { const safe = workoutPlanSchema.partial().parse(input); await updateDoc(doc(db, COLLECTIONS.workoutPlans, id), { ...safe, updatedAt: serverTimestamp() }); }
export async function deleteWorkoutPlan(id: string) { const used = await getDocs(query(col(COLLECTIONS.workoutAssignments), where("workoutPlanId", "==", id), limit(1))); if (!used.empty) throw new Error("This workout plan has assignment history. Deactivate it instead."); await deleteDoc(doc(db, COLLECTIONS.workoutPlans, id)); }
