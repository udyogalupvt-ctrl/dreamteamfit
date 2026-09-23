import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EXPORTS, exportCollection } from "@/services/data-export.service";
import { firestoreErrorMessage } from "@/services/firestore.service";

export function DataExportPanel() {
  const [id, setId] = useState("clients");
  const [format, setFormat] = useState<"csv" | "xlsx">("xlsx");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const def = EXPORTS.find((e) => e.id === id)!;
  const run = async () => {
    setBusy(true);
    try { const n = await exportCollection(def, format, from || undefined, to || undefined); toast.success(`Exported ${n} ${def.label.toLowerCase()}`); }
    catch (e) { toast.error(firestoreErrorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <section className="surface-card p-4 sm:p-5">
      <h2 className="text-card-title flex items-center gap-2"><Download className="size-4" /> Data Export</h2>
      <p className="text-meta mt-1">Download your records. Passwords, access tokens, WhatsApp credentials and biometric data are never included.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1 text-sm font-semibold">Data<Select value={id} onValueChange={setId}><SelectTrigger className="w-full" aria-label="Export data"><SelectValue /></SelectTrigger><SelectContent>{EXPORTS.map((e) => <SelectItem key={e.id} value={e.id}>{e.label}</SelectItem>)}</SelectContent></Select></label>
        <label className="grid gap-1 text-sm font-semibold">Format<Select value={format} onValueChange={(v) => setFormat(v as "csv" | "xlsx")}><SelectTrigger className="w-full" aria-label="Export format"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="xlsx">Excel (.xlsx)</SelectItem><SelectItem value="csv">CSV</SelectItem></SelectContent></Select></label>
        {def.dateField ? <>
          <label className="grid gap-1 text-sm font-semibold">From<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="grid gap-1 text-sm font-semibold">To<Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </> : null}
      </div>
      <Button className="mt-4" disabled={busy} onClick={() => void run()}>{busy ? <Loader2 className="animate-spin" /> : <Download />} Export {def.label}</Button>
    </section>
  );
}
