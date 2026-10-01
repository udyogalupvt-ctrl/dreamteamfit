import { toast } from "sonner";
import { firestoreErrorMessage } from "@/services/firestore.service";

/**
 * "Done" message with an Undo button (12 seconds), for anything done by mistake: a delete, a
 * cancel, a payment, blocking entry…
 */
export function toastWithUndo(
  message: string,
  undo: (() => Promise<unknown>) | undefined,
  description?: string,
) {
  toast.success(message, {
    ...(description ? { description } : {}),
    duration: 12000,
    ...(undo
      ? {
          action: {
            label: "Undo",
            onClick: () =>
              void undo().then(
                () => toast.success("Undone"),
                (e: unknown) => toast.error(firestoreErrorMessage(e)),
              ),
          },
        }
      : {}),
  });
}
