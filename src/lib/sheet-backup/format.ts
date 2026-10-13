/**
 * How the backup sheet looks, as Google Sheets API `batchUpdate` requests. Pure (no network) so it
 * is unit-tested and the server and the scripts format a tab identically. Readers are not
 * technical, so: real dates and Indian money, a calm grey header with coloured mode chips,
 * banded rows, fixed column widths, filters, and only the top two rows frozen.
 */
import type { Cell, Column } from "./types.ts";

type Req = Record<string, unknown>;

/* ------------------------------------------------------------------- values */

/** Days since 1899-12-30 (what Google Sheets calls a date), "" for empty or not a date. */
export const dateSerial = (iso: string): number | "" => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return "";
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) + 25569 : "";
};

/** ₹1,59,046: lakh / crore grouping; the sheet shows an empty cell for 0 (see toCells). */
export const INR_FORMAT = "[>=10000000]₹##\\,##\\,##\\,##0;[>=100000]₹##\\,##\\,##0;₹##,##0";
const DATE_FORMAT = "dd-mm-yyyy";

/** Column rows -> sheet values: dates as real dates, 0 money as empty (the sheet never shows 0s). */
export function toCells<R>(columns: Column<R>[], rows: R[]): Cell[][] {
  return rows.map((r, i) =>
    columns.map((c) => {
      const v = c.value(r, i);
      if (c.kind === "date") return typeof v === "string" ? dateSerial(v) : v;
      if (c.kind === "money" && v === 0) return "";
      return v;
    }),
  );
}

/** 0 -> A, 25 -> Z, 26 -> AA. */
export const colLetter = (i: number): string =>
  (i >= 26 ? colLetter(Math.floor(i / 26) - 1) : "") + String.fromCharCode(65 + (i % 26));

/* ------------------------------------------------------------------ palette */

const rgb = (hex: string) => ({
  red: parseInt(hex.slice(1, 3), 16) / 255,
  green: parseInt(hex.slice(3, 5), 16) / 255,
  blue: parseInt(hex.slice(5, 7), 16) / 255,
});
const WHITE = "#FFFFFF";
const HEADER_BG = "#ECEFF1";
const HEADER_TEXT = "#263238";
const HEADER_LINE = "#90A4AE";
const TOTALS_BG = "#FFF8E1";
const BAND = "#FAFAFA";
/** Header chips for the money-mode columns: background / dark text of the same hue (>= 4.5:1). */
const CHIPS: Record<string, [string, string]> = {
  PP: ["#F3E5F5", "#6A1B9A"],
  CASH: ["#E3F2FD", "#0D47A1"],
  CARD: ["#E8F5E9", "#1B5E20"],
  "DUE NOW": ["#FFEBEE", "#B71C1C"],
  DUE: ["#FFEBEE", "#B71C1C"],
  "BALANCE DUE": ["#FFEBEE", "#B71C1C"],
};

/* -------------------------------------------------------------------- rules */

/** A coloured cell rule on one column: by exact text, or by a formula written for the first data row. */
export interface StatusRule {
  column: string;
  equals?: string;
  formula?: string;
  background?: string;
  text?: string;
  bold?: boolean;
}
/** A rule that colours the whole data row when the formula (written for row 3) is true. */
export interface RowRule {
  formula: string;
  background: string;
}

/** Cancelled / Refunded red, Balance blue, Part paid orange (month tabs). */
export function monthRowRules(columns: Column<unknown>[]): RowRule[] {
  const at = (h: string) =>
    colLetter(
      Math.max(
        0,
        columns.findIndex((c) => c.header === h),
      ),
    );
  const status = at("STATUS");
  const kind = at("PAYMENT FOR");
  return [
    { formula: `=OR($${status}3="Cancelled",$${status}3="Refunded")`, background: "#FFEBEE" },
    { formula: `=$${kind}3="Balance"`, background: "#E3F2FD" },
    { formula: `=$${status}3="Part paid"`, background: "#FFF3E0" },
  ];
}

/** Members STATUS chips: Active green, Ending in 7 days orange, Ended grey, No plan light grey. */
export const membersStatusRules: StatusRule[] = [
  { column: "STATUS", equals: "Active", background: "#E8F5E9", text: "#1B5E20" },
  { column: "STATUS", equals: "Ending in 7 days", background: "#FFF3E0", text: "#E65100" },
  { column: "STATUS", equals: "Ended", background: "#ECEFF1", text: "#455A64" },
  { column: "STATUS", equals: "No plan", background: "#F5F5F5", text: "#757575" },
];

/** Dues: DAYS OVERDUE above 0 in red bold. */
export const duesRules: StatusRule[] = [
  { column: "DAYS OVERDUE", formula: "=N(@)>0", text: "#B71C1C", bold: true },
];

/* ----------------------------------------------------------------- one tab */

export interface TabSpec {
  sheetId: number;
  columns: Column<unknown>[];
  /** Data rows (below the header and totals rows). */
  rowCount: number;
  /** Row 2 holds totals (styled); the layout is always header, totals, data. */
  hasTotals: boolean;
  tabColor: string;
  statusRules?: StatusRule[];
  rowRules?: RowRule[];
  /** From the sheet's metadata, so the old ones are removed first. */
  existingBandingIds: number[];
  existingConditionalCount: number;
  /** Per column: hide it (a money column that is empty for the whole tab). */
  hideEmptyMoney?: boolean[];
}

/** Everything in the "Look": run after the values are written. */
export function tabFormatRequests(spec: TabSpec): unknown[] {
  const { sheetId, columns } = spec;
  const ncol = columns.length;
  // Never an empty range: an empty tab still formats one data row.
  const end = 2 + Math.max(spec.rowCount, 1);
  const area = (r0: number, r1: number, c0 = 0, c1 = ncol) => ({
    sheetId,
    startRowIndex: r0,
    endRowIndex: r1,
    startColumnIndex: c0,
    endColumnIndex: c1,
  });
  const cells = (range: object, userEnteredFormat: object, fields: string): Req => ({
    repeatCell: { range, cell: { userEnteredFormat }, fields },
  });
  const reqs: Req[] = [];

  // 1. Old banding and conditional rules out (they would overlap or pile up).
  for (const id of spec.existingBandingIds) reqs.push({ deleteBanding: { bandedRangeId: id } });
  for (let i = 0; i < spec.existingConditionalCount; i++)
    reqs.push({ deleteConditionalFormatRule: { sheetId, index: 0 } });

  // 2. Clean slate, then the sheet itself: tab colour, top two rows frozen, no frozen columns.
  reqs.push({
    repeatCell: {
      range: { sheetId },
      cell: { userEnteredFormat: {} },
      fields: "userEnteredFormat",
    },
  });
  reqs.push({
    updateSheetProperties: {
      properties: {
        sheetId,
        tabColorStyle: { rgbColor: rgb(spec.tabColor) },
        gridProperties: {
          frozenRowCount: 2,
          frozenColumnCount: 0,
          rowCount: Math.max(end + 20, 50),
          columnCount: Math.max(ncol, 1),
        },
      },
      fields:
        "tabColorStyle,gridProperties.frozenRowCount,gridProperties.frozenColumnCount,gridProperties.rowCount,gridProperties.columnCount",
    },
  });

  // 3. Body: centred vertically, long text clipped (rows keep one height).
  reqs.push(
    cells(
      area(1, end),
      { verticalAlignment: "MIDDLE", wrapStrategy: "CLIP" },
      "userEnteredFormat(verticalAlignment,wrapStrategy)",
    ),
  );

  // 4. Per column: alignment and number format (money in rupees, dates dd-mm-yyyy), mode colours, NAME bold.
  columns.forEach((c, i) => {
    const kind = c.kind ?? "text";
    const col = (r0: number) => area(r0, end, i, i + 1);
    if (kind === "money")
      reqs.push(
        cells(
          col(1),
          { horizontalAlignment: "RIGHT", numberFormat: { type: "NUMBER", pattern: INR_FORMAT } },
          "userEnteredFormat(horizontalAlignment,numberFormat)",
        ),
      );
    else if (kind === "date")
      reqs.push(
        cells(
          col(2),
          { horizontalAlignment: "CENTER", numberFormat: { type: "DATE", pattern: DATE_FORMAT } },
          "userEnteredFormat(horizontalAlignment,numberFormat)",
        ),
      );
    else if (kind === "number")
      reqs.push(
        cells(
          col(2),
          { horizontalAlignment: "CENTER", numberFormat: { type: "NUMBER", pattern: "0" } },
          "userEnteredFormat(horizontalAlignment,numberFormat)",
        ),
      );
    if (c.color)
      reqs.push(
        cells(
          col(2),
          { textFormat: { foregroundColor: rgb(c.color) } },
          "userEnteredFormat.textFormat.foregroundColor",
        ),
      );
    if (c.header === "NAME")
      reqs.push(cells(col(2), { textFormat: { bold: true } }, "userEnteredFormat.textFormat.bold"));
  });

  // 5. Header row: calm grey, bold dark text, centred, wrapped; mode headers as pastel chips.
  reqs.push(
    cells(
      area(0, 1),
      {
        backgroundColor: rgb(HEADER_BG),
        textFormat: { bold: true, foregroundColor: rgb(HEADER_TEXT) },
        horizontalAlignment: "CENTER",
        verticalAlignment: "MIDDLE",
        wrapStrategy: "WRAP",
      },
      "userEnteredFormat",
    ),
  );
  columns.forEach((c, i) => {
    const chip = CHIPS[c.header];
    if (chip)
      reqs.push(
        cells(
          area(0, 1, i, i + 1),
          {
            backgroundColor: rgb(chip[0]),
            textFormat: { bold: true, foregroundColor: rgb(chip[1]) },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
            wrapStrategy: "WRAP",
          },
          "userEnteredFormat",
        ),
      );
  });
  reqs.push({
    updateBorders: {
      range: area(0, 1),
      bottom: { style: "SOLID_MEDIUM", color: rgb(HEADER_LINE) },
    },
  });

  // 6. Totals row: bold on cream with solid lines; the "matches the app" line goes green or red.
  if (spec.hasTotals) {
    reqs.push(
      cells(
        area(1, 2),
        { backgroundColor: rgb(TOTALS_BG), textFormat: { bold: true } },
        "userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.bold",
      ),
    );
    reqs.push({
      updateBorders: {
        range: area(1, 2),
        top: { style: "SOLID", color: rgb(HEADER_LINE) },
        bottom: { style: "SOLID", color: rgb(HEADER_LINE) },
      },
    });
  }

  // 7. Row heights.
  const rowHeight = (r0: number, r1: number, pixelSize: number): Req => ({
    updateDimensionProperties: {
      range: { sheetId, dimension: "ROWS", startIndex: r0, endIndex: r1 },
      properties: { pixelSize },
      fields: "pixelSize",
    },
  });
  reqs.push(rowHeight(0, 1, 44), rowHeight(1, 2, 28), rowHeight(2, end, 24));

  // 8. Fixed column widths (never auto-resized) and hidden empty money columns.
  columns.forEach((c, i) =>
    reqs.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
        properties: { pixelSize: c.width, hiddenByUser: !!spec.hideEmptyMoney?.[i] },
        fields: "pixelSize,hiddenByUser",
      },
    }),
  );

  // 9. Banded rows and the filter buttons on the header row.
  reqs.push({
    addBanding: {
      bandedRange: {
        range: area(2, end),
        rowProperties: {
          firstBandColorStyle: { rgbColor: rgb(WHITE) },
          secondBandColorStyle: { rgbColor: rgb(BAND) },
        },
      },
    },
  });
  reqs.push({ setBasicFilter: { filter: { range: area(0, end) } } });

  // 10. Colour rules, top priority first: whole-row rules, then column chips, then the match line.
  let index = 0;
  const addRule = (ranges: object[], condition: object, format: object) =>
    reqs.push({
      addConditionalFormatRule: {
        index: index++,
        rule: { ranges, booleanRule: { condition, format } },
      },
    });
  for (const r of spec.rowRules ?? [])
    addRule(
      [area(2, end)],
      { type: "CUSTOM_FORMULA", values: [{ userEnteredValue: r.formula }] },
      { backgroundColor: rgb(r.background) },
    );
  for (const r of spec.statusRules ?? []) {
    const i = columns.findIndex((c) => c.header === r.column);
    if (i < 0) continue;
    const letter = colLetter(i);
    const condition = r.formula
      ? {
          type: "CUSTOM_FORMULA",
          values: [{ userEnteredValue: r.formula.replace(/@/g, `${letter}3`) }],
        }
      : { type: "TEXT_EQ", values: [{ userEnteredValue: r.equals ?? "" }] };
    addRule([area(2, end, i, i + 1)], condition, {
      ...(r.background ? { backgroundColor: rgb(r.background) } : {}),
      textFormat: {
        ...(r.text ? { foregroundColor: rgb(r.text) } : {}),
        ...(r.bold ? { bold: true } : {}),
      },
    });
  }
  const nameAt = columns.findIndex((c) => c.header === "NAME");
  if (spec.hasTotals && nameAt >= 0) {
    const cell = [area(1, 2, nameAt, nameAt + 1)];
    addRule(
      cell,
      { type: "TEXT_CONTAINS", values: [{ userEnteredValue: "✓" }] },
      { backgroundColor: rgb("#E8F5E9"), textFormat: { foregroundColor: rgb("#1B5E20") } },
    );
    addRule(
      cell,
      { type: "TEXT_CONTAINS", values: [{ userEnteredValue: "✗" }] },
      { backgroundColor: rgb("#FFEBEE"), textFormat: { foregroundColor: rgb("#B71C1C") } },
    );
  }
  return reqs;
}

/* ----------------------------------------------------------------- Read me */

/**
 * The Read me page: title, a two-column guide (A 220 px, B 640 px, B wrapped), ticks green and
 * crosses red. `checkRows` are 0-based sheet rows. A single-cell line simply runs across into B.
 */
export function readMeFormatRequests(
  sheetId: number,
  rowCount: number,
  checkRows: { row: number; ok: boolean }[],
  opts: { tableHeaderRow?: number; headingRows?: number[] } = {},
): unknown[] {
  const end = Math.max(rowCount, 4);
  const area = (r0: number, r1: number, c0 = 0, c1 = 2) => ({
    sheetId,
    startRowIndex: r0,
    endRowIndex: r1,
    startColumnIndex: c0,
    endColumnIndex: c1,
  });
  const cells = (range: object, userEnteredFormat: object, fields: string): Req => ({
    repeatCell: { range, cell: { userEnteredFormat }, fields },
  });
  const header = opts.tableHeaderRow ?? 3;
  const reqs: Req[] = [
    {
      repeatCell: {
        range: { sheetId },
        cell: { userEnteredFormat: {} },
        fields: "userEnteredFormat",
      },
    },
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          tabColorStyle: { rgbColor: rgb("#2E7D32") },
          gridProperties: {
            frozenRowCount: 0,
            frozenColumnCount: 0,
            hideGridlines: true,
            rowCount: Math.max(end + 20, 50),
            columnCount: 2,
          },
        },
        fields:
          "tabColorStyle,gridProperties.frozenRowCount,gridProperties.frozenColumnCount,gridProperties.hideGridlines,gridProperties.rowCount,gridProperties.columnCount",
      },
    },
    cells(area(0, end), { verticalAlignment: "TOP" }, "userEnteredFormat.verticalAlignment"),
    // Column A text runs across into B when B is empty; B wraps.
    cells(area(0, end, 0, 1), { wrapStrategy: "OVERFLOW_CELL" }, "userEnteredFormat.wrapStrategy"),
    cells(area(0, end, 1, 2), { wrapStrategy: "WRAP" }, "userEnteredFormat.wrapStrategy"),
    cells(
      area(0, 1),
      { textFormat: { bold: true, fontSize: 16, foregroundColor: rgb(HEADER_TEXT) } },
      "userEnteredFormat.textFormat",
    ),
    cells(
      area(1, 2),
      { textFormat: { foregroundColor: rgb("#607D8B") } },
      "userEnteredFormat.textFormat.foregroundColor",
    ),
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 36 },
        fields: "pixelSize",
      },
    },
    cells(
      area(header, header + 1),
      {
        backgroundColor: rgb(HEADER_BG),
        textFormat: { bold: true, foregroundColor: rgb(HEADER_TEXT) },
        verticalAlignment: "MIDDLE",
      },
      "userEnteredFormat(backgroundColor,textFormat,verticalAlignment)",
    ),
    {
      updateBorders: {
        range: area(header, header + 1),
        bottom: { style: "SOLID_MEDIUM", color: rgb(HEADER_LINE) },
      },
    },
  ];
  for (const r of opts.headingRows ?? [])
    reqs.push(
      cells(
        area(r, r + 1),
        { textFormat: { bold: true, fontSize: 12, foregroundColor: rgb(HEADER_TEXT) } },
        "userEnteredFormat.textFormat",
      ),
    );
  for (const c of checkRows)
    reqs.push(
      cells(
        area(c.row, c.row + 1, 0, 1),
        { textFormat: { bold: true, foregroundColor: rgb(c.ok ? "#1B5E20" : "#B71C1C") } },
        "userEnteredFormat.textFormat",
      ),
    );
  reqs.push(
    ...[220, 640].map((pixelSize, i) => ({
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
        properties: { pixelSize },
        fields: "pixelSize",
      },
    })),
  );
  return reqs;
}

/* ------------------------------------------------------------ spreadsheet */

/** Once per spreadsheet: Indian dates and money, IST, Roboto 10. */
export function spreadsheetSetupRequests(): unknown[] {
  return [
    {
      updateSpreadsheetProperties: {
        properties: {
          locale: "en_IN",
          timeZone: "Asia/Kolkata",
          defaultFormat: { textFormat: { fontFamily: "Roboto", fontSize: 10 } },
        },
        fields:
          "locale,timeZone,defaultFormat.textFormat.fontFamily,defaultFormat.textFormat.fontSize",
      },
    },
  ];
}
