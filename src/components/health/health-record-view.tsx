import { StatusPill } from "@/components/common/status-pill";
import { formatDateISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { HealthFormRecord } from "@/types/models";

type RecordLike = Pick<
  HealthFormRecord,
  "version" | "signedOn" | "signedName" | "method" | "answers" | "consent"
> &
  Partial<Pick<HealthFormRecord, "by" | "note">>;

/** One filled health form: the answers and consent exactly as the member saw them. */
export function HealthRecordView({ record: r }: { record: RecordLike }) {
  return (
    <article className="space-y-3">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-card-title">{formatDateISO(r.signedOn)}</h3>
        <StatusPill tone={r.method === "app" ? "info" : "violet"}>
          {r.method === "app" ? "Member app" : "On paper"}
        </StatusPill>
        <span className="text-meta">Version {r.version}</span>
      </header>
      {r.method === "paper" ? (
        <p className="text-sm">
          Filled on paper at the gym{r.by ? `, recorded by ${r.by}` : ""}.{" "}
          {r.note ? (
            <>
              Said Yes to: <b className="text-warning">{r.note}</b>
            </>
          ) : r.note === "" ? (
            "No Yes answers noted."
          ) : null}
        </p>
      ) : (
        <>
          <ol className="divide-y divide-border rounded-lg border border-border">
            {r.answers.map((a, i) => (
              <li key={a.id} className="grid gap-1 p-3 text-sm">
                <p>
                  <span className="text-meta tabular-nums">{i + 1}. </span>
                  {a.text}
                </p>
                <p
                  className={cn(
                    "font-semibold",
                    a.kind === "yesno" && a.answer === "yes" && "text-warning",
                  )}
                >
                  {a.kind === "text" ? a.detail || "—" : a.answer === "yes" ? "Yes" : "No"}
                  {a.kind === "yesno" && a.detail ? (
                    <span className="font-normal text-foreground"> · {a.detail}</span>
                  ) : null}
                </p>
              </li>
            ))}
          </ol>
          <p className="text-sm">
            Agreed and signed as <b>{r.signedName}</b>.
          </p>
        </>
      )}
      {r.consent ? (
        <details className="rounded-lg bg-muted/60 p-3 text-sm">
          <summary className="cursor-pointer font-medium">Consent text agreed to</summary>
          <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{r.consent}</p>
        </details>
      ) : null}
    </article>
  );
}
