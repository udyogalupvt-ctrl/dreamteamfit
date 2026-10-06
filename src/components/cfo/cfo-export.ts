import { downloadExcel, type ReportCell, type ReportSheet } from "@/lib/report-export";
import { formatCount, formatDay, formatRupees } from "@/lib/cfo/money";
import type { CfoAlertRow, CfoDueGroup, CfoDueRow, CfoListKey } from "@/lib/cfo/types";

export const DUE_GROUP_LABEL: Record<CfoDueGroup, string> = {
  notDue: "Not due yet",
  d0_7: "0 to 7 days late",
  d8_30: "8 to 30 days late",
  d30plus: "More than 30 days late",
};

export const LIST_META: Record<
  CfoListKey,
  { label: string; sheet: string; moneyLabel: string; file: string }
> = {
  atRisk: {
    label: "Not coming",
    sheet: "Not coming",
    moneyLabel: "Next renewal worth",
    file: "cfo-not-coming",
  },
  renewals: {
    label: "Renewals",
    sheet: "Renewals coming",
    moneyLabel: "Renewal worth",
    file: "cfo-renewals",
  },
  newSlipping: {
    label: "New members",
    sheet: "New members slipping",
    moneyLabel: "Plan worth",
    file: "cfo-new-members",
  },
  ptChances: {
    label: "PT chances",
    sheet: "PT chances",
    moneyLabel: "PT from",
    file: "cfo-pt-chances",
  },
  dues: { label: "Pending dues", sheet: "Pending dues", moneyLabel: "Balance", file: "cfo-dues" },
};

/** The sheet behind a tab: the same columns on the page, in Excel and on paper. */
export function listSheet(key: CfoListKey, rows: (CfoAlertRow | CfoDueRow)[]): ReportSheet {
  const meta = LIST_META[key];
  if (key === "dues") {
    return {
      id: key,
      title: meta.sheet,
      hint: "Bills with money still to pay",
      columns: [
        { label: "Name" },
        { label: "Member ID" },
        { label: "Phone" },
        { label: "Bill" },
        { label: "For" },
        { label: "Balance", type: "money" },
        { label: "Pay by", type: "date" },
        { label: "Days late", type: "number" },
        { label: "Group" },
      ],
      rows: (rows as CfoDueRow[]).map((r) => [
        r.name,
        r.code,
        r.phone,
        r.billNumber,
        r.items,
        r.balance,
        r.dueDate,
        r.daysLate,
        DUE_GROUP_LABEL[r.group],
      ]),
    };
  }
  return {
    id: key,
    title: meta.sheet,
    hint: "Members to look at",
    columns: [
      { label: "Name" },
      { label: "Member ID" },
      { label: "Phone" },
      { label: "Plan" },
      { label: "Plan ends", type: "date" },
      { label: "Last visit", type: "date" },
      { label: meta.moneyLabel, type: "money" },
      { label: "Why" },
      { label: "Top priority" },
    ],
    rows: (rows as CfoAlertRow[]).map((r) => [
      r.name,
      r.code,
      r.phone,
      r.plan,
      r.endDate,
      r.lastVisit,
      r.money,
      r.reason,
      r.top ? "Yes" : "",
    ]),
  };
}

export const downloadListExcel = (
  key: CfoListKey,
  rows: (CfoAlertRow | CfoDueRow)[],
  day: string,
) => downloadExcel(`${LIST_META[key].file}-${day}.xlsx`, [listSheet(key, rows)]);

const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );

function printCell(type: string | undefined, v: ReportCell) {
  if (v === null || v === undefined || v === "") return "";
  if (type === "money" && typeof v === "number") return formatRupees(v);
  if (type === "date" && typeof v === "string") return formatDay(v);
  if (type === "number" && typeof v === "number") return formatCount(v);
  return String(v);
}

/** Opens a clean page and the print window (same idea as the Day Book). */
export function printList(
  key: CfoListKey,
  rows: (CfoAlertRow | CfoDueRow)[],
  o: { gym: string; line: string; day: string },
) {
  const sheet = listSheet(key, rows);
  const w = window.open("", "_blank");
  if (!w) return false;
  const head = sheet.columns.map((c) => `<th>${esc(c.label)}</th>`).join("");
  const body = sheet.rows
    .map(
      (r) =>
        `<tr>${sheet.columns.map((c, i) => `<td>${esc(printCell(c.type, r[i]))}</td>`).join("")}</tr>`,
    )
    .join("");
  w.document.write(
    `<html><head><title>${esc(LIST_META[key].label)} ${esc(o.day)}</title><style>body{font-family:system-ui,sans-serif;padding:16px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #999;padding:4px 6px;text-align:left}th{background:#eee}h1{font-size:18px;margin:0 0 4px}p{margin:0 0 12px;font-size:13px}</style></head><body><h1>${esc(o.gym)} · ${esc(LIST_META[key].label)}</h1><p>${esc(o.line)} · ${esc(formatDay(o.day))}</p><table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${sheet.columns.length}">Nobody on this list.</td></tr>`}</tbody></table></body></html>`,
  );
  w.document.close();
  w.focus();
  w.print();
  return true;
}
