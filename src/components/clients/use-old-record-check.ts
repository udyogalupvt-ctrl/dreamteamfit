import { useEffect, useState } from "react";
import { formatDateISO } from "@/lib/format";
import {
  oldPersonFor,
  oldPhoneKey,
  oldPlanInRecords,
  type OldMember,
  type OldPlan,
} from "@/lib/old-data";
import { lookupOldMembers } from "@/services/old-data.service";

export type OldRecordCheck =
  | { state: "off" | "loading" | "unknown" }
  | { state: "found"; plan: OldPlan }
  | { state: "missing"; text: string };

/**
 * Is a plan ticked "paid in the old software" in the old software's records (Backup data)? No
 * fixed last day for the old software: its own records decide. "missing" = they have no plan for
 * these days, so the money was probably paid here (the October check found new cash / UPI saved
 * as old). The phone's records are read once per visit; "unknown" = they couldn't be read.
 */
export function useOldRecordCheck(input: {
  on: boolean;
  phone: string;
  name: string;
  oldMemberId: string;
  kind: "gym" | "pt";
  start: string;
  end: string;
}): OldRecordCheck {
  const key = oldPhoneKey(input.phone);
  const [got, setGot] = useState<{ key: string; members: OldMember[] | null } | null>(null);
  useEffect(() => {
    if (!input.on || key.length < 10) return;
    let live = true;
    lookupOldMembers(key).then(
      (r) => live && setGot({ key, members: r.members }),
      () => live && setGot({ key, members: null }),
    );
    return () => {
      live = false;
    };
  }, [input.on, key]);
  if (!input.on) return { state: "off" };
  if (key.length < 10) return { state: "unknown" };
  if (!got || got.key !== key) return { state: "loading" };
  if (!got.members) return { state: "unknown" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.start)) return { state: "loading" };
  const who = { oldMemberId: input.oldMemberId, name: input.name };
  const plan = oldPlanInRecords(got.members, who, {
    kind: input.kind,
    start: input.start,
    end: input.end,
  });
  if (plan) return { state: "found", plan };
  // Linked to an old record, but none on this phone: the phone changed since; can't tell.
  if (!got.members.length && input.oldMemberId) return { state: "unknown" };
  const person = oldPersonFor(got.members, who);
  const last = [...(person?.plans ?? [])]
    .filter((p) => p.start)
    .sort((a, b) => b.start.localeCompare(a.start))[0];
  return {
    state: "missing",
    text: !got.members.length
      ? "This phone number is not in the old software's records."
      : !person
        ? "The old software has this phone number, but not this member's name."
        : last
          ? `The old software has no plan for them from ${formatDateISO(input.start)}. Their last plan there: ${last.name}, ${formatDateISO(last.start)}${last.end ? ` → ${formatDateISO(last.end)}` : ""}.`
          : "The old software has this member, but no plans.",
  };
}
