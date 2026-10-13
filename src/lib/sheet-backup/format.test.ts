import assert from "node:assert/strict";
import { test } from "node:test";
import {
  colLetter,
  dateSerial,
  duesRules,
  INR_FORMAT,
  membersStatusRules,
  monthRowRules,
  readMeFormatRequests,
  spreadsheetSetupRequests,
  tabFormatRequests,
  toCells,
  type TabSpec,
} from "./format.ts";
import { MONTH_COLUMNS, type MonthRow } from "./month.ts";
import { duesTab } from "./tabs.ts";
import type { Column } from "./types.ts";

type Req = Record<string, Record<string, unknown>>;
const only = (reqs: unknown[], key: string) =>
  (reqs as Req[]).filter((r) => key in r).map((r) => r[key]!);

const spec = (over: Partial<TabSpec> = {}): TabSpec => ({
  sheetId: 7,
  columns: MONTH_COLUMNS as Column<unknown>[],
  rowCount: 12,
  hasTotals: true,
  tabColor: "#6A1B9A",
  existingBandingIds: [],
  existingConditionalCount: 0,
  ...over,
});

test("dateSerial counts days since 1899-12-30", () => {
  assert.equal(dateSerial("2026-10-13"), 46308);
  assert.equal(dateSerial("1899-12-30"), 0);
  assert.equal(dateSerial(""), "");
  assert.equal(dateSerial("not a date"), "");
});

test("toCells: zero money becomes empty, dates become serials, text stays", () => {
  const cols: Column<{ d: string; m: number; t: string; n: number }>[] = [
    { header: "D", value: (r) => r.d, width: 96, kind: "date" },
    { header: "M", value: (r) => r.m, width: 96, kind: "money" },
    { header: "T", value: (r) => r.t, width: 96, kind: "text" },
    { header: "N", value: (r) => r.n, width: 96, kind: "number" },
  ];
  const out = toCells(cols, [
    { d: "2026-10-13", m: 0, t: "x", n: 0 },
    { d: "", m: 1999, t: "", n: 5 },
  ]);
  assert.deepEqual(out, [
    [46308, "", "x", 0],
    ["", 1999, "", 5],
  ]);
});

test("toCells on the month columns keeps S.NO and blank dates", () => {
  const row = {
    date: "2026-10-08",
    pp: 0,
    cash: 2000,
    name: "Asha",
    days: 30,
    start: "",
    paid: 2000,
  } as unknown as MonthRow;
  const cells = toCells(MONTH_COLUMNS, [row]);
  assert.equal(cells[0]?.[0], 1);
  assert.equal(cells[0]?.[1], dateSerial("2026-10-08"));
  assert.equal(cells[0]?.[6], ""); // PP is 0
  assert.equal(cells[0]?.[7], 2000); // CASH
  assert.equal(cells[0]?.[20], ""); // START DATE empty
});

test("INR format groups the Indian way", () => {
  assert.equal(INR_FORMAT, "[>=10000000]₹##\\,##\\,##\\,##0;[>=100000]₹##\\,##\\,##0;₹##,##0");
});

test("tab formatting: filter, banding, 2 frozen rows, no frozen columns, a width per column, no auto-resize", () => {
  const reqs = tabFormatRequests(spec());
  assert.equal(only(reqs, "setBasicFilter").length, 1);
  assert.equal(only(reqs, "addBanding").length, 1);
  assert.equal(only(reqs, "autoResizeDimensions").length, 0);

  const props = only(reqs, "updateSheetProperties")[0] as {
    properties: { gridProperties: { frozenRowCount: number; frozenColumnCount: number } };
  };
  assert.equal(props.properties.gridProperties.frozenRowCount, 2);
  assert.equal(props.properties.gridProperties.frozenColumnCount, 0);

  const widths = only(reqs, "updateDimensionProperties").filter(
    (r) => (r["range"] as { dimension: string }).dimension === "COLUMNS",
  ) as { range: { startIndex: number; endIndex: number }; properties: { pixelSize: number } }[];
  assert.equal(widths.length, MONTH_COLUMNS.length);
  widths.forEach((w, i) => {
    assert.equal(w.range.startIndex, i);
    assert.equal(w.range.endIndex, i + 1);
    assert.equal(w.properties.pixelSize, MONTH_COLUMNS[i]!.width);
  });
});

test("header chips for PP, CASH, CARD and DUE use the Look colours", () => {
  const reqs = tabFormatRequests(spec());
  const header = (name: string) => {
    const i = MONTH_COLUMNS.findIndex((c) => c.header === name);
    const hit =
      only(reqs, "repeatCell").find((r) => {
        const range = r["range"] as {
          startRowIndex?: number;
          endRowIndex?: number;
          startColumnIndex?: number;
        };
        return range.startRowIndex === 0 && range.endRowIndex === 1 && range.startColumnIndex === i;
      }) ??
      only(reqs, "repeatCell").find((r) => {
        // No chip of its own: the plain grey header row covers every column.
        const range = r["range"] as {
          startRowIndex?: number;
          endRowIndex?: number;
          startColumnIndex?: number;
        };
        return range.startRowIndex === 0 && range.endRowIndex === 1 && range.startColumnIndex === 0;
      });
    assert.ok(hit, name);
    const fmt = (
      hit["cell"] as {
        userEnteredFormat: {
          backgroundColor: { red: number };
          textFormat: { foregroundColor: { red: number } };
        };
      }
    ).userEnteredFormat;
    return fmt;
  };
  const hex = (c: { red: number }) => Math.round(c.red * 255);
  assert.equal(hex(header("PP").backgroundColor), 0xf3);
  assert.equal(hex(header("PP").textFormat.foregroundColor), 0x6a);
  assert.equal(hex(header("CASH").backgroundColor), 0xe3);
  assert.equal(hex(header("CARD").backgroundColor), 0xe8);
  assert.equal(hex(header("DUE NOW").backgroundColor), 0xff);
  assert.equal(hex(header("DUE NOW").textFormat.foregroundColor), 0xb7);
  // The plain header is the grey one.
  assert.equal(hex(header("NAME").backgroundColor), 0xec);
});

test("old banding and conditional rules are removed before the new ones go in", () => {
  const reqs = tabFormatRequests(
    spec({
      existingBandingIds: [11, 12],
      existingConditionalCount: 3,
      rowRules: monthRowRules(MONTH_COLUMNS),
    }),
  );
  const keys = (reqs as Record<string, unknown>[]).map((r) => Object.keys(r)[0]);
  assert.equal(keys.filter((k) => k === "deleteBanding").length, 2);
  assert.equal(keys.filter((k) => k === "deleteConditionalFormatRule").length, 3);
  assert.ok(keys.lastIndexOf("deleteBanding") < keys.indexOf("addBanding"));
  assert.ok(
    keys.lastIndexOf("deleteConditionalFormatRule") < keys.indexOf("addConditionalFormatRule"),
  );
  assert.equal(only(reqs, "addConditionalFormatRule").length, 3 + 2); // 3 row rules + the match line ✓ / ✗
});

test("empty money columns are hidden, others shown", () => {
  const hide = MONTH_COLUMNS.map((c) => c.header === "PT FEE");
  const reqs = tabFormatRequests(spec({ hideEmptyMoney: hide }));
  const widths = only(reqs, "updateDimensionProperties").filter(
    (r) => (r["range"] as { dimension: string }).dimension === "COLUMNS",
  ) as { properties: { hiddenByUser: boolean } }[];
  assert.deepEqual(
    widths.map((w) => w.properties.hiddenByUser),
    hide,
  );
});

test("month row rules point at the STATUS and PAYMENT FOR columns", () => {
  const rules = monthRowRules(MONTH_COLUMNS);
  const status = colLetter(MONTH_COLUMNS.findIndex((c) => c.header === "STATUS"));
  const kind = colLetter(MONTH_COLUMNS.findIndex((c) => c.header === "PAYMENT FOR"));
  assert.equal(rules.length, 3);
  assert.equal(rules[0]!.formula, `=OR($${status}3="Cancelled",$${status}3="Refunded")`);
  assert.equal(rules[1]!.formula, `=$${kind}3="Balance"`);
  assert.equal(rules[2]!.formula, `=$${status}3="Part paid"`);
  assert.deepEqual(
    rules.map((r) => r.background),
    ["#FFEBEE", "#E3F2FD", "#FFF3E0"],
  );
});

test("members chips and dues overdue rules", () => {
  assert.deepEqual(
    membersStatusRules.map((r) => r.equals),
    ["Active", "Ending in 7 days", "Ended", "No plan"],
  );
  const members = tabFormatRequests(spec({ statusRules: membersStatusRules }));
  assert.equal(only(members, "addConditionalFormatRule").length, 4 + 2); // 4 chips + match-line ✓/✗
  const dues = duesTab({ openBills: [], clients: new Map(), today: "2026-10-13" });
  const reqs = tabFormatRequests(
    spec({ columns: dues.columns as Column<unknown>[], statusRules: duesRules }),
  );
  const rule = only(reqs, "addConditionalFormatRule")[0] as {
    rule: { booleanRule: { condition: { values: { userEnteredValue: string }[] } } };
  };
  assert.equal(rule.rule.booleanRule.condition.values[0]!.userEnteredValue, "=N(I3)>0");
});

test("column letters", () => {
  assert.equal(colLetter(0), "A");
  assert.equal(colLetter(25), "Z");
  assert.equal(colLetter(26), "AA");
  assert.equal(colLetter(29), "AD");
});

test("spreadsheet setup: Indian locale, IST, Roboto 10", () => {
  const [req] = spreadsheetSetupRequests() as {
    updateSpreadsheetProperties: { properties: Record<string, unknown> };
  }[];
  const p = req!.updateSpreadsheetProperties.properties as {
    locale: string;
    timeZone: string;
    defaultFormat: { textFormat: { fontFamily: string; fontSize: number } };
  };
  assert.equal(p.locale, "en_IN");
  assert.equal(p.timeZone, "Asia/Kolkata");
  assert.equal(p.defaultFormat.textFormat.fontFamily, "Roboto");
  assert.equal(p.defaultFormat.textFormat.fontSize, 10);
});

test("read me format: widths 220 / 640, checks coloured, no auto-resize", () => {
  const reqs = readMeFormatRequests(3, 20, [
    { row: 12, ok: true },
    { row: 13, ok: false },
  ]);
  const widths = (
    only(reqs, "updateDimensionProperties") as {
      range: { dimension: string; startIndex: number };
      properties: { pixelSize: number };
    }[]
  ).filter((r) => r.range.dimension === "COLUMNS");
  assert.deepEqual(
    widths.map((w) => w.properties.pixelSize),
    [220, 640],
  );
  assert.equal(only(reqs, "autoResizeDimensions").length, 0);
  const colours = (
    only(reqs, "repeatCell") as {
      range: { startRowIndex: number };
      cell: {
        userEnteredFormat: { textFormat?: { foregroundColor?: { red: number; green: number } } };
      };
    }[]
  )
    .filter((r) => r.range.startRowIndex === 12 || r.range.startRowIndex === 13)
    .map((r) => r.cell.userEnteredFormat.textFormat?.foregroundColor);
  assert.ok(colours[0] && colours[0].green > colours[0].red, "✓ is green");
  assert.ok(colours[1] && colours[1].red > colours[1].green, "✗ is red");
});
