import { useState } from "react";
import { CheckCircle2, HeartPulse, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { HealthRecordView } from "@/components/health/health-record-view";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { PortalHealth, PortalHealthRecord } from "@/constants/portal";
import { HEALTH_LIMITS, buildAnswers, validateAnswers } from "@/lib/health-form";
import { portalCall } from "@/lib/portal-firebase";
import { cn } from "@/lib/utils";
import { day } from "./portal-shell";

type Answers = Record<string, { answer: "" | "yes" | "no"; detail: string }>;

/** Member app → Health form: fill it (when the gym asks) or read what was filled. */
export function HealthFormView({
  health,
  memberName,
  onSaved,
}: {
  health: PortalHealth;
  memberName: string;
  onSaved: () => void;
}) {
  return health.status === "pending" ? (
    <FillForm health={health} memberName={memberName} onSaved={onSaved} />
  ) : (
    <Filled health={health} />
  );
}

function FillForm({
  health,
  memberName,
  onSaved,
}: {
  health: PortalHealth;
  memberName: string;
  onSaved: () => void;
}) {
  const { form, last } = health;
  const [answers, setAnswers] = useState<Answers>({});
  const [agreed, setAgreed] = useState(false);
  const [signedName, setSignedName] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (id: string, patch: Partial<Answers[string]>) =>
    setAnswers((a) => ({ ...a, [id]: { answer: "", detail: "", ...a[id], ...patch } }));

  const submit = async () => {
    const problem = validateAnswers(form, buildAnswers(form, answers), signedName, agreed);
    if (problem) {
      toast.error(problem);
      const n = /question (\d+)/.exec(problem)?.[1];
      document
        .getElementById(n ? `hq-${n}` : "hf-sign")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setBusy(true);
    try {
      await portalCall("/api/portal/health-form", {
        version: form.version,
        answers,
        signedName: signedName.trim(),
        agreed,
      });
      toast.success("Thank you! Your health form is saved.");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save. Please try again.");
      if ((e as { status?: number }).status === 409) onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="surface-card space-y-2 p-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
            <HeartPulse className="size-5" aria-hidden />
          </span>
          <h2 className="text-card-title">{form.title}</h2>
        </div>
        {last ? (
          <p className="rounded-lg bg-warning/10 p-2 text-sm">
            The gym has updated its health form. Please fill it again.
          </p>
        ) : null}
        {form.intro ? <p className="whitespace-pre-wrap text-sm">{form.intro}</p> : null}
        <p className="text-meta">Only the gym staff and your trainer see your answers.</p>
      </section>

      <ol className="space-y-3">
        {form.questions.map((q, i) => {
          const a = answers[q.id];
          const groupId = `hq-${i + 1}`;
          return (
            <li key={q.id} id={groupId} className="surface-card space-y-3 p-4">
              <p id={`${groupId}-label`} className="text-sm font-medium">
                <span className="text-meta tabular-nums">{i + 1}. </span>
                {q.text}
              </p>
              {q.kind === "yesno" ? (
                <div
                  role="radiogroup"
                  aria-labelledby={`${groupId}-label`}
                  className="grid grid-cols-2 gap-2"
                >
                  {(["no", "yes"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={a?.answer === v}
                      onClick={() => set(q.id, { answer: v })}
                      className={cn(
                        "h-11 cursor-pointer rounded-lg border text-sm font-semibold transition-colors",
                        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                        a?.answer === v
                          ? v === "yes"
                            ? "border-warning bg-warning text-warning-foreground"
                            : "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background hover:bg-accent",
                      )}
                    >
                      {v === "yes" ? "Yes" : "No"}
                    </button>
                  ))}
                </div>
              ) : null}
              {q.kind === "text" || (a?.answer === "yes" && q.detailOnYes) ? (
                <Textarea
                  aria-label={
                    q.kind === "text" ? `Answer ${i + 1}` : `Details for question ${i + 1}`
                  }
                  rows={2}
                  maxLength={HEALTH_LIMITS.answer}
                  value={a?.detail ?? ""}
                  onChange={(e) => set(q.id, { detail: e.target.value })}
                  placeholder={
                    q.kind === "text" ? "Write here (optional)" : "Please tell us a little more"
                  }
                />
              ) : null}
            </li>
          );
        })}
      </ol>

      <section id="hf-sign" className="surface-card space-y-3 p-4">
        <h2 className="text-card-title">Your agreement</h2>
        <div className="max-h-60 overflow-y-auto rounded-lg bg-muted/60 p-3 text-sm whitespace-pre-wrap">
          {form.consent}
        </div>
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <Checkbox
            checked={agreed}
            onCheckedChange={(v) => setAgreed(v === true)}
            className="mt-0.5 size-5"
          />
          <span>I have read this, my answers are true, and I agree.</span>
        </label>
        <div className="space-y-1.5">
          <label htmlFor="hf-name" className="text-sm font-medium">
            Type your full name to sign
          </label>
          <Input
            id="hf-name"
            autoComplete="name"
            maxLength={HEALTH_LIMITS.name}
            value={signedName}
            onChange={(e) => setSignedName(e.target.value)}
            placeholder={memberName}
          />
        </div>
        <Button className="h-11 w-full" onClick={() => void submit()} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Save my health form
        </Button>
      </section>
    </>
  );
}

function Filled({ health }: { health: PortalHealth }) {
  const [records, setRecords] = useState<PortalHealthRecord[] | null>(null);
  const [busy, setBusy] = useState(false);
  const last = health.last;

  const load = async () => {
    setBusy(true);
    try {
      const r = await portalCall<{ records: PortalHealthRecord[] }>("/api/portal/health-form");
      setRecords(r.records);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="surface-card space-y-3 p-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-success text-success-foreground">
            <CheckCircle2 className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-card-title">Health form filled</h2>
            <p className="text-meta">
              {last
                ? `${last.method === "paper" ? "On paper at the gym" : "In this app"} on ${day(last.signedOn)}`
                : ""}
            </p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          If something about your health changes, please tell your trainer or the front desk.
        </p>
        {!records ? (
          <Button variant="outline" onClick={() => void load()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
            View my answers
          </Button>
        ) : null}
      </section>
      {records ? (
        <section className="surface-card space-y-6 p-4">
          {records.length ? (
            records.map((r, i) => <HealthRecordView key={`${r.signedOn}-${i}`} record={r} />)
          ) : (
            <p className="text-meta">Nothing saved yet.</p>
          )}
        </section>
      ) : null}
    </>
  );
}
