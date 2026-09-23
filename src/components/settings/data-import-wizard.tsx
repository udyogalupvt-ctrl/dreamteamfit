import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill } from "@/components/common/status-pill";
import { useAuth } from "@/hooks/use-auth";
import { useLive } from "@/hooks/use-live-query";
import { downloadText, errorReportCsv, IMPORT_FIELDS, IMPORT_LABELS, key, readSpreadsheet, suggestMapping, unknownNames, validateRows, type DupAction, type ParsedFile, type Resolution } from "@/lib/data-import";
import { subscribeClients } from "@/services/clients.service";
import { subscribePackages } from "@/services/packages.service";
import { subscribeTrainers } from "@/services/pt.service";
import { subscribeMemberships } from "@/services/memberships.service";
import { subscribeExpenses } from "@/services/expenses.service";
import { findCompletedBatch, fingerprintFile, runImport, type ImportResult } from "@/services/data-import.service";
import { cn } from "@/lib/utils";
import { IMPORT_TYPES, type Client, type Expense, type GymPackage, type ImportType, type Membership, type Trainer } from "@/types/models";

const STEPS = ["Data type", "Upload", "Read", "Map columns", "Preview", "Validate", "Errors & duplicates", "Confirm", "Import", "Summary"];
const VIEW: Record<ImportType, "/clients" | "/packages" | "/expenses"> = { clients: "/clients", packages: "/packages", trainers: "/packages", memberships: "/clients", expenses: "/expenses" };
const NONE = "__none";

export function DataImportWizard() {
  const { user } = useAuth();
  const clients = useLive(subscribeClients, [] as Client[], []);
  const packages = useLive(subscribePackages, [] as GymPackage[], []);
  const trainers = useLive(subscribeTrainers, [] as Trainer[], []);
  const memberships = useLive(subscribeMemberships, [] as Membership[], []);
  const expenses = useLive(subscribeExpenses, [] as Expense[], []);
  const [step, setStep] = useState(0);
  const [type, setType] = useState<ImportType>("clients");
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [sheet, setSheet] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [packageRes, setPackageRes] = useState<Record<string, Resolution>>({});
  const [trainerRes, setTrainerRes] = useState<Record<string, Resolution>>({});
  const [dupActions, setDupActions] = useState<Record<number, DupAction>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [filter, setFilter] = useState<"all" | "invalid" | "duplicates">("all");

  const ctx = { clients: clients.data, packages: packages.data, trainers: trainers.data, memberships: memberships.data, expenses: expenses.data, packageRes, trainerRes, dupActions };
  const unknown = useMemo(() => (parsed ? unknownNames(type, parsed.rows, mapping, ctx) : { packages: [], trainers: [] }), [parsed, type, mapping, packages.data, trainers.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const validated = useMemo(() => (parsed ? validateRows(type, parsed.rows, mapping, ctx) : []), [parsed, type, mapping, clients.data, packages.data, trainers.data, memberships.data, expenses.data, packageRes, trainerRes, dupActions]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = { total: validated.length, valid: validated.filter((r) => !r.errors.length).length, invalid: validated.filter((r) => r.errors.length).length, dup: validated.filter((r) => r.duplicate).length };
  const toWrite = validated.filter((r) => !r.errors.length && r.action !== "skip").length;
  const fields = IMPORT_FIELDS[type];
  const missingRequired = fields.filter((f) => f.required && !mapping[f.key]);

  const reset = () => { setStep(0); setFile(null); setParsed(null); setMapping({}); setPackageRes({}); setTrainerRes({}); setDupActions({}); setResult(null); setProgress(""); };
  const read = async (f: File, sh?: string) => {
    setBusy(true);
    try {
      if (!/\.(csv|xlsx|xls)$/i.test(f.name)) throw new Error("Upload a CSV or Excel (.xlsx) file.");
      if (f.size > 10 * 1024 * 1024) throw new Error("File is larger than 10 MB.");
      const p = await readSpreadsheet(f, sh);
      if (!p.rows.length) throw new Error("No data rows found below the header row.");
      setParsed(p); setSheet(sh ?? p.sheetNames[0] ?? ""); setMapping(suggestMapping(type, p.headers)); setDupActions({}); setStep(2);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not read file"); } finally { setBusy(false); }
  };
  const failuresFor = (r: ImportResult | null) => {
    const rows = new Map(validated.map((v) => [v.row, v.raw]));
    const items = (r?.failures ?? validated.flatMap((v) => v.errors.map((e) => ({ row: v.row, ...e })))).map((f) => ({ ...f, raw: rows.get(f.row) ?? {} }));
    downloadText(`import-errors-${type}.csv`, errorReportCsv(items));
  };
  const doImport = async () => {
    if (!file || !parsed || !user) return;
    setBusy(true); setStep(8);
    try {
      const fp = await fingerprintFile(type, file.name, parsed.rows);
      if (await findCompletedBatch(fp)) throw new Error("This exact file was already imported. Nothing was written again.");
      const res = await runImport({ type, fileName: file.name, fingerprint: fp, rows: validated, ctx, staff: { uid: user.uid, name: user.displayName || user.email || "Staff" }, onProgress: (d, t) => setProgress(`${d} / ${t}`) });
      setResult(res); setStep(9);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Import failed"); setStep(7); } finally { setBusy(false); }
  };

  const shown = validated.filter((r) => filter === "all" || (filter === "invalid" ? r.errors.length : r.duplicate));
  const previewCols = fields.filter((f) => mapping[f.key]).slice(0, 6);

  return (
    <section className="surface-card overflow-hidden">
      <header className="border-b border-border p-4 sm:p-5">
        <h2 className="text-card-title flex items-center gap-2"><FileSpreadsheet className="size-4" /> Data Import</h2>
        <p className="text-meta mt-1">Move members and records from your old software. Nothing is saved until you confirm.</p>
        <ol className="no-scrollbar mt-4 flex gap-1.5 overflow-x-auto pb-1" aria-label="Import steps">
          {STEPS.map((s, i) => <li key={s} className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold", i === step ? "bg-primary text-primary-foreground" : i < step ? "bg-muted text-foreground" : "bg-muted/50 text-muted-foreground")} aria-current={i === step ? "step" : undefined}>{i + 1}. {s}</li>)}
        </ol>
      </header>
      <div className="grid gap-4 p-4 sm:p-5">
        {step === 0 ? (
          <>
            <p className="text-sm font-semibold">What are you importing?</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {IMPORT_TYPES.map((t) => <button key={t} type="button" onClick={() => setType(t)} className={cn("min-h-12 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors", type === t ? "border-primary bg-primary/10" : "border-border hover:bg-accent")}>{IMPORT_LABELS[t]}</button>)}
            </div>
            <p className="text-meta">Tip: import Packages and Clients before Memberships — memberships are matched to clients by phone number.</p>
            <div><Button onClick={() => setStep(1)}>Continue</Button></div>
          </>
        ) : null}
        {step === 1 ? (
          <>
            <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border p-6 text-center hover:bg-accent/40">
              {busy ? <Loader2 className="size-6 animate-spin" /> : <Upload className="size-6" />}
              <span className="font-semibold">Upload CSV or Excel file</span>
              <span className="text-meta">First row must contain column names. Any column names work.</span>
              <input type="file" accept=".csv,.xlsx,.xls" className="sr-only" aria-label="Upload import file" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); void read(f); } }} />
            </label>
            <div><Button variant="outline" onClick={() => setStep(0)}>Back</Button></div>
          </>
        ) : null}
        {step === 2 && parsed ? (
          <>
            <p className="text-sm">Read <b>{file?.name}</b>: <b>{parsed.rows.length}</b> rows, <b>{parsed.headers.length}</b> columns.</p>
            {parsed.sheetNames.length > 1 ? <Select value={sheet} onValueChange={(v) => file && void read(file, v)}><SelectTrigger className="w-full sm:w-64" aria-label="Sheet"><SelectValue /></SelectTrigger><SelectContent>{parsed.sheetNames.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select> : null}
            <div className="flex flex-wrap gap-1.5">{parsed.headers.map((h) => <span key={h} className="rounded-md bg-muted px-2 py-1 text-xs">{h}</span>)}</div>
            <div className="flex gap-2"><Button variant="outline" onClick={() => setStep(1)}>Back</Button><Button onClick={() => setStep(3)}>Map columns</Button></div>
          </>
        ) : null}
        {step === 3 && parsed ? (
          <>
            <p className="text-sm">We suggested matches. Change any that are wrong.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map((f) => (
                <label key={f.key} className="grid gap-1 text-sm">
                  <span className="font-semibold">{f.label}{f.required ? <span className="text-destructive"> *</span> : null}</span>
                  <Select value={mapping[f.key] ?? NONE} onValueChange={(v) => setMapping((m) => { const n = { ...m }; if (v === NONE) delete n[f.key]; else n[f.key] = v; return n; })}>
                    <SelectTrigger className="w-full" aria-label={`Column for ${f.label}`}><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value={NONE}>— Not in file —</SelectItem>{parsed.headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
                  </Select>
                </label>
              ))}
            </div>
            {missingRequired.length ? <p role="alert" className="text-sm text-destructive">Map required fields: {missingRequired.map((f) => f.label).join(", ")}</p> : null}
            <div className="flex gap-2"><Button variant="outline" onClick={() => setStep(2)}>Back</Button><Button disabled={!!missingRequired.length} onClick={() => setStep(4)}>Preview</Button></div>
          </>
        ) : null}
        {step >= 4 && step <= 7 && parsed ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[["Total rows", counts.total, "info"], ["Valid rows", counts.valid, "success"], ["Invalid rows", counts.invalid, "danger"], ["Possible duplicates", counts.dup, "warning"]].map(([l, v]) => (
              <div key={l as string} className="rounded-xl border border-border p-3"><p className="text-meta">{l}</p><p className="text-xl font-bold">{v}</p></div>))}
          </div>
        ) : null}
        {step === 4 && parsed ? (
          <>
            <div className="max-h-[420px] overflow-auto rounded-xl border border-border">
              <table className="w-full min-w-[560px] text-left text-xs sm:text-sm">
                <thead className="sticky top-0 bg-muted"><tr><th className="p-2">Row</th>{previewCols.map((f) => <th key={f.key} className="p-2">{f.label}</th>)}<th className="p-2">Status</th></tr></thead>
                <tbody>{validated.slice(0, 200).map((r) => (
                  <tr key={r.row} className={cn("border-t border-border", r.errors.length && "bg-destructive/5")}>
                    <td className="p-2">{r.row}</td>{previewCols.map((f) => <td key={f.key} className="max-w-40 truncate p-2">{String(r.data[f.key] ?? "")}</td>)}
                    <td className="p-2">{r.errors.length ? <StatusPill tone="danger">{r.errors[0]!.reason}</StatusPill> : r.duplicate ? <StatusPill tone="warning">Duplicate</StatusPill> : <StatusPill tone="success">Valid</StatusPill>}</td>
                  </tr>))}</tbody>
              </table>
            </div>
            {validated.length > 200 ? <p className="text-meta">Showing first 200 rows. All rows are validated.</p> : null}
            <div className="flex gap-2"><Button variant="outline" onClick={() => setStep(3)}>Back</Button><Button onClick={() => setStep(5)}>Validate</Button></div>
          </>
        ) : null}
        {step === 5 ? (
          <>
            {unknown.packages.length ? (
              <div className="grid gap-3 rounded-xl border border-warning/40 p-3">
                <p className="text-sm font-semibold">Packages not found — choose what to do. Prices are never guessed.</p>
                {unknown.packages.map((name) => { const r = packageRes[key(name)]; return (
                  <div key={name} className="grid gap-2 sm:grid-cols-[1fr_200px_1fr] sm:items-center">
                    <span className="text-sm font-semibold">"{name}"</span>
                    <Select value={r?.mode ?? NONE} onValueChange={(v) => setPackageRes((m) => ({ ...m, [key(name)]: v === "create" ? { mode: "create" } : v === "skip" ? { mode: "skip" } : { mode: "map", id: packages.data[0]?.id ?? "" } }))}>
                      <SelectTrigger className="w-full" aria-label={`Resolve package ${name}`}><SelectValue placeholder="Choose action" /></SelectTrigger>
                      <SelectContent><SelectItem value={NONE} disabled>Choose action</SelectItem><SelectItem value="map">Map to existing</SelectItem><SelectItem value="create">Create new package</SelectItem><SelectItem value="skip">Skip rows</SelectItem></SelectContent>
                    </Select>
                    {r?.mode === "map" ? <Select value={r.id} onValueChange={(id) => setPackageRes((m) => ({ ...m, [key(name)]: { mode: "map", id } }))}><SelectTrigger className="w-full" aria-label="Existing package"><SelectValue /></SelectTrigger><SelectContent>{packages.data.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>
                      : r?.mode === "create" ? <div className="flex gap-2"><Input type="number" min={0} placeholder="Price ₹" aria-label="New package price" value={r.price ?? ""} onChange={(e) => setPackageRes((m) => ({ ...m, [key(name)]: { ...r, price: e.target.value === "" ? undefined : Number(e.target.value) } }))} /><Input type="number" min={1} placeholder="Days" aria-label="New package days" value={r.durationDays ?? ""} onChange={(e) => setPackageRes((m) => ({ ...m, [key(name)]: { ...r, durationDays: e.target.value === "" ? undefined : Number(e.target.value) } }))} /></div> : <span />}
                  </div>); })}
              </div>
            ) : null}
            {unknown.trainers.length ? (
              <div className="grid gap-3 rounded-xl border border-border p-3">
                <p className="text-sm font-semibold">Trainers not found</p>
                {unknown.trainers.map((name) => { const r = trainerRes[key(name)]; return (
                  <div key={name} className="grid gap-2 sm:grid-cols-[1fr_200px_1fr] sm:items-center">
                    <span className="text-sm font-semibold">"{name}"</span>
                    <Select value={r?.mode ?? "skip"} onValueChange={(v) => setTrainerRes((m) => ({ ...m, [key(name)]: v === "create" ? { mode: "create" } : v === "map" ? { mode: "map", id: trainers.data[0]?.id ?? "" } : { mode: "skip" } }))}>
                      <SelectTrigger className="w-full" aria-label={`Resolve trainer ${name}`}><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="skip">Skip trainer assignment</SelectItem><SelectItem value="create">Create trainer</SelectItem><SelectItem value="map" disabled={!trainers.data.length}>Map to existing</SelectItem></SelectContent>
                    </Select>
                    {r?.mode === "map" ? <Select value={r.id} onValueChange={(id) => setTrainerRes((m) => ({ ...m, [key(name)]: { mode: "map", id } }))}><SelectTrigger className="w-full" aria-label="Existing trainer"><SelectValue /></SelectTrigger><SelectContent>{trainers.data.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent></Select> : <span />}
                  </div>); })}
              </div>
            ) : null}
            {!unknown.packages.length && !unknown.trainers.length ? <p className="flex items-center gap-2 text-sm"><CheckCircle2 className="size-4 text-success" /> All rows checked. {counts.invalid ? `${counts.invalid} row(s) have problems.` : "No problems found."}</p> : null}
            <div className="flex gap-2"><Button variant="outline" onClick={() => setStep(4)}>Back</Button><Button onClick={() => setStep(6)}>Review errors & duplicates</Button></div>
          </>
        ) : null}
        {step === 6 ? (
          <>
            <div className="flex flex-wrap gap-2">
              {(["all", "invalid", "duplicates"] as const).map((f) => <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>{f === "all" ? `All issues` : f === "invalid" ? `Errors (${counts.invalid})` : `Duplicates (${counts.dup})`}</Button>)}
              {counts.invalid ? <Button size="sm" variant="outline" onClick={() => failuresFor(null)}><Download /> Error report</Button> : null}
            </div>
            <ul className="grid max-h-[460px] gap-2 overflow-auto">
              {shown.filter((r) => r.errors.length || r.duplicate || r.warnings.length).map((r) => (
                <li key={r.row} className="rounded-xl border border-border p-3 text-sm">
                  <p className="font-semibold">Row {r.row}</p>
                  {r.errors.map((e, i) => <p key={i} className="text-destructive">{e.field}: {e.reason}</p>)}
                  {r.warnings.map((w, i) => <p key={i} className="text-meta">{w}</p>)}
                  {r.duplicate && !r.errors.length ? (
                    <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_180px] sm:items-center">
                      <div><p className="text-meta">Existing</p><p>{r.duplicate.label}</p></div>
                      <div><p className="text-meta">Incoming</p><p>{r.duplicate.incoming || "—"}</p></div>
                      <Select value={dupActions[r.row] ?? "skip"} onValueChange={(v) => setDupActions((m) => ({ ...m, [r.row]: v as DupAction }))}>
                        <SelectTrigger className="w-full" aria-label={`Duplicate action row ${r.row}`}><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="skip">Skip</SelectItem>{r.duplicate.id && (type === "clients" || type === "packages" || type === "trainers") ? <SelectItem value="update">Update existing</SelectItem> : null}<SelectItem value="create">Create new</SelectItem></SelectContent>
                      </Select>
                    </div>
                  ) : null}
                </li>))}
              {!validated.some((r) => r.errors.length || r.duplicate || r.warnings.length) ? <li className="text-sm text-muted-foreground">No errors or duplicates.</li> : null}
            </ul>
            <div className="flex gap-2"><Button variant="outline" onClick={() => setStep(5)}>Back</Button><Button onClick={() => setStep(7)}>Continue</Button></div>
          </>
        ) : null}
        {step === 7 ? (
          <>
            <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm">
              <p className="font-semibold">Ready to import {IMPORT_LABELS[type].toLowerCase()} from {file?.name}</p>
              <p className="mt-1">{toWrite} row(s) will be saved · {counts.invalid} invalid row(s) will not be imported · {validated.filter((r) => !r.errors.length && r.action === "skip").length} duplicate(s) skipped.</p>
              <p className="text-meta mt-2 flex items-center gap-1"><AlertTriangle className="size-3.5" /> Rows are saved in safe groups; importing the same file twice is blocked.</p>
            </div>
            <div className="flex gap-2"><Button variant="outline" onClick={() => setStep(6)}>Back</Button><Button disabled={busy || toWrite === 0} onClick={() => void doImport()}>Confirm import</Button></div>
          </>
        ) : null}
        {step === 8 ? <p className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" /> Importing… {progress}</p> : null}
        {step === 9 && result ? (
          <>
            <div className="rounded-xl border border-border p-4">
              <p className="flex items-center gap-2 font-bold"><CheckCircle2 className="size-5 text-success" /> Import complete <StatusPill tone={result.status === "completed" ? "success" : result.status === "failed" ? "danger" : "warning"}>{result.status.replace(/_/g, " ")}</StatusPill></p>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
                {[["Rows found", result.rowsFound], ["Imported", result.imported + result.updated], ["Skipped", result.skipped], ["Failed", result.failed], ["Duplicates", result.duplicates]].map(([l, v]) => <div key={l as string}><dt className="text-meta">{l}</dt><dd className="text-lg font-bold">{v}</dd></div>)}
              </dl>
              {result.updated ? <p className="text-meta mt-2">{result.updated} existing record(s) updated.</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild><Link to={VIEW[type]}>View imported records</Link></Button>
              <Button variant="outline" disabled={!result.failures.length} onClick={() => failuresFor(result)}><Download /> Download error report</Button>
              <Button variant="outline" onClick={reset}>Start another import</Button>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
