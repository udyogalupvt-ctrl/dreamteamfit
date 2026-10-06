import { diffDays } from "@/lib/cfo/dates";
import { formatDay, formatRupees } from "@/lib/cfo/money";
import type { CfoAlertRow, CfoDueRow, CfoListKey } from "@/lib/cfo/types";

const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";

/**
 * The WhatsApp text for a row. Facts only: no offers, no discounts. The member's first name,
 * how long we haven't seen them, when the plan ends, or the balance (live, from the re-check).
 */
export function cfoWhatsAppText(
  key: CfoListKey,
  row: CfoAlertRow | CfoDueRow,
  o: { gym: string; today: string; balance?: number },
): string {
  const hi = `Hi ${firstName(row.name)},`;
  if (key === "dues") {
    const r = row as CfoDueRow;
    const owed = formatRupees(o.balance ?? r.balance);
    return `${hi} a balance of ${owed} is pending on your ${o.gym} bill ${r.billNumber}. Please pay at the front desk or reply here.`;
  }
  const r = row as CfoAlertRow;
  const end = r.endDate ? formatDay(r.endDate) : "";
  const runsTill = end ? ` Your plan runs till ${end}.` : "";
  switch (key) {
    case "atRisk": {
      if (r.kind === "dropping")
        return `${hi} we've missed you at ${o.gym} lately. Is everything okay?${runsTill}`;
      const days = r.lastVisit ? diffDays(r.lastVisit, o.today) : 0;
      return days > 0
        ? `${hi} we haven't seen you at ${o.gym} for ${days} days. Is everything okay?${runsTill}`
        : `${hi} we haven't seen you at ${o.gym} for a while. Is everything okay?${runsTill}`;
    }
    case "renewals":
      return `${hi} your ${o.gym} plan ends${end ? ` on ${end}` : " soon"}. Reply here or visit the front desk to renew.`;
    case "newSlipping":
      return `${hi} welcome to ${o.gym}! How are your first weeks going? Ask at the front desk if you'd like help with a workout plan.`;
    default:
      return `${hi} great to see you training so regularly at ${o.gym}! If you'd like a personal trainer, ask at the front desk.`;
  }
}
