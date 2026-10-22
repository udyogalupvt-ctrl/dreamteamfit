import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "@/lib/firestore";
import { auth, db } from "@/lib/firebase";
import { todayISO } from "@/lib/format";
import { nextFormVersion, normalizeHealthForm, validateFormEdit } from "@/lib/health-form";
import { COLLECTIONS, toDate } from "./firestore.service";
import type { Client, HealthFormRecord, HealthFormSettings } from "@/types/models";

const formRef = () => doc(db, COLLECTIONS.settings, "healthForm");
const who = () => auth.currentUser?.displayName || auth.currentUser?.email || "Owner";

/** settings/healthForm, or the built-in starting form while nothing is saved. */
export function subscribeHealthForm(
  gymName: string,
  onData: (form: HealthFormSettings) => void,
  onError: (e: Error) => void,
) {
  return onSnapshot(
    formRef(),
    (snap) => onData(normalizeHealthForm(snap.data(), gymName)),
    onError,
  );
}

/** Owner saves the form (questions, consent, on/off). The version goes up when the text changed. */
export async function saveHealthForm(saved: HealthFormSettings, edited: HealthFormSettings) {
  const problem = validateFormEdit(edited);
  if (problem) throw new Error(problem);
  const version = nextFormVersion(saved, edited);
  await setDoc(formRef(), {
    enabled: edited.enabled,
    version,
    requiredVersion: Math.min(saved.requiredVersion, version),
    title: edited.title.trim(),
    intro: edited.intro.trim(),
    questions: edited.questions.map((q) => ({ ...q, text: q.text.trim() })),
    consent: edited.consent.trim(),
    updatedBy: who(),
    updatedAt: serverTimestamp(),
  });
  return version;
}

/**
 * "Ask everyone to accept again": a new version that every member must accept, including those
 * who accepted the current text.
 */
export async function askEveryoneAgain(form: HealthFormSettings) {
  const version = form.version + 1;
  await setDoc(formRef(), {
    ...form,
    version,
    requiredVersion: version,
    updatedBy: who(),
    updatedAt: serverTimestamp(),
  });
}

const mapRecord = (id: string, d: Record<string, unknown>): HealthFormRecord => ({
  id,
  clientId: String(d["clientId"] ?? ""),
  clientName: String(d["clientName"] ?? ""),
  version: Number(d["version"]) || 1,
  title: String(d["title"] ?? ""),
  answers: Array.isArray(d["answers"]) ? (d["answers"] as HealthFormRecord["answers"]) : [],
  consent: String(d["consent"] ?? ""),
  signedName: String(d["signedName"] ?? ""),
  method: d["method"] === "paper" ? "paper" : "app",
  by: String(d["by"] ?? ""),
  note: String(d["note"] ?? ""),
  signedOn: String(d["signedOn"] ?? ""),
  createdAt: toDate(d["createdAt"]),
  updatedAt: toDate(d["updatedAt"]),
});

/** Every acceptance of one member, newest first. */
export async function listHealthRecords(clientId: string) {
  const snap = await getDocs(
    query(collection(db, "healthForms"), where("clientId", "==", clientId)),
  );
  return snap.docs
    .map((d) => mapRecord(d.id, d.data()))
    .sort(
      (a, b) =>
        b.signedOn.localeCompare(a.signedOn) || b.createdAt.getTime() - a.createdAt.getTime(),
    );
}

/**
 * A member without the app filled the form on paper: staff record it (with what it said Yes to).
 * Returns the undo.
 */
export async function markPaperForm(client: Client, form: HealthFormSettings, note: string) {
  const ref = doc(collection(db, "healthForms"));
  const signedOn = todayISO();
  const flag = note.trim().slice(0, 500);
  const before = client.healthForm;
  const batch = writeBatch();
  batch.set(ref, {
    clientId: client.id,
    clientName: client.fullName,
    version: form.version,
    title: form.title,
    answers: [],
    consent: form.consent,
    signedName: "",
    method: "paper",
    by: who(),
    note: flag,
    signedOn,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, COLLECTIONS.clients, client.id), {
    healthForm: {
      version: form.version,
      signedOn,
      method: "paper",
      flags: flag ? [flag] : [],
      notes: [],
    },
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  return async () => {
    const undo = writeBatch();
    undo.delete(ref);
    undo.update(doc(db, COLLECTIONS.clients, client.id), {
      healthForm: before ?? null,
      updatedAt: serverTimestamp(),
    });
    await undo.commit();
  };
}
