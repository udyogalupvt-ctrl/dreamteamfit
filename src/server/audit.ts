import { FieldValue } from "firebase-admin/firestore";
import { db } from "./admin";

/**
 * Activity-log line for something the server did by itself (device, cron). Staff changes are
 * logged by the app in the same write as the change (src/lib/firestore.ts).
 */
export async function systemAudit(entry: {
  collection: string;
  docId: string;
  summary: string;
  clientId?: string;
  clientName?: string;
}) {
  await db()
    .collection("auditLogs")
    .add({
      at: FieldValue.serverTimestamp(),
      action: "updated",
      clientId: "",
      clientName: "",
      ...entry,
      actorType: "system",
      actorUid: "",
      actorName: "System (automatic)",
      changes: {},
    })
    .catch((e) => console.error("audit write failed", String(e)));
}
