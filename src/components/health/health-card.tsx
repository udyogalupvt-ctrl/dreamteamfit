import { useState } from "react";
import { HeartPulse, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Field, FormDialog } from "@/components/common/form-dialog";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAccess } from "@/hooks/use-access";
import { useHealthForm } from "@/hooks/use-health-form";
import { formatDateISO } from "@/lib/format";
import { healthStatus } from "@/lib/health-form";
import { toastWithUndo } from "@/lib/undo-toast";
import { cn } from "@/lib/utils";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { markPaperForm } from "@/services/health-form.service";
import type { Client } from "@/types/models";
import { HealthAnswersDialog } from "./health-answers-dialog";

/** Profile header hint (the page opens on the Plan tab): pending, or how many Yes answers to read. */
export function HealthPill({ client, onOpen }: { client: Client; onOpen: () => void }) {
  const { form, loading } = useHealthForm();
  const flags = client.healthForm?.flags.length ?? 0;
  const pending = healthStatus(client.healthForm, form) === "pending";
  if (loading || (!flags && !pending)) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="cursor-pointer rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <StatusPill tone="warning">
        {flags ? `Health: said Yes to ${flags}` : "Health form pending"}
      </StatusPill>
    </button>
  );
}

/** Member profile: did they fill the health form, and what did they say Yes to. */
export function HealthCard({ client, className }: { client: Client; className?: string }) {
  const { can } = useAccess();
  const { form, loading } = useHealthForm();
  const [viewing, setViewing] = useState(false);
  const [paper, setPaper] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const last = client.healthForm;
  const status = healthStatus(last, form);
  // Switched off and never filled: nothing to show.
  if (loading || (status === "off" && !last)) return null;

  const savePaper = async () => {
    setBusy(true);
    try {
      const undo = await markPaperForm(client, form, note);
      setPaper(false);
      setNote("");
      toastWithUndo("Paper health form recorded", undo, client.fullName);
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={cn("surface-card space-y-3 p-4 sm:p-5", className)}>
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
          <HeartPulse className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <h2 className="text-card-title">Health form</h2>
            {status === "pending" ? (
              <StatusPill tone="warning">Pending</StatusPill>
            ) : (
              <StatusPill tone="success">Done</StatusPill>
            )}
          </div>
          <p className="text-meta mt-0.5">
            {last
              ? `Filled ${last.method === "app" ? "in the member app" : "on paper"} on ${formatDateISO(last.signedOn)}${
                  status === "pending"
                    ? " — the form has changed since, so they'll be asked again"
                    : ""
                }.`
              : "Not filled yet. The member app asks them on its home screen."}
          </p>
        </div>
      </div>

      {last?.flags.length ? (
        <div className="space-y-1 rounded-xl border border-warning/50 bg-warning/10 p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-warning">
            <TriangleAlert className="size-4" aria-hidden /> Said Yes to
          </p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {last.flags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      ) : last ? (
        <p className="text-sm">No health problems ticked.</p>
      ) : null}
      {last?.notes.length ? (
        <ul className="space-y-0.5 text-sm text-muted-foreground">
          {last.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {last ? (
          <Button variant="outline" size="sm" onClick={() => setViewing(true)}>
            View answers
          </Button>
        ) : null}
        {status === "pending" && can("members") ? (
          <Button variant="outline" size="sm" onClick={() => setPaper(true)}>
            Received on paper
          </Button>
        ) : null}
      </div>

      <HealthAnswersDialog client={client} open={viewing} onOpenChange={setViewing} />
      <FormDialog
        open={paper}
        onOpenChange={setPaper}
        title="Health form received on paper"
        description={`${client.fullName} filled and signed the paper form. Keep the paper safe.`}
        footer={
          <>
            <Button variant="outline" onClick={() => setPaper(false)}>
              Cancel
            </Button>
            <Button onClick={() => void savePaper()} disabled={busy}>
              Save
            </Button>
          </>
        }
      >
        <Field
          label="What did they answer Yes to?"
          htmlFor="hf-paper-note"
          hint="Leave empty if every answer was No. Shown on their profile and to their trainer."
        >
          <Textarea
            id="hf-paper-note"
            rows={3}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Knee surgery 2024, on BP tablets"
          />
        </Field>
      </FormDialog>
    </section>
  );
}
