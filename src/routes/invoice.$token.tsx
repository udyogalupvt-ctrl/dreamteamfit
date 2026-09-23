import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download, Printer, ReceiptIndianRupee } from "lucide-react";
import { BrandMark } from "@/components/layout/brand-mark";
import { Button } from "@/components/ui/button";
import { useLive } from "@/hooks/use-live-query";
import { formatPrice } from "@/lib/format";
import { downloadInvoicePdf } from "@/lib/invoice-download";
import { subscribePublicInvoice } from "@/services/invoices.service";
import type { PublicInvoice } from "@/types/models";

export const Route = createFileRoute("/invoice/$token")({
  head: () => ({
    meta: [
      { title: "Invoice — REBUILD FITNESS" },
      { name: "description", content: "Secure customer invoice." },
    ],
  }),
  component: PublicInvoicePage,
});
function PublicInvoicePage() {
  const [downloading, setDownloading] = useState(false);
  const { token } = Route.useParams();
  const live = useLive<PublicInvoice | null>(
    (ok, fail) => subscribePublicInvoice(token, ok, fail),
    null,
    [token],
  );
  if (live.loading)
    return (
      <main className="grid min-h-screen place-items-center bg-slate-100 p-4">
        <p>Loading invoice…</p>
      </main>
    );
  if (live.error || !live.data)
    return (
      <main className="grid min-h-screen place-items-center bg-slate-100 p-4 text-slate-950">
        <div className="text-center">
          <ReceiptIndianRupee className="mx-auto size-10" />
          <h1 className="mt-4 text-xl font-bold">Invoice unavailable</h1>
          <p className="mt-2 text-sm text-slate-600">
            Check that the secure link is complete and try again.
          </p>
        </div>
      </main>
    );
  const i = live.data,
    b = i.business;
  return (
    <main className="min-h-screen bg-slate-100 px-3 py-6 text-slate-950 sm:px-6 print:bg-white print:p-0">
      <article className="mx-auto max-w-4xl overflow-hidden rounded-2xl bg-white shadow-xl print:max-w-none print:rounded-none print:shadow-none">
        <div className="h-3 bg-yellow-400" />
        <header className="flex flex-col gap-5 border-b border-slate-200 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-8">
          <div>
            <BrandMark />
            <p className="mt-3 max-w-md text-sm text-slate-600">{b.address}</p>
            <p className="text-sm text-slate-600">
              {[b.phone, b.email].filter(Boolean).join(" · ")}
            </p>
            {b.gstin ? <p className="text-sm text-slate-600">GSTIN: {b.gstin}</p> : null}
          </div>
          <div className="sm:text-right">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Invoice</p>
            <h1 className="mt-1 text-2xl font-black">{i.invoiceNumber}</h1>
            <p className="mt-2 text-sm">Issued {i.invoiceDate}</p>
            <p className="text-sm">Due {i.dueDate}</p>
          </div>
        </header>
        <section className="p-5 sm:p-8">
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Bill to</p>
            <p className="mt-1 text-lg font-bold">{i.clientName}</p>
            <p className="text-sm text-slate-600">
              {[i.clientPhone, i.clientEmail].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="mt-7 overflow-x-auto">
            <table className="w-full min-w-[540px] text-left text-sm">
              <thead className="bg-slate-950 text-white">
                <tr>
                  <th className="p-3">Item</th>
                  <th className="p-3 text-right">Qty</th>
                  <th className="p-3 text-right">Rate</th>
                  <th className="p-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {i.items.map((item, n) => (
                  <tr className="border-b border-slate-200" key={n}>
                    <td className="p-3">
                      <b>{item.name}</b>
                      {item.description ? (
                        <span className="block text-slate-500">{item.description}</span>
                      ) : null}
                    </td>
                    <td className="p-3 text-right">{item.quantity}</td>
                    <td className="p-3 text-right">{formatPrice(item.unitPrice)}</td>
                    <td className="p-3 text-right font-semibold">{formatPrice(item.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="ml-auto mt-7 max-w-sm space-y-3 text-sm">
            {[
              ["Subtotal", i.subtotal],
              ...(i.discount ? [["Discount", -i.discount] as [string, number]] : []),
              ...(i.tax ? [[`Tax (${b.taxRate}%)`, i.tax] as [string, number]] : []),
              ["Total", i.total],
              ["Amount Paid", i.amountPaid],
              ["Balance Due", i.balanceDue],
            ].map(([label, value]) => (
              <div
                key={label}
                className={`flex justify-between gap-4 ${label === "Total" || label === "Balance Due" ? "border-t border-slate-300 pt-3 text-lg font-black" : ""}`}
              >
                <dt>{label}</dt>
                <dd>{formatPrice(value as number)}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-7 flex flex-col justify-between gap-4 rounded-xl bg-yellow-400 p-4 sm:flex-row sm:items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider">Payment status</p>
              <p className="text-xl font-black capitalize">
                {i.paymentStatus} · {i.paymentMethod}
              </p>
            </div>
            <div className="flex gap-2 print:hidden">
              <Button variant="secondary" onClick={() => window.print()}>
                <Printer /> Print
              </Button>
              <Button
                disabled={downloading}
                onClick={() => {
                  setDownloading(true);
                  // Built on the member's phone from the bill itself: no stored file needed.
                  void downloadInvoicePdf(i, b).finally(() => setDownloading(false));
                }}
              >
                <Download /> {downloading ? "Preparing…" : "Download PDF"}
              </Button>
            </div>
          </div>
        </section>
        <footer className="border-t border-slate-200 p-5 text-center text-sm text-slate-500 sm:p-8">
          Thank you for choosing {b.businessName || "REBUILD FITNESS"}.
        </footer>
      </article>
    </main>
  );
}
