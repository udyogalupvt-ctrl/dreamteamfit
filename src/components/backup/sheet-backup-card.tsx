import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Copy, ExternalLink, FileSpreadsheet, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeStatus, type SheetBackupStatus } from "@/lib/sheet-backup/status";
import { cn } from "@/lib/utils";
import { getSheetBackupStatus, saveSheetLink, syncSheetNow } from "@/services/sheet-backup.service";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Owner only: the Google Sheet copy of the gym's records, how fresh it is, and the buttons to fix it. */
export function SheetBackupCard() {
  const [status, setStatus] = useState<SheetBackupStatus | null>(null);
  const [loadError, setLoadError] = useState("");
  const [step, setStep] = useState(0); // > 0 while "Sync now" is running
  const [changing, setChanging] = useState(false);
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState("");

  const load = useCallback(async () => {
    try {
      setStatus(await getSheetBackupStatus());
      setLoadError("");
    } catch (e) {
      setLoadError(msg(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const syncNow = async () => {
    setStep(1);
    try {
      await syncSheetNow(setStep);
      const fresh = await getSheetBackupStatus();
      setStatus(fresh);
      if (describeStatus(fresh).kind === "ok") toast.success("The Google Sheet is up to date.");
      else
        toast.error("The sheet was updated, but it does not match the app yet.", {
          description: "See the red note on the Backup card.",
        });
    } catch (e) {
      toast.error("Could not update the Google Sheet.", { description: msg(e) });
      await load();
    } finally {
      setStep(0);
    }
  };

  const saveLink = async () => {
    setLinkError("");
    try {
      await saveSheetLink(link.trim());
      setChanging(false);
      setLink("");
      toast.success("Sheet changed.", { description: "Press Sync now to fill it." });
      await load();
    } catch (e) {
      setLinkError(msg(e));
    }
  };

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(status?.shareWith ?? "");
      toast.success("Email copied");
    } catch {
      toast.error("Could not copy. Select the email and copy it by hand.");
    }
  };

  const syncing = step > 0;
  const state = status ? describeStatus(status) : null;
  const tone = syncing
    ? "updating"
    : loadError && !status
      ? "problem"
      : (state?.kind ?? "updating");

  return (
    <section aria-labelledby="sheet-backup-title" className="surface-card space-y-4 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-success/15 text-success">
          <FileSpreadsheet className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 id="sheet-backup-title" className="text-card-title">
            Google Sheet backup
          </h2>
          <p className="text-meta mt-0.5">
            A copy of every member, plan and payment in the gym&apos;s Google Sheet. It updates by
            itself after each entry and every night.
          </p>
        </div>
      </div>

      <div
        role="status"
        aria-live="polite"
        data-testid="sheet-status"
        data-state={status || syncing ? tone : "loading"}
        className={cn(
          "flex items-start gap-2.5 rounded-xl border p-3 text-sm",
          tone === "ok" && "border-success/40 bg-success/10",
          tone === "updating" && "border-warning/50 bg-warning/10",
          tone === "problem" && "border-destructive/40 bg-destructive/10",
        )}
      >
        {syncing || (tone === "updating" && !loadError) ? (
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-warning" aria-hidden />
        ) : tone === "ok" ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
        ) : (
          <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        )}
        <div className="min-w-0 space-y-1">
          {syncing ? (
            <p className="font-medium">
              Updating the sheet… step {step}. Please keep this page open.
            </p>
          ) : loadError ? (
            <p className="font-medium">Could not read the backup status.</p>
          ) : state ? (
            <p className="font-medium">{state.text}</p>
          ) : (
            <p className="text-muted-foreground">Checking the sheet…</p>
          )}
          {!syncing && loadError ? (
            <>
              <p className="text-muted-foreground break-words">{loadError}</p>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                Try again
              </Button>
            </>
          ) : null}
          {!syncing && state?.kind === "problem" && state.items.length ? (
            <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
              {state.items.map((i) => (
                <li key={i} className="break-words">
                  {i}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {status ? (
          <Button asChild variant="outline">
            <a href={status.sheetUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden /> Open the sheet
            </a>
          </Button>
        ) : null}
        <Button onClick={syncNow} disabled={!status}>
          {syncing ? `Step ${step}…` : "Sync now"}
        </Button>
        <Button
          variant="ghost"
          className="col-span-2 sm:col-span-1"
          aria-expanded={changing}
          aria-controls="sheet-change"
          disabled={syncing}
          onClick={() => {
            setChanging((v) => !v);
            setLinkError("");
          }}
        >
          Change sheet
        </Button>
      </div>

      {changing ? (
        <div
          id="sheet-change"
          className="space-y-3 rounded-xl border border-border bg-muted/40 p-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor="sheet-link">Link to the Google Sheet</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="sheet-link"
                inputMode="url"
                autoComplete="off"
                placeholder="https://docs.google.com/spreadsheets/d/…"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && link.trim()) void saveLink();
                }}
                aria-describedby="sheet-share-hint"
                aria-invalid={linkError ? true : undefined}
              />
              <Button onClick={saveLink} disabled={!link.trim()} className="sm:shrink-0">
                Save
              </Button>
            </div>
          </div>
          {status?.shareWith ? (
            <div id="sheet-share-hint" className="space-y-1.5 text-sm">
              <p>Share the sheet with this email as Editor:</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="break-all rounded-md bg-background px-2 py-1 text-xs ring-1 ring-border">
                  {status.shareWith}
                </code>
                <Button variant="outline" size="sm" onClick={copyEmail}>
                  <Copy aria-hidden /> Copy
                </Button>
              </div>
            </div>
          ) : (
            <p id="sheet-share-hint" className="text-sm">
              Share the sheet with the app&apos;s Google account as Editor first.
            </p>
          )}
          {linkError ? (
            <p role="alert" className="break-words text-sm text-destructive">
              {linkError}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
