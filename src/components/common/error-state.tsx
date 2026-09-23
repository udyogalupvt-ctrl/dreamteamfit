import { AlertTriangle } from "lucide-react";
import { firestoreErrorMessage } from "@/services/firestore.service";

export function ErrorState({ error, title = "Couldn't load data" }: { error: unknown; title?: string }) {
  return (
    <div
      role="alert"
      className="surface-card flex flex-col items-center px-6 py-12 text-center"
    >
      <span className="grid size-12 place-items-center rounded-2xl bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/25">
        <AlertTriangle className="size-5" aria-hidden />
      </span>
      <h3 className="text-section-title mt-4">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{firestoreErrorMessage(error)}</p>
    </div>
  );
}
