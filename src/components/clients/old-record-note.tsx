import { TriangleAlert } from "lucide-react";
import { useOldRecordCheck } from "@/components/clients/use-old-record-check";
import type { Client } from "@/types/models";

/**
 * Edit plan / Edit PT plan of a plan saved as paid in the old software that its records don't
 * have: probably money paid here, ticked as old by mistake. Information only (the owner decides).
 */
export function OldRecordNote({
  on,
  client,
  kind,
  start,
  end,
}: {
  on: boolean;
  client: Pick<Client, "phone" | "fullName" | "oldMemberId"> | null | undefined;
  kind: "gym" | "pt";
  start: string;
  end: string;
}) {
  const check = useOldRecordCheck({
    on: on && !!client,
    phone: client?.phone ?? "",
    name: client?.fullName ?? "",
    oldMemberId: client?.oldMemberId ?? "",
    kind,
    start,
    end,
  });
  if (check.state !== "missing") return null;
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-xl border border-warning/50 bg-warning/10 p-3 text-sm"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <p className="min-w-0">
        <b>Not in the old software's records.</b> {check.text} If it was paid here by cash or UPI,
        Remove this plan (added by mistake) and sell it again with the right mode, so the Day Book
        and Collected count it.
      </p>
    </div>
  );
}
