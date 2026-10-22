import { useEffect, useState } from "react";
import { FormDialog } from "@/components/common/form-dialog";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { listHealthRecords } from "@/services/health-form.service";
import type { Client, HealthFormRecord } from "@/types/models";
import { HealthRecordView } from "./health-record-view";

/** Every health form a member filled (app or paper), newest first, with the exact text they saw. */
export function HealthAnswersDialog({
  client,
  open,
  onOpenChange,
}: {
  client: Client;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [records, setRecords] = useState<HealthFormRecord[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setRecords(null);
    setError("");
    listHealthRecords(client.id).then(setRecords, (e: unknown) =>
      setError(firestoreErrorMessage(e)),
    );
  }, [open, client.id]);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Health form · ${client.fullName}`}
      description="What they answered, and the consent they agreed to, each time."
    >
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : !records ? (
        <p className="text-meta">Loading…</p>
      ) : !records.length ? (
        <p className="text-meta">No health form saved yet.</p>
      ) : (
        <div className="space-y-6">
          {records.map((r) => (
            <HealthRecordView key={r.id} record={r} />
          ))}
        </div>
      )}
    </FormDialog>
  );
}
