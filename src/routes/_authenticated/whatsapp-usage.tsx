import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { format, startOfMonth, subMonths, endOfMonth } from "date-fns";
import { MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { ErrorState } from "@/components/common/error-state";
import { LoadingRows } from "@/components/common/loading-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusPill } from "@/components/common/status-pill";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAccess } from "@/hooks/use-access";
import { useLive } from "@/hooks/use-live-query";
import { db } from "@/lib/firebase";
import { doc, onSnapshot, setDoc } from "@/lib/firestore";
import { formatPrice, todayISO } from "@/lib/format";
import { getServer } from "@/lib/server-api";
import { subscribeWhatsAppMessages } from "@/services/whatsapp.service";
import {
  DEFAULT_WHATSAPP_SETTINGS,
  subscribeWhatsAppSettings,
} from "@/services/whatsapp-settings.service";
import type { WhatsAppMessage, WhatsAppSettings } from "@/types/models";

export const Route = createFileRoute("/_authenticated/whatsapp-usage")({
  head: () => ({ meta: [{ title: "WhatsApp usage — REBUILD FITNESS" }] }),
  component: WhatsAppUsagePage,
});

type Period = "today" | "month" | "last" | "custom";
type Template = { name: string; status: string; category: string };
type Rates = { utility: number; marketing: number };
/** Approximate Meta prices for India (₹ per delivered message). Edit to match your Meta bill. */
const DEFAULT_RATES: Rates = { utility: 0.12, marketing: 0.79 };

const KINDS: { type: string; label: string; template: keyof WhatsAppSettings }[] = [
  { type: "invoice", label: "Bills after payment", template: "invoiceTemplate" },
  { type: "payment_due", label: "Balance due reminders", template: "paymentDueTemplate" },
  { type: "renewal", label: "Renewal reminders", template: "renewalTemplate" },
  { type: "birthday", label: "Birthday wishes", template: "birthdayTemplate" },
  { type: "absence", label: "Missed-workout nudges", template: "absenceTemplate" },
  { type: "test", label: "Tests", template: "invoiceTemplate" },
];
const SENT = new Set(["sent", "delivered", "read"]);

/** How many WhatsApp messages went out, of which kind, and roughly what they cost. */
function WhatsAppUsagePage() {
  const messages = useLive<WhatsAppMessage[]>(subscribeWhatsAppMessages, [], []);
  const wa = useLive(subscribeWhatsAppSettings, DEFAULT_WHATSAPP_SETTINGS, []);
  const { can } = useAccess();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [rates, setRates] = useState<Rates>(DEFAULT_RATES);
  const [period, setPeriod] = useState<Period>("month");
  const today = todayISO();
  const [from, setFrom] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [to, setTo] = useState(today);

  useEffect(() => {
    void getServer<{ templates: Template[] }>("/api/whatsapp/templates")
      .then((r) => setTemplates(r.templates))
      .catch(() => setTemplates([]));
    return onSnapshot(doc(db, "settings", "whatsappCost"), (s) =>
      setRates({ ...DEFAULT_RATES, ...(s.data() as Partial<Rates> | undefined) }),
    );
  }, []);

  const range = useMemo<[string, string]>(() => {
    const now = new Date();
    if (period === "today") return [today, today];
    if (period === "last") {
      const last = subMonths(now, 1);
      return [format(startOfMonth(last), "yyyy-MM-dd"), format(endOfMonth(last), "yyyy-MM-dd")];
    }
    if (period === "custom") return [from, to];
    return [format(startOfMonth(now), "yyyy-MM-dd"), today];
  }, [period, from, to, today]);

  const categoryOf = (name: string) =>
    templates.find((t) => t.name === name)?.category?.toLowerCase() ??
    (name === "gym_payment_receipt" || name === "gym_payment_due" ? "utility" : "marketing");

  const rows = useMemo(() => {
    const inRange = messages.data.filter((m) => {
      const d = format(m.sentAt ?? m.createdAt, "yyyy-MM-dd");
      return d >= range[0] && d <= range[1];
    });
    return KINDS.map((k) => {
      const mine = inRange.filter((m) => m.type === k.type);
      const sent = mine.filter((m) => SENT.has(m.status));
      const template = sent[0]?.templateName || String(wa.data[k.template] ?? "");
      const category = k.type === "test" ? "utility" : categoryOf(template);
      const rate = category === "utility" ? rates.utility : rates.marketing;
      return {
        ...k,
        template,
        category,
        sent: sent.length,
        failed: mine.filter((m) => m.status === "failed").length,
        cost: sent.length * rate,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.data, range, templates, rates, wa.data]);
  const totalSent = rows.reduce((n, r) => n + r.sent, 0);
  const totalCost = rows.reduce((n, r) => n + r.cost, 0);

  const saveRate = (k: keyof Rates, v: number) => {
    setRates((r) => ({ ...r, [k]: v }));
    void setDoc(doc(db, "settings", "whatsappCost"), { [k]: v }, { merge: true }).catch((e) =>
      toast.error((e as Error).message),
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="WhatsApp usage"
        description="Messages sent through the WhatsApp API and their approximate cost, so you know what Meta will bill."
        breadcrumbs={[{ label: "Home", to: "/dashboard" }, { label: "WhatsApp usage" }]}
      />
      {messages.error ? <ErrorState error={messages.error} title="Couldn't load messages" /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <SelectTrigger className="w-40" aria-label="Period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="month">This month</SelectItem>
            <SelectItem value="last">Last month</SelectItem>
            <SelectItem value="custom">Pick dates</SelectItem>
          </SelectContent>
        </Select>
        {period === "custom" ? (
          <>
            <Input
              type="date"
              aria-label="From"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-auto"
            />
            <Input
              type="date"
              aria-label="To"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
              className="w-auto"
            />
          </>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <div className="surface-card p-4">
          <p className="text-meta">Messages sent</p>
          <p className="text-stat tabular-nums">{totalSent}</p>
        </div>
        <div className="surface-card p-4">
          <p className="text-meta">Approx. cost</p>
          <p className="text-stat tabular-nums">{formatPrice(Math.round(totalCost * 100) / 100)}</p>
        </div>
        <div className="surface-card col-span-2 p-4 lg:col-span-1">
          <p className="text-meta">₹ per message (edit to match your Meta bill)</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-sm">
              Utility
              <Input
                type="number"
                step="0.01"
                min={0}
                disabled={!can("settings")}
                value={rates.utility}
                onChange={(e) => saveRate("utility", Number(e.target.value))}
              />
            </label>
            <label className="text-sm">
              Marketing
              <Input
                type="number"
                step="0.01"
                min={0}
                disabled={!can("settings")}
                value={rates.marketing}
                onChange={(e) => saveRate("marketing", Number(e.target.value))}
              />
            </label>
          </div>
        </div>
      </div>
      {messages.loading ? (
        <LoadingRows rows={5} />
      ) : (
        <section className="surface-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>What</TableHead>
                <TableHead>Template · type</TableHead>
                <TableHead className="text-right">Sent</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                <TableHead className="text-right">Approx. cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.type}>
                  <TableCell className="font-semibold">
                    <span className="inline-flex items-center gap-2">
                      <MessageCircle className="size-4 text-[#25D366]" aria-hidden /> {r.label}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="block text-sm">{r.template || "—"}</span>
                    <StatusPill tone={r.category === "utility" ? "success" : "warning"}>
                      {r.category === "utility" ? "Utility (cheaper)" : "Marketing"}
                    </StatusPill>
                  </TableCell>
                  <TableCell className="text-right font-bold tabular-nums">{r.sent}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.failed || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPrice(Math.round(r.cost * 100) / 100)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}
      {templates.length ? (
        <section className="surface-card p-4 sm:p-5">
          <h2 className="text-card-title">Templates on your WhatsApp account</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {templates
              .filter((t) => t.name.startsWith("gym_"))
              .map((t) => (
                <li key={t.name} className="rounded-lg border border-border px-3 py-2 text-sm">
                  <b>{t.name}</b> · {t.category.toLowerCase()} ·{" "}
                  <span className={t.status === "APPROVED" ? "text-success" : "text-warning"}>
                    {t.status.toLowerCase()}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
      <p className="text-meta">
        Meta bills per delivered template message; prices here are estimates. Marketing messages
        (birthday, missed-workout, renewal) cost more than Utility ones (bills, balance reminders).
        Turn off what you don&apos;t need in Settings → Reminders.
      </p>
    </div>
  );
}
