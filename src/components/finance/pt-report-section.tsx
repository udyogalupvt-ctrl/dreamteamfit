import { useMemo, useState } from "react";
import { Download, Dumbbell } from "lucide-react";
import * as XLSX from "xlsx";
import { EmptyState } from "@/components/common/empty-state";
import { LoadingRows } from "@/components/common/loading-state";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
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
import { useLive } from "@/hooks/use-live-query";
import { formatDateISO, formatPrice, todayISO } from "@/lib/format";
import { subscribePayments, subscribePayouts } from "@/services/finance.service";
import { subscribePtAssignments } from "@/services/pt.service";
import type { Payment, PtAssignment, TrainerPayout } from "@/types/models";

/**
 * PT report: per PT plan — trainer, member, fee, how much the member has paid, gym share,
 * trainer share, collected or not, how they paid, and whether the trainer was paid.
 */
export function PtReportSection() {
  const pts = useLive<PtAssignment[]>(subscribePtAssignments, [], []);
  const payments = useLive<Payment[]>(subscribePayments, [], []);
  const payouts = useLive<TrainerPayout[]>(subscribePayouts, [], []);
  const [trainer, setTrainer] = useState("all");
  const [month, setMonth] = useState(todayISO().slice(0, 7));

  const trainers = [
    ...new Map(pts.data.map((p) => [p.trainerId, p.trainerNameSnapshot])).entries(),
  ];
  const rows = useMemo(
    () =>
      pts.data
        .filter((p) => p.status !== "cancelled")
        .filter((p) => trainer === "all" || p.trainerId === trainer)
        .filter(
          (p) =>
            !month || p.startDate.startsWith(month) || p.createdAt.toISOString().startsWith(month),
        )
        .map((p) => {
          const paid = payments.data.filter((x) => x.ptAssignmentId === p.id);
          const given = paid.reduce((n, x) => n + x.ptGymAmount + x.trainerShareAmount, 0);
          const payout = payouts.data.find((x) => x.ptAssignmentId === p.id);
          return {
            pt: p,
            given: Math.round(given),
            collected:
              given >= p.ptPrice - 0.5 ? "Collected" : given > 0 ? "Part paid" : "Not collected",
            methods: [...new Set(paid.map((x) => x.method))].join(", ") || "—",
            trainerPaid: payout?.status === "paid",
          };
        }),
    [pts.data, payments.data, payouts.data, trainer, month],
  );
  const totals = rows.reduce(
    (t, r) => ({
      fee: t.fee + r.pt.ptPrice,
      given: t.given + r.given,
      gym: t.gym + r.pt.gymShareAmount,
      trainer: t.trainer + r.pt.trainerShareAmount,
    }),
    { fee: 0, given: 0, gym: 0, trainer: 0 },
  );

  const excel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        rows.map((r) => ({
          Trainer: r.pt.trainerNameSnapshot,
          Member: r.pt.clientNameSnapshot,
          "PT package": r.pt.ptPackageNameSnapshot,
          From: r.pt.startDate,
          To: r.pt.endDate,
          "Client fee": r.pt.ptPrice,
          "Total given": r.given,
          "Gym share": r.pt.gymShareAmount,
          "Trainer share": r.pt.trainerShareAmount,
          Collected: r.collected,
          "Payment method": r.methods,
          "Trainer paid": r.trainerPaid ? "Yes" : "No",
        })),
      ),
      "PT report",
    );
    XLSX.writeFile(wb, `pt-report-${month || "all"}.xlsx`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={trainer} onValueChange={setTrainer}>
          <SelectTrigger className="w-full sm:w-56" aria-label="Trainer">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All trainers</SelectItem>
            {trainers.map(([id, n]) => (
              <SelectItem key={id} value={id}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="month"
          aria-label="Month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="w-auto"
        />
        <Button variant="ghost" size="sm" onClick={() => setMonth("")}>
          All months
        </Button>
        <Button variant="outline" size="sm" onClick={excel} disabled={!rows.length}>
          <Download aria-hidden /> Excel
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Client fees", totals.fee],
          ["Total given", totals.given],
          ["Gym share", totals.gym],
          ["Trainer share", totals.trainer],
        ].map(([k, v]) => (
          <div key={k} className="surface-card p-4">
            <p className="text-meta">{k}</p>
            <p className="text-stat tabular-nums">{formatPrice(Number(v))}</p>
          </div>
        ))}
      </div>
      {pts.loading || payments.loading ? (
        <LoadingRows rows={4} />
      ) : !rows.length ? (
        <EmptyState
          icon={Dumbbell}
          title="No PT in this period"
          description="PT sold when members join or renew shows here."
        />
      ) : (
        <section className="surface-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Trainer</TableHead>
                <TableHead>Member</TableHead>
                <TableHead className="text-right">Client fee</TableHead>
                <TableHead className="text-right">Total given</TableHead>
                <TableHead className="text-right">Gym share</TableHead>
                <TableHead className="text-right">Trainer share</TableHead>
                <TableHead>Collected</TableHead>
                <TableHead>Payment method</TableHead>
                <TableHead>Trainer paid</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.pt.id}>
                  <TableCell className="font-semibold">{r.pt.trainerNameSnapshot}</TableCell>
                  <TableCell>
                    {r.pt.clientNameSnapshot}
                    <span className="text-meta block">
                      {r.pt.ptPackageNameSnapshot} · {formatDateISO(r.pt.startDate)} –{" "}
                      {formatDateISO(r.pt.endDate)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPrice(r.pt.ptPrice)}
                  </TableCell>
                  <TableCell className="text-right font-bold tabular-nums">
                    {formatPrice(r.given)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPrice(r.pt.gymShareAmount)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPrice(r.pt.trainerShareAmount)}
                  </TableCell>
                  <TableCell>
                    <StatusPill
                      tone={
                        r.collected === "Collected"
                          ? "success"
                          : r.collected === "Part paid"
                            ? "warning"
                            : "danger"
                      }
                    >
                      {r.collected}
                    </StatusPill>
                  </TableCell>
                  <TableCell>{r.methods}</TableCell>
                  <TableCell>{r.trainerPaid ? "Yes" : "No"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}
    </div>
  );
}
