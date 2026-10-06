# CFO: build plan (version 1, reviewed)

Spec: `CFO_SPEC.md` (incl. "Adjustments for this app"). This plan says how it is built here.
Branch `cfo-v1`, local commits only. Contracts: `src/lib/cfo/types.ts`.
Reviewed 2026-10-06 by three independent reviewers (maths, code, owner/safety); their fixes are in.

## 1. Architecture

```
Firestore ──(single-field queries, getAll)──> src/server/cfo-data.ts ──CfoInput──> src/lib/cfo (pure maths)
                                                                                  │
         cfoReports/latest  (numbers, counts, top rows)  <──────────── CfoComputed ┘
         cfoReports/list-{atRisk|renewals|newSlipping|ptChances|dues}  (full lists, one doc each)
         cfoBriefs/latest (newest OK brief) · cfoBriefs/status (last attempt) · cfoBriefs/{date}-{HHmm} (history)
src/server/ai.ts: Gemini | OpenAI | Claude | off (plain fetch, keys in headers, deadline-bound)
Page /cfo reads 3 docs on open (+1 per list tab opened). Refresh → POST /api/cfo/refresh; new summary → POST /api/cfo/brief.
Morning cron: last step, own try/catch, only if ≥30 s left.
```

Hard rules for the code:
- **Every Firestore query uses one field only** (one equality OR one range) — the live project has
  no composite indexes. **No filtered aggregate** (`sum`/`count` with `where`). Grep check in tests.
- `src/lib/cfo` is pure: relative imports with `.ts` extension, every type import is `import type`,
  no `@/` imports, no enums/namespaces. Runs under `node --test` (Node 22 type stripping).
- Every snapshot number is finite (no NaN/Infinity): "not enough data" is `null`.
- Server never logs AI requests, replies or member rows.

## 2. Spec terms → real data

| Spec term | Real source |
|---|---|
| Member | `clients`: `fullName`, `phone`, `clientCode`, `joinedOn` (else `createdAt` → IST date via Intl, not `joinedOnOf`), `lastVisitDate`, `thumbSince`, `firstThumbRegistered` |
| Plan | `memberships`: `startDate`, `endDate`, `priceSnapshot` (list price), `status`, `pauses[]`, `cancelledOn`, `cancelId`, `invoiceId`, `paidInOldSoftware`, `source`, `upgradedTo`, `upgradeFrom`, `originalEndDate`, `upgradeCredit` (on the old plan) |
| Price after discount, paid so far | The plan's bill (`invoices`), shared as in 4.1 |
| Payments | `payments`: `amount` (minus = refund), `paymentDate`, `kind`, `cancelId` |
| PT | `ptAssignments` (`ptPrice`, `trainerId`, dates, `status`, `invoiceId`, `trainerShareAmount`, `paidInOldSoftware`); `trainerPayouts` (`ptAssignmentId`, `trainerShareAmount`, `beforeCancel.trainerShareAmount`, `status`, `paidAt` YYYY-MM-DD, `adjustment`) |
| Attendance | `memberVisits/{clientId}.days` + `clients.lastVisitDate` |
| Expenses | `expenses` (`amount`, `date`, `category`, `paidBy`, `settled`, `settledDate`); salary already in here |
| Other income | `manualIncome` + non-plan lines on bills |
| Trainer salary | `staffPrivate/{trainer.staffId || trainer.id}.monthlySalary` (0 or missing = not stored) |
| Frozen | Pause (`pauses[]`) |
| Admin | server: `requireStaff` → 401, then `requireFeature(req,"finance")` → 403; page/rules: `can("finance")` |

## 3. New data (nothing existing is changed or migrated)

| Doc | Written by | Rules |
|---|---|---|
| `cfoSettings/main` (`CfoSettings` + `updatedAt`, `updatedBy`) | page via `@/lib/firestore` (audited, line has no amounts) | read/write `can('finance')`, id `main`, types checked |
| `cfoReports/latest` (`CfoSnapshot` + lock fields) | server only | read `can('finance')`, write false |
| `cfoReports/list-*` (`CfoListDoc`) | server only | same block |
| `cfoBriefs/latest`, `cfoBriefs/status`, `cfoBriefs/{date}-{HHmm}` | server only | read `can('finance')`, write false |

Release order (for the user, later): deploy rules first, then code. Until rules exist the page
shows "CFO is being set up" instead of an error.

## 4. Layer 1 maths (pure, `src/lib/cfo`)

T = today (IST). Day maths on date strings in UTC. Inclusive day counts.
**Rounding:** round each leaf once to whole rupees (per month: gym, PT, other income; each expense
category; each cash part; each advance item), then build every total and difference from the
rounded leaves, so profit = earned − expenses and free cash = cash − parts exactly on the page.

### 4.1 Plan value and paid amount (tax taken out)

Bill with `subtotal ≤ 0` → all values and paid = 0 (plan still counts for members/alerts).
Else: `grossM` = `membershipGross` (fallback the plan's list price), `grossP` = `ptGross` (fallback
PT list price), scaled down together if `grossM + grossP > subtotal`; `grossO = subtotal − grossM − grossP`.
`credit = min(bill.upgradeCredit, base × grossM/subtotal)`.
- `base = subtotal − (discount − credit)`; `valueM = base·grossM/subtotal`, `valueP = base·grossP/subtotal`,
  `valueO = base·grossO/subtotal`.
- `cashExTax = total > 0 ? amountPaid × (subtotal − discount)/total : 0`, shared by
  (`valueM − credit`, `valueP`, `valueO`); then `paidM += credit` (credit = already paid).
- **Old-software bills** (its plans have `paidInOldSoftware`): never use the shares above. Open
  amount = `balanceDue + closedAmount` (ex-tax); share it over that bill's old plans by list price;
  each plan: value = list price, paid = list price − its share of the open amount. Old plan with no
  bill: value = paid = list price. Imported plan (`source:"import"`, no bill): value = paid = list price.
- Plan whose bill is missing (deleted, or empty `invoiceId` and no loaded bill names it):
  value = paid = 0 + data note.
- **Orphan bill** (its `membershipId`/`ptAssignmentId` plan no longer exists — member deleted with
  "keep bills"; only bills dated in the report window, since older unpaid bills are loaded for dues
  while their ended plans are not): `valueM + valueP − its PT payouts' trainer share` earned on the bill date + data note.
- `valueO` (other lines) is earned on the bill date.

### 4.2 Spreading over days (one function)

Item: `start`, `end`, `totalEnd` (original length), paused days (union), `V`, optional
`stopOn` (first day it no longer earns) and `F` (final lifetime value).
- Active days = days in `[start, totalEnd]` not paused; 0 or bad dates → all of `V` on `start` + note.
- Earned in `[a,b]` = `V × activeDays([a,b] ∩ [start, min(end, stopOn−1)]) / totalActive`.
- If `stopOn` is set: on `stopOn` book `F − earned before stopOn` (may be minus). Lifetime = `F`.

Used for:
| Case | totalEnd | stopOn | F |
|---|---|---|---|
| Normal plan | end | — | — (lifetime V) |
| Cancelled (gym or PT) | end | cancelledOn | paid − its share of refunds with the same `cancelId` (shared by paid amount) |
| Upgraded old plan (`upgradedTo`) | originalEndDate | new plan's start (= end+1) | V − the credit the new plan's bill really applied (not capped: a credit above what was paid is a loss on the upgrade day) |
| Superseded (status `expired`, another non-cancelled gym plan of the member starts after its start and on/before its end) | end | that plan's start | V (days given up; gym keeps it) |
| Trainer share of a PT plan (cost) | as the PT plan | as the PT plan | Σ current non-cancelled payout lines incl. minus adjustments; V = Σ non-adjustment lines using `beforeCancel` amount when present; no payout lines: `trainerShareAmount` only if the PT plan has a live bill and is not old-software, else 0 |

PT counts in income as **the gym's share**: PT income spread − trainer share spread (same as the
rest of the app: "the trainer's share is not gym income"). Trainer share is not an expense.

### 4.3 Monthly numbers (6 full months + this month so far)

- **Earned income (M)** = gym plans + PT gym share + other bill lines + `manualIncome`. Current
  month counted to today (`partial`, with `daysCounted`/`daysInMonth`).
- **Money received (M)** = Σ `payments.amount` by `paymentDate` + old bills (`paymentsTracked`
  false) by bill date. Shown under profit as "same as the Dashboard"; explains earned vs received.
- **Expenses (M)** = expense records dated in M (whoever paid). By category; custom categories kept for the page.
- **Profit (M)** = earned − expenses.
- **Has data (M)**: months from the month of the **first expense record** on. Earlier months show
  income but "no expense records yet" (no profit, not used in averages).
- **Average monthly expenses** = mean of the last 3 full months that have data ("based on N months"; none → null).
- **Average active members (M)** = Σ over days of M of members with a non-cancelled gym/PT plan
  covering that day ÷ days in M (2 decimals). Head count also kept for trends.
- **Income per member** = earned (last full month) / its average active members (null if month has no data or 0).
- **Break-even** = ceil(avg monthly expenses / income per member); null if unknown.
- **Active members (today)** = distinct members with a non-cancelled gym/PT plan covering T (paused count).
- **Advance (paid in advance by members)** = Σ over non-cancelled gym/PT plans with effective end ≥ T
  (incl. queued) of `max(0, paidEff − V × activeDaysUsed(start..T)/totalActive)`; `paidEff` =
  paid − credit for an upgraded old plan; superseded plans end at their cut.
- **Cash** (only when opening money set; D = opening date) = opening balance (at the START of D)
  + Σ payments.amount (paymentDate ≥ D) + Σ old bills' amountPaid (paymentsTracked false, invoiceDate ≥ D)
  + Σ manualIncome (date ≥ D) − Σ expenses paid by the gym (date ≥ D) − Σ staff-paid expenses
  settled (settledDate ≥ D) − Σ payouts with status paid (paidAt ≥ D, minus lines included). Nothing else.
- **Free cash ("really yours")** = cash − advance + the trainers' part of the advance − pending
  trainer payouts (status pending, incl. minus lines) − staff-paid expenses not yet settled. The
  trainers' part of unused PT days is owed once: to the trainer, or back to the member on a refund
  (the app then takes it off the trainer's pay), so it is not subtracted twice (review 2026-10-06).
- **Runway** = cash / avg monthly expenses; cash ≤ 0 → 0 ("money has run out", warning); unknown → null.
- **Renewal (M)**: gym plans (not cancelled, not upgraded, not superseded) ending in M, latest per
  member. Renewed = another non-cancelled, not cut-short gym plan of the member that started
  after this one, ends later and starts ≤ end + grace.
  Not renewed = none and end + grace < T. Else still deciding (shown, not counted). Rate =
  renewed / (renewed + not renewed), null if 0.
- **Left early (M)** = members with a gym plan cancelled in M and no other non-cancelled gym plan
  covering the cancel day or starting within grace after it.
- **New members (M)** = join date in M, except members whose every plan is old-software/imported.
- **Net growth (M)** = new − not renewed − left early (each member counted once per month).
- **Pending dues** = bills with balanceDue > 0, status not refunded/closed; late days from dueDate
  (else bill date): not due yet / 0–7 / 8–30 / 30+. Total equals the Dashboard's "Balance due".
- **PT per trainer** (this month so far, last month): PT income (full), trainer share, gym keeps, salary.

### 4.4 Layer 2 alerts

Running plan = non-cancelled, not superseded gym plan covering T (latest end if several). Visit
days = memberVisits days ∪ lastVisitDate. Tracked = thumb registered or a known visit (untracked
counted in a note). `from` = later of `thumbSince` and the start of the member's unbroken run of
plans (walk back through plans that ended within grace before the next one started).

| Alert (tab) | Rule | Money column |
|---|---|---|
| At risk ("Not coming") | running, not paused today, tracked; days since later of (last visit, from) minus paused days ≥ atRiskDays, OR dropping: from ≤ T−27, no pause in last 28 days, earlier-14-day visits ≥ 4 and last-14 ≤ half | "Next renewal worth" = plan value |
| Renewals | running plan ends in 0..renewalDays days, no later non-cancelled gym plan; Top priority if also at risk | "Renewal worth" |
| New members slipping | new member (4.3), joined 7..30 days ago, running, not paused, tracked or waiting for thumb, visit days since joining < newMemberMinVisits | "Plan worth" |
| PT chances | running, visit days in last 30 ≥ ptMinVisits, never a non-cancelled PT plan | "PT from" = cheapest active PT package |
| Cash | runway < runwayWarnMonths, cash ≤ 0, or active < break-even | reasons |

**Changes from the spec (shown on the page too):** the "dropping" rule needs ≥ 4 visits in the
earlier 14 days (with fewer, "half" is noise); new members are checked from day 7 (earlier is too
soon to judge); the profit card shows the last full month (this month so far underneath), because
rent and salaries are paid early in the month; PT counts as the gym's share.

Rows sorted by money, highest first; top-priority badge. Summary doc keeps count, total and the
top 20 rows per list; full lists (cap 1,000 rows, trimmed to stay under 800 KB with "showing N of M")
in `cfoReports/list-*`.

## 5. Layer 3: AI brief

- `buildBriefInput` fills the fixed type `CfoBriefInput` (allow-list): `currency`, `language`, `today`,
  `lastFullMonth` and `thisMonthSoFar` (earned, expenses, profit, received, renewal rate, new, lost,
  daysCounted/daysInMonth), `members` (active, break-even, above/below), `cash` (balance, really
  yours, advance, runway; or "not set"), `alerts` (count + money per list), `dues` (groups),
  `expensesByCategory` (10 built-in names; every custom category added into "Other (custom)"),
  `pt` (total gym share, trainer share, number of trainers), `rules` (thresholds). Values are
  pre-formatted strings exactly as the page shows them. Never: names, phones, IDs, bill numbers,
  per-trainer rows, salaries, custom category text, notes, package names.
- Privacy guard (backup): refuse if any run of 10+ digits, or any whole-word (case-insensitive)
  match of a client/trainer name part of 3+ letters that is not part of the fixed vocabulary.
  Status `blocked`, reason "personal data check" (no name saved).
- Prompt = spec text + "Judge 'Where you stand' on the last full month; mention this month only as
  so far. Write every number in 0-9 digits exactly as in the data (e.g. ₹1,90,000). Never use words
  for numbers, lakh or crore, another script's digits, or dates."
- `verifyBriefNumbers`: native digits mapped to 0-9; any lakh/crore/लाख/లక్ష/K/L next to a number
  → unknown; numbers taken as whole tokens (₹ , % stripped); each must be in the allowed set (every
  number in the input as digits, today's date parts, 1, 2, 3). Exact set match, never substring.
- At most **2 AI calls per brief** (timeout retry and number-check retry share them). Timeout =
  min(20 s, time left − 5 s); under 10 s left → `skipped`.
- Storage: OK briefs → `cfoBriefs/{date}-{HHmm}` and copied to `cfoBriefs/latest` (with
  `snapshotComputedAt`); every attempt updates `cfoBriefs/status` {at, status, reason}. Failed
  attempts never replace the OK brief. Page: newest OK brief + "Written Mon 6 Oct with that
  morning's numbers; numbers below are newer" when snapshot differs + small line about the last failed attempt.
- Fallback text: "AI summary is not available right now." + reason ("switched off in CFO settings" /
  "not set up yet" / "couldn't check its numbers" / "the AI service didn't answer") + "All numbers below are correct."
- Provider env: `CFO_AI_PROVIDER` gemini|openai|claude|off (off when its key is missing),
  `CFO_AI_MODEL` (default per provider), `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`.
  Keys only in headers (`x-goog-api-key`, `Authorization: Bearer`, `x-api-key` + `anthropic-version`).
  Saved errors: short code + HTTP status, ≤120 chars, key text stripped. `CFO_AI_BASE_URL`,
  `CFO_TODAY`, `CFO_MIN_REFRESH_SECONDS` are honoured **only when `FIRESTORE_EMULATOR_HOST` is set**.
- When: morning cron makes one if there is no OK brief since this week's Monday (retries daily);
  "New AI summary" button: max 3 per day.

## 6. Server, limits, files

- `POST /api/cfo/refresh` (numbers only), `POST /api/cfo/brief` (summary from the saved snapshot).
  401 no login / portal token; 403 no Finance; JSON errors always (handler wrapped).
- One lock for everyone (transaction on `cfoReports/latest`: `runningSince`, `computedAt`):
  recompute at most once per 10 min (settings save and cron included; cron skips if fresh).
  Reply says when Refresh is possible again. Brief counter `manualBriefs {date, count}`.
- Deadline per request (start + 50 s). Numbers saved before any AI call. Page treats non-JSON / 504
  as "Still working it out. Try again in 2 minutes."
- Reads per refresh (1,000 members, 3,000 plans, 150 visits/day): memberships `endDate ≥ windowStart`
  (~1,500) + `endDate == ""`; ptAssignments all (~300); trainerPayouts all (~350); invoices getAll
  plan bills + `invoiceDate ≥ windowStart` + `balanceDue > 0` + `paymentsTracked == false`
  (~1,500 de-duplicated); payments `paymentDate ≥ min(D, 1st of last month)` (~600) + `kind == "refund"`;
  expenses `date ≥ min(windowStart, D)` + `settledDate ≥ D`; `expenses orderBy date limit 1`;
  manualIncome `date ≥ min(windowStart, D)`; clients getAll referenced (~1,000); memberVisits getAll
  members with a running plan or new (~500); trainers, ptPackages, staffPrivate getAll (small).
  ≈ 6–7k reads; report stores `readCount`.

Files — new: `src/lib/cfo/{types,dates,money,plans,numbers,alerts,brief,index}.ts` + `*.test.ts`;
`src/server/{cfo-data,ai,cfo}.ts`; `src/services/cfo.service.ts`; `src/routes/_authenticated/cfo.tsx`;
`src/components/cfo/*`. Changed: `src/server/router.ts`, `automation.ts` (morning step),
`admin.ts` (health: AI set/missing), `firestore.rules`, `src/services/firestore.service.ts`
(COLLECTIONS), `src/constants/navigation.ts` (Workspace, after Income & Expenses: "CFO"),
`src/constants/features.ts` (`/cfo` → finance; Finance hint mentions the CFO page),
`src/lib/audit-describe.ts`, `package.json` (`"test:cfo": "node --test \"src/lib/cfo/**/*.test.ts\""`),
`.env.example`, README env table.

## 7. Page (`/cfo`)

Plain words; spec names as small grey sub-labels.
1. Header: "Worked out 8:02 AM today" (amber if > 26 h old), Refresh (disabled with reason during
   the 10-min lock), Settings. No snapshot yet: "Work out my numbers".
2. Health cards, each with a word (Good / Watch / Problem) so colour is never the only signal:
   - "September: Profit ₹X" (last full month; green > 0, red < 0) + grey "October so far (6 of 31
     days): earned ₹A · spent ₹B · received ₹C (same as Dashboard)".
   - "Members 120 · need 100 to cover costs" (green ≥ +10 %, amber within 10 %, red below).
   - "All gym money (bank + UPI + cash)" — not the Day Book drawer (red ≤ 0).
   - "Money that is really yours" (red < 0 "You have spent ₹X of members' advance money", amber < 1 month of expenses).
   - "Months you can run with no new money" (red < warn, amber < 2× warn). Grey = not enough data.
   Cash cards ask for opening money until it is set.
3. "This week's summary" card (date, provider, notes from §5) or the fallback.
4. Problem tabs as a sideways chip row with counts; header sentence with the money ("38 members
   not coming for 14+ days. Their next renewals are worth ₹1,90,000."). Rows: name, ID, phone,
   plan, end, last visit, money (per-tab column name), reason; Call (`tel:`), WhatsApp (`wa.me`,
   `normalizeWhatsAppPhone`, fixed factual text, no offers); on tap re-check live (1–2 reads):
   already renewed / paid / came today → say so instead of opening WhatsApp. Excel + Print per tab.
   Phone: cards; desktop: table. List loaded when the tab opens.
5. Trends (6 months + this month): earned vs expenses, new vs lost (not renewed = "Blacklist", left
   early), renewal rate; months without expense records greyed; small table under each chart.
6. "How these numbers are worked out": each number, one line + rupee example; changes from the spec;
   expenses by category; PT per trainer; data notes; "Active today includes PT-only members and
   plans waiting for a thumb; Dashboard counts only active gym plans".
7. Settings dialog: "Total gym money at the START of [date]: bank + UPI + card + cash drawer, before
   any payment or expense that day" (no future dates; tip: last night's bank balance + this
   morning's drawer), thresholds, AI on/off, language. Save → "Work out the numbers again now?".
Permission-denied on read → "CFO is being set up" (no console error spam).

WhatsApp texts (facts only): not coming — "Hi {first}, we haven't seen you at {gym} for {n} days.
Is everything okay? Your plan runs till {end}."; dropping — "Hi {first}, we've missed you at
{gym} lately. Is everything okay? Your plan runs till {end}."; renewal — "Hi {first}, your {gym}
plan ends on {end}. Reply here or visit the front desk to renew."; new — "Hi {first}, welcome to
{gym}! How are your first weeks going? Ask at the front desk if you'd like help with a workout
plan."; PT — "Hi {first}, great to see you training so regularly at {gym}! If you'd like a
personal trainer, ask at the front desk."; dues — "Hi {first}, a balance of ₹{live balance} is
pending on your {gym} bill {number}. Please pay at the front desk or reply here."

## 8. Tests and proof for the 10 checks

- Unit (`npm run test:cfo`): every formula and edge case: ₹0 bill, 100 % discount, tax bill,
  gym+PT bill, part payment, pause (stacked), cancel with no/part/full refund (income and trainer
  share), upgrade after 165 days / day 1 / future-dated (Σ earned = Σ kept), superseded plan,
  old-software gym+PT on one bill, orphan bill, missing bill, missing end date, brand-new gym,
  February, Number.isFinite over the whole snapshot, profit = earned − expenses exactly, rounding,
  brief input allow-list, privacy guard, number check (₹90,000 vs ₹1,90,000; "1.9 lakh"; Telugu digits).
- Emulator e2e (session scratchpad): `cfo_seed.py` seeds the spec's test data for a fixed
  `CFO_TODAY`; `cfo_expected.md` = independent hand calculation (written without reading the
  engine code); `cfo_local.py` refreshes through the API and compares every number and list;
  `fake_ai.py` records requests (normal / invents a number / uses lakh / slow 25 s / 500);
  `cfo_access_local.py` (no token 401, member-app & trainer-app tokens 401, desk 403, manager 200,
  direct reads of `cfoReports/*`, `cfoBriefs/*`, `cfoSettings/main` denied for desk/portal, writes denied).
- Playwright as owner (light/dark, 390/1440) and desk; console errors collected.
- Regression: the old kit (`regress_merge.sh` suites + journey + search + gym_pc) with the HANDOFF
  counts, plus `cfo_regress_local.py` (front desk at 390 px: join with payment, balance payment,
  hand-marked visit, machine punch via /iclock, expense in Day Book and Income & expenses, trainer
  payout paid → owner Refresh shows each change), and the morning cron with the CFO step throwing
  and timing out (reminders still go out).

| Check | Proof |
|---|---|
| 1 Earned income | unit + e2e vs hand calc (yearly plan spread) |
| 2 Profit | unit + e2e (profit = earned − expenses, exact) |
| 3 Break-even | unit + e2e + page text above/below |
| 4 Advance, free cash | unit + e2e incl. part-payment plan and paused member |
| 5 Cash, runway | Playwright: save opening money; payment + expense in the app; Refresh; exact change |
| 6 Renewal rate, net growth | unit + e2e (incl. left early) |
| 7 Pending dues | unit + e2e + page; total = Dashboard "Balance due" |
| 8 Alerts | unit + e2e exact members; paused member never at risk |
| 9 AI brief | fake AI: OK brief numbers ⊂ its snapshot; request has no names/phones/custom categories; AI off / failing / inventing → page works with fallback |
| 10 Safety | access tests + regression + 390 px no sideways scroll + no console errors |

## 9. Limits (written down)

- Numbers refresh each morning or on Refresh (max once per 10 min), not live.
- Upgrade credit and old-software plans use list prices where the real price is unknown.
- Members deleted with their accounts vanish from history.
- Income excludes GST (tax is off today); cash includes it.
- Real AI only with the user's key; build and tests use the fake AI.
- Not in v1 (spec): forecasts, what-ifs, WhatsApp brief, gym comparison; also Member Calls call-status sync.
