import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Dumbbell, Loader2, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormDialog } from "@/components/common/form-dialog";
import { SearchInput } from "@/components/common/search-input";
import { ClientAvatar } from "@/components/clients/client-avatar";
import { useEnrollment } from "@/components/enrollment/enrollment-context";
import { useAuth } from "@/hooks/use-auth";
import { formatPrice, normalizePhone, todayISO } from "@/lib/format";
import { calculateInvoiceTotals } from "@/lib/invoice-utils";
import { createInvoiceSchema, type CreateInvoiceInput } from "@/lib/invoice-validation";
import { cn } from "@/lib/utils";
import { createInvoice } from "@/services/invoices.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import type {
  BusinessBillingSettings,
  Client,
  GymPackage,
  InvoiceItem,
  PaymentMethod,
} from "@/types/models";
import { PAYMENT_METHODS } from "@/types/models";

const emptyItem = (): InvoiceItem => ({
  name: "",
  description: "",
  quantity: 1,
  unitPrice: 0,
  total: 0,
  packageId: null,
});

/**
 * Billing entry point. Packages and PT always go through the joining / renewal flow so
 * membership, trainer share and fingerprint stay in sync; this dialog only bills other items.
 */
export function CreateBillDialog({
  open,
  onOpenChange,
  clients,
  packages,
  settings,
  initialClientId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clients: Client[];
  packages: GymPackage[];
  settings: BusinessBillingSettings;
  initialClientId?: string | undefined;
}) {
  const { user } = useAuth();
  const { openEnrollment } = useEnrollment();
  const [clientId, setClientId] = useState(initialClientId ?? "");
  const [mode, setMode] = useState<"choose" | "items">("choose");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<InvoiceItem[]>([emptyItem()]);
  const [discount, setDiscount] = useState(0);
  const [received, setReceived] = useState<number | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("UPI");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setClientId(initialClientId ?? "");
    setMode("choose");
    setSearch("");
    setItems([emptyItem()]);
    setDiscount(0);
    setReceived(null);
    setNotes("");
    setErrors({});
  }, [open, initialClientId]);

  const client = clients.find((c) => c.id === clientId) ?? null;
  const totals = useMemo(
    () => calculateInvoiceTotals(items, discount, settings, received ?? Number.MAX_SAFE_INTEGER),
    [items, discount, settings, received],
  );
  const paid = received ?? totals.total;
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase(),
      p = normalizePhone(search);
    if (!q) return clients.slice(0, 6);
    return clients
      .filter(
        (c) =>
          c.fullName.toLowerCase().includes(q) ||
          c.clientCode.toLowerCase().includes(q) ||
          (p.length >= 3 && c.phoneNormalized.includes(p)),
      )
      .slice(0, 8);
  }, [clients, search]);

  const updateItem = (index: number, patch: Partial<InvoiceItem>) =>
    setItems((old) =>
      old.map((item, i) =>
        i === index
          ? {
              ...item,
              ...patch,
              total: (patch.quantity ?? item.quantity) * (patch.unitPrice ?? item.unitPrice),
            }
          : item,
      ),
    );

  const sellPackage = () => {
    if (!client) return;
    onOpenChange(false);
    openEnrollment({ existingClient: client });
  };

  const submit = async () => {
    if (!client || !user || saving) return;
    const input: CreateInvoiceInput = {
      clientId,
      items: items.map((i) => ({ ...i, total: i.quantity * i.unitPrice, packageId: null })),
      discount,
      amountPaid: Math.min(paid, totals.total),
      paymentMethod: method,
      invoiceDate: todayISO(),
      dueDate: todayISO(),
      notes,
      createMembership: false,
      membershipStartDate: todayISO(),
      previousAction: "expired",
    };
    const parsed = createInvoiceSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    if (paid > totals.total) return setErrors({ amountPaid: `Up to ${formatPrice(totals.total)}` });
    setErrors({});
    setSaving(true);
    try {
      const invoice = await createInvoice(input, {
        client,
        packages,
        settings,
        staff: { uid: user.uid, name: user.displayName || user.email || "Staff" },
      });
      toast.success("Bill created", {
        description: `${invoice.invoiceNumber} · share it from the list`,
      });
      onOpenChange(false);
    } catch (e) {
      toast.error("Couldn't create the bill", { description: firestoreErrorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={mode === "items" && client ? `Bill · ${client.fullName}` : "New bill"}
      className="sm:max-w-2xl"
      footer={
        mode === "items" ? (
          <>
            <Button variant="outline" onClick={() => setMode("choose")}>
              <ChevronLeft aria-hidden /> Back
            </Button>
            <Button size="lg" disabled={saving} onClick={() => void submit()}>
              {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Save bill · {formatPrice(Math.min(paid, totals.total))} received
            </Button>
          </>
        ) : undefined
      }
    >
      {mode === "choose" ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-label">Member</p>
            {client ? (
              <div className="flex items-center gap-3 rounded-xl border border-primary bg-primary/10 p-3">
                <ClientAvatar name={client.fullName} url={client.profilePhotoUrl} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{client.fullName}</p>
                  <p className="text-meta">
                    {client.phone} · {client.currentMembership?.packageName || "No current package"}
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setClientId("")}>
                  Change
                </Button>
              </div>
            ) : (
              <>
                <SearchInput
                  value={search}
                  onValueChange={setSearch}
                  placeholder="Search name or phone…"
                  label="Search members"
                />
                <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-xl border border-border">
                  {matches.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setClientId(c.id)}
                        className="flex w-full items-center gap-3 p-3 text-left hover:bg-accent"
                      >
                        <ClientAvatar name={c.fullName} url={c.profilePhotoUrl} size={32} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{c.fullName}</span>
                          <span className="text-meta">{c.phone}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                  {!matches.length ? (
                    <li className="p-3 text-sm text-muted-foreground">
                      No member found. New people join through “New member”.
                    </li>
                  ) : null}
                </ul>
              </>
            )}
          </div>
          <div
            className={cn("grid gap-3 sm:grid-cols-2", !client && "pointer-events-none opacity-50")}
            aria-disabled={!client}
          >
            <button
              type="button"
              onClick={sellPackage}
              className="rounded-2xl border border-border p-4 text-left transition-colors hover:border-primary hover:bg-primary/5"
            >
              <Dumbbell className="size-6" aria-hidden />
              <p className="mt-2 font-bold">Renew / new package or PT</p>
              <p className="text-meta">
                Membership dates, trainer share and fingerprint handled for you.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setMode("items")}
              className="rounded-2xl border border-border p-4 text-left transition-colors hover:border-primary hover:bg-primary/5"
            >
              <ShoppingBag className="size-6" aria-hidden />
              <p className="mt-2 font-bold">Other items</p>
              <p className="text-meta">Supplements, merchandise, locker, day pass…</p>
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <section className="space-y-3">
            {errors["items"] ? <p className="text-xs text-destructive">{errors["items"]}</p> : null}
            {items.map((item, index) => (
              <div key={index} className="grid grid-cols-[1fr_4.5rem_6.5rem_auto] items-end gap-2">
                <Field label={index ? "" : "Item"} htmlFor={`item-${index}`}>
                  <Input
                    id={`item-${index}`}
                    value={item.name}
                    placeholder="e.g. Whey protein"
                    onChange={(e) => updateItem(index, { name: e.target.value })}
                  />
                </Field>
                <Field label={index ? "" : "Qty"} htmlFor={`qty-${index}`}>
                  <Input
                    id={`qty-${index}`}
                    type="number"
                    inputMode="numeric"
                    min="1"
                    value={item.quantity}
                    onChange={(e) => updateItem(index, { quantity: Number(e.target.value) })}
                  />
                </Field>
                <Field label={index ? "" : "Price ₹"} htmlFor={`price-${index}`}>
                  <Input
                    id={`price-${index}`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    value={item.unitPrice}
                    onChange={(e) => updateItem(index, { unitPrice: Number(e.target.value) })}
                  />
                </Field>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove item"
                  disabled={items.length === 1}
                  onClick={() => setItems((v) => v.filter((_, i) => i !== index))}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setItems((v) => [...v, emptyItem()])}
            >
              <Plus aria-hidden /> Add item
            </Button>
          </section>
          <section className="grid grid-cols-2 gap-3">
            <Field
              label="Amount received ₹"
              htmlFor="amount-paid"
              error={errors["amountPaid"]}
              hint={
                paid < totals.total
                  ? `Balance ${formatPrice(totals.total - paid)} stays due`
                  : "Full payment"
              }
            >
              <Input
                id="amount-paid"
                type="number"
                inputMode="decimal"
                min="0"
                value={paid}
                onChange={(e) => setReceived(e.target.value === "" ? 0 : Number(e.target.value))}
              />
            </Field>
            <Field label="Discount ₹" htmlFor="discount" error={errors["discount"]}>
              <Input
                id="discount"
                type="number"
                inputMode="decimal"
                min="0"
                value={discount}
                onChange={(e) => setDiscount(Number(e.target.value))}
              />
            </Field>
            <Field label="Paid by" htmlFor="payment-method" className="col-span-2">
              <div className="flex flex-wrap gap-1.5" role="radiogroup" id="payment-method">
                {PAYMENT_METHODS.filter((m) => m !== "Other").map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={method === m}
                    onClick={() => setMethod(m)}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-sm font-semibold",
                      method === m
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:bg-accent",
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Note on bill" htmlFor="invoice-notes" className="col-span-2">
              <Input
                id="invoice-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
              />
            </Field>
          </section>
          <dl className="grid grid-cols-3 gap-2 rounded-xl bg-muted/60 p-3 text-sm">
            <div>
              <dt className="text-meta">Total</dt>
              <dd className="font-bold tabular-nums">{formatPrice(totals.total)}</dd>
            </div>
            <div>
              <dt className="text-meta">Received</dt>
              <dd className="font-bold tabular-nums">
                {formatPrice(Math.min(paid, totals.total))}
              </dd>
            </div>
            <div>
              <dt className="text-meta">Balance</dt>
              <dd className="font-bold tabular-nums">
                {formatPrice(Math.max(0, totals.total - paid))}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </FormDialog>
  );
}
