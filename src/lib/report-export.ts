/**
 * Reports → Excel (every sheet in one workbook) and CSV (one sheet). Dates go into Excel as real
 * dates, money as numbers, so the gym can sort, filter and add them up straight away.
 */

export type ReportColumnType = "text" | "date" | "money" | "number";
export interface ReportColumn {
  label: string;
  type?: ReportColumnType;
}
export type ReportCell = string | number | null | undefined;
export interface ReportSheet {
  id: string;
  title: string;
  /** One line under the title on the page ("Bills dated in the period"). */
  hint: string;
  columns: ReportColumn[];
  rows: ReportCell[][];
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/**
 * "2026-10-01" → Excel's day number. Worked out in UTC: the spreadsheet library's own conversion
 * is a few seconds off in India time.
 */
export function excelDay(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return (Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - EXCEL_EPOCH) / 86_400_000;
}

const empty = (v: ReportCell) => v === null || v === undefined || v === "";

function excelCell(type: ReportColumnType | undefined, v: ReportCell) {
  if (empty(v)) return null;
  if (type === "date" && typeof v === "string") {
    const day = excelDay(v);
    return day === null ? { t: "s", v } : { t: "n", v: day, z: "dd-mmm-yyyy" };
  }
  if (typeof v === "number")
    return {
      t: "n",
      v,
      ...(type === "money" ? { z: Number.isInteger(v) ? "#,##0" : "#,##0.00" } : {}),
    } as const;
  return { t: "s", v: String(v) };
}

/** Width of a column: its longest value, within reason. */
function width(sheet: ReportSheet, i: number) {
  let w = sheet.columns[i]!.label.length;
  for (const r of sheet.rows.slice(0, 1000)) {
    const v = r[i];
    const len = sheet.columns[i]!.type === "date" ? 11 : empty(v) ? 0 : String(v).length;
    if (len > w) w = len;
  }
  return Math.min(50, w + 2);
}

/** Excel sheet names: 31 characters, none of []:*?/\ and unique. */
function sheetName(title: string, used: Set<string>) {
  const base = title.replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || "Sheet";
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 28)} ${n}`;
  used.add(name.toLowerCase());
  return name;
}

export async function downloadExcel(fileName: string, sheets: ReportSheet[]) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const s of sheets) {
    const head = s.columns.map((c) => ({ t: "s", v: c.label }));
    const body = s.rows.map((r) => s.columns.map((c, i) => excelCell(c.type, r[i])));
    const ws = XLSX.utils.aoa_to_sheet(
      s.rows.length ? [head, ...body] : [head, [{ t: "s", v: "Nothing in this period" }]],
    );
    ws["!cols"] = s.columns.map((_, i) => ({ wch: width(s, i) }));
    if (s.rows.length && s.columns.length > 1)
      ws["!autofilter"] = {
        ref: XLSX.utils.encode_range({
          s: { r: 0, c: 0 },
          e: { r: s.rows.length, c: s.columns.length - 1 },
        }),
      };
    XLSX.utils.book_append_sheet(wb, ws, sheetName(s.title, used));
  }
  XLSX.writeFile(wb, fileName, { compression: true });
}

const BOM = String.fromCharCode(0xfeff);

/** A text cell Excel would run as a formula (=, +, -, @) is kept as plain text. */
const safeText = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
const csvField = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** CSV text (UTF-8 with a byte-order mark, so Excel shows ₹ and Telugu names correctly). */
export function sheetCsv(sheet: ReportSheet) {
  const lines = [
    sheet.columns.map((c) => csvField(c.label)).join(","),
    ...sheet.rows.map((r) =>
      sheet.columns
        .map((c, i) => {
          const v = r[i];
          if (empty(v)) return "";
          if (typeof v === "number") return String(v);
          return csvField(c.type === "date" ? v! : safeText(v!));
        })
        .join(","),
    ),
  ];
  return BOM + lines.join("\r\n") + "\r\n";
}

export function downloadCsv(fileName: string, sheet: ReportSheet) {
  const url = URL.createObjectURL(new Blob([sheetCsv(sheet)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
