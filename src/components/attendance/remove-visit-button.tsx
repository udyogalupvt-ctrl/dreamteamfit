import { useState } from "react";
import { format } from "date-fns";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useAccess } from "@/hooks/use-access";
import { removeManualVisit } from "@/services/attendance.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import type { AttendanceEvent } from "@/types/models";

/** "Remove" on a visit staff marked by hand by mistake (thumb punches can't be removed). */
export function RemoveVisitButton({ event: e }: { event: AttendanceEvent }) {
  const { can } = useAccess();
  const [open, setOpen] = useState(false);
  if (e.source !== "manual" || !can("attendance")) return null;
  const when = format(e.timestamp, "dd MMM, hh:mm a");
  const remove = async () => {
    setOpen(false);
    try {
      await removeManualVisit(e);
      toast.success("Visit removed", { description: `${e.clientNameSnapshot} · ${when}` });
    } catch (err) {
      toast.error(firestoreErrorMessage(err));
    }
  };
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove visit of ${e.clientNameSnapshot} at ${when}`}
        onClick={() => setOpen(true)}
      >
        <Trash2 aria-hidden />
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Remove this visit?"
        description={`${e.clientNameSnapshot} · ${when}, marked by hand. Use this only for a visit marked by mistake.`}
        confirmLabel="Remove visit"
        cancelLabel="Keep it"
        destructive
        onConfirm={() => void remove()}
      />
    </>
  );
}
