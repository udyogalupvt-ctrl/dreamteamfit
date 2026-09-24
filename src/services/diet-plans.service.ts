import { addDoc, deleteDoc, doc, getDocs, limit, orderBy, query, serverTimestamp, updateDoc, where, type DocumentData } from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { dietPlanSchema } from "@/lib/plan-validation";
import type { DietPlan } from "@/types/models";
import { col, COLLECTIONS, subscribeCollection, toDate } from "./firestore.service";

export type DietPlanInput = Pick<DietPlan, "name" | "goal" | "description" | "dailyCalories" | "mealStructure" | "notes" | "isActive">;
const mapPlan = (id: string, d: DocumentData): DietPlan => ({ id, name: d["name"] ?? "", goal: d["goal"] ?? "Custom", description: d["description"] ?? "", dailyCalories: Number(d["dailyCalories"] ?? 0), mealStructure: d["mealStructure"] ?? "", notes: d["notes"] ?? "", isActive: Boolean(d["isActive"]), createdAt: toDate(d["createdAt"]), updatedAt: toDate(d["updatedAt"]) });
export const subscribeDietPlans = (onData: (v: DietPlan[]) => void, onError: (e: Error) => void) => subscribeCollection(COLLECTIONS.dietPlans, mapPlan, onData, onError, orderBy("createdAt", "desc"));
export async function createDietPlan(input: DietPlanInput) { const safe = dietPlanSchema.parse(input); return (await addDoc(col(COLLECTIONS.dietPlans), { ...safe, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })).id; }
export async function updateDietPlan(id: string, input: Partial<DietPlanInput>) { const safe = dietPlanSchema.partial().parse(input); await updateDoc(doc(db, COLLECTIONS.dietPlans, id), { ...safe, updatedAt: serverTimestamp() }); }
export async function deleteDietPlan(id: string) { const used = await getDocs(query(col(COLLECTIONS.dietAssignments), where("dietPlanId", "==", id), limit(1))); if (!used.empty) throw new Error("This diet plan has assignment history. Deactivate it instead."); await deleteDoc(doc(db, COLLECTIONS.dietPlans, id)); }
