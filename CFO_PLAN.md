# CFO: build plan (version 1)

Spec: `CFO_SPEC.md` (including "Adjustments for this app"). This plan says how it is built in
this codebase. Branch `cfo-v1`, local commits only.

## 1. Architecture in one picture

```
Firestore (existing data) ──read by──> src/server/cfo-data.ts  (admin SDK, few queries, normalises docs)
                                          │  CfoInput (plain objects, no Firestore types)
                                          ▼
                                   src/lib/cfo/*  (PURE maths: numbers, alerts, brief input; unit-tested)
                                          │  CfoSnapshot
                                          ▼
src/server/cfo.ts  ── saves ──> cfoReports/latest   (numbers + alert lists; read by the page)
        │                         cfoBriefs/{date}  (AI text + the exact input sent)
        └── src/server/ai.ts  (Gemini | OpenAI | Claude | off, plain fetch, timeout + 1 retry)

Page /cfo  ── reads 3 docs (cfoReports/latest, newest cfoBriefs, cfoSettings/main) ──> UI
          ── POST /api/cfo/refresh  (recompute; optionally new brief)
Morning cron (existing /api/cron/morning) ── last step: recompute; new brief if none yet this week (Mon)
```

Why: Firestore charges per read. The heavy reading happens on the server once a day (and on
Refresh, throttled to once a minute), not every time someone opens the page (page = 3 reads).

## 2. Spec terms → real data

| Spec term | Real source |
|---|---|
| Member | `clients` (`fullName`, `phone`, `clientCode`, `joinedOn` or `createdAt` (IST date), `lastVisitDate`, `thumbSince`, `firstThumbRegistered`) |
| Membership plan | `memberships` (`startDate`, `endDate`, `priceSnapshot` = list price, `status`, `pauses[]`, `cancelledOn`, `cancelId`, `invoiceId`, `paidInOldSoftware`, `source:"import"`, `upgradedTo`, `upgradeFrom`, `originalEndDate`) |
| Price after discount | Only on the bill (`invoices`): plan's share of `subtotal − discount` (see 4.1) |
| Amount paid so far | Bill `amountPaid` shared the same way (no per-plan payment link is reliable) |
| Payments received | `payments` (`amount`, negative for refunds; `paymentDate`; `kind`; `cancelId`) |
| PT | `ptAssignments` (`ptPrice`, `trainerId`, `trainerNameSnapshot`, dates, `status`, `invoiceId`, `trainerShareAmount`), payouts in `trainerPayouts` (`ptAssignmentId`, `trainerShareAmount`, `status`, `paidAt` YYYY-MM-DD, `adjustment`) |
| Attendance | `memberVisits/{clientId}.days` (one entry per visit day, allowed punches only, kept in step when a hand-marked visit is removed) + `clients.lastVisitDate` |
| Expenses | `expenses` (`amount`, `date`, `category`, `paidBy`, `settled`, `settledDate`). Staff salary is already here (`payStaff` writes an expense) |
| Other income | `manualIncome` (`amount`, `date`) + non-plan lines on bills |
| Trainer salary | `trainers.staffId` → `staffPrivate/{staffId}.monthlySalary` |
| Frozen | Plan pause (`pauses[]`: `on`, `days`) |
| Admin | `requireFeature(request,"finance")` on the server; `can("finance")` in the page and rules (owners + "All features" + Finance ticked) |

## 3. New data (no existing data is changed)

| Collection / doc | Who writes | Rules |
|---|---|---|
| `cfoSettings/main` `{openingBalance:number|null, openingDate:"YYYY-MM-DD"|"", atRiskDays:14, renewalDays:30, newMemberMinVisits:4, ptMinVisits:12, runwayWarnMonths:2, graceDays:15, aiEnabled:true, language:"English"|"Telugu"|"Hindi", updatedAt, updatedBy}` | Page (through `@/lib/firestore`, so it is audit-logged) | read/write `can('finance')`, id must be `main`, field types checked |
| `cfoReports/latest` = the `CfoSnapshot` (numbers, lists, notes, `computedAt`, `computedBy`) | Server only | read `can('finance')`, write `false` |
| `cfoBriefs/{YYYY-MM-DD}` `{date, createdAt, by, provider, model, status:"ok"|"failed"|"off"|"unverified", text, input (exact JSON sent), error, unknownNumbers}` | Server only | read `can('finance')`, write `false` |

Expense categories already exist. No migration. No field is added to existing collections.
Production rules deploy needs the user's OK (not done in this build).

## 4. Layer 1: exact maths (all in `src/lib/cfo`, pure, unit-tested)

Dates are `YYYY-MM-DD` strings; "today" (T) is IST (`localDate()` on the server). Day maths is
done on date strings in UTC so time zones never shift a day. Money is kept unrounded inside and
rounded to whole rupees only for display and stored totals.

### 4.1 Value and paid amount of each plan (from its bill), tax taken out

For a bill: `grossM` = `membershipGross` (fallback: the plan's list price), `grossP` = `ptGross`
(fallback: PT list price), scaled down together if they add up to more than `subtotal`;
`grossO = subtotal − grossM − grossP` (other lines). `credit = upgradeCredit`.

- `base = subtotal − (discount − credit)` (discount without the upgrade credit), shared by gross:
  `valueM = base × grossM/subtotal`, `valueP = base × grossP/subtotal`, `valueO = base × grossO/subtotal`.
- Cash paid without tax: `cashExTax = amountPaid × (subtotal − discount)/total` (0 if `total` is 0).
  Shared by the "after full discount" amounts (`valueM − credit`, `valueP`, `valueO`), then
  `paidM += credit` (upgrade credit counts as already paid).
- Old-software plan (`paidInOldSoftware`): value = list price; paid = value − (its bill's
  `balanceDue` without tax, or 0 if no bill). Imported plan (`source:"import"`, no bill): value =
  paid = list price. Any other plan whose bill is missing (deleted): value = paid = 0, and a
  "data to check" note counts it.
- `valueO` (other lines on a bill) is earned on the bill date.

### 4.2 Spreading a value over days (one function for gym plans, PT plans and trainer share)

Item: `start`, `end` (actual), `totalEnd` (= `originalEndDate` for a plan cut short by an upgrade,
else `end`), paused days (union of all pauses), `value V`, optional `cancelledOn` and `finalValue F`.
- Active days = days in `[start, totalEnd]` that are not paused. If 0 or bad dates: whole value on
  `start` (+ note).
- Earned in period `[a,b]` = `V × (active days in [a,b] ∩ [start, end] before cancelledOn) / total active days`.
- Cancelled: earning stops the day before `cancelledOn`; on `cancelledOn` the difference
  `F − earned so far` is booked (can be minus). For a cancelled gym/PT plan `F` = paid (without
  tax) − its share of the refunds with the same `cancelId` (refunds shared by paid amount). So the
  total ever earned on a cancelled plan = money kept. Past months never change when a plan is
  cancelled later; a restore (undo) puts everything back because we always recompute.
- Upgrade: the old plan stops at its new `endDate` but is spread over its original length; the
  unused part moves to the new plan as `credit` (4.1). Past months stay stable.

### 4.3 Monthly numbers (6 full months + this month so far)

- **Earned income (M)** = gym plans + PT plans (4.2) + other bill lines + `manualIncome` in M.
  This month is counted up to and including today ("so far").
- **Expenses (M)** = expense records dated in M (all, whoever paid) + **trainer share** of PT
  earned in M (spread like the PT income; per PT plan = sum of its non-cancelled payout lines incl.
  minus adjustments, fallback `trainerShareAmount`). Trainer share is shown as its own category
  "Trainer share (PT)" because it is a real cost that is not on the Expenses page.
- **Profit or loss (M)** = earned income − expenses.
- **Average monthly expenses** = average of the last 3 full months that have data (a month has
  data if it is on/after the month of the gym's first record). "based on N months"; 0 months → null.
- **Active members (today)** = distinct members with a non-cancelled gym or PT plan covering today
  (paused members count; they are still members).
- **Active members in M** = distinct members with such a plan on at least one day of M.
- **Income per member** = earned income of last full month / active members in that month.
- **Break-even members** = ceil(average monthly expenses / income per member); null if either is
  missing or 0. Page says above / below.
- **Advance money owed** = for every non-cancelled gym/PT plan that ends today or later (includes
  queued, paid-ahead plans): `max(0, paid − V × active days used up to today / total active days)`.
- **Cash balance** (only when opening money is set) = opening balance (money at the START of the
  opening date) + sum of `payments.amount` with `paymentDate ≥ openingDate` (one aggregate query;
  refunds are minus) + old bills without payment records (`paymentsTracked:false`, by bill date)
  + `manualIncome` since + … − expenses paid by the gym since (`paidBy "Gym"` by `date`; others by
  `settledDate` once settled) − trainer payouts paid since (`paidAt`).
- **Free cash** = cash − advance owed. **Runway** = cash / average monthly expenses (null when
  either is missing; "if no new money comes in").
- **Renewal rate (M)**: gym plans (not cancelled, not cut short by an upgrade) ending in M, one per
  member (their latest ending in M). Renewed = another non-cancelled gym plan of the same member
  ends later and starts on or before `end + grace`. Not renewed = no such plan and `end + grace`
  is before today. Otherwise "still deciding" (shown, not counted). Rate = renewed / (renewed +
  not renewed), null if 0.
- **New members (M)** = members whose join date (`joinedOn`, else `createdAt` IST) is in M, except
  members whose every plan came from the old software or an import.
- **Net member growth (M)** = new members − not renewed.
- **Pending dues** = bills with `balanceDue > 0` and status not `refunded`/`closed`. Age from
  `dueDate` (else bill date): not due yet / 0–7 / 8–30 / more than 30 days late. List + totals.
- **PT income per trainer** (this month so far and last month): PT earned income + trainer share
  + monthly salary when the trainer has one.

### 4.4 Layer 2 alerts (thresholds from `cfoSettings`)

"Running plan" = non-cancelled gym plan covering today (latest-ending if several). Visit days =
`memberVisits` days ∪ `lastVisitDate`. "Tracked" = thumb registered or a known last visit (same
rule as the Calls page; untracked members are counted in a note "N can't be checked yet").
`from` = later of `thumbSince` and the start of the member's unbroken run of plans (walk back
through earlier plans that ended within the grace period before the next started).

| Alert | Rule | Money at stake |
|---|---|---|
| At-risk | Running plan, not paused today, tracked; and (days since the later of last visit / `from`, minus paused days, ≥ `atRiskDays`) OR (`from` ≤ today−27, no pause in the last 28 days, visits in the earlier 14 days ≥ 4 and last-14-day visits ≤ half of them) | plan value |
| Renewal coming | Running plan ends in 0…`renewalDays` days and no later non-cancelled gym plan; "Top priority" if also at-risk | plan value |
| New member slipping | Counts as a new member, joined 7…30 days ago, running plan, not paused, tracked (or plan waiting for thumb), visit days since joining < `newMemberMinVisits` | plan value |
| PT opportunity | Running plan, visit days in last 30 ≥ `ptMinVisits`, never had a non-cancelled PT plan | cheapest active PT package price |
| Cash warning | runway < `runwayWarnMonths` OR active members < break-even | — (reasons listed) |

Row: name, member ID, phone, plan, end date, last visit, money, short reason. Sorted by money,
highest first (top-priority badge shown). Lists are stored up to 500 rows each with the full
count and total (page says "showing 500 of N" if ever cut).

## 5. Layer 3: AI brief

- `buildBriefInput(snapshot, settings)` → totals only, numbers pre-formatted exactly as the page
  shows them ("₹1,90,000", "2.4 months", "70%"), plus rule thresholds and today's date. Never
  member rows. Guard before sending: JSON must not contain any 10-digit number or any name/phone
  from the alert rows (refuse to send if it does).
- System prompt = spec text + "Copy every number exactly as written in the data."
- `verifyBriefNumbers(text, input)`: every number in the reply must appear in the input (after
  removing ₹ , % and spaces) or be 1/2/3 list numbering. If not: retry once with a reminder; if still
  wrong, status `unverified`, page shows the fallback message.
- Provider: env `CFO_AI_PROVIDER` = `gemini` | `openai` | `claude` | `off` (default off when no
  key), `CFO_AI_MODEL` (optional), `GEMINI_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`,
  `CFO_AI_BASE_URL` (optional override; local tests point it at a fake AI). Plain `fetch`, 20 s
  timeout, one retry, never throws, total kept inside the 60 s function limit.
- When: morning cron makes one if there is none since this week's Monday; Refresh button makes a
  new one. Settings switch `aiEnabled` off → no call, page shows "AI summary is not available right now."

## 6. Files

New
- `src/lib/cfo/types.ts` (input, settings, snapshot contracts), `dates.ts`, `money.ts`,
  `plans.ts` (4.1, 4.2), `numbers.ts` (4.3), `alerts.ts` (4.4), `brief.ts` (5), `index.ts`
  (`computeCfoSnapshot(input, settings)`), `*.test.ts` (node:test; relative imports with `.ts`).
- `src/server/cfo-data.ts` (Firestore → `CfoInput`), `src/server/ai.ts`, `src/server/cfo.ts`
  (`handleCfo`, `refreshCfo`, `cfoMorningStep`).
- `src/services/cfo.service.ts`, `src/routes/_authenticated/cfo.tsx`, `src/components/cfo/*`.

Changed (small)
- `src/server/router.ts` (+ `/api/cfo/` line), `src/server/automation.ts` (morning: last step,
  own try/catch), `src/server/admin.ts` (health: AI provider set/missing),
  `src/services/firestore.service.ts` (COLLECTIONS), `src/constants/navigation.ts` + `features.ts`
  (`/cfo` → `finance`), `firestore.rules` (3 blocks), `src/lib/audit-describe.ts` (CFO settings
  line), `package.json` (`"test:cfo": "node --test src/lib/cfo/"`), `.env.example` + README (AI vars).

API: `POST /api/cfo/refresh {brief:boolean}` → `{ok, computedAt, brief: status}`; 401/403 JSON
errors; 429-style message if refreshed in the last 60 s. Errors always JSON (never the router's
plain-text 500).

## 7. Page (`/cfo`, nav "CFO", Management group, `finance`)

1. Header: "Updated 8:02 AM today", Refresh, Settings.
2. Five health cards (green / amber / red): profit this month so far (with last month under it),
   active vs break-even, cash, free cash, runway. Cash cards ask for opening money until it is set.
3. "This week's brief" card (date, provider) or the fallback line.
4. Problem tabs: At risk · Renewals · New members · PT chances · Dues · Cash, each with count and
   money; rows have Call (`tel:`) and WhatsApp chat (`wa.me`, free); Excel download per tab.
   Phone: cards; desktop: table.
5. Trends (6 months + this month): earned vs expenses, new vs lost members, renewal rate; each
   with a small table for screen readers.
6. "How these numbers are worked out": every Layer 1 number with its one-line meaning and a rupee
   example; expenses by category; PT per trainer.
7. Settings dialog: opening money + date, thresholds, AI on/off, brief language. Save → recompute.
First visit (no snapshot): one button "Work out my numbers".

## 8. Tests and how each of the 10 checks is proved

- Unit tests (`npm run test:cfo`): every formula, edge cases (zero data, divide by zero, pause,
  part payment, refund/cancel, upgrade, missing end date, old-software, tax bill, orphan bill).
- Local emulator e2e (`cfo_local.py` in the session scratchpad, `CFO_TODAY` fixed date honoured
  only when `FIRESTORE_EMULATOR_HOST` is set): seeds the spec's test data, refreshes through the
  API as owner, compares every number with a hand calculation written in `cfo_expected.md`.
- Fake AI (`fake_ai.py`) records every request: proves no names/phones are sent, numbers match.
- Playwright as owner (light/dark, 390/1440), as a desk login without Finance, console errors.

| Check | Proof |
|---|---|
| 1 Earned income | unit test + e2e value for the test month = hand calc (yearly plan spread) |
| 2 Profit | unit + e2e: earned − expenses for the same month |
| 3 Break-even | unit + e2e + page text "above/below break-even" |
| 4 Advance owed, free cash | unit + e2e incl. part-payment plan and paused member |
| 5 Cash, runway | Playwright: save opening money; take a payment + add an expense in the app; Refresh; both numbers move by the exact amounts |
| 6 Renewal rate, net growth | unit + e2e vs hand calc |
| 7 Pending dues | unit + e2e + page list and group totals |
| 8 Alerts | unit + e2e: exact members per list; paused member never at-risk |
| 9 AI brief | fake AI: generated, every number found on the page, request has no names/phones; AI off and AI failing → page works with the fallback line |
| 10 Safety | desk login: page shows "no access", API 403; regression suites (join member, payment, attendance, expense) pass; 390 px no sideways scroll; console clean |

## 9. Risks and limits (written down so nobody is surprised)

- Numbers refresh once a day or on Refresh, not live. The page shows when they were made.
- Upgrade credit and old-software plans use list prices where the real price is unknown.
- Members deleted with their accounts vanish from history (their money docs are gone).
- Income is counted without GST (tax is off for this gym today); cash includes it.
- The real AI is only tried with the user's key; build and tests use the fake AI.
