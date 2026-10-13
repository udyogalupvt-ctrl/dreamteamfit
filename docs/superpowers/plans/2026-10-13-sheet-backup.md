# Google Sheet Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app keeps the gym's Google Sheet "REBUILD FITNESS – Register Backup" filled with readable tabs that match the dashboard to the rupee, plus hidden restore tabs holding every business record.

**Architecture:** Pure row builders in `src/lib/sheet-backup/` (no database, unit-tested with `node --test`). A small Sheets REST client and a resumable runner in `src/server/` read Firestore with firebase-admin and write the sheet; routes under `/api/backup/sheet/*`; the night and morning crons call the runner. The browser write wrapper pings a debounced "touch" after each change. The owner sees status + Sync now on the Backup page.

**Tech Stack:** TanStack Start + React 19, firebase-admin, Google Sheets REST v4 via `fetch`, JWT signed with node:crypto, node:test.

**Spec:** `docs/superpowers/specs/2026-10-13-sheet-backup-design.md` (read it first). Working preview code that already produces the approved month layout and passes the row-by-row check: session scratchpad `948c07bc…/month_preview.mjs`, `verify_rows.mjs`, `sheet_check.mjs`.

## Global Constraints

- Sheet totals MUST equal the dashboard: money on `paymentDate` (≤ today, IST), legacy untracked bills (`paymentsTracked === false && amountPaid > 0`) on `invoiceDate`; formula = `buildFinanceSummary` in `src/services/finance.service.ts:502`.
- Month columns, exact order: S.NO · DATE PAID · NAME · PHONE NO · PAYMENT FOR · PACKAGE · PP · CASH · CARD · OTHER · PAID IN OLD SOFTWARE · PAID AMOUNT · DUE NOW · TOTAL BILL · GYM FEE · PT FEE · DISCOUNT · Counseller · PT Trainer · TYPE OF CLIENT · START DATE · ENDING DATE · DAYS · PT End date · Membership payment due date · STATUS · NOTE · ENTERED ON · BILL NO · MEMBER ID.
- Freeze rows 1–2 only, never columns. Money columns empty for the whole month are hidden.
- No new npm dependency, no new env var required (optional test overrides `SHEETS_API_BASE`, `GOOGLE_TOKEN_URL`).
- No Firestore rules change: state lives in `serverSecrets/sheetBackup` (default-deny).
- Every server query uses at most one range/inequality field (no composite indexes: the key can't create them).
- Dates in the sheet `DD-MM-YYYY`; money `#,##0`; IST (`Asia/Kolkata`) for "today" and "entered on".
- Never write secrets or the excluded collections (spec "Restore tabs") to the sheet.
- Code style: match neighbours (plain-English comments, relative `.ts` imports inside `src/lib/sheet-backup/` so `node --test` runs them, like `src/lib/plan-money.ts`). Many files are CRLF: ignore eslint "Delete ␍" on untouched lines.
- Production is live data: tests use the emulators + a fake Sheets server; the only live writes are to the backup sheet.

### Look (user, 2026-10-13: "should look really good for viewing", readers are non-technical)

- Spreadsheet properties: `locale: "en_IN"`, `timeZone: "Asia/Kolkata"`, default font Roboto 10 (so `TODAY()` and dates are Indian). The empty default "Sheet1" is deleted once real tabs exist.
- Dates are REAL dates (serial number = days since 1899-12-30, written RAW) with number format `dd-mm-yyyy`, so the owner can sort and filter; never text.
- Money: Indian grouping `[>=10000000]₹##\,##\,##\,##0;[>=100000]₹##\,##\,##0;₹##,##0` (₹1,59,046); empty when 0 (write "" not 0). Right-aligned.
- Header row: background `#ECEFF1`, bold dark text `#263238`, centered, wrapped, height 44, bottom border medium `#90A4AE`. Mode headers as pastel chips with dark matching text (contrast ≥ 4.5:1): PP `#F3E5F5`/`#6A1B9A`, CASH `#E3F2FD`/`#0D47A1`, CARD `#E8F5E9`/`#1B5E20`, DUE `#FFEBEE`/`#B71C1C`.
- Totals row 2: bold, `#FFF8E1` (green `#E8F5E9` / red `#FFEBEE` for the match line), top + bottom solid borders.
- Data rows: alternating banding white / `#FAFAFA` (`addBanding`), conditional colours on top (Cancelled/Refunded `#FFEBEE`, Balance `#E3F2FD`, Part paid `#FFF3E0`); rows height 24; NAME bold.
- Every tab gets a basic filter on the header row (filter buttons) and fixed column widths (each `Column` has `width` px: S.NO 48, dates 96, NAME 170, PHONE 110, money 96, text 120–160); no auto-resize.
- Tab colours: Read me green `#2E7D32`, Members blue `#1565C0`, Dues red `#C62828`, months purple `#6A1B9A`, the rest grey `#607D8B`. Order: Read me, Members, Dues, months newest first, Expenses, All plans, Staff & trainers, Packages, then hidden `_data_*`.
- Members STATUS chips: Active green, Ending in 7 days orange, Ended grey, No plan light grey. Dues DAYS OVERDUE > 0 red bold.
- Read me: A1 title "REBUILD FITNESS — Backup" (bold 16), A2 "Last updated …", a 2-column table "Tab | What it shows / when to use it", then the checks with ✓ (green) / ✗ (red), then "If the app is down" steps. Column A width 220, B 640, wrapped.
- All formatting is built by a pure module (`src/lib/sheet-backup/format.ts`, Task 3b) so it is unit-tested and identical in the server and the scripts.

---

### Task 1: Month rows (pure) — the dashboard-matching register

**Files:**
- Create: `src/lib/sheet-backup/types.ts`, `src/lib/sheet-backup/month.ts`
- Test: `src/lib/sheet-backup/month.test.ts`
- Modify: `package.json` (add `src/lib/sheet-backup/*.test.ts` to `test:cfo`)

**Interfaces — Produces:**
```ts
// types.ts — plain shapes (Timestamps already turned into ISO strings by the caller)
export interface PayIn { id: string; clientId: string; clientNameSnapshot: string; invoiceId: string; membershipId: string | null; ptAssignmentId: string | null; amount: number; method: string; paymentDate: string; kind: "initial" | "balance" | "refund"; counsellorName: string; oldSoftware?: boolean; oldSoftwareBillNo?: string; splitId?: string; createdDay: string /* IST YYYY-MM-DD */ }
export interface BillIn { id: string; invoiceNumber: string; clientId: string; clientNameSnapshot: string; membershipId: string | null; ptAssignmentId: string | null; items: { name: string }[]; subtotal: number; discount: number; total: number; amountPaid: number; balanceDue: number; paymentStatus: string; paymentMethod: string; invoiceDate: string; dueDate: string; membershipGross: number; ptGross: number; upgradeCredit?: number; oldSoftwareCredit?: number; cancelledParts?: Record<string, { kind: "gym" | "pt"; amount: number }> | null; paymentsTracked?: boolean; counsellorName: string; createdDay: string }
export interface PlanIn { id: string; clientId: string; packageId: string; packageNameSnapshot: string; priceSnapshot: number; durationDaysSnapshot: number; startDate: string; endDate: string; status: string; counsellorName: string; paidInOldSoftware?: boolean; oldSoftwarePaid?: number; oldSoftwareBalance?: number }
export interface PtIn { id: string; clientId: string; ptPackageNameSnapshot: string; trainerNameSnapshot: string; startDate: string; endDate: string; status: string; ptPrice: number; oldSoftwarePaid?: number }
export interface ClientIn { id: string; clientCode: string; fullName: string; phone: string }
export interface PackageIn { id: string; name: string; category: string; durationDays: number; price: number; isActive: boolean }
export type Cell = string | number;
export interface Column<R> { header: string; value: (r: R, i: number) => Cell; money?: "sum" | "due"; color?: string }
// month.ts
export interface MonthInput { from: string; to: string; payments: PayIn[]; legacyBills: BillIn[]; bills: Map<string, BillIn>; plans: Map<string, PlanIn>; pts: Map<string, PtIn>; clients: Map<string, ClientIn>; packages: Map<string, PackageIn>; plansOfClients: PlanIn[] }
export interface MonthRow { /* fields as in month_preview.mjs rows: date, entered, billNo, billKey, id, name, kind, type, phone, start, end, pkg, days, pp, cash, card, other, old, paid, due, gymFee, totalBill, discount, counsellor, ptFee, trainer, ptEnd, payBy, status, note */ }
export const MONTH_COLUMNS: Column<MonthRow>[];
export function buildMonth(input: MonthInput): { rows: MonthRow[]; appTotal: number; sheetTotal: number; dueOnBills: number; matches: boolean };
export const CATEGORY_LABEL: Record<string, string>; // "Strength + Cardio" → "Cardio & strengthening", "Strength Only" → "Strengthening", "Cardio Only" → "Cardio"
export const dmy: (iso: string | undefined | null) => string;
```

`Column` already carries `width: number` and `kind?: "date" | "money" | "text" | "number"` (see Look): date columns return ISO `YYYY-MM-DD` (Task 3b's `toCells` turns them into real dates), money columns return numbers (0 allowed).

Port `buildMonth`'s row logic from scratchpad `month_preview.mjs` (function `buildMonth`, minus Firestore reads) and its `COLS` as `MONTH_COLUMNS`, with these rules:
- split pair (same `splitId`) → one row; mode columns: `UPI`→PP, `Cash`, `Card`, `oldSoftware || method === "Not recorded"` → PAID IN OLD SOFTWARE, anything else → OTHER.
- PAYMENT FOR: refund → "Refund"; balance → "Balance"; old-software payment without bill → "Old software"; bill whose first item starts "Balance from the old software" → "Old software balance"; `upgradeCredit > 0` → "Upgrade"; no gym plan → "PT" (or "Other" without PT); else "Renewal" if the member has another plan starting earlier, else "New". Legacy bill → "Bill (no payment record)".
- GYM FEE / PT FEE = `planMoney(kind, price, bill).total` (import `../plan-money.ts`), TOTAL BILL / DISCOUNT only on the sale row (initial or old-software-without-bill). DISCOUNT = `discount − upgradeCredit − oldSoftwareCredit` (≥ 0).
- DUE NOW = `max(0, bill.balanceDue)`; old-software without bill → `plan.oldSoftwareBalance || 0`. `dueOnBills` sums each bill once.
- STATUS: Cancelled (gym or PT plan cancelled) · Refunded (refund row) · Part paid (due > 0) · Paid.
- NOTE: `"entered later, dated the day it was paid"` when `paymentDate < createdDay`; `"₹1 top-up after price change"` (show the real amount) when kind = balance and 0 < amount ≤ 10. Join both with " · " if both apply.
- Sort by date, then bill number numerically (`localeCompare(…, undefined, { numeric: true })`).
- `appTotal` = Σ payments.amount + Σ legacyBills.amountPaid (the dashboard formula); `sheetTotal` = Σ rows.paid; `matches` = |a−b| < 0.01.

- [ ] **Step 1: Write the failing tests** in `month.test.ts` (node:test + node:assert/strict), fixtures built inline:
  1. late sale: bill dated 2026-10-08, payment `paymentDate` 2026-09-30, `createdDay` 2026-10-08 → appears in the September input only, NOTE says entered later, `matches` true.
  2. split pair: two payments (Cash 1000, UPI 1000, same splitId) → one row, CASH 1000, PP 1000, PAID 2000.
  3. balance ₹1 → kind "Balance", note contains "₹1 top-up", gymFee "" (not a sale row).
  4. refund −500 → kind "Refund", status "Refunded", PAID −500, `appTotal` includes −500.
  5. legacy bill (paymentsTracked false, amountPaid 1500, method Cash) → row with CASH 1500; `appTotal` = payments + 1500.
  6. renewal vs new: member with an earlier plan → "Renewal"; without → "New".
  7. old-software payment without bill → PAID IN OLD SOFTWARE = amount, PP/CASH/CARD 0, DUE NOW = oldSoftwareBalance.
  8. `MONTH_COLUMNS.map(c => c.header)` equals the Global Constraints order exactly.
- [ ] **Step 2: Run** `node --test src/lib/sheet-backup/month.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `types.ts` + `month.ts` as above.
- [ ] **Step 4: Run** the test again → PASS; then `npm run test:cfo` (after adding the glob) → all pass.
- [ ] **Step 5: Commit** `git add src/lib/sheet-backup package.json && git commit -m "Sheet backup: month rows that match the dashboard"`

### Task 2: The other readable tabs (pure)

**Files:**
- Create: `src/lib/sheet-backup/tabs.ts`
- Test: `src/lib/sheet-backup/tabs.test.ts`

**Interfaces — Produces** (each returns `{ columns: Column<T>[]; rows: T[]; total?: number }`):
```ts
export function membersTab(input: { clients: (ClientIn & { gender?: string; dateOfBirth?: string | null; joinedOn?: string; lastVisitDate?: string; status: string; currentMembership: { packageName: string; startDate: string; endDate: string; status: string } | null })[]; pts: PtIn[]; openBills: BillIn[]; today: string })
// columns: MEMBER ID · NAME · PHONE NO · GENDER · DATE OF BIRTH · JOINED · CURRENT PLAN · START DATE · ENDING DATE · DAYS LEFT · STATUS · PT TRAINER · PT END · BALANCE DUE · LAST VISIT
// DAYS LEFT is a sheet formula string: `=IF(J{row}="","",DATEVALUE(…)-TODAY())` built from the ENDING DATE cell (row index known when writing: give Column.value the row index i; header row 1 + totals row 2 → data row = i + 3). STATUS: "Active" / "Ending in 7 days" (end − today ≤ 7) / "Ended" / "No plan" — computed in code from `today`.
export function duesTab(input: { openBills: BillIn[]; clients: Map<string, ClientIn>; today: string })
// one row per bill with balanceDue > 0 and paymentStatus not closed/refunded; columns: NAME · PHONE NO · BILL NO · BILL DATE · TOTAL BILL · PAID · DUE · PAY BY · DAYS OVERDUE · MEMBER ID; total = Σ due (must equal the dashboard "Balance due" tile: use-attention.ts sums balanceDue of the same bills)
export function expensesTab(input: { expenses: { date: string; category: string; amount: number; paymentMethod?: string; note?: string; description?: string; createdBy?: string }[] })
// newest first; columns DATE · CATEGORY · AMOUNT · MODE · NOTE · ADDED BY; total = Σ amount
export function plansTab(input: { plans: PlanIn[]; pts: PtIn[]; clients: Map<string, ClientIn>; bills: Map<string, BillIn> /* by plan's invoiceId */ })
// one row per gym plan and per PT plan, newest start first: MEMBER ID · NAME · KIND (Gym/PT) · PACKAGE · START DATE · ENDING DATE · PRICE · STATUS · COUNSELLER / TRAINER · BILL NO · FROM OLD SOFTWARE (Yes/"")
export function staffTab(input: { staff: { name: string; role?: string; phone?: string; active?: boolean }[]; trainers: { name: string; phone?: string; active?: boolean; isActive?: boolean }[] })
export function packagesTab(input: { packages: PackageIn[]; ptPackages: { name: string; price: number; durationType?: string; isActive?: boolean }[] })
export function readMeRows(input: { updatedAt: string; checks: { name: string; ok: boolean; detail: string }[]; tabs: string[] }): Cell[][]
// Plain English, one line per tab ("Members — everyone, their plan and days left. Use this to check entry if the app is down."), "Last updated: …", each check as "✓ Oct 2026 matches the app (₹2,07,049)" / "✗ …", and "If the app is down: use Members to check plans, write new sales on paper; the app stays the truth when it is back."
```
Field names: check `src/types/models.ts` (Expense ~line 538, Staff ~1188, Trainer 906, PtPackage 893) and use the real names; drop any column whose field doesn't exist rather than inventing one.

- [ ] **Step 1:** failing tests: members STATUS for end = today+3 → "Ending in 7 days", end < today → "Ended"; dues total = Σ balanceDue of open bills only (closed bill with balance excluded); plans tab has one row per gym and PT plan; readMe contains "✗" when a check fails.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** "Sheet backup: members, dues, expenses, plans, staff, packages, read me"

### Task 3: Restore codec (pure)

**Files:**
- Create: `src/lib/sheet-backup/restore-codec.ts`
- Test: `src/lib/sheet-backup/restore-codec.test.ts`

**Interfaces — Produces:**
```ts
export const CELL_LIMIT = 45000;
export const EXCLUDED_COLLECTIONS: ReadonlySet<string>; // the spec's exclude list, verbatim
/** Firestore value → JSON-safe value: Timestamp-like {toDate()} / {_seconds,_nanoseconds} → {"__ts": ISO}; GeoPoint → {"__geo":[lat,lng]}; DocumentReference-like {path, firestore} → {"__ref": path}; Bytes/Buffer → {"__b64": …}. */
export function encodeValue(v: unknown): unknown;
/** Inverse; `make` supplies the admin constructors (Timestamp.fromDate, new GeoPoint, db.doc) so this file stays pure. */
export function decodeValue(v: unknown, make: { ts: (d: Date) => unknown; geo: (lat: number, lng: number) => unknown; ref: (path: string) => unknown; bytes: (b64: string) => unknown }): unknown;
/** One record → one sheet row: [id, updatedAtISO, json chunk 1, json chunk 2, …] (chunks of CELL_LIMIT chars). */
export function recordToRow(id: string, data: Record<string, unknown>): string[];
/** Row back to { id, data } (joins the chunks; throws on broken JSON naming the id). */
export function rowToRecord(row: string[]): { id: string; data: Record<string, unknown> };
```
- [ ] **Step 1:** failing tests: round trip of a doc with nested Timestamp (`{ toDate: () => new Date("2026-10-13T10:00:00Z") }`), arrays, nulls, numbers; a 120,000-char string splits into 3 chunks and joins back exactly; `EXCLUDED_COLLECTIONS` has `serverSecrets`, `loginVault`, `staffPrivate`, `auditLogs`.
- [ ] **Steps 2–4:** run FAIL → implement → PASS.
- [ ] **Step 5: Commit** "Sheet backup: restore copy encoder"

### Task 3b: Sheet formatting (pure)

**Files:**
- Create: `src/lib/sheet-backup/format.ts`
- Test: `src/lib/sheet-backup/format.test.ts`
- Modify: `src/lib/sheet-backup/types.ts` (`Column` gets `width: number` and `kind?: "date" | "money" | "text" | "number"`; date values are ISO strings converted by `dateSerial`)

**Interfaces — Produces:**
```ts
export const dateSerial: (iso: string) => number | ""; // days since 1899-12-30 (UTC maths), "" for empty
export const INR_FORMAT: string; // the Look money pattern
export interface TabSpec { sheetId: number; columns: Column<unknown>[]; rowCount: number /* data rows */; hasTotals: boolean; tabColor: string; statusRules?: { column: string; equals: string; background: string; text?: string }[]; rowRules?: { formula: string; background: string }[]; existingBandingIds: number[]; existingConditionalCount: number; hideEmptyMoney?: boolean[] /* per column */ }
export function tabFormatRequests(spec: TabSpec): unknown[]; // deletes old banding/conditional rules, then everything in "Look"
export function readMeFormatRequests(sheetId: number, rowCount: number, checkRows: { row: number; ok: boolean }[]): unknown[];
export function spreadsheetSetupRequests(): unknown[]; // locale, timeZone, default font
export function toCells<R>(columns: Column<R>[], rows: R[]): Cell[][]; // applies dateSerial for kind "date", "" for zero money
```
- [ ] **Step 1:** failing tests: `dateSerial("2026-10-13") === 46308`; `toCells` turns 0 money into "" and dates into serials; `tabFormatRequests` contains `setBasicFilter`, `addBanding`, `frozenRowCount: 2` and `frozenColumnCount: 0`, one `updateDimensionProperties` width per column, and no `autoResizeDimensions`; header colours for PP/CASH/CARD/DUE as in Look.
- [ ] **Steps 2–4:** FAIL → implement → PASS. **Step 5: Commit** "Sheet backup: formatting"

### Task 4: Server — Sheets client, runner, routes, crons

**Files:**
- Create: `src/server/sheets-api.ts`, `src/server/sheet-backup.ts`
- Modify: `src/server/router.ts` (add `if (path.startsWith("/api/backup/sheet/")) return await handleSheetBackup(request, url);`), `src/server/automation.ts:593-622` (add a `sheetBackup` step to BOTH morning and night: `await step("sheetBackup", () => runSheetBackup({ mode: "nightly", budgetMs: 40_000 }))`)

**Interfaces — Produces:**
```ts
// sheets-api.ts
export function sheetsClient(sheetId: string): Promise<{
  meta(): Promise<{ title: string; tabs: { title: string; sheetId: number; hidden: boolean; conditionalFormatCount: number }[] }>;
  ensureTab(title: string, opts?: { index?: number; hidden?: boolean }): Promise<number>; // sheetId
  writeTab(title: string, values: Cell[][], opts?: { formulaRows?: number[] }): Promise<void>; // clear + write in ≤ 5,000-row chunks; RAW except formulaRows (USER_ENTERED)
  readTab(title: string): Promise<Cell[][]>;
  batchUpdate(requests: unknown[]): Promise<unknown>;
  deleteTab(title: string): Promise<void>;
}>;
// token: JWT RS256 with credentials() from ./admin (clientEmail, privateKey), scope https://www.googleapis.com/auth/spreadsheets, cached until 5 min before expiry. Base URLs: process.env.SHEETS_API_BASE ?? "https://sheets.googleapis.com", process.env.GOOGLE_TOKEN_URL ?? "https://oauth2.googleapis.com/token". Errors: throw Error(`Google Sheets ${status}: ${message}`) — never include the token.
// sheet-backup.ts
export const DEFAULT_SHEET_ID = "1Rsn0jB8HX8TsbYmrxeT6VCPl4wcmyh2VhU7yy2_qJxc";
export interface BackupState { sheetId: string; lastOkAt: string | null; lastRunAt: string | null; lastError: string | null; checks: { name: string; ok: boolean; detail: string }[]; queue: string[]; dirtyMonths: string[]; dirtyDocs: string[]; leaseUntil: number; restoreSince: string | null }
export function runSheetBackup(opts: { mode: "quick" | "nightly" | "full"; budgetMs: number; touched?: { months?: string[]; paths?: string[] } }): Promise<{ done: boolean; wrote: string[]; checks: BackupState["checks"] }>;
export function handleSheetBackup(request: Request, url: URL): Promise<Response>;
```
Runner rules:
- State doc `serverSecrets/sheetBackup` (sheetId defaults to `DEFAULT_SHEET_ID`). Lease: transaction sets `leaseUntil = now + 55s`; if another run holds it, merge `touched` into `dirtyMonths/dirtyDocs` and return `{ done: false }`.
- Steps are named strings in `queue`: `month:YYYY-MM`, `members`, `dues`, `expenses`, `plans`, `staff`, `packages`, `data:<collection>`, `readme` (always last). quick = touched months + `members` + `dues` + `data:<collection>` of touched paths (+ anything left in queue); nightly = current + previous month, members, dues, expenses, plans, staff, packages, every `data:*`, readme; full = every month from the earliest payment/invoice month to now + nightly set. Process steps until `budgetMs` is used; save the rest in `queue` (next run continues). Return `done` = queue empty.
- Month step: Firestore reads exactly like `month_preview.mjs` (payments by paymentDate range; invoices by invoiceDate range for legacy; `getAll` for bills/plans/pts/clients by id; memberships `where clientId in` chunks of 30; packages). Convert Timestamps → `createdDay` (IST). Build with `buildMonth`, write with header row + totals row (row 2: "TOTAL", NAME cell = `"${n} payments · app shows ₹X ✓ matches · updated <IST time>"` or "✗ DIFFERENT"; `=SUM(col3:col)` for money "sum" columns; DUE cell = dueOnBills) + data rows; then one batchUpdate with the formatting from `month_preview.mjs` `writeTab` (header grey bold + colours, totals green/red, number format, no frozen columns, hide empty money columns, conditional rows red/blue/orange, auto-resize, NAME width 170). Tab title `Oct 2026`; month tabs ordered newest first after Read me, Members, Dues.
- Record each month check in `checks` (`{ name: "Oct 2026", ok: matches, detail: "₹2,07,049" }`) and dues check (`dues total = Σ balanceDue of open bills`).
- `data:<collection>`: if the tab is missing or mode ≠ quick → read the whole collection, write `[["id","updatedAt","json"], ...recordToRow]` sorted by id. quick → read only the touched docs; update their rows in place (read column A of the tab to find the row; append if new; clear the row if the doc no longer exists). Hidden tabs; add a protected range (`addProtectedRange` with `warningOnly: true` and description "Backup copy — written by the app") once per tab.
- Collections: `db().listCollections()` minus `EXCLUDED_COLLECTIONS`.
- Errors: catch per step; set `lastError` (first 300 chars) and the step stays queued; `lastOkAt` only when a run ends with an empty queue and every check ok.
Routes (`handleSheetBackup`):
- `POST /api/backup/sheet/touch` — `requireStaff`; body `{ paths: string[] }` (max 200, each `^[A-Za-z]+/[A-Za-z0-9_-]+$`); months come from the server (payment/invoice docs read for their dates), never trusted from the browser; runs `quick` with budget 25 s; returns `{ ok: true }` (errors → 200 with `{ ok: false }`, the sale already succeeded).
- `GET /api/backup/sheet/status` — owner only (`isOwnerEmail` from `@/constants/owners` via requireStaff user.email): `{ sheetUrl, lastOkAt, lastRunAt, lastError, checks, pending: queue.length }`.
- `POST /api/backup/sheet/sync` — owner only; `{ mode: "full" }` first call queues full; each call runs ≤ 40 s and returns `{ done }` (the page calls again until done).
- `POST /api/backup/sheet/settings` — owner only; `{ sheetUrl }` → parse id from `/spreadsheets/d/<id>/`, test with `meta()`, save; error message tells the owner to share the sheet with `credentials().clientEmail` as Editor.

- [ ] **Step 1:** fake Sheets + token server for tests: `scripts/test/fake-sheets.mjs` (node http on port from argv; implements token POST, GET spreadsheet meta, values get/update/clear, batchUpdate addSheet/deleteSheet/updateSheetProperties/other requests accepted; keeps tabs in memory; `GET /__dump` returns all tabs as JSON).
- [ ] **Step 2:** emulator test `scripts/test/sheet_backup_local.py` (style of scratchpad `50d6b2d7…/h/sec_local.py`: restart emulators with `restart.sh`, build with `VITE_USE_EMULATORS=1`, serve with `SHEETS_API_BASE`/`GOOGLE_TOKEN_URL` pointing at the fake): seed a member + sale + balance + split + refund + late sale (paymentDate last month) + legacy bill; call `/api/backup/sheet/sync` as owner until done; assert from `/__dump`: month tabs exist, totals equal the dashboard formula computed in the test, column order, `_data_payments` row count = payments count, no `_data_serverSecrets`/`_data_loginVault`; staff touch after a new payment adds its row; non-owner gets 403 on status/sync/settings; touch without login 401.
- [ ] **Step 3:** run → FAIL. **Step 4:** implement `sheets-api.ts`, `sheet-backup.ts`, router + cron. **Step 5:** run → PASS; `npx tsc --noEmit`, `npm run lint` (ignore CRLF noise), `npm run test:cfo`.
- [ ] **Step 6: Commit** "Sheet backup: server runner, routes and crons"

### Task 5: Browser — touch after each change, Backup card, dashboard warning

**Files:**
- Create: `src/lib/sheet-backup-touch.ts`, `src/services/sheet-backup.service.ts`, `src/components/backup/sheet-backup-card.tsx`
- Modify: `src/lib/firestore.ts` (after every successful `commitWithLog`, `addDoc` and `runTransaction`, call `noteChanged(paths)` with each op's `ref.path`), `src/routes/_authenticated/backup.tsx` (render `<SheetBackupCard />` first when `owner`), `src/routes/_authenticated/dashboard.tsx` (owner-only warning line under the attention tiles when status says stale > 26 h or a check failed; links to /backup)

**Interfaces:**
```ts
// sheet-backup-touch.ts — imported by firestore.ts; no React.
const WATCHED = new Set(["payments","invoices","memberships","ptAssignments","clients","expenses","packages","ptPackages","trainers","staff","recycleBin","recycleBinItems"]);
export function noteChanged(paths: string[]): void; // keeps WATCHED paths, debounces 60 s (and flushes on `visibilitychange` → hidden via navigator.sendBeacon is NOT possible with auth → just flush with fetch keepalive), calls callServer("/api/backup/sheet/touch", { paths }) fire-and-forget, swallowing errors. Never throws, never delays the write. Skipped in the member/trainer portal (only when auth.currentUser is staff — the server rejects others anyway).
// sheet-backup.service.ts
export const getSheetBackupStatus = () => getServer<SheetBackupStatus>("/api/backup/sheet/status");
export async function syncSheetNow(onProgress: (n: number) => void): Promise<void>; // loops POST /sync until done (max 20 calls)
export const saveSheetLink = (sheetUrl: string) => callServer("/api/backup/sheet/settings", { sheetUrl });
```
Card (owner only): title "Google Sheet backup"; line "Last updated 13 Oct, 10:42 pm" with a green ✓ "Matches the app" or red ✗ listing failed checks; buttons "Open the sheet" (new tab), "Sync now" (busy spinner via promise-returning onClick, toast on done/fail), "Change sheet" (small inline input + Save). Copy in plain English; use existing components (`Button`, `StatusPill`, tokens like `bg-success/10`). Accessibility floor: 4.5:1, focus visible, keyboard.

- [ ] **Step 1:** extend `sheet_backup_local.py`: as owner open /backup → card shows ✓ and time; Sync now completes; as staff the card is absent; a sale in the UI → after the debounce the fake sheet has the row (set debounce from `window.__SHEET_TOUCH_MS` when present, for tests).
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** PASS; screenshots of /backup and /dashboard light + dark at 390 and 1440.
- [ ] **Step 5: Commit** "Sheet backup: Backup page card, touch after changes, dashboard warning"

### Task 6: Restore script (only on the owner's word)

**Files:**
- Create: `scripts/restore-from-sheet.mjs`
- Test: extend `scripts/test/sheet_backup_local.py` (emulator only)

Usage: `node scripts/restore-from-sheet.mjs <keyFile> <sheetId> <collection|all> [--doc <id>] [--apply]`. Reads `_data_<collection>` tabs via the same JWT method, decodes with `restore-codec.ts` (`node --experimental-strip-types`), compares with Firestore: prints per collection `new N · different N · same N` and lists up to 20 ids. Without `--apply` writes nothing. With `--apply` writes new + different docs (batches of 400), never deletes. Refuses `EXCLUDED_COLLECTIONS`. Uses `FIRESTORE_EMULATOR_HOST` when set (tests).
- [ ] **Step 1:** test: emulator → sync → delete a payment + change a client in Firestore → dry run reports 1 new, 1 different and writes nothing → `--apply` restores both exactly (deep-equal incl. Timestamps).
- [ ] **Steps 2–4:** FAIL → implement → PASS. **Step 5: Commit** "Sheet backup: restore script with dry run"

### Task 7: Live run, check, push

- [ ] Review: one reviewer agent on the whole diff (restore + server auth are data/security code).
- [ ] Merge `sheet-backup` into `main` (fast-forward), `npm run build`, unit + emulator suites green.
- [ ] Push `main` (user asked; it also carries 04afaff, 97e05a5, 6333c83, 417b073 + handoffs). Wait for `curl https://dreamteamfit.vercel.app/api/version` = new commit.
- [ ] First full fill: the owner presses **Sync now** on the Backup page once (no owner password here; the night cron also fills current + previous month and every other tab at 21:30 IST). Then run scratchpad `verify_rows.mjs` for every month tab → all rows match, and open the sheet's tabs via the API dump to check the Look items.
- [ ] Update `docs/HANDOFF.md`, memory, and tell the owner: press Sync now once; staff share = view only.
