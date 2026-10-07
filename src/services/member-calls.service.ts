import { doc, onSnapshot, serverTimestamp, setDoc } from "@/lib/firestore";
import { db } from "@/lib/firebase";
import type { OldMember } from "@/lib/old-data";
import type { CallStatus, Segment } from "@/lib/member-segments";
import { col, COLLECTIONS, toDate } from "./firestore.service";

export interface MemberCall {
  key: string;
  clientId: string;
  /** "old" = someone from the old software who has not come back yet (no member here). */
  segment: Segment | "old";
  /** Old software rows: the whole old record, phone key and when they were put on the list. */
  old: OldMember | null;
  phoneKey: string;
  addedAt: Date | null;
  status: CallStatus;
  notes: string;
  updatedBy: string;
  updatedAt: Date;
}

export const subscribeMemberCalls = (ok: (x: MemberCall[]) => void, fail: (e: Error) => void) =>
  onSnapshot(
    col(COLLECTIONS.memberCalls),
    (s) =>
      ok(
        s.docs.map((d) => ({
          key: d.id,
          clientId: String(d.data()["clientId"] ?? ""),
          segment: d.data()["segment"] as Segment | "old",
          old: (d.data()["old"] as OldMember | undefined) ?? null,
          phoneKey: String(d.data()["phoneKey"] ?? ""),
          addedAt: d.data()["addedAt"] ? toDate(d.data()["addedAt"]) : null,
          status: (d.data()["status"] ?? "not_called") as CallStatus,
          notes: String(d.data()["notes"] ?? ""),
          updatedBy: String(d.data()["updatedBy"] ?? ""),
          updatedAt: toDate(d.data()["updatedAt"]),
        })),
      ),
    fail,
  );

/** Saves the call status / notes for one member in one list. */
export async function saveMemberCall(
  key: string,
  input: {
    clientId: string;
    clientName: string;
    segment: Segment | "old";
    status: CallStatus;
    notes: string;
  },
  by: string,
) {
  await setDoc(
    doc(db, COLLECTIONS.memberCalls, key),
    {
      clientId: input.clientId,
      clientNameSnapshot: input.clientName,
      segment: input.segment,
      status: input.status,
      notes: input.notes.trim(),
      updatedBy: by,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}
