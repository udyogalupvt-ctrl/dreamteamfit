import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Field } from "@/components/common/form-dialog";
import { FormSection } from "@/components/common/form-section";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAccess } from "@/hooks/use-access";
import { useHealthForm } from "@/hooks/use-health-form";
import { HEALTH_LIMITS, defaultHealthForm, formChanged, newQuestionId } from "@/lib/health-form";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { askEveryoneAgain, saveHealthForm } from "@/services/health-form.service";
import type { HealthFormSettings, HealthQuestion } from "@/types/models";

/** Settings → Member app: the owner writes the health form members accept in their app. */
export function HealthFormEditor() {
  const { owner } = useAccess();
  const { form: saved, gymName, loading } = useHealthForm();
  // null = showing what is saved; the first change makes a draft.
  const [draft, setDraft] = useState<HealthFormSettings | null>(null);
  const [asking, setAsking] = useState(false);
  const [resetting, setResetting] = useState(false);
  const f = draft ?? saved;
  const dirty = !!draft && (formChanged(saved, draft) || draft.enabled !== saved.enabled);
  const edit = (patch: Partial<HealthFormSettings>) => setDraft({ ...f, ...patch });
  const editQ = (i: number, patch: Partial<HealthQuestion>) =>
    edit({ questions: f.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) });
  const move = (i: number, by: number) => {
    const qs = [...f.questions];
    const [q] = qs.splice(i, 1);
    qs.splice(i + by, 0, q!);
    edit({ questions: qs });
  };

  const save = async () => {
    try {
      const version = await saveHealthForm(saved, f);
      setDraft(null);
      toast.success(
        version !== saved.version
          ? `Saved as version ${version}. Members who already filled it stay done.`
          : "Saved",
      );
    } catch (e) {
      toast.error(e instanceof Error && !("code" in e) ? e.message : firestoreErrorMessage(e));
    }
  };

  const id = (k: string) => `hf-${k}`;
  return (
    <FormSection
      title="Health form"
      description="Members fill it once in their app, before training. Yes answers show on the member's profile and in their trainer's app."
      footer={
        owner ? (
          <>
            {dirty ? (
              <span className="mr-auto self-center text-sm text-warning">Not saved yet</span>
            ) : (
              <span className="text-meta mr-auto self-center">
                Version {saved.version}
                {saved.updatedBy ? ` · saved by ${saved.updatedBy}` : ""}
              </span>
            )}
            <Button variant="ghost" onClick={() => setResetting(true)}>
              <RotateCcw aria-hidden /> Starting form
            </Button>
            {saved.enabled ? (
              <Button variant="outline" onClick={() => setAsking(true)} disabled={dirty}>
                Ask everyone again
              </Button>
            ) : null}
            {draft ? (
              <Button variant="outline" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            ) : null}
            <Button onClick={save} disabled={!dirty}>
              Save
            </Button>
          </>
        ) : undefined
      }
    >
      {!owner ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          Only the owner can change the health form.
        </p>
      ) : null}
      <fieldset disabled={!owner || loading} className="grid min-w-0 gap-4">
        <label className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
          <span>
            <span className="block text-sm font-medium">Ask members to fill it</span>
            <span className="text-meta block">
              {f.enabled
                ? "On: members see it on their app's home screen until they fill it."
                : "Off: nobody is asked and nothing shows as pending."}
            </span>
          </span>
          <Switch checked={f.enabled} onCheckedChange={(enabled) => edit({ enabled })} />
        </label>
        {!saved.enabled ? (
          <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <p>
              The questions and consent below are a starting draft written for you, not legal
              advice. Read every line (ask your doctor or lawyer if unsure) and change anything
              before you switch it on.
            </p>
          </div>
        ) : null}
        <Field label="Title" htmlFor={id("title")}>
          <Input
            id={id("title")}
            value={f.title}
            maxLength={HEALTH_LIMITS.title}
            onChange={(e) => edit({ title: e.target.value })}
          />
        </Field>
        <Field label="Note at the top" htmlFor={id("intro")}>
          <Textarea
            id={id("intro")}
            rows={3}
            className="field-sizing-content"
            value={f.intro}
            maxLength={HEALTH_LIMITS.intro}
            onChange={(e) => edit({ intro: e.target.value })}
          />
        </Field>

        <div className="grid gap-3">
          <p className="text-sm font-medium">Questions</p>
          <ol className="grid gap-3">
            {f.questions.map((q, i) => (
              <li key={q.id} className="grid gap-2 rounded-lg border border-border p-3">
                <div className="flex items-start gap-2">
                  <span className="text-meta mt-2 w-5 shrink-0 tabular-nums">{i + 1}.</span>
                  <Textarea
                    aria-label={`Question ${i + 1}`}
                    rows={3}
                    value={q.text}
                    maxLength={HEALTH_LIMITS.question}
                    onChange={(e) => editQ(i, { text: e.target.value })}
                    className="min-h-0 flex-1 field-sizing-content"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 pl-7">
                  <Select
                    value={q.kind}
                    onValueChange={(v) =>
                      editQ(i, { kind: v as HealthQuestion["kind"], detailOnYes: v === "yesno" })
                    }
                  >
                    <SelectTrigger className="h-9 w-40" aria-label={`Answer type ${i + 1}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yesno">Yes / No</SelectItem>
                      <SelectItem value="text">Written answer</SelectItem>
                    </SelectContent>
                  </Select>
                  {q.kind === "yesno" ? (
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={q.detailOnYes}
                        onCheckedChange={(v) => editQ(i, { detailOnYes: v === true })}
                      />
                      Ask for details on Yes
                    </label>
                  ) : null}
                  <span className="ml-auto flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Move question ${i + 1} up`}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Move question ${i + 1} down`}
                      disabled={i === f.questions.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove question ${i + 1}`}
                      onClick={() => edit({ questions: f.questions.filter((_, j) => j !== i) })}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </span>
                </div>
              </li>
            ))}
          </ol>
          {f.questions.length < HEALTH_LIMITS.questions ? (
            <Button
              variant="outline"
              className="justify-self-start"
              onClick={() =>
                edit({
                  questions: [
                    ...f.questions,
                    { id: newQuestionId(f.questions), text: "", kind: "yesno", detailOnYes: true },
                  ],
                })
              }
            >
              <Plus aria-hidden /> Add question
            </Button>
          ) : null}
        </div>

        <Field
          label="What members agree to"
          htmlFor={id("consent")}
          hint="Shown under the questions; the member ticks “I agree” and types their name."
        >
          <Textarea
            id={id("consent")}
            rows={8}
            className="max-h-96 field-sizing-content"
            value={f.consent}
            maxLength={HEALTH_LIMITS.consent}
            onChange={(e) => edit({ consent: e.target.value })}
          />
        </Field>
      </fieldset>

      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title="Ask every member to fill it again?"
        description="Everyone, including members who already filled it, will see the form again the next time they open their app. Their old answers stay on their profile."
        confirmLabel="Ask everyone again"
        onConfirm={() =>
          void askEveryoneAgain(saved).then(
            () => toast.success("Every member will be asked again"),
            (e: unknown) => toast.error(firestoreErrorMessage(e)),
          )
        }
      />
      <ConfirmDialog
        open={resetting}
        onOpenChange={setResetting}
        title="Go back to the starting form?"
        description="Your questions and consent text are replaced by the starting draft. Nothing is saved until you press Save."
        confirmLabel="Use the starting form"
        onConfirm={() => {
          const start = defaultHealthForm(gymName);
          setDraft({ ...start, enabled: f.enabled });
        }}
      />
    </FormSection>
  );
}
