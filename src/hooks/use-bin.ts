import { toast } from "sonner";
import { useAccess } from "@/hooks/use-access";
import { useAuth } from "@/hooks/use-auth";
import { toastWithUndo } from "@/lib/undo-toast";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { restoreBinById, type Deleter } from "@/services/recycle-bin.service";

/**
 * Deleting from any page: who may delete in a section (canDelete), and `remove`, which moves the
 * thing to the Recycle Bin stamped with who did it, then offers Undo on the message.
 */
export function useBin() {
  const { user } = useAuth();
  const { role, canDelete, can } = useAccess();
  const by: Deleter = {
    uid: user?.uid ?? "",
    name: user?.displayName || user?.email || "Staff",
    role,
  };
  const viewer = { owner: can("recycleBin"), uid: user?.uid ?? "" };
  const remove = async (what: string, move: (by: Deleter) => Promise<string>) => {
    try {
      const binId = await move(by);
      toastWithUndo(
        `${what} moved to the Recycle Bin`,
        () => restoreBinById(binId, by, viewer),
        can("recycleBin")
          ? "Restore it any time from the Recycle Bin."
          : "The owner can restore it.",
      );
      return true;
    } catch (e) {
      toast.error("Couldn't delete", { description: firestoreErrorMessage(e) });
      return false;
    }
  };
  return { canDelete, remove };
}
