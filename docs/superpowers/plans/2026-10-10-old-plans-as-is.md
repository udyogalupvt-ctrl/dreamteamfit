# Old plans as-is: migration + permanent guardrails — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every old-software member's plan exists in the app exactly as in the old records (name, start, end, amount, balance), with the money counted as normal money on the start date, and no manual way left for staff to hand-enter an old plan.

**Architecture:** a pure decision module (`src/lib/old-migrate.ts`) computes, per phone record, what to create / fix / leave (with reasons). Server endpoints (`src/server/old-migrate.ts`, admin SDK, owner-gated for the bulk run) apply those decisions in per-member transactions, writing one `oldSoftwareMoves` doc (kind `"as-is"`) with full before-snapshots per changed member, so every change has per-row Undo and Undo-all. An owner card "Old software check" on Income & expenses drives preview → run → review → undo. All legacy hand-entry paths (checkout tick, Add old plan dialog, Check & mark) are removed; carrying an old plan happens only through the new carry endpoint, once per old plan (`oldPlanKey`).

**Tech stack:** TanStack Start + React 19, Firestore (client SDK + rules for UI; firebase-admin on the server), node:test for units, Playwright+emulators for E2E.

## Global constraints (from the spec, verbatim where it matters)

- Old plan kept as-is: old plan name, start, end, amount, balance. No package picking, no bill (except the balance bill), no WhatsApp.
- Money is money: paid part = one payment on the plan's start date, `oldSoftware: true`, mode **"Not recorded"** (`method: "not_recorded"`), editable later; never in past days' Day Book drawer cash, never in incentives/trainer payouts.
- Old balance > 0 → the existing old-balance bill ("Balance from the old software · …"), Collect works, WhatsApp reminder only when staff tick `remindOldBalance`.
- Thumb works until the old plan's end date; when it ends → renewal due → renew with OUR packages (normal sale).
- NOT touched by the migration: plans sold here (renewals, new money), payments taken here, Day Book cash, trainer shares.
- "Paid in the old software" plans NOT in the old records: not changed, listed for the owner with the reason.
- An old plan can be carried once (`oldPlanKey` idempotency); a sale here can't silently overlap a carried old plan (existing `plan-overlap` refusal stays).
- Production names never in git-tracked files. Live data: back up before the run; Undo for every change.
- Rules: `oldSoftwareMoves` can never be deleted → undo marks `undone: true`. The browser cannot read `oldMembers`/`oldDataIndex` → all old-record reads for the migration happen on the server.
- Server-side admin writes do NOT queue door checks automatically (the client wrapper does) → the migration queues `biometricCommands` door checks itself for every member whose plans changed, and recomputes `clients.currentMembership` with `pickCurrent`.

## Data shapes (exact)

**As-is gym plan** (`memberships/{id}`):
```js
{ clientId, packageId: "", packageNameSnapshot: <old plan name>, priceSnapshot: <old "amount to be paid">,
  durationDaysSnapshot: <days start..end incl.>, startDate: <old start>, endDate: <old end>,
  status: "active" | "expired" | "pending" (by dates today),
  invoiceId: <balance bill id or "">, enrollmentId: "",
  paidInOldSoftware: true, oldSoftwarePaid: <amount - balance>, oldSoftwareBalance: <balance>,
  oldSoftwareBillNo: <bill no or absent>, oldPlanAsIs: true, oldPlanKey: "<oldMemberId>|<start>|<end>|<name>",
  oldMemberId, createdAt, updatedAt }
```
**As-is PT plan** (`ptAssignments/{id}`): same old* fields plus
```js
{ clientId, clientNameSnapshot, ptPackageId: "", ptPackageNameSnapshot: <old plan name>,
  trainerId: "", trainerNameSnapshot: "", ptPrice: <amount>, trainerShareAmount: 0, gymShareAmount: <amount>,
  startDate, endDate, status: "active" | "completed" | "pending", invoiceId, enrollmentId: "" }
```
No trainerPayout, no enrollment doc, no WhatsApp.

**Kind rule:** `isOldPtPlanName(name)` → PT assignment; PT name that also grants the floor (`/floor|gym/i` in the name) → membership + PT pair sharing the one payment (existing gym+PT pair pattern); else membership.

**Payment** (one per old plan; pair shares one): `oldPaymentData(...)` with `method: "not_recorded"`, `paymentDate: <old start>`, `amount: <amount - balance>` (skip when 0), `oldSoftware: true`, `invoiceId: ""`, split fields zeroed for trainer (`trainerShareAmount: 0`).

**Balance bill** (only when balance > 0): the existing single-line "Balance from the old software · <old plan name>" invoice + publicInvoices mirror, `remindOldBalance: false` by default.

**Move doc** (`oldSoftwareMoves/{auto}`): `{ kind: "as-is", runId, phoneKey, clientId, clientName, action: "create-member" | "carry" | "fix" | "recycle-duplicate", was: <plain-words summary>, now: <plain-words summary>, before: { client?, memberships: [{id,data}], ptAssignments: [{id,data}], invoices: [{id,data}], publicInvoices: [{id,data}], payments: [{id,data}], enrollments: [{id,data}] }, created: { clientId?, membershipIds: [], ptAssignmentIds: [], invoiceIds: [], publicInvoiceTokens: [], paymentIds: [], memberIdReserved? }, undone: false, by, byUid, createdAt }` — one per changed member; undo = write back every `before` snapshot, delete every `created` id, recompute current, queue door check, mark `undone: true`.

## Decision table (pure module) — every case

Input per phone: old record members[], app clients on that phone (+ their memberships, ptAssignments, invoices, payments, enrollments). Output: actions + skip reasons. For each old member (person) on the phone, matched to an app client by `oldMemberId`, else `pickOldMember` name match, else the only pair:

| # | Case | Action |
|---|------|--------|
| 1 | Not in app + plan running today | create member (details below) + carry running plan as-is (+ balance bill). |
| 2 | Not in app + only ended plans | nothing now (first-visit "Add from old software" in search). Listed as "not changed: comes on first visit". |
| 3 | In app, old plan carried already with `oldPlanAsIs` | skip (carried once). |
| 4 | In app, a plan marked `paidInOldSoftware` matches an old plan (`matchingOldPlan`, ±10 days) but differs in name/dates/price/paid/balance (any package pick counts as differing in name) | **fix in place**: rewrite that membership/PT to the exact as-is shape (keep the SAME doc ids), rewrite its old `oldSoftware` payments to one exact payment, convert/create/delete the balance bill to match the old balance, KEEP every non-oldSoftware payment (money taken here) pointing at the kept bill. |
| 5 | In app, TWO OR MORE plans match the same old plan | keep/fix the best one (same rule as 4), move each extra whole sale to the Recycle Bin (existing `planRemoval` semantics) — only when the extra has no non-oldSoftware payments; else list "not changed: money taken here on the copy — owner decides". |
| 6 | In app, member has a running old plan NOT in the app (and no plan here covering today of that kind) | carry it as-is (same as 1, member exists). |
| 7 | Plan marked `paidInOldSoftware` with NO old plan covering it (October mistakes) | not changed; listed with reason "not in the old records (likely money paid here)". |
| 8 | Plans sold here (no `paidInOldSoftware`), incl. renewals while the old plan ran | never touched. If a carried old plan overlaps one, create the old plan with `overlapOk` pairing marked so the owner overlap list stays quiet, and list a note. |
| 9 | Two people share a phone | each old member handled separately against their own matched client; creating both is fine. |
| 10 | Old plan with no end date or no start date | not changed; listed "dates missing in the old record — staff add by hand". |
| 11 | Member in app already, correct by chance but entered as a normal sale covering the old plan's days (no paidInOldSoftware, payment real mode, counted in Day Book) | NOT touched (money taken here is sacred); listed "entered as a sale here — owner decides" unless the sale's payment day ≥ old software stop (then it's just new money, silent). Conservative: never auto-recycle money with a real mode. |
| 12 | `oldSoftwareMoves` of the legacy kinds exist for a plan being fixed | fix proceeds on current values; legacy move docs stay untouched (their undo may refuse later — acceptable, listed in now-summary). |

**Member creation (case 1):** `fullName` (tidyName), `phone`, `phoneNormalized`, `gender`, `dateOfBirth` (from old record when present — the member app password needs it), `joinedOn: oldJoinedOn`, `oldMemberId`, `clientCode`: the old numeric member ID when 1–8999 and free (reserve in `memberIds`), else next free; `status: "active"`, `currentMembership` via `pickCurrent`. Counsellor fields left empty (staff by hand, spec item 6). Mirror every other required client field from the enrollment path (verify against `enrollMember`'s client write during build).

## Tasks

### Task 1: pure decision module `src/lib/old-migrate.ts` + units
**Files:** Create `src/lib/old-migrate.ts`, `src/lib/old-migrate.test.ts` (node:test, wired into `npm run test:cfo` group like `old-data.test.ts`).
**Produces:** `planMigration(input: { today: string, phoneKey: string, oldMembers: OldMember[], clients: AppClient[], memberships: Row[], ptAssignments: Row[], invoices: Row[], payments: Row[], enrollments: Row[] }): { changes: MemberChange[], skips: Skip[] }` where `MemberChange = { action, clientRef: {id} | {create: ClientDraft}, writes: PlannedWrite[], was: string, now: string }` — PlannedWrite is a discriminated union (`set-membership`, `fix-membership`, `set-pt`, `fix-pt`, `set-payment`, `delete-payment`, `repoint-payment`, `set-invoice`, `fix-invoice`, `delete-invoice`, `recycle-sale`, …) that the server executes mechanically.
Unit tests cover every row of the decision table plus: `planKindOf` (gym / pt / pt+floor), exact money maths (amount − balance, zero-paid plans, balance-only), `oldPlanKey` idempotency, name-matched family phones, missing dates, the "never touch non-oldSoftware payments" invariant (assert no PlannedWrite ever deletes/edits a payment whose `oldSoftware !== true` beyond `repoint-payment` invoiceId), and re-running on already-fixed state returns zero changes.

### Task 2: server engine `src/server/old-migrate.ts`
**Files:** Create `src/server/old-migrate.ts`; modify `src/server/router.ts` (route `/api/old-migrate/*`).
**Endpoints:**
- `GET /api/old-migrate/preview?cursor=N` (owner): read `oldDataIndex` summary keys, page 50 phones; `getAll` old records + app docs; run `planMigration`; return `{rows, skips, nextCursor, done, totals}`. No writes.
- `POST /api/old-migrate/apply {runId, cursor}` (owner): same page; per changed member ONE transaction: re-read docs, re-plan, execute PlannedWrites, write the move doc (full before-snapshots + created ids), recompute `currentMembership` (`pickCurrent`), queue door check (`biometricCommands` — same shape the client wrapper writes; copy from `src/lib/firestore.ts:155` / `src/server/biometric.ts`), audit line. Returns progress; safe to re-run (oldPlanKey + deep-equal skip).
- `POST /api/old-migrate/carry {phone, oldMemberId, planKey?}` (feature `members`): single-member carry for first-visit adds and the member-page banner; same engine, one move doc, `action: "carry"` or `"create-member"`.
- `GET /api/old-migrate/search?q=` (feature `members`): name/phone search over the old directory for global search (return ≤8 entries incl. latest plan + whether already in app).
- `POST /api/old-migrate/undo {moveId}` and `POST /api/old-migrate/undo-run {runId, cursor}` (owner): restore every `before` snapshot (tx.set whole-doc), delete every `created` doc (admin may delete payments/invoices; memberIds reservation left — note in doc), recompute current + door check, mark `undone: true`. Refuse when a restored doc changed since (deep compare the created as-is docs against their written shape; if a created plan was renewed/edited → refuse with why).
- Recycle of duplicates: reuse `planRemoval` (lib) + a server-side port of the `removePlan` transaction writing `recycleBin`/`recycleBinItems` (same shapes, `deletedByUid` = owner uid) so Restore in the app works on them.

### Task 3: owner card "Old software check" (`src/components/finance/old-migrate-check.tsx`)
**Files:** Create component; modify `src/routes/_authenticated/expenses.tsx` (mount FIRST in the income section).
UI: Preview button → paged fetch loop with progress; summary counts; Run (ConfirmDialog typeToConfirm "RUN") → apply loop; results table grouped: changed (was → now, per-row Undo), not changed (reason), duplicates recycled. "Undo all" (typeToConfirm). Card also lists past runs (`oldSoftwareMoves` kind "as-is" grouped by runId, client query — rules allow finance read) with per-row + per-run Undo. Phone + desktop layouts, light/dark.

### Task 4: retire every manual entry path
**Files:** Modify `enrollment-wizard.tsx`, `enrollment.service.ts`, `clients.$clientId.tsx`, `old-sales-review.tsx`; delete `add-old-plan-dialog.tsx`, `old-software-dialog.tsx` usage (keep `undoOldSoftwareMove` + the member-page Undo link for already-made legacy moves).
- Wizard: remove `paidOld`/`paidHere`/`oldBalanceText`/`oldPaidText`/`oldRows`/`remindOld`/`askOld` state, the tick UI, old-amount inputs, OldPaidRows at checkout, the lock effect, the confirm, draft fields, and the `oldSoftware` arg to `enrollMember`. Keep `oldRunning` lookup to show instead: a banner "Old software plan <name> runs to <end>. Carry it as-is first" + [Carry the old plan] button → `/api/old-migrate/carry` → after carry the normal renew-min logic prices the sale from the day after. A sale overlapping a not-yet-carried old plan of the same kind is refused on save with that banner (replaces the lock).
- `enrollment.service.ts`: delete the `oldSoftware` input + `oldFields` + old-payment rows + balance-bill branch (the carry endpoint owns balance bills now); keep the "plan here already covers that day" refusal.
- Member page: "Add it here" banner now calls the carry endpoint (no package guessing); "Paid in the old software?" link and `OldSoftwareDialog` removed; legacy Undo link stays.
- `old-sales-review.tsx`: drop "Check & mark" (list becomes read-only guidance: "Remove the plan and sell it again, or let the migration fix it"); `NotInOldRecords` list stays.
- Global search: old-directory section "In the old software" via `/api/old-migrate/search` with one-click "Add from old software" (carry endpoint) when the phone isn't in the app.

### Task 5: "Not recorded" mode + readers
**Files:** modify the payment-method label map(s) (pay-mode-field, number-details chips, Day Book lists, Excel export, invoice/receipt renderers, CFO labels) so `method: "not_recorded"` renders "Not recorded" and the old "Old software" chip label is gone; `oldPaymentData` takes the method (default `"not_recorded"`); Edit plan's old rows keep offering Cash/UPI/… plus "Not recorded". Verify Day Book cash, CFO cash, incentives, payouts still key off `oldSoftware: true` (no behavior change).

### Task 6: emulator suite `asis_local.py` + regression
**Files:** scratchpad harness; suite covers (each numbered check): seed old records via `/api/old-data/upload` (synthetic CSVs, fake names); run migration from the owner card; every decision-table case end to end; checkout tick is gone; carry-first banner + refusal; "Add from old software" in search; member page shows as-is plan + balance Collect; Day Book drawer unchanged on past days; dashboard This month counts the October-start old plan; renewal reminder appears when the as-is plan ends (morning cron); member app shows the plan; per-row Undo, Undo-all, re-run idempotence; phone 390px + desktop 1440px, light + dark screenshots.
Regressions: `remove`, `audit2`, `audit9`, `moneyfix`, `latedates`, `paidon`, `paidon_edit`, `renew_pt`, `oldlock` (updated: the lock is replaced by carry-first), `plans_end`, `update`, `price`, `split` + unit suites + tsc + eslint + build.

### Task 7: live run
Backup (read-only dump of clients, memberships, ptAssignments, payments, invoices, publicInvoices, enrollments, cashDays, oldSoftwareMoves, recycleBin*, memberIds, oldDataIndex summary → scratchpad JSON, counts into HANDOFF only) → push main → verify `/api/version` → owner login (headless Playwright, creds from owner_login.txt, never printed) → preview → apply → verify EVERY old member with a fresh read-only script (`verify_asis.mjs`: for each old member with a running plan: app has exact name/start/end/price/paid/balance; no duplicate carried plans; every non-oldSoftware payment byte-identical to the backup except allowed `invoiceId` repoints; Day Book cashDays untouched; totals) → October comparison vs `october_check.md` → Telugu-English fix list → delete owner_login.txt (both copies) → HANDOFF.

## As built (2026-10-10 overnight)

- Mode is stored literally as `method: "Not recorded"` (type widened; NOT added to the checkout
  choices; offered in Edit plan's old rows via `OLD_PAY_METHODS`). The This-month "Old software"
  chip is gone: chips show the payment's real method.
- `priceSnapshot` = the old "amount to be paid" (CFO earned value right), `durationDaysSnapshot`
  real days (upgrade-credit maths safe).
- The in-app punch decision (`decide()` in biometric.ts, `decideMemberAccess`) now counts active
  PT plans like the machine's `entitled()` — migrated PT-only members log allowed, not "blocked".
- Carry-first checkout: the banner + one-press carry replaced the lock; `e["oldCarry"]` refuses a
  same-kind sale over a not-yet-carried old plan's days; after the carry the renew flow prices
  from the day after the old end (existing renewMin).
- The member app no longer lists a carried plan twice (portal oldHistory filtered).
- `markPaidInOldSoftware` has no UI any more (kept only for legacy Undo); `OldSalesReview` is
  read-only guidance; `add-old-plan-dialog.tsx` and `old-software-dialog.tsx` deleted
  (`RemindOldBalance` moved to `old-paid-rows.tsx`).
- Server engine details: per-member transactions re-plan inside the tx; move docs carry full
  before-copies + created ids; undo refuses when any created doc's `updatedAt` moved past its
  `createdAt` (money collected on a new balance bill is never lost) or a created member has new
  records; `memberIds` reservation freed on undo; overlap marks never bump `updatedAt`;
  door checks queued for changed members with a registered thumb; invoice numbers from
  `settings/counters` + `settings/business.invoicePrefix`; Vercel `maxDuration` is already 60s
  and every endpoint is paged (preview 120 phones, apply/undo 12 members).
- Suites: `asis_local.py` (the whole decision table end to end + undo + idempotence + search +
  carry-first + screenshots), `oldlock_local.py` rewritten carry-first; `renew_pt` B-case and
  `audit2` D/E updated (Check & mark retired).

## Self-review notes
- Spec item 10 (paper-book entries after the backup date) = staff work, out of scope — stated in the owner page copy.
- Spec "show ONE screen preview first": superseded by the owner's overnight pre-approval; preview screenshots still taken for the morning.
- memberIds freed on undo? `memberIds` rules are create-only for clients, but the admin SDK can delete the reservation on undo-of-create-member — do that, and note it.
- Vercel function time: all endpoints paged (50 phones preview / 25 apply / 25 undo-run per call).
