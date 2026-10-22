import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ErrorState } from "@/components/common/error-state";
import { Shimmer } from "@/components/common/loading-state";
import { useAccess } from "@/hooks/use-access";
import { todayISO } from "@/lib/format";
import { toastWithUndo } from "@/lib/undo-toast";
import {
  deleteBodyEntry,
  deskAuthor,
  saveBodyEntry,
  subscribeBodyProgress,
} from "@/services/body-progress.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import type { BodyEntry } from "@/types/models";
import { ProgressPanel } from "./progress-panel";

/** Member profile → More → Body progress. Read only while open (one doc per member). */
export function ClientProgressSection({ clientId }: { clientId: string }) {
  const { can } = useAccess();
  const allowed = can("members");
  const [entries, setEntries] = useState<BodyEntry[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    if (!allowed) return;
    return subscribeBodyProgress(clientId, setEntries, setError);
  }, [clientId, allowed]);

  if (!allowed) return null;
  if (error) return <ErrorState error={error} title="Couldn't load body progress" />;
  if (!entries) return <Shimmer className="h-64 w-full" />;
  return (
    <ProgressPanel
      entries={entries}
      actor={{ kind: "staff", id: deskAuthor().id }}
      today={todayISO()}
      canAdd
      onSave={async (input, id) => {
        try {
          await saveBodyEntry(clientId, input, id);
        } catch (e) {
          throw new Error(firestoreErrorMessage(e));
        }
        toast.success(id ? "Entry changed" : "Progress saved");
      }}
      onDelete={async (entry) => {
        try {
          toastWithUndo("Entry removed", await deleteBodyEntry(clientId, entry));
        } catch (e) {
          toast.error(firestoreErrorMessage(e));
        }
      }}
    />
  );
}
