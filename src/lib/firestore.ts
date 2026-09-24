/**
 * The app's Firestore, with two things added to every write (no Cloud Functions needed):
 *
 * 1. Activity log: each change also writes an /auditLogs line IN THE SAME atomic write, with the
 *    signed-in staff account. Firestore rules let the app only create log lines (never edit or
 *    delete them), and only as itself with the server's clock.
 * 2. Door lock: a plan / PT / entry-block change queues a "door_check" note, and deleting a
 *    member queues a "forget" note. The server handles them on the fingerprint device's next poll.
 *
 * Import Firestore from "@/lib/firestore" instead of "firebase/firestore" everywhere in the app.
 */
import * as fs from "firebase/firestore";
import type {
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  SetOptions,
  Transaction,
  WriteBatch,
} from "firebase/firestore";
import { AUDIT_SKIP, auditLine } from "@/lib/audit-describe";
import { auth, db } from "@/lib/firebase";

export * from "firebase/firestore";

type D = Record<string, unknown>;
type Op =
  | { kind: "set"; ref: DocumentReference; data: D; merge: boolean }
  | { kind: "update"; ref: DocumentReference; data: D }
  | { kind: "delete"; ref: DocumentReference };

/** Above this many writes in one batch (imports, member delete), log one summary line instead. */
const BULK = 20;
const DOOR_COLLECTIONS = new Set(["memberships", "ptAssignments"]);

const collectionOf = (ref: DocumentReference) => ref.parent.id;

/** What the document will look like after the write (sentinels shown as markers). */
function applyWrite(op: Op, before: D | null): D | null {
  if (op.kind === "delete") return null;
  const base = op.kind === "set" && !op.merge ? {} : { ...(before ?? {}) };
  for (const [k, v] of Object.entries(op.data)) {
    if (v instanceof fs.FieldValue) {
      if (v.isEqual(fs.deleteField())) delete base[k];
      else base[k] = `(${k} updated)`;
    } else base[k] = v;
  }
  return base;
}

function actor() {
  const u = auth.currentUser;
  return {
    actorType: "app_user",
    actorUid: u?.uid ?? "",
    actorName: u?.email || u?.displayName || u?.uid || "",
  };
}

type Extra = { ref: DocumentReference; data: D };

/** Log lines and door notes for a set of writes whose "before" state is known. */
function sideWrites(ops: { op: Op; before: D | null }[]): Extra[] {
  const out: Extra[] = [];
  const logs = fs.collection(db, "auditLogs");
  const commands = fs.collection(db, "biometricCommands");
  const doorFor = new Set<string>();
  const now = fs.serverTimestamp();
  const note = (type: string, clientId: string, pin = "", deviceId = "", staffId = "") =>
    out.push({
      ref: fs.doc(commands),
      data: {
        type,
        clientId,
        staffId,
        deviceId,
        biometricUserId: pin,
        serialNumber: "",
        enrollmentId: null,
        command: "",
        order: 0,
        door: true,
        status: "pending",
        cmdNo: null,
        returnCode: null,
        error: "",
        sentAt: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    });

  for (const { op, before } of ops) {
    const col = collectionOf(op.ref);
    const after = applyWrite(op, before);
    const line = auditLine(col, op.ref.id, before, after);
    if (line) out.push({ ref: fs.doc(logs), data: { ...line, at: now, ...actor() } });

    const doc = (after ?? before ?? {}) as D;
    if (DOOR_COLLECTIONS.has(col)) {
      const waiting = (x: D | null) => !x || x["status"] === "biometric_pending";
      const clientId = String(doc["clientId"] ?? "");
      // A new member's plan starts only when the thumb is registered (done on the server).
      if (clientId && !(waiting(before) && waiting(after))) doorFor.add(clientId);
    } else if (
      col === "staff" &&
      before &&
      after &&
      before["active"] !== false &&
      after["active"] === false
    ) {
      if (before["biometricUserId"])
        note(
          "staff_off",
          "",
          String(before["biometricUserId"]),
          String(before["biometricDeviceId"] ?? ""),
          op.ref.id,
        );
    } else if (col === "clients" && before) {
      if (!after && before["biometricUserId"])
        note(
          "forget",
          op.ref.id,
          String(before["biometricUserId"]),
          String(before["biometricDeviceId"] ?? ""),
        );
      else if (
        after &&
        before["biometricStatus"] !== after["biometricStatus"] &&
        before["firstThumbRegistered"]
      )
        doorFor.add(op.ref.id);
    }
  }
  doorFor.forEach((clientId) => note("door_check", clientId));
  return out;
}

function bulkLine(ops: Op[]): Extra {
  const counts = new Map<string, number>();
  ops.forEach((o) => {
    const key = `${o.kind === "delete" ? "deleted" : "saved"} ${collectionOf(o.ref)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return {
    ref: fs.doc(fs.collection(db, "auditLogs")),
    data: {
      at: fs.serverTimestamp(),
      collection: "bulk",
      docId: "",
      action: "updated",
      summary: `Bulk change (${ops.length} records): ${[...counts].map(([k, n]) => `${n} ${k}`).join(", ")}`,
      clientId: "",
      clientName: "",
      changes: {},
      ...actor(),
    },
  };
}

/** Old state of the document, read only for collections that are logged. */
const beforeOf = async (op: Op) => {
  if (AUDIT_SKIP.has(collectionOf(op.ref))) return null;
  const snap = await fs.getDoc(op.ref);
  return snap.exists() ? (snap.data() as D) : null;
};

async function commitWithLog(ops: Op[], apply: (b: WriteBatch) => void) {
  const batch = fs.writeBatch(db);
  apply(batch);
  if (ops.length > BULK) {
    // Big batches: still log each member deletion by name, the rest as one line.
    const members = ops.filter((o) => collectionOf(o.ref) === "clients");
    const befores = await Promise.all(members.map(beforeOf));
    sideWrites(members.map((op, i) => ({ op, before: befores[i] ?? null }))).forEach((x) =>
      batch.set(x.ref, x.data),
    );
    const log = bulkLine(ops.filter((o) => collectionOf(o.ref) !== "clients"));
    // The bulk line goes in a separate write when the batch is already at Firestore's limit.
    if (ops.length + members.length + 2 <= 500) batch.set(log.ref, log.data);
    else await fs.setDoc(log.ref, log.data);
  } else {
    const befores = await Promise.all(ops.map(beforeOf));
    sideWrites(ops.map((op, i) => ({ op, before: befores[i] ?? null }))).forEach((x) =>
      batch.set(x.ref, x.data),
    );
  }
  await batch.commit();
}

// ------------------------------------------------------------------ single writes

export async function setDoc<T>(
  ref: DocumentReference<T>,
  data: fs.WithFieldValue<T>,
): Promise<void>;
export async function setDoc<T>(
  ref: DocumentReference<T>,
  data: fs.PartialWithFieldValue<T>,
  options: SetOptions,
): Promise<void>;
export async function setDoc(ref: DocumentReference, data: D, options?: SetOptions) {
  const merge = Boolean(options && ("merge" in options ? options.merge : true));
  const op: Op = { kind: "set", ref, data, merge };
  await commitWithLog([op], (b) => (options ? b.set(ref, data, options) : b.set(ref, data)));
}

export async function updateDoc(
  ref: DocumentReference,
  data: fs.UpdateData<DocumentData>,
): Promise<void> {
  const op: Op = { kind: "update", ref, data: data as D };
  await commitWithLog([op], (b) => b.update(ref, data));
}

export async function deleteDoc(ref: DocumentReference): Promise<void> {
  await commitWithLog([{ kind: "delete", ref }], (b) => b.delete(ref));
}

export async function addDoc<T>(
  collectionRef: fs.CollectionReference<T>,
  data: fs.WithFieldValue<T>,
): Promise<DocumentReference<T>> {
  const ref = fs.doc(collectionRef);
  const op: Op = { kind: "set", ref: ref as DocumentReference, data: data as D, merge: false };
  const batch = fs.writeBatch(db);
  batch.set(ref, data);
  sideWrites([{ op, before: null }]).forEach((x) => batch.set(x.ref, x.data));
  await batch.commit();
  return ref;
}

// ------------------------------------------------------------------ batches

export function writeBatch(firestore: Firestore = db): WriteBatch {
  if (firestore !== db) return fs.writeBatch(firestore);
  const ops: Op[] = [];
  const calls: ((b: WriteBatch) => void)[] = [];
  const wrapper = {
    set(ref: DocumentReference, data: D, options?: SetOptions) {
      ops.push({ kind: "set", ref, data, merge: Boolean(options) });
      calls.push((b) => (options ? b.set(ref, data, options) : b.set(ref, data)));
      return wrapper;
    },
    update(ref: DocumentReference, data: D) {
      ops.push({ kind: "update", ref, data });
      calls.push((b) => b.update(ref, data));
      return wrapper;
    },
    delete(ref: DocumentReference) {
      ops.push({ kind: "delete", ref });
      calls.push((b) => b.delete(ref));
      return wrapper;
    },
    commit: () => commitWithLog(ops, (b) => calls.forEach((c) => c(b))),
  };
  return wrapper as unknown as WriteBatch;
}

// ------------------------------------------------------------------ transactions

/**
 * Log lines are written inside the same transaction, after the caller's own writes (Firestore
 * allows writes after reads). "Before" is whatever the transaction read for that document.
 */
export function runTransaction<T>(
  firestore: Firestore,
  updateFunction: (tx: Transaction) => Promise<T>,
  options?: fs.TransactionOptions,
): Promise<T> {
  return fs.runTransaction(
    firestore,
    async (tx) => {
      const seen = new Map<string, D | null>();
      const ops: Op[] = [];
      const wrapped = {
        async get(ref: DocumentReference) {
          const snap: DocumentSnapshot = await tx.get(ref);
          seen.set(ref.path, snap.exists() ? (snap.data() as D) : null);
          return snap;
        },
        set(ref: DocumentReference, data: D, opts?: SetOptions) {
          ops.push({ kind: "set", ref, data, merge: Boolean(opts) });
          if (opts) tx.set(ref, data, opts);
          else tx.set(ref, data);
          return wrapped;
        },
        update(ref: DocumentReference, data: D) {
          ops.push({ kind: "update", ref, data });
          tx.update(ref, data);
          return wrapped;
        },
        delete(ref: DocumentReference) {
          ops.push({ kind: "delete", ref });
          tx.delete(ref);
          return wrapped;
        },
      };
      const result = await updateFunction(wrapped as unknown as Transaction);
      // An update always has an existing document; if the transaction didn't read it, compare to {}.
      const withBefore = ops.map((op) => ({
        op,
        before: seen.has(op.ref.path)
          ? (seen.get(op.ref.path) ?? null)
          : op.kind === "set"
            ? null
            : {},
      }));
      sideWrites(withBefore).forEach((x) => tx.set(x.ref, x.data));
      return result;
    },
    options,
  );
}
