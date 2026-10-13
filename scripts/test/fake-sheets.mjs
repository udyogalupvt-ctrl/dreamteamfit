// A fake Google Sheets + OAuth token server for the backup tests. Nothing here talks to Google.
//   node scripts/test/fake-sheets.mjs <port>
// Point the app at it with SHEETS_API_BASE=http://127.0.0.1:<port> GOOGLE_TOKEN_URL=http://127.0.0.1:<port>/token
//
// Implements what src/server/sheets-api.ts uses: token POST, spreadsheet metadata, values
// get / update / clear / batchUpdate / batchClear, and batchUpdate for addSheet, deleteSheet,
// updateSheetProperties, banding, conditional rules, protected ranges and the filter (the other
// formatting requests are counted). It enforces the grid size like Google does, and keeps one
// spreadsheet in memory that starts with the empty "Sheet1" of a new file.
//
//   GET  /__dump      every tab: values, formula cells, hidden columns, widths, filter, counts...
//   POST /__reset     back to a new empty spreadsheet
//   POST /__control   { failNext: { status, count } } answer the next N sheet calls with an error
import http from "node:http";

const port = Number(process.argv[2] || 5799);
const TOKEN = "fake-token";

let sheet;
let nextId;
let control;
let tokenRequests;
let requestLog;

function reset() {
  nextId = 1;
  control = { status: 0, count: 0 };
  tokenRequests ??= []; // kept across resets: the app caches its token
  requestLog = [];
  sheet = { title: "Fake backup sheet", tabs: [] };
  addTab("Sheet1", 0);
  sheet.tabs[0].sheetId = 0;
}

function addTab(title, index, extra = {}) {
  const tab = {
    sheetId: nextId++,
    title,
    index: index ?? sheet.tabs.length,
    hidden: false,
    rows: 1000,
    cols: 26,
    cells: new Map(), // "r,c" -> value (0-based)
    formulas: new Set(), // "r,c" entered as formulas (USER_ENTERED)
    banding: [],
    conditional: [],
    protectedRanges: 0,
    filter: null,
    frozenRows: 0,
    frozenCols: 0,
    hiddenCols: new Set(),
    widths: {},
    rowHeights: {},
    counts: {},
    tabColor: null,
    ...extra,
  };
  sheet.tabs.push(tab);
  // Keep the indexes 0..n-1 in order, the way Google does.
  sheet.tabs.sort((a, b) => a.index - b.index);
  sheet.tabs.forEach((t, i) => (t.index = i));
  return tab;
}

const colIndex = (letters) => letters.split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

// 'Oct 2026'!A1:C5 | 'Oct 2026'!A:A | 'Oct 2026'!A5 | 'Oct 2026' -> { tab, r0, r1, c0, c1 } (inclusive, 0-based)
function parseRange(text) {
  const m = /^(?:'((?:[^']|'')+)'|([^!]+))(?:!(.+))?$/.exec(text);
  if (!m) throw new HttpError(400, `Unable to parse range: ${text}`);
  const title = (m[1] ?? m[2]).replace(/''/g, "'");
  const tab = sheet.tabs.find((t) => t.title === title);
  if (!tab) throw new HttpError(400, `Unable to parse range: ${text}`);
  if (!m[3]) return { tab, r0: 0, r1: tab.rows - 1, c0: 0, c1: tab.cols - 1 };
  const parts = m[3].split(":");
  const cell = (s, isEnd) => {
    const x = /^([A-Z]+)(\d*)$/.exec(s);
    if (!x) throw new HttpError(400, `Unable to parse range: ${text}`);
    return { c: colIndex(x[1]), r: x[2] ? Number(x[2]) - 1 : isEnd ? tab.rows - 1 : 0 };
  };
  const a = cell(parts[0], false);
  const b = parts[1] ? cell(parts[1], true) : a;
  return { tab, r0: a.r, r1: b.r, c0: a.c, c1: b.c };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function writeValues(range, values, userEntered) {
  const { tab, r0, c0 } = range;
  values.forEach((row, ri) =>
    row.forEach((v, ci) => {
      const r = r0 + ri;
      const c = c0 + ci;
      if (r >= tab.rows || c >= tab.cols)
        throw new HttpError(
          400,
          `Range ('${tab.title}'!A1) exceeds grid limits. Max rows: ${tab.rows}, max columns: ${tab.cols}`,
        );
      const key = `${r},${c}`;
      if (v === "" || v === null || v === undefined) {
        tab.cells.delete(key);
        tab.formulas.delete(key);
      } else {
        tab.cells.set(key, v);
        if (userEntered && typeof v === "string" && v.startsWith("=")) tab.formulas.add(key);
        else tab.formulas.delete(key);
      }
    }),
  );
}

function clearRange(range) {
  const { tab, r0, r1, c0, c1 } = range;
  for (const key of [...tab.cells.keys()]) {
    const [r, c] = key.split(",").map(Number);
    if (r >= r0 && r <= r1 && c >= c0 && c <= c1) {
      tab.cells.delete(key);
      tab.formulas.delete(key);
    }
  }
}

function readValues(range) {
  const { tab, r0, r1, c0, c1 } = range;
  let maxR = -1;
  const rows = new Map();
  for (const [key, v] of tab.cells) {
    const [r, c] = key.split(",").map(Number);
    if (r < r0 || r > r1 || c < c0 || c > c1) continue;
    maxR = Math.max(maxR, r);
    if (!rows.has(r)) rows.set(r, []);
    rows.get(r)[c - c0] = v;
  }
  const out = [];
  for (let r = r0; r <= maxR; r++) {
    const row = rows.get(r) ?? [];
    out.push(Array.from(row, (v) => (v === undefined ? "" : v)));
  }
  return out;
}

function batchUpdate(requests) {
  const replies = [];
  for (const req of requests) {
    const kind = Object.keys(req)[0];
    const body = req[kind];
    const tabById = (id) => {
      const t = sheet.tabs.find((x) => x.sheetId === id);
      if (!t) throw new HttpError(400, `No sheet with id ${id}`);
      return t;
    };
    let reply = {};
    if (kind === "addSheet") {
      const p = body.properties ?? {};
      if (sheet.tabs.some((t) => t.title === p.title))
        throw new HttpError(400, `A sheet with the name "${p.title}" already exists.`);
      const tab = addTab(p.title, p.index, { hidden: !!p.hidden });
      reply = { addSheet: { properties: { sheetId: tab.sheetId, title: tab.title, index: tab.index } } };
    } else if (kind === "deleteSheet") {
      const t = tabById(body.sheetId);
      sheet.tabs = sheet.tabs.filter((x) => x !== t);
      sheet.tabs.forEach((x, i) => (x.index = i));
    } else if (kind === "updateSheetProperties") {
      const t = tabById(body.properties.sheetId);
      const fields = String(body.fields).split(",");
      const p = body.properties;
      for (const f of fields) {
        if (f === "title") t.title = p.title;
        else if (f === "hidden") t.hidden = !!p.hidden;
        else if (f === "tabColorStyle") t.tabColor = p.tabColorStyle?.rgbColor ?? null;
        else if (f === "gridProperties.rowCount") t.rows = p.gridProperties.rowCount;
        else if (f === "gridProperties.columnCount") t.cols = p.gridProperties.columnCount;
        else if (f === "gridProperties.frozenRowCount") t.frozenRows = p.gridProperties.frozenRowCount ?? 0;
        else if (f === "gridProperties.frozenColumnCount") t.frozenCols = p.gridProperties.frozenColumnCount ?? 0;
        else if (f === "index") {
          sheet.tabs = sheet.tabs.filter((x) => x !== t);
          sheet.tabs.splice(Math.min(p.index, sheet.tabs.length), 0, t);
          sheet.tabs.forEach((x, i) => (x.index = i));
        }
      }
    } else if (kind === "addBanding") {
      const t = tabById(body.bandedRange.range.sheetId);
      const id = 1000 + nextId++;
      t.banding.push({ id, range: body.bandedRange.range });
      reply = { addBanding: { bandedRange: { bandedRangeId: id } } };
    } else if (kind === "deleteBanding") {
      for (const t of sheet.tabs) t.banding = t.banding.filter((b) => b.id !== body.bandedRangeId);
    } else if (kind === "addConditionalFormatRule") {
      const t = tabById(body.rule.ranges[0].sheetId);
      t.conditional.splice(body.index ?? t.conditional.length, 0, body.rule);
    } else if (kind === "deleteConditionalFormatRule") {
      const t = tabById(body.sheetId);
      if (!t.conditional[body.index]) throw new HttpError(400, "No rule at that index");
      t.conditional.splice(body.index, 1);
    } else if (kind === "addProtectedRange") {
      tabById(body.protectedRange.range.sheetId).protectedRanges += 1;
    } else if (kind === "setBasicFilter") {
      tabById(body.filter.range.sheetId).filter = body.filter.range;
    } else if (kind === "updateDimensionProperties") {
      const t = tabById(body.range.sheetId);
      const { dimension, startIndex, endIndex } = body.range;
      for (let i = startIndex; i < endIndex; i++) {
        if (dimension === "COLUMNS") {
          if (body.properties.pixelSize !== undefined) t.widths[i] = body.properties.pixelSize;
          if (body.properties.hiddenByUser) t.hiddenCols.add(i);
          else if ("hiddenByUser" in body.properties) t.hiddenCols.delete(i);
        } else if (body.properties.pixelSize !== undefined) t.rowHeights[i] = body.properties.pixelSize;
      }
    } else if (kind === "repeatCell") {
      const sid = body.range.sheetId;
      const t = tabById(sid);
      t.counts.repeatCell = (t.counts.repeatCell ?? 0) + 1;
    } else if (kind === "updateBorders") {
      const t = tabById(body.range.sheetId);
      t.counts.updateBorders = (t.counts.updateBorders ?? 0) + 1;
    } else if (kind === "autoResizeDimensions") {
      const t = tabById(body.dimensions.sheetId);
      t.counts.autoResize = (t.counts.autoResize ?? 0) + 1;
    } else if (kind === "updateSpreadsheetProperties") {
      sheet.properties = { ...(sheet.properties ?? {}), ...body.properties };
    } else {
      throw new HttpError(400, `Unsupported request: ${kind}`);
    }
    replies.push(reply);
  }
  return { replies };
}

function metadata() {
  return {
    properties: { title: sheet.title, ...(sheet.properties ?? {}) },
    sheets: sheet.tabs.map((t) => ({
      properties: {
        sheetId: t.sheetId,
        title: t.title,
        index: t.index,
        ...(t.hidden ? { hidden: true } : {}),
        gridProperties: { rowCount: t.rows, columnCount: t.cols },
      },
      ...(t.conditional.length ? { conditionalFormats: t.conditional } : {}),
      ...(t.banding.length ? { bandedRanges: t.banding.map((b) => ({ bandedRangeId: b.id })) } : {}),
    })),
  };
}

function dump() {
  return {
    title: sheet.title,
    properties: sheet.properties ?? null,
    tokenRequests,
    requestCount: requestLog.length,
    requests: requestLog,
    tabs: sheet.tabs.map((t) => {
      let maxR = -1;
      for (const key of t.cells.keys()) maxR = Math.max(maxR, Number(key.split(",")[0]));
      const values = [];
      for (let r = 0; r <= maxR; r++) values.push([]);
      for (const [key, v] of t.cells) {
        const [r, c] = key.split(",").map(Number);
        values[r][c] = v;
      }
      return {
        sheetId: t.sheetId,
        title: t.title,
        index: t.index,
        hidden: t.hidden,
        rows: t.rows,
        cols: t.cols,
        values: values.map((row) => Array.from(row, (v) => (v === undefined ? "" : v))),
        formulaCells: [...t.formulas].map((k) => k.split(",").map(Number)),
        frozenRows: t.frozenRows,
        frozenCols: t.frozenCols,
        filter: t.filter,
        hiddenCols: [...t.hiddenCols].sort((a, b) => a - b),
        widths: t.widths,
        rowHeights: t.rowHeights,
        bandingCount: t.banding.length,
        conditionalCount: t.conditional.length,
        protectedRanges: t.protectedRanges,
        counts: t.counts,
        tabColor: t.tabColor,
      };
    }),
  };
}

const send = (res, status, body) => {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(data) });
  res.end(data);
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const raw = await readBody(req);
    if (url.pathname === "/__dump") return send(res, 200, dump());
    if (url.pathname === "/__reset") return reset(), send(res, 200, {});
    if (url.pathname === "/__control") {
      const b = JSON.parse(raw || "{}");
      control = { status: b.failNext?.status ?? 0, count: b.failNext?.count ?? 0 };
      return send(res, 200, control);
    }
    if (url.pathname === "/token") {
      const form = new URLSearchParams(raw);
      const jwt = (form.get("assertion") ?? "").split(".");
      let claims = {};
      try {
        claims = JSON.parse(Buffer.from(jwt[1] ?? "", "base64url").toString("utf8"));
      } catch {
        /* not a JWT */
      }
      tokenRequests.push({ grant: form.get("grant_type"), parts: jwt.length, iss: claims.iss, scope: claims.scope });
      if (jwt.length !== 3 || !jwt[2]) return send(res, 400, { error: "invalid_grant" });
      return send(res, 200, { access_token: TOKEN, expires_in: 3600, token_type: "Bearer" });
    }

    const m = /^\/v4\/spreadsheets\/([^/:]+)(.*)$/.exec(url.pathname);
    if (!m) return send(res, 404, { error: { message: "Not found" } });
    if (req.headers.authorization !== `Bearer ${TOKEN}`)
      return send(res, 401, { error: { message: "Request had invalid authentication credentials." } });
    if (control.count > 0) {
      control.count -= 1;
      return send(res, control.status, { error: { message: `Injected failure ${control.status}` } });
    }
    if (m[1].startsWith("NOACCESS"))
      return send(res, 404, { error: { message: "Requested entity was not found." } });
    const rest = decodeURIComponent(m[2]);
    requestLog.push(`${req.method} ${rest}`);
    const body = raw ? JSON.parse(raw) : {};

    if (rest === "" && req.method === "GET") return send(res, 200, metadata());
    if (rest === ":batchUpdate") return send(res, 200, batchUpdate(body.requests ?? []));
    if (rest === "/values:batchUpdate") {
      const ue = body.valueInputOption === "USER_ENTERED";
      for (const d of body.data ?? []) writeValues(parseRange(d.range), d.values, ue);
      return send(res, 200, {});
    }
    if (rest === "/values:batchClear") {
      for (const r of body.ranges ?? []) clearRange(parseRange(r));
      return send(res, 200, {});
    }
    const v = /^\/values\/(.+)$/.exec(rest);
    if (v) {
      if (v[1].endsWith(":clear")) {
        clearRange(parseRange(v[1].slice(0, -":clear".length)));
        return send(res, 200, {});
      }
      const range = parseRange(v[1]);
      if (req.method === "GET") return send(res, 200, { values: readValues(range) });
      if (req.method === "PUT") {
        writeValues(range, body.values ?? [], url.searchParams.get("valueInputOption") === "USER_ENTERED");
        return send(res, 200, {});
      }
    }
    return send(res, 404, { error: { message: `No such call: ${req.method} ${rest}` } });
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: { message: e.message } });
    console.error(e);
    return send(res, 500, { error: { message: String(e) } });
  }
});

reset();
server.listen(port, "127.0.0.1", () => console.log(`fake sheets on ${port}`));
