# Google Sheet backup — design (2026-10-13, approved by the user in chat)

## Goal

A Google Sheet in the gym's own account that (1) the owner / front desk can use if the app is down,
(2) always shows the SAME numbers as the app's dashboard, and (3) holds an exact copy of every business
record so the app can be rebuilt from it — only when the owner says so.

Sheet: "REBUILD FITNESS – Register Backup", id `1Rsn0jB8HX8TsbYmrxeT6VCPl4wcmyh2VhU7yy2_qJxc`, shared as
Editor with the Firebase service account. Sheets API is enabled on `rebuildfitos`. Connection and the
month layout are proven by scratchpad previews (`sheet_check.mjs`, `month_preview.mjs`, session 948c07bc…).

## Rules (non-negotiable)

1. **Numbers match the app.** Month tabs use the dashboard rule (`buildFinanceSummary`): money counts on
   its `paymentDate`; legacy untracked bills on `invoiceDate`; only days up to today. Each month's totals
   row computes the app's figure independently and shows "app shows ₹X ✓ matches" (green) or
   "✗ DIFFERENT" (red). Dues tab total = the dashboard "Balance due" tile.
2. **The app is the truth; the sheet is a copy.** The app never reads the sheet. Each sync rewrites the
   tabs it owns, so a missed sync heals on the next one.
3. **No new keys.** Auth = JWT signed with the existing `FIREBASE_SERVICE_ACCOUNT` (node:crypto, scope
   `https://www.googleapis.com/auth/spreadsheets`), like `push.ts`. No new npm dependency.
4. **Restore only on the owner's word**, via a script with a dry run first. No restore button in the app.
5. **Never in the sheet:** `serverSecrets`, `staffPrivate` passwords/keys, logs and queues (see Restore tabs).

## Tabs (in this order)

| Tab | One row per | Notes |
|---|---|---|
| **Read me** | — | Plain-English guide to each tab, "Last updated", health line per check (✓/✗), what to do if the app is down |
| **Members** | member | ID, name, phone, gender, DOB, joined, current plan, start, end, **days left (sheet formula vs TODAY())**, status (Active / Ending in 7 days / Ended), PT trainer, PT end, balance due, last visit |
| **Dues** | open bill | name, phone, bill no, bill date, total, paid, due, pay-by date, days overdue; total = dashboard tile |
| **Mon YYYY** (newest first, every month since the app started) | payment (split Cash+UPI pair = 1 row) | layout below |
| **Expenses** | expense | date, category, amount, mode, note, by; monthly subtotal rows |
| **All plans** | gym plan or PT plan | member, kind, package, start, end, price, paid-for value, status, counsellor/trainer, bill no, old-software flag |
| **Staff & trainers** | person | name, role, phone, active (no passwords) |
| **Packages** | package / PT package | name, category, days, price, active |
| hidden **_data_<collection>** | record | restore copy, see below |

### Month tab layout (user-approved order)

S.NO · DATE PAID · NAME · PHONE NO · PAYMENT FOR (New / Renewal / Upgrade / PT / Balance / Refund /
Old software / Old software balance) · PACKAGE · **PP · CASH · CARD · OTHER · PAID IN OLD SOFTWARE ·
PAID AMOUNT · DUE NOW · TOTAL BILL · GYM FEE · PT FEE · DISCOUNT** · Counseller · PT Trainer · TYPE OF
CLIENT (Cardio & strengthening / Strengthening / Cardio / Personal training) · START DATE · ENDING DATE ·
DAYS · PT End date · Membership payment due date · STATUS · NOTE · ENTERED ON · BILL NO · MEMBER ID

- Row 1 header (grey, bold; PP purple, CASH blue, CARD green, DUE red), row 2 totals (SUM formulas;
  DUE = due on the distinct bills in the tab). Freeze rows 1–2 only — **no frozen columns**.
- Fees/total/discount only on the sale row (not on Balance rows) so sums don't double count.
- Money columns empty for the whole month are hidden.
- Row shading: Cancelled/Refunded red, Balance blue, Part paid orange.
- NOTE "entered later, dated the day it was paid" when `paymentDate` < typed-in day (IST of createdAt).
- Small top-ups (user, 2026-10-13): staff changed ₹1,999 packages to ₹2,000 and took the ₹1 as a balance
  payment. These are `kind: "balance"` already → PAYMENT FOR "Balance" (never a new entry), still counted
  (the dashboard counts them), NOTE "₹1 top-up after price change" for balance payments ≤ ₹10.
- Money maths reuses `src/lib/plan-money.ts` (`planMoney`). Old-software money goes only in its own column.

## Restore tabs (hidden, protected)

One hidden tab `_data_<collection>` per ROOT collection found by `db.listCollections()` (so new
collections are included automatically), EXCEPT this exclude list (logs, queues, secrets, regenerable):
`serverSecrets, staffPrivate, loginVault, pushSubscriptions, oldSoftwareMoveSeals, auditLogs, deviceLog,
biometricCommands, whatsappMessages, whatsappWebhookEvents, whatsappWebhookStatus, waChats,
automationActivities, notifications, renewalNotifications, birthdayNotifications, absenceNotifications,
paymentDueNotifications, expenseActivities, leadLogs, cfoBriefs, cfoReports`.
Measured 2026-10-13: ~9,000 business records (~7 MB JSON; attendance 2,247 grows ~100/day). Only
subcollection in use is `waChats/*/messages` (excluded).

Columns: `id | updatedAt | json` (+ `json2…` when a record is over 45,000 characters; Timestamps encoded
as `{"__ts": ISO}` so they come back exactly). Sorted by id.

## When it syncs

- **After every entry** (sale, payment, edit, cancel, remove, expense, member change): the browser
  write wrapper (`src/lib/firestore.ts`) marks the change; a debounced (60 s) fire-and-forget call to
  `POST /api/backup/sheet/sync` (staff auth) runs a **quick sync**: the month tab(s) of the changed
  money, Dues, and the changed members' rows in Members, plus their restore rows (`updatedAt >` last sync,
  single-field queries only — no composite indexes).
- **Every night** (existing night cron): full rebuild of every readable tab and full restore-tab
  reconcile (drops rows of deleted records).
- **"Sync now"** (owner, Backup page): full rebuild.
- Concurrency: one run at a time (lease doc in `serverSecrets/sheetBackupState`); a call during a run
  marks "again" so nothing is lost. Estimated cost: quick sync ≈ 300 reads; ≈ 50/day ≈ 15k reads/day
  (well under ₹1/day). Sheets API is free.

## Settings and health

- Sheet id + last result (time, ok/error, per-check ✓/✗, rows written) live in the server-only
  `serverSecrets/sheetBackup*` docs (default-deny rules, so **no rules deploy needed**); read/written via
  owner-only `/api/backup/sheet/*`.
- Backup page, new card "Google Sheet backup" (owner): sheet link, last updated, ✓/✗ checks, Sync now,
  change sheet link (verifies access with a test read before saving).
- Owner sees a dashboard warning when the last successful sync is older than 26 h or the last check
  said DIFFERENT.

## Restore (only when the owner asks)

`scripts/restore-from-sheet.mjs <collection|all> [--member <id>] [--apply]`: reads the hidden tabs,
compares with Firestore and prints counts (new / different / same). Writes only with `--apply`. Never
deletes Firestore records that are not in the sheet.

## Testing

- Pure row builders (`src/lib/sheet-backup/*.ts`, relative `.ts` imports) unit-tested with `node --test`:
  dashboard match on fixtures (late sale dated last month, split pair, refund, balance, legacy bill,
  old-software and future-dated money), column order, hidden empty columns, JSON round trip.
- Emulator suite with a fake Sheets API (`SHEETS_API_BASE` env): sale → quick sync writes the month row;
  edit/cancel/remove update it; night run reconciles; failure shows on the Backup page.
- Live: run once against the real sheet, confirm Oct/Sep still MATCH, light/dark 390/1440 screenshots
  of the Backup card.

## Out of scope (v1)

Staff typing sales into the sheet while the app is down (can be added later as a "Sales while app down"
tab imported on the owner's word).
