/**
 * A small Google Sheets (REST v4) client for the backup sheet. No library: the access token is a
 * JWT signed with the same service account the server already uses (node:crypto, like push.ts),
 * scope "spreadsheets". The sheet must be shared with that account as Editor.
 *
 * Test switches (never needed in production): SHEETS_API_BASE and GOOGLE_TOKEN_URL point it at a
 * fake server. Errors say what Google answered, never the token or the key.
 */
import { createSign } from "node:crypto";
import type { Cell } from "@/lib/sheet-backup/types";
import { credentials } from "./admin";

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const REAL_TOKEN_URL = "https://oauth2.googleapis.com/token";
/** Most rows per write, and most characters (the API likes requests of a couple of MB at most). */
const CHUNK_ROWS = 5_000;
const CHUNK_CHARS = 1_500_000;
/** Waits before retrying a "too many requests" / server hiccup answer (Sheets allows 60 writes a minute). */
const RETRY_WAITS_MS = [1_500, 4_000, 9_000];

const base = () =>
  (process.env["SHEETS_API_BASE"] ?? "https://sheets.googleapis.com").replace(/\/+$/, "");
const tokenUrl = () => process.env["GOOGLE_TOKEN_URL"] ?? REAL_TOKEN_URL;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What the sheet looks like now (one tab). */
export interface TabInfo {
  title: string;
  sheetId: number;
  hidden: boolean;
  index: number;
  rows: number;
  cols: number;
  conditionalFormatCount: number;
  bandingIds: number[];
}

export interface SheetsClient {
  meta(): Promise<{ title: string; tabs: TabInfo[] }>;
  /** Makes the tab when it is missing; returns its sheetId. */
  ensureTab(title: string, opts?: { index?: number; hidden?: boolean }): Promise<number>;
  /**
   * Clears the tab and writes the values (RAW, in chunks). Cells listed through `formulaRows` /
   * `formulaCols` that start with "=" are then entered as formulas (everything else stays plain text).
   */
  writeTab(
    title: string,
    values: Cell[][],
    opts?: { formulaRows?: number[]; formulaCols?: number[] },
  ): Promise<void>;
  readTab(title: string, range?: string): Promise<Cell[][]>;
  /** Rewrites single rows in place (1-based sheet rows) and clears others. */
  patchRows(
    title: string,
    set: { row: number; values: Cell[] }[],
    clearRows: number[],
  ): Promise<void>;
  batchUpdate(requests: unknown[]): Promise<unknown>;
  deleteTab(title: string): Promise<void>;
}

/* ------------------------------------------------------------------- token */

let cached: { token: string; exp: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.exp - 300_000 > Date.now()) return cached.token;
  const { clientEmail, privateKey } = credentials();
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: clientEmail,
    scope: SCOPE,
    aud: REAL_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .sign(privateKey)
    .toString("base64url");
  const res = await fetch(tokenUrl(), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  };
  if (!res.ok || !body.access_token)
    throw new Error(
      `Google sign-in failed (${res.status}): ${String(body.error_description ?? body.error ?? "no token").slice(0, 160)}`,
    );
  cached = { token: body.access_token, exp: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cached.token;
}

/* ------------------------------------------------------------------ client */

/** A tab (or cells in it) as a URL path piece: 'Oct 2026'!A1 */
const rangePath = (title: string, cells?: string) =>
  encodeURIComponent(`'${title.replace(/'/g, "''")}'${cells ? `!${cells}` : ""}`);
/** The same for a range inside a JSON body. */
const rangeText = (title: string, cells: string) => `'${title.replace(/'/g, "''")}'!${cells}`;

export async function sheetsClient(sheetId: string): Promise<SheetsClient> {
  // The emulator suite must never write the real sheet.
  if (process.env["FIRESTORE_EMULATOR_HOST"] && !process.env["SHEETS_API_BASE"])
    throw new Error("Refusing to use the real Google Sheet while the Firestore emulator is on.");
  const root = `${base()}/v4/spreadsheets/${encodeURIComponent(sheetId)}`;

  async function api(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const token = await accessToken();
      const res = await fetch(`${root}${path}`, {
        method: init.method ?? "GET",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
      if (res.ok) return res.json().catch(() => ({}));
      if (res.status === 401 && attempt === 0) {
        cached = null; // the token went stale early: sign in again once
        continue;
      }
      const wait = RETRY_WAITS_MS[attempt];
      if ((res.status === 429 || res.status >= 500) && wait !== undefined) {
        await sleep(wait);
        continue;
      }
      const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(
        `Google Sheets ${res.status}: ${String(err.error?.message ?? res.statusText).slice(0, 200)}`,
      );
    }
  }

  let tabsCache: { title: string; tabs: TabInfo[] } | null = null;
  const forget = () => {
    tabsCache = null;
  };

  async function meta() {
    if (tabsCache) return tabsCache;
    const j = (await api(
      "?fields=properties.title,sheets(properties(title,sheetId,hidden,index,gridProperties(rowCount,columnCount)),conditionalFormats,bandedRanges(bandedRangeId))",
    )) as {
      properties?: { title?: string };
      sheets?: {
        properties: {
          title: string;
          sheetId: number;
          hidden?: boolean;
          index: number;
          gridProperties?: { rowCount?: number; columnCount?: number };
        };
        conditionalFormats?: unknown[];
        bandedRanges?: { bandedRangeId: number }[];
      }[];
    };
    tabsCache = {
      title: j.properties?.title ?? "",
      tabs: (j.sheets ?? []).map((s) => ({
        title: s.properties.title,
        sheetId: s.properties.sheetId,
        hidden: !!s.properties.hidden,
        index: s.properties.index,
        rows: s.properties.gridProperties?.rowCount ?? 1000,
        cols: s.properties.gridProperties?.columnCount ?? 26,
        conditionalFormatCount: s.conditionalFormats?.length ?? 0,
        bandingIds: (s.bandedRanges ?? []).map((b) => b.bandedRangeId),
      })),
    };
    return tabsCache;
  }

  async function tabNamed(title: string): Promise<TabInfo> {
    const t = (await meta()).tabs.find((x) => x.title === title);
    if (!t) throw new Error(`Tab "${title}" is missing from the sheet.`);
    return t;
  }

  async function batchUpdate(requests: unknown[]) {
    forget();
    return api(":batchUpdate", { method: "POST", body: { requests } });
  }

  /** The tab must have room for the values: a write past the grid is refused by Google. */
  async function growTo(tab: TabInfo, rows: number, cols: number) {
    if (rows <= tab.rows && cols <= tab.cols) return;
    await batchUpdate([
      {
        updateSheetProperties: {
          properties: {
            sheetId: tab.sheetId,
            gridProperties: {
              rowCount: Math.max(rows, tab.rows),
              columnCount: Math.max(cols, tab.cols),
            },
          },
          fields: "gridProperties.rowCount,gridProperties.columnCount",
        },
      },
    ]);
  }

  const a1 = (col: number, row: number) => {
    let c = "";
    for (let n = col; n >= 0; n = Math.floor(n / 26) - 1)
      c = String.fromCharCode(65 + (n % 26)) + c;
    return `${c}${row}`;
  };

  return {
    meta,
    batchUpdate,

    async ensureTab(title, opts = {}) {
      const have = (await meta()).tabs.find((t) => t.title === title);
      if (have) return have.sheetId;
      const res = (await batchUpdate([
        {
          addSheet: {
            properties: {
              title,
              ...(opts.index === undefined ? {} : { index: opts.index }),
              ...(opts.hidden ? { hidden: true } : {}),
            },
          },
        },
      ])) as { replies?: { addSheet?: { properties?: { sheetId?: number } } }[] };
      const id = res.replies?.[0]?.addSheet?.properties?.sheetId;
      if (id === undefined) throw new Error(`Could not add the tab "${title}".`);
      return id;
    },

    async writeTab(title, values, opts = {}) {
      const tab = await tabNamed(title);
      const width = values.reduce((n, r) => Math.max(n, r.length), 1);
      await growTo(tab, values.length + 1, width);
      await api(`/values/${rangePath(title)}:clear`, { method: "POST", body: {} });
      // Plain (RAW) write in chunks.
      let start = 0;
      while (start < values.length) {
        let end = start;
        let chars = 0;
        while (
          end < values.length &&
          end - start < CHUNK_ROWS &&
          (chars < CHUNK_CHARS || end === start)
        ) {
          chars += values[end]!.reduce<number>((n, c) => n + String(c).length, 0);
          end += 1;
        }
        await api(`/values/${rangePath(title, a1(0, start + 1))}?valueInputOption=RAW`, {
          method: "PUT",
          body: { values: values.slice(start, end) },
        });
        start = end;
      }
      // Formulas: only the cells the caller named, and only when they start with "=".
      const data: { range: string; values: Cell[][] }[] = [];
      const isFormula = (c: Cell | undefined) => typeof c === "string" && c.startsWith("=");
      for (const r of opts.formulaRows ?? [])
        (values[r] ?? []).forEach((c, ci) => {
          if (isFormula(c)) data.push({ range: rangeText(title, a1(ci, r + 1)), values: [[c]] });
        });
      for (const ci of opts.formulaCols ?? []) {
        let r = 0;
        while (r < values.length) {
          if (!isFormula(values[r]?.[ci])) {
            r += 1;
            continue;
          }
          const run: Cell[][] = [];
          const from = r;
          while (r < values.length && isFormula(values[r]?.[ci])) {
            run.push([values[r]![ci]!]);
            r += 1;
          }
          data.push({ range: rangeText(title, a1(ci, from + 1)), values: run });
        }
      }
      for (let i = 0; i < data.length; i += 200)
        await api("/values:batchUpdate", {
          method: "POST",
          body: { valueInputOption: "USER_ENTERED", data: data.slice(i, i + 200) },
        });
    },

    async readTab(title, range) {
      const j = (await api(
        `/values/${rangePath(title, range)}?valueRenderOption=UNFORMATTED_VALUE`,
      )) as {
        values?: Cell[][];
      };
      return j.values ?? [];
    },

    async patchRows(title, set, clearRows) {
      const tab = await tabNamed(title);
      const top = Math.max(0, ...set.map((s) => s.row), ...clearRows);
      const width = set.reduce((n, s) => Math.max(n, s.values.length), 1);
      await growTo(tab, top + 1, width);
      const lastCol = a1(Math.max(width, tab.cols) - 1, 1).replace(/\d+/g, "");
      const clears = [...new Set([...clearRows, ...set.map((s) => s.row)])].map((r) =>
        rangeText(title, `A${r}:${lastCol}${r}`),
      );
      for (let i = 0; i < clears.length; i += 200)
        await api("/values:batchClear", {
          method: "POST",
          body: { ranges: clears.slice(i, i + 200) },
        });
      for (let i = 0; i < set.length; i += 200)
        await api("/values:batchUpdate", {
          method: "POST",
          body: {
            valueInputOption: "RAW",
            data: set
              .slice(i, i + 200)
              .map((s) => ({ range: rangeText(title, `A${s.row}`), values: [s.values] })),
          },
        });
    },

    async deleteTab(title) {
      const have = (await meta()).tabs.find((t) => t.title === title);
      if (have) await batchUpdate([{ deleteSheet: { sheetId: have.sheetId } }]);
    },
  };
}
