# Handoff

Last updated: 2026-10-10 (Cash + UPI split payment, old-software records check; branch split-pay)

## 2026-10-10: Cash + UPI split payment and the "paid in the old software" check (branch `split-pay`, local)

**State** (spec `docs/superpowers/specs/2026-10-09-split-payment-old-software-check-design.md`)
- **Cash + UPI:** "Paid by" has a 5th choice at checkout, Collect balance and Edit payment
  (`src/components/billing/pay-mode-field.tsx`; total + "Cash part", UPI = rest). Saved as TWO
  payments (UPI part first) sharing `splitId` (`src/lib/split-pay.ts`), so Day Book cash /
  Collected by mode / CFO / Excel need no change; allocation shared with `shareOut` (adds up
  exactly, no −₹0.01). Bill `paymentModes` → "UPI + Cash" (bill page, PDF, Billing, Excel); rows
  tagged "(part of Cash + UPI)". Edit payment edits a pair as one (`payment-split.service.ts`:
  split / re-balance / merge, total fixed, rights checked on every part); Paid on (Edit plan) moves
  both; Undo (toast or row) takes both back; Remove refuses one part ("choose one mode first");
  late-sales tool and the old-software move keep a pair together (move clears the link on the part
  left and fixes the bill's label; Undo restores). Fixes the October rows Aniket / K. Sudheer:
  owner opens the payment → Cash + UPI.
- **Old-software check (no fixed date, user: "mostly from Oct 5, don't depend on it"):** the old
  software's own records decide (`oldPlanInRecords` in `src/lib/old-data.ts`). Checkout: ticked
  "Paid in the old software" with no old plan for those days → amber warning + "Paid here
  (untick)" + a confirm on save. Edit plan / Edit PT plan: note. Income & expenses → Profit &
  income: list "Saved as paid in the old software, not in its records" (Roshan, P. Joshi,
  K. Sri Devi should show; fix = Remove plan + sell again with the right mode).
- Another session committed ad5d841 (old plan lock only for the same kind) onto this branch by
  mistake; the same change is on main as 57f5a2b, so merging main is clean. Its Edit plan
  "Already paid" skips split payments.
- Checks: tsc clean, unit 312/312, build OK; emulator suite `split_local.py` 34/34 (harness in
  session scratchpad fc9b07bc…/scratchpad/harness, `bash regress.sh split_local.py`; screenshots
  light/dark 390/1440 in `shots_split/`); regressions paidon 15/15, paidon_edit 13/13, latedates
  26/26, remove 39/39, moneyfix 21/21, audit2 27/27, audit9 23/23, undo_refund 43/43, oldlock 8/8.
  Old suites now pick mode chips with `exact=True` ("Cash + UPI" contains "UPI"). Reviewer agent
  (money): 7 findings, all fixed.
- Not done: Create bill (other items) has no Cash + UPI at entry (split it after in Edit payment).

### Next
1. User OK → merge `split-pay` into main, push (Vercel deploys). No rules change needed.
2. Owner: split Aniket and K. Sudheer's October payments; check the new owner list and fix the
   October old-software rows.


## 2026-10-10: a plan still running in the old software no longer locks a new sale

**State**
- **Bug (how a new ₹10,000 PT was saved "paid in the old software"):** a member whose old-software
  gym annual plan still runs bought PT here; checkout locked "Paid in the old software" and the old
  plan's dates. Now (`enrollment-wizard.tsx`): the lock applies only to a sale of the same kind as the
  old running plan (`isOldPtPlanName`: PT ↔ PT, gym ↔ gym), and staff can press **"No, this is new money
  paid here"** (undo: "Carry the old plan instead"); unlocking resets the start day and old amounts.
  Complements the split-payment chat's "old-software records check" (that one warns when the tick is
  on and NOT locked).
- Committed alone on top of 3ee9f44 (index-only stage: HEAD + this fix); checked in a separate worktree
  (tsc, eslint, unit 295/295). Emulator `oldlock_local.py` 8/8 (scratchpad 32d649c3…).
- **Another chat is building Cash + UPI split + old-software records check in this same folder**
  (plan `docs/superpowers/plans/2026-10-09-split-payment-old-software-check.md`, uncommitted files).
  Its working copy already contains this fix. Commit only your own files.
- Manual October fixes (owner): all steps work, see the chat reply of 2026-10-10.

## 2026-10-09 (later): "Paid on" can be corrected later; "This month" list numbered and filterable

**State**
- **Paid on after saving:** `src/components/clients/paid-on-field.tsx` (`usePaidOn` + `PaidOnField`) in
  Edit plan and Edit PT plan: the plan's checkout payment (kind initial, same bill, not old software). It
  follows a corrected start day when it was paid on the old start day (unless picked). Rules in
  `paymentDateRights` (payment-edit.service): front desk = a payment typed in today; owner = any day from
  the 1st of last month; Edit payment uses the same rule now (before: owner only). Owner moves also move
  the sale's pending trainer payout date (not used in any total; rules let only Finance update payouts).
- **This month / Collected lists** (`number-details.tsx`): rows numbered 1…n (all drawer lists); mode chips
  are toggle filters (several at once, × on picked, "Show all"), summary shows the filtered total.
- "2 days strength" package: created by a front-desk staff login on 9 Oct 2026 17:04 IST, used once a
  minute later (read-only check, `prod_package_who.mjs`; the audit log keeps the name).
- Owner guide in Telugu-English for the October fixes: chat reply of this date (names; not in git).
- Checks: tsc + eslint clean (2 fast-refresh warnings, same kind as before), unit 295/295, build OK;
  emulator `paidon_edit_local.py` 13/13 (owner Edit plan: follows start, only-date change; Edit PT plan
  moves the payout; desk locked on an older payment, fixes today's entry at 390 px; list numbers +
  UPI / UPI+Cash / Show all), and paidon 15/15, latedates 26/26, renew_pt 26/26, update 6/6, audit2 27/27,
  remove 39/39, plans_end 12/12, moneyfix 21/21, audit9 23/23.

## 2026-10-09 (late): PT-only reminders, phone "Tap to refresh", "Paid on" at checkout, October check

**State**
- **PT-only renewal reminders:** `processRenewalReminders` reads PT plans (active/pending) with gym plans;
  same one-per-member rule (the plan that ends last). PT reminder rows carry `ptAssignmentId`.
- **Phone / tablet (< 1024 px) update button:** `src/components/layout/new-version-bar.tsx`, bottom centre,
  16 px above the bottom tab bar (staff "Quick navigation" / portal "Sections"), else above the home bar;
  top bar button and the toast only on larger screens.
- **"Paid on" at checkout** (replaces "When was it paid? first day / Today"): date field, default = the
  plan's first day when it started before today, else today; from the 1st of last month to today; not for
  upgrades. A plan whose start date staff left alone (new joining / expired member) starts on the paid day;
  a new member whose plan started earlier gets that day as `joinedOn`. Payment gets `paidOnChosen: true`
  (late-sales tool never moves it). `latedates_local.py` updated to the field.
- **October register vs app (read-only check, nothing changed):** app ₹1,57,070 (41 payments) vs sheet
  received ₹1,54,949: +₹2,121 explained row by row (₹1 package prices ×26 −₹26; one member ₹2,500 monthly
  in the app vs ₹300 PT day on the sheet +₹2,200; one ₹2,499 vs ₹2,000 +₹499; one ₹1,799 vs ₹1,750 +₹49;
  one PT member's ₹6,000 renewal not entered, ₹1,000 old balance instead −₹5,000; 3 sheet rows not in the app
  −₹4,600; one ₹8,999 paid in the app is "₹9,000 due" on the sheet +₹8,999). Modes: 3 October payments were
  saved "paid in the old software" (₹14,499) though the sheet has them as PhonePe/cash; 2 part-cash
  payments saved all UPI. Row list (names, not in git): session scratchpad bc809a92… `october_check.md`;
  data fixes left to the owner.
  Read-only script: session scratchpad bc809a92… `prod_oct_money.mjs` (writes a local JSON only).
- Checks: tsc + eslint clean, unit 295/295, build OK; emulator `paidon_local.py` 15/15 (new member paid
  yesterday, staff-picked start kept, future refused, PT-only reminder from the morning job, phone button
  16 px above the tab bar + tap reloads, desktop keeps the top button), latedates 26/26 (updated),
  renew_pt 26/26, update 6/6, audit2 27/27, remove 39/39, plans_end 12/12, moneyfix 21/21, audit9 23/23.
  Suites now accept "No gym membership here yet" (PT-only empty state).

### Next
1. Owner/front desk: fix the October rows listed (or ask Claude to do them in the owner's browser).
2. Decide: package prices ₹1,999/₹2,499/₹9,999 vs the round amounts actually taken.
3. Maybe build: split payment at checkout (part cash, part UPI); today: enter the UPI part, then
   Collect balance in cash the same day.

## 2026-10-09 (night): owner-reported bugs (K. Mothilal renewal, PT dates/discount, Android app update)

**State**
- **1 Renew blocked (real member, K. Mothilal):** his only plan here was the PT plan carried over from
  the old software (15 Sep → 14 Oct). The Renew window looked only at gym plans, so it thought he had
  nothing here, forced the old running plan again (start locked to 15 Sep, "paid in the old software")
  and the save was refused. Now: PT plans count as plans here (`ptPlans` in enrollment-wizard.tsx);
  renewal is offered from the day after the last plan of the kinds being bought (`renewMin` /
  `renewStart`), PT-only renewals too; "Current plan: PT · … ends …". A member whose old plan is not in
  the app yet still carries it first; the note now says "Save this one first, then press Renew again".
- **Member page:** a PT-only member shows "PT plan running" + current = the PT plan (was "No active plan"
  / "No membership records yet"); empty state offers "Renew / add package".
- **2 PT dates + PT discount:** PT box has PT start / PT end (default = plan start, PT package length =
  the gym plan's dates when both are the same length; editable, end ≥ start, start after a running PT)
  and "PT discount ₹" (max = PT package max, else its price). The PT discount lowers the PT line on the
  bill (`ptGross` = after discount) and the trainer share is worked out on that price (₹6,000 − ₹1,000,
  35% → ₹1,750). PT plan keeps `ptListPrice` + `ptDiscount`; member page shows "package ₹6,000 · ₹1,000
  discount" (`planMoney(..., ownDiscount)`). The bill's own Discount stays a whole-bill discount
  (split by price as before). Helpers `ptDiscountOf` / `ptNetPrice` / `maxPtDiscount` in
  enrollment.service.ts.
- **3 Android app stuck after an update:** the error page's "Try again" retried the old version's
  deleted page files forever (only closing the app helped). Now a stale build shows "The app was updated
  → Open the new version" (full reload); the app also loads a newer version when it is sent to the
  background or brought back (visibilitychange / pageshow / focus), not only after 20 s idle. Portal
  error "Go home" stays on the member's / trainer's own page.
- Checks: build OK, tsc + eslint clean, unit 294/294; emulator (harness scratchpad 32d649c3…,
  `bash regress.sh <suite>`; `rerun.sh` = same without rebuilding) `renew_pt_local.py` 26/26 (K. Mothilal
  case end to end as owner, PT dates/discount, member page, phone width), `update_local.py` 6/6
  (background update, no loop, stale page files → "Open the new version"); regressions audit2 27/27,
  remove 39/39, plans_end 12/12, moneyfix 21/21, audit9 23/23. Dark shots 390/1440 in
  `shots_renew_pt/`. Pushed to main.
- Not done (decide): PT-only members get no expiry/renewal WhatsApp reminder (reminders read gym plans
  only); a PT plan can still be sold over another running PT plan by script (the window refuses it).

### Next
1. User: refresh any open app tab once (older tabs); installed phone apps update by themselves now.
2. Owner: renew K. Mothilal again (Renew → it starts 15 Oct).
3. Still open: K. Sri Devi's cancelled PT (owner); M. Rohith's package (owner); P. Sai Ram clean-up.

## 2026-10-09 (late night): audit 9, cancelling one plan of a gym + PT bill

**State**
- Undo fix 9e93f72 confirmed live (`/api/version` = `9e93f7267129`) before starting.
- **9 (user chose "split by price"):** cancelling one plan of a gym + PT bill, with "Stop asking" ticked,
  drops only that plan's unpaid part by price (₹2,500 + ₹12,000, ₹5,000 paid, ₹9,500 due; PT cancelled →
  ₹7,862 dropped, ₹1,638 still asked). Stored per cancel on the bill: `cancelledParts[cancelId] =
  {kind, amount, paidThen}`, sum `cancelledDue`; balance everywhere = total − paid − cancelledDue.
  Rules in `src/lib/bill-cancel.ts` (unit-tested). Later payments count all for the running plan (no
  trainer share for a cancelled PT). Restore/Undo asks again; refused while money collected after the
  cancel is still on the bill ("Remove that payment first"). Removing/undoing a payment made BEFORE the
  cancel is refused ("Restore that plan first"). Edit payment amount, Edit bill discount, Edit plan
  price (bill untouched), Check & mark and old-balance edits are blocked on such a bill (like Closed).
  Public bill shows "Not asked (plan cancelled)". CFO counts it with closedAmount. No rules change.
- Checks: build OK, unit 293/293, tsc + eslint clean; emulator `audit9_local.py` 23/23 (scratchpad 32d649c3…,
  `bash regress.sh audit9_local.py`), undo_refund 43/43, remove 39/39, moneyfix 21/21; shots in `shots_audit9/`.
  Reviewer agent (money): 3 real findings fixed (pre-cancel payment removal, Restore after a later
  payment, double write on Restore) + CFO closedAmount on restore.
- Left as notes (not fixed): the cancel writes use the dialog's copy of the bill (a payment collected
  by someone else while the window is open is not seen; same as the old Close path); Restore keeps the
  old pay-by date, so a past date means no reminder for the restored part (same as Closed restore);
  member app shows no "dropped" row; pre-existing: undoing old-software "Check & mark" puts the old
  bill back without looking at a cancellation since.

### Next
1. User: refresh any open app tab once.
2. Still open: K. Sri Devi's cancelled PT (owner); M. Rohith's package (owner); P. Sai Ram clean-up.
3. Later audit items: 7 (CFO values old plans at today's price), 10 (member app display), 11–13, 15
   ([audit](MIGRATION_AUDIT_2026-10-09.md)).


## 2026-10-09 (night): `undo_refund_local.py` fixed, one real bug found

**State**
- Suite now 43/43 (harness scratchpad 32d649c3…, `bash regress.sh undo_refund_local.py`). Line 142 was
  stale: the owner gets **Remove** on a payment, not the same-day Undo. The refund-cap section was stale
  too (audit 5 caps a refund per plan: gym ₹2,500 of the ₹14,500 bill), rewritten to check that.
- **Real bug (live since 44275eb):** Undo on the "plans cancelled" message left the member's summary
  `cancelled` (plans ran again). `restoreCancellation` compared with the member as they were before the
  cancel and skipped the write. Fixed in `plan-cancel.service.ts` (always writes). Local commit on main,
  NOT pushed. Unit 282/282, tsc clean. Members hit by this get healed by the morning `rollPlans`.

### Next
1. User: OK to push main (Vercel deploys the Undo fix)?
2. Still open: K. Sri Devi's cancelled PT (owner); M. Rohith's package (owner); P. Sai Ram clean-up.
3. Later audit items: 7, 9, 10, 11–13, 15 ([audit](MIGRATION_AUDIT_2026-10-09.md)).


## 2026-10-09 (evening): migration audit items 2, 4, 8 (branch `audit-fixes-2`, local)

**State**
- **LIVE:** with the user's OK, main fast-forwarded to `audit-fixes-2` (includes `audit-fixes-1`) and
  pushed; `/api/version` = `55362080dad3`, `/api/health` OK (AI keys still unset: CFO env pending).
- Branch `audit-fixes-2` = `audit-fixes-1` (a902f4c) + 44275eb, 14a7fc7, 02f445a.
  No rules change (plans are writable by any staff login). Plan: [docs/superpowers/plans/2026-10-09-audit-fixes-2.md](superpowers/plans/2026-10-09-audit-fixes-2.md).
- **8 One current-plan rule:** `src/lib/current-plan.ts` `pickCurrent` (running today, latest start → next
  upcoming → latest ended → latest cancelled), used by the sale, thumb (app + machine), Edit plan,
  Cancel/Restore, Remove, Excel import, member lists (`planByClient`) and the member app.
  The morning `rollPlans` now reads each member with a live plan and corrects a wrong
  `currentMembership` (first morning after deploy fixes old wrong ones; later only real changes).
  A member with only an upcoming plan now has it as current (status `pending`).
- **2 / 14 Overlaps:** `src/lib/plan-overlap.ts`. A sale (incl. Add old plan) or Edit plan whose gym
  dates overlap another counted gym plan is refused with the plan's name and what to do. Not refused:
  the upgraded plan, plans a renewal / upgrade ended, pairs marked "Not a duplicate", and (Edit plan,
  backdated upgrade) days that were already shared before. Old plans whose dates are all past are saved
  `expired` (PT `completed`), so they never become current or end the running plan.
  Owner list **Plans that overlap** on Income & expenses (`GET /api/old-data/overlaps`, plans ending on
  or after the 1st of last month) with Open member / **Not a duplicate** (field `overlapOk` on both
  plans, Undo; updatedAt left alone for Remove's same-write check).
- **4 "Paid in the old software?"** also lists PT plans sold alone, matches old CSV plans by kind (PT ↔
  PT), and flags a sale over an old-software plan already in the app ("Already in this app as an
  old-software plan …", strong). **Check & mark** works on a PT-only bill (`OldMoveTarget` in
  `old-software.service.ts`; PT plan marked, trainer share cancelled, old payment on the PT plan, Undo).
  Not done: looking back before the 1st of last month (closed Day Book months can't be moved anyway).
- Checks: `npm run build` OK; regressions remove 39/39, plans_end 12/12, moneyfix 21/21, audit 22/22.
- Unit 282/282 (`npm run test:cfo`, new `current-plan.test.ts`, `plan-overlap.test.ts`),
  tsc + eslint clean on changed files. Emulator suite `audit2_local.py` 27/27 (scratchpad 32d649c3…,
  `bash regress.sh audit2_local.py`; regress.sh now stops the :5199 server BEFORE building, else EBUSY),
  screenshots light/dark 390/1440 in its `shots/`. Reviewer agent (money): 1 real finding (overlap
  rule refused edits next to older-style renewals / Not-a-duplicate pairs), fixed in 02f445a. Left as a
  note: when all of a member's live plans end the same morning, `rollPlans` picks "latest ended" among
  those only (an older expired plan with a later end date would be skipped; rare).

### Next
1. User: refresh any open app tab once. Tell the front desk: old balances need the tick on the bill
   before WhatsApp reminders (audit 1); a plan over another plan's dates is now refused with a message
   saying what to do. After tomorrow's morning cron, the owner checks Income & expenses → "Plans that
   overlap" and "Paid in the old software?".
2. (Done, see night section.)
3. Still open: K. Sri Devi's cancelled PT (owner); M. Rohith's package (owner); P. Sai Ram clean-up.
4. Later audit items: 7 (CFO values old plans at today's price), 9 (gym+PT bill open after partial
   cancel), 10 (member app display), 11–13, 15.

## 2026-10-09 (afternoon): migration audit items 1, 3, 5, 6 (branch `audit-fixes-1`, local)

**State**
- Branch `audit-fixes-1` from main 58b7b0d. NOT merged, NOT pushed. No rules change needed
  (invoices aren't field-restricted), so nothing to deploy besides the code.
- **1 Old balances:** the morning cron skips a bill whose only line is "Balance from the old
  software" unless staff ticked **Send WhatsApp reminders for this balance** (bill field
  `remindOldBalance`) or part of it was collected here. The tick is in Add old plan, the join
  wizard ("Paid in the old software" with a balance) and **Edit bill** (old-balance bills only;
  not copied to the public bill link). Existing old-balance bills in production have no tick, so
  their reminders stop until staff confirm. Rule: `src/lib/reminders.ts` `remindsBalance`.
- **3 Expiry reminders:** one per member, for the plan that ends last (`renewalReminderPlans`);
  two running plans ending the same day = one message; same plan picked every run.
- **5 Refund cap:** always capped now: what was paid here for these plans + what was paid in the
  old software (old payment records first, else the plan's `oldSoftwarePaid`; a gym+PT pair counts
  once) − refunds already given (`refundLimit` in `src/lib/plan-money.ts`). `paidForPlans` also adds
  the old money for an old plan that has a balance bill. Cancel box shows "₹X of it in the old software".
- **6 Joining incentive:** skips old-balance, closed and refunded bills, and sales later found paid
  in full in the old software (`countsAsJoining`, `staff-pay-section.tsx`).
- Checks: unit 257/257 (`npm run test:cfo`, new `reminders.test.ts` + refund tests in
  `plan-money.test.ts`), tsc + eslint clean, `npm run build` OK. Emulator suite `audit_local.py`
  22/22 (scratchpad e7851dff…, `bash regress.sh audit_local.py`), screenshots light/dark 390/1440 in
  its `shots/`. Regression: plans_end 12/12, remove 39/39, moneyfix 21/21; undo_refund passed its first 18
  checks then hit its known line-142 crash (as before).
- Not browser-tested: the tick in Add old plan and the join wizard (needs old-software CSV data);
  they reuse the Edit bill component and tsc covers the wiring.

### Next
1. User: OK to merge `audit-fixes-1` into main and push (Vercel deploys it). Tell the front desk:
   old balances get no WhatsApp reminders until someone ticks the box on the bill (Edit bill).
2. Fix audit items 2, 4 and 8 ([audit](MIGRATION_AUDIT_2026-10-09.md)).
3. Fix `undo_refund_local.py` (line 142).
4. Still open from before: owner removes K. Sri Devi's cancelled PT; M. Rohith's package (owner);
   P. Sai Ram clean-up.

## 2026-10-09 (midday): Remove is live

**State**
- With the user's OK: `remove-plan` fast-forwarded into main (ea3f254) and pushed. Vercel serves it:
  `/api/version` = `ea3f254215e2`, `/api/health` OK (AI keys still unset: CFO env pending).
- Checked again before the merge: unit 240/240, tsc clean, `npm run build` OK.
- Firestore rules deployed to `rebuildfitos` (ruleset 1e78f5b2…; read back = the file). Before it, the
  live rules equalled main's old file except the trainerPayouts `deletePlans` lines, so only those
  changed. Backup of the previous live rules (ruleset 02b1b06a…):
  scratchpad fe259a89…/`live_rules_backup_2026-10-09.txt`; scripts `read_live_rules.mjs`,
  `deploy_rules.mjs` there.
- A staff login with the "Plans added by mistake" switch can now remove PT plans too.
- `stash@{0}` (step 2 cancel choice, superseded) is still kept; drop it once the owner has used Remove
  and is happy (`git stash drop stash@{0}`).
- Branch `remove-plan` kept (same commit as main).

### Next
1. Owner: refresh any open app tab once, then remove K. Sri Devi's cancelled PT (bin icon on the
   member page) and check the Dashboard "paid and given back" pair is gone. Report anything odd.
2. Fix audit items 1, 3, 5 and 6 (reminders for old balances, double expiry reminders, refund cap,
   joining incentive), then 2, 4 and 8 ([audit](MIGRATION_AUDIT_2026-10-09.md)).
3. Fix `undo_refund_local.py` (line 142).
4. Still open: M. Rohith's package (owner); P. Sai Ram clean-up (Remove makes it easier).

## 2026-10-09 (morning): "Remove (added by mistake)" built (branch `remove-plan`, NOT merged / pushed)

**State**
- Built from [the plan](superpowers/plans/2026-10-09-remove-plan.md), Tasks 1-5. Commits 5bd4a57 … bc980a5
  on `remove-plan` (branched from the docs commit 4babd4d = main + docs).
- Step 2 leftovers stashed with the user's OK: `stash@{0}` "step2 cancel choice (superseded)". Drop it
  once the user confirms Remove is what they want (`git stash drop stash@{0}`).
- What it does: the bin icon "Remove <plan> (added by mistake)" on running, upcoming and cancelled gym
  plans (Active card + Membership history) and PT plans, for the owner, or a staff login with the new
  delete switch "Plans added by mistake" (`deletePlans`, Staff page).
  - The whole sale goes to the Recycle Bin (new section "Plans") in one transaction: plans on its bill,
    the bill + public link, payments, the refunds of its own cancellation, old-software payments,
    trainer payouts, joining record.
  - The plans it changed come back: an upgrade's old plan gets its end date back; a plan a renewal ended
    runs again.
  - Undo / Restore puts it all back.
  - Pure maths: `src/lib/plan-remove.ts`. Writes: `src/services/plan-remove.service.ts`.
  - Dialog: `src/components/clients/remove-plan-dialog.tsx`.
  - The Cancel box now says "Added by mistake? Don't cancel: use Remove (bin icon)" (staff without
    the switch: "ask the owner to remove it").
- New sales stamp `endedBy` + `statusBeforeSale` on plans they end (`enrollment.service.ts`).
  - Older sales: a plan only comes back if its last change has the exact time of the sale's creation
    (the same write).
- Refused, with what to do instead:
  - trainer already paid;
  - a non-old payment in a closed Day Book month;
  - cancelled together with a plan outside the sale;
  - an upgrade whose old plan is cancelled or gone;
  - a plan upgraded since (remove the upgrade first).
- Restore is refused when:
  - a plan it put back was changed since (cancelled, upgraded, renewed, dates edited);
  - the member is deleted;
  - part of it is already back;
  - money falls in a closed Day Book month.
- Other guards added:
  - a removed payment can't come back without its plan (`putBackPayment`);
  - old-software "Undo" refuses a removed plan;
  - the member's joining-record link moves to an earlier record still waiting for a thumb (or none).
- `firestore.rules` changed locally (trainerPayouts read + delete also `can('deletePlans')`). **NOT
  deployed.** Until it is deployed, a staff login with the switch is told to ask the owner for PT plans.
  Gym plans and the owner work without it.
- Tests:
  - unit 240/240 (`npm run test:cfo`);
  - tsc and eslint clean; `npm run build` OK;
  - emulator suites (scratchpad b6110210…, `bash regress.sh <suite>`):
    - `remove_local.py` 39/39 (Sri Devi's case, gym + PT bill, stamped/older renewal, upgrade, old plan,
      refusals, review fixes, staff with/without the switch, a real sale writing the stamp,
      Undo + Recycle Bin restore);
    - plans_end 12/12, moneyfix 21/21, latedates 26/26;
    - olddates 64/64 (its 6 stale checks are fixed);
    - `undo_refund_local.py` still crashes at line 142 (waits for an "Undo" button on the Payments
      list), as before this work.
  - Screenshots light/dark 390/1440 in `shots_remove_keep/`.
- Reviewer agent (money): 5 confirmed findings, all fixed in bc980a5. Left as notes:
  - a login with only the Recycle Bin page can't restore a PT sale (payout read rule; same as member
    restores);
  - a payment recorded during the seconds of a removal could be left behind;
  - an upgrade put-back ignores pause days added to the old plan after the upgrade.

### Next
1. User: OK to merge `remove-plan` into main and push (Vercel deploys)? OK to deploy the rules change
   (Rules REST API, scratchpad `rules_deploy.mjs` pattern)? Then the owner removes K. Sri Devi's cancelled
   PT (bin icon) and checks that the Dashboard pair is gone.
2. Fix audit items 1, 3, 5 and 6 (reminders for old balances, double expiry reminders, refund cap,
   joining incentive), then 2, 4 and 8 ([audit](MIGRATION_AUDIT_2026-10-09.md)).
3. Fix `undo_refund_local.py` (line 142).
4. Still open: M. Rohith's package (owner); P. Sai Ram clean-up (Remove makes it easier).

## 2026-10-09 (after midnight): "Remove (added by mistake)" designed; migration audit done

**State**
- New user request (K. Sri Devi): a PT plan added by mistake could only be cancelled and refunded,
  which books a sale and a refund that never happened. The user wants "remove what we added",
  everywhere.
- Design approved in chat, written as a plan:
  [docs/superpowers/plans/2026-10-09-remove-plan.md](superpowers/plans/2026-10-09-remove-plan.md).
  - Remove = the whole sale goes to the Recycle Bin (plans on the bill, bill, payments, refunds,
    trainer share, joining record), and earlier plans the sale cut short come back. Undo / Restore
    puts it all back.
  - Access: the owner always; the owner can switch it on per staff login ("Plans added by mistake").
  - NOT built yet.
- Next step 2 from the late-night list (a cancel choice for old-software money) was built first:
  cancelold 11/11, plans_end 12/12, moneyfix 21/21, latedates 26/26.
  - The user then chose to replace it with Remove and simplify the Cancel box.
  - That code is still UNCOMMITTED in the working tree on branch `cancel-old-money`: discarding it was
    blocked by the auto-mode safety check.
  - The "Leftover" section of the plan lists the files, and how to stash it once the user says OK.
- Migration audit (Next step 3) done:
  [docs/MIGRATION_AUDIT_2026-10-09.md](MIGRATION_AUDIT_2026-10-09.md), 15 ranked findings with
  fixes. Worst:
  - balance-due WhatsApp reminders go out for stale old balances (`automation.ts:330-373`);
  - duplicate plans are hardly caught;
  - expiry reminders double up;
  - the old-sales review list misses PT and in-app plans.
- Test suite fix: `olddates_local.py` (scratchpad 376e89b1…) now picks "Today" in "When was it
  paid?" for Kiran's setup, which should clear its 6 stale checks. Not re-run yet.
- `undo_refund_local.py` crashed after its 10 cancel/refund checks passed. It timed out waiting for
  the "Undo" button on the member's Payments list (`clients.$clientId.tsx:717`). The suite (or that
  button) is probably out of date since the payment Remove work. Check it.
- Test harness for this session: scratchpad 376e89b1… (`regress.sh`, `emu.py`, `cancelold_local.py`,
  `shots/`).

### Next
1. (Effort Extra high) Build Remove from the plan file, Tasks 1-6. First ask the user whether to stash
   the step 2 leftovers.
2. Fix audit items 1, 3, 5 and 6 (reminders for old balances, double expiry reminders, refund cap,
   joining incentive), then 2, 4 and 8.
3. Re-run `olddates_local.py` and fix `undo_refund_local.py`.
4. Still open: M. Rohith's package (owner); P. Sai Ram clean-up (below), which Remove will make easier.

## 2026-10-09 (late night): migration money fixes (merged into main and pushed, 04e2545)

User's report (P. Sai Ram, member ID 141): old software showed ₹5,000 balance that was really paid
back then. "Paid in parts" in Edit plan did not clear the balance; Billing Collect had no date;
no way to remove wrong entries; Dashboard "Collected today" listed paid-and-given-back pairs.
Live data read was blocked (auto-mode "Production Reads"), so worked from the screenshots.

Built (branch `money-fixes`, fast-forwarded into main):
- Edit plan / Edit PT plan: more paid in the old software lowers the plan's old-balance bill
  ("Balance from the old software · …") by as much, and back when lowered (`oldBalanceAfter`,
  `isOldBalanceBill` in `src/lib/old-money.ts`; `writeOldBalanceBill` in plan-edit.service; PT path
  now saves in one transaction). Refused when more than the balance still due (says what was
  collected here: remove that payment first). Plan card shows the balance due from the bill.
- Collect balance: "Paid on" (today default, 1st of last month .. today, like Edit payment); on an
  old-balance bill the hint points to Edit plan → Paid in the old software.
- Owner (finance): "Remove" on the member's Payments list (`src/lib/payment-remove.ts`,
  `payment-remove.service.ts`, `remove-payment-dialog.tsx`). Goes to the Recycle Bin (section
  bills, extra.kind "payment"); Undo / Restore puts payment + bill back only if the bill is
  unchanged (total, paid, due, status). Allowed: payments with a bill (not an initial payment with a
  trainer share), a cancellation's refund (has cancelId, no trainer share), old-software money of a
  cancelled / missing plan (lowers the plan's oldSoftwarePaid too). Not before cashOpenFrom (except
  old-software money). On a cancelled plan's bill: bill stays Closed, beforeCancel/cancelId set so
  Restore asks for it again. Hidden on a running plan's old-software rows (Edit plan instead).
- Dashboard Collected list: a payment + its same-mode, same-amount refund fold under
  "Paid and given back: N (adds up to ₹0) · Show" (`src/lib/money-pairs.ts`); ₹0 mode chips hidden.
- CFO: an old-balance bill at ₹0 goes to the old-software branch (list price), not value 0.
- Reviewer agent (money): 9 findings, all fixed in 04e2545.
- Tests: unit 221/221 (`npm run test:cfo`, new payment-remove + money-pairs tests); emulator suite
  `moneyfix_local.py` 21/21 (scratchpad 7f906952…, `bash regress.sh moneyfix_local.py`);
  latedates 26/26, newmember 11/11; olddates 58/64 = same 6 failures as main before this work
  (suite predates late-sale dates: K0, K0 baseline, I4, G4, K3, K4 expect a back-dated sale to
  count today; update that suite). Screenshots light/dark 390/1440 in that scratchpad's `shots_fix/`.

### Next
1. Owner, once live (P. Sai Ram): Payments tab → Remove the two ₹10,000 "paid in the old software"
   rows of the cancelled plans, the −₹5,000 cash refund and the ₹5,000 UPI balance payment (if it
   was not really collected on 9 Oct); then Plan → Edit plan → Paid in parts? Add a part ₹5,000 with
   the real day → bill RF-2026-000087 drops to ₹0. Same for K. Sri Devi's ₹10,000 pair if it was a
   mistake.
2. Build (new chat): cancelling a plan paid in the old software asks the owner "entered by mistake /
   twice: take its ₹X out of income" or "really paid: keep it" (today its old-software money keeps
   counting); `restoreCancellation` puts the money back. Files: `plans-control.tsx`
   (CancelPlansDialog), `plan-cancel.service.ts` (cancelPlans / restoreCancellation).
3. Migration audit (user: "think what problems they'll get, find similar things"): e.g. balance
   reminders (WhatsApp payment-due) for old balances already paid, member app showing old balances,
   duplicate plans (old + new sale) beyond the review list, `olddates_local.py` update.
4. Still open: M. Rohith's package (owner).

## 2026-10-09 (night): new members stay clean (merged into main and pushed, 7b48a0c)

User: "for new members there is no disturbance of old software things ... the paid date will be
the normal flow". Checked a brand-new member (phone not in the old data) end to end on emulators:
joining form shows nothing about the old software, plan starts today, no "When was it paid?",
payment dated today with no old-software / paidToday marks, not listed by "Sales typed in after
the plan started". One thing was not clean and is fixed: every billed plan in Membership history
showed a "Paid in the old software?" link. Now only for a member linked to the old software
(`oldMemberId`) or a plan that started before its bill was made (`mayBeOldSale` in
`clients.$clientId.tsx`). Unit 200/200, tsc + eslint clean, build OK.
Suite `newmember_local.py` 11/11 (scratchpad 7f906952…, `bash regress.sh newmember_local.py`),
screenshots light/dark 390/1440 in its `shots_new/`.
Note (left as is, by design): a NEW member whose plan date is set before today still gets
"Paid in the old software" and "When was it paid?" (that is how old members not found in the
old data are entered).
`shots_local.py` (scratchpad 7b781562…) fixed: Billing waits on the heading + a visible
"Collected ·" card; Edit plan waits on the "Paid in the old software" group (`#plan-oldpaid` is now
`#plan-oldpaid-amount`). All 12 shots taken.

### Next
1. Done: merged and pushed with the user's OK. Check the Vercel deploy finished.
2. Still open: M. Rohith's package (owner, see below); owner runs "Sales typed in after the plan
   started" → Move once the late-sales version is live.

## 2026-10-09 (evening): sales typed in after the plan started count on the plan's first day

**State:** branch `late-sale-dates` merged into main (fast-forward) and pushed 2026-10-09 with the user's OK
(Vercel deploys from main). Before the push: unit 200/200, build OK. No Firestore rules change needed.

User's report: A. Sharath Kumar's plan runs 2 Oct → 1 Nov but his ₹1,699 counted as "yesterday"
(8 Oct, the day he was typed in). Rule (user, 2026-10-09): "we don't know when he paid, so the
plan's start day is the day he paid". He slipped through because he was entered as a normal sale
(not "Paid in the old software") and the "Paid in the old software?" review list only flags plans
that started 7+ days before payment (his was 6).
Also: the money list showed ₹1,699 but his member page showed "Price ₹1,999" (package price; ₹300
discount was on the bill).

Built:
- Checkout (`enrollment.service.ts`, `enrollment-wizard.tsx`): a plan that started before today
  dates its joining payment AND trainer payout on the plan's first day ("When was it paid?":
  first day (default) / Today → `paidToday: true`). Upgrades stay today. Not before the 1st of
  last month (Day Book carried forward) → today. Maths `src/lib/late-sales.ts` `saleMoneyDay`.
- Owner tool, Income & expenses → Profit & income → "Sales typed in after the plan started":
  Check → tick list (untick ones really paid that day) → Move → Undo (run in `oldSoftwareMoves`
  kind `late-dates`; each payment gets a correction line with `tool: "late-sale-dates"`).
  Target day: the plan's first day if it started before the day the payment was typed in
  (createdAt), else the day typed in (also fixes a plan whose start was corrected later).
  Leaves alone: upgrades (credit on the bill, or a plan named in another plan's `upgradedTo`),
  cancelled plans, closed/refunded/missing bills, plans marked paid in the old software, dates set
  by hand / `paidToday`, anything before the 1st of last month. Never moves money across a day whose
  opening money was typed in (Day Book `cashDays.openingOverride` for cash, CFO `openingBalance` +
  `openingDate` for all): it stops on that day instead, so cash in hand and CFO money today never
  change. Undo re-checks the same. A run that moved nothing is not saved; Undo is offered for the
  newest run not taken back.
- Member page plan card / history, PT rows, PT tab, member app: what the member pays for the plan
  (`src/lib/plan-money.ts`: its share of the bill's discount / credit / payments): "Paid ₹1,699 ·
  package ₹1,999 · ₹300 discount".
- Upgrade credit for unused days = what was paid for the plan × unused ÷ days (was package price).
- Money list (Dashboard): "typed in <day>" instead of a time when a payment counts on another day.
- Front desk may correct payments typed in today even when they count on an earlier day.
- "Paid in the old software?" review (`server/old-sales.ts`) now judges lateness by the day typed
  in, so back-dated sales are still flagged.
- A joining draft left from an earlier day no longer keeps that day as "today" (`savedOn`).
- Money review agent (10 findings): fixed 2, 3, 7, 8, 9 and a bug in my first Day Book fix
  (`cashDate`, removed). Kept on purpose: checkout cash dated on the plan's first day may fall
  before a typed Day Book opening (paid then = in that count; the hint says "cash handed over now?
  choose Today"); first-day default also for existing members (the reported member is one);
  counsellor incentives follow the payment's month (confirm text says so); the tool does not move
  the trainer payout's date (informational only, like Edit payment).
- Tests: unit 200/200 (`npm run test:cfo`, new `late-sales.test.ts`, `plan-money.test.ts`);
  emulator suite `latedates_local.py` (session scratchpad 7f906952…, run `bash regress.sh
  latedates_local.py`); screenshots light/dark 390/1440 in that scratchpad's `shots/`.

### Next
1. Done 2026-10-09: merged and pushed. Check the Vercel deploy finished.
2. Owner, once it is live: Income & expenses → Profit & income → "Sales typed in after the plan
   started" → Check → untick any sale really paid on the day it was typed in → Move. A. Sharath
   Kumar's ₹1,699 then counts on 2 Oct. Undo is on the same card.
3. Still open from earlier: M. Rohith's package (owner: Edit plan → "3 Month package cardio and
   strengthening", end 15 Oct 2026, ₹5,800), `shots_local.py` 390 px Billing fix (test script only).
   The temporary `.claude/settings.local.json` allow rule is already gone (checked 2026-10-09).

## 2026-10-09: item 5 built: old-software money counted on its real dates (gym and PT)

**State:** branch `old-money-dates` merged into main and pushed 2026-10-09 with the user's OK (Vercel
deploys from main).
No Firestore rules change needed (payments and `oldSoftwareMoves` rules already cover it).

What it does (user's rule 2026-10-08: count on the real date, never in the Day Book drawer):
- Plans paid in the old software get `payments` docs `oldSoftware: true`, `invoiceId: ""`, linked to
  the plan(s), dated when paid there: the plan's start day, or part payments (rows: day, amount,
  mode). They count in Collected / month totals / income / Reports / CFO "received" by date; NOT in
  the Day Book drawer or carry-forward, CFO cash balance, incentives (counsellor ""), trainer
  payouts (none made), the "Paid in the old software?" suspects. No Edit / Undo as a payment.
- Maths: `src/lib/old-money.ts` (split gym / PT trainer share / one old plan for both, row checks,
  diff, backfill plan; unit tests in `old-money.test.ts`, run by `npm run test:cfo`).
  DB: `src/services/old-money.service.ts`. UI rows editor: `src/components/clients/old-paid-rows.tsx`.
- Where rows are made: joining form ("Paid in parts or on another day?"; a plan starting after
  today must be given the day: never "today"), Add-it-here dialog, Edit plan / Edit PT plan (rows
  changeable by the OWNER only: it changes past income; a single row follows a corrected start
  day), the owner's "Paid in the old software?" move (its Undo removes them).
- One old plan = one payment: gym + PT joined together or on the same bill share one payment
  (Edit PT plan then says "change it in Edit plan"); never two.
- Owner tool: Income & expenses → Profit & income → "Old-software money on its real dates":
  Check (month table + "not added" list with reasons) → Count (fixed ids `old-<planId>`, run kept
  in `oldSoftwareMoves` kind "dates") → Undo (removes the run's untouched payments).
- Day Book: Collected / Who paid = money taken here; "Paid in the old software · ₹X" listed apart.
  Dashboard money list: "Old software" chip and rows. Cancel refund share uses what was paid there.
- Checks: money review agent (12 findings, all fixed in 4dabe03 except the limits below); emulator
  suite `olddates_local.py` 46/46 on fcebdcf, 64/64 on 4dabe03 (incl. later start, pairs, refunded
  cancel, Count twice, front-desk read-only, Dashboard chip); unit 179/179; tsc,
  eslint (changed files), build OK. Screenshots light/dark 390/1440 in session scratchpad
  1bd8724d…/shots. Re-run: `bash <scratchpad 1bd8724d…>/regress.sh olddates_local.py` (~7 min).
- Known limits (left on purpose): a cancelled old plan keeps its old money (it was paid; plans
  entered twice should be undone, not cancelled; the owner tool leaves cancelled-without-refund
  plans out and lists them); CFO "earned" income for old plans still uses the package price, not
  the amount paid there; an imported legacy bill (`paymentsTracked: false`) for the same plan would
  count twice (the app never makes those now).

### Next
1. Done: merged + pushed. Open front-desk tabs pick up the new version when idle (or press "New
   version · Refresh").
2. Owner, once now that it is live: Income & expenses → Profit & income → "Old-software money on its real
   dates" → Check → read the month table and the "not added" list → Count. Undo if it looks wrong.
3. Then fix the "not added" ones: no amount saved (Edit plan → add what was paid there), starts
   after today (give the day), cancelled (decide: usually entered twice, leave out).
4. Kalyan Devaraju (PT + floor as one old plan): amount stays on the gym plan only (as before).
5. Still open from earlier: M. Rohith's package (owner), remove `.claude/settings.local.json`
   temporary allow rule, `shots_local.py` 390 px Billing fix.

## 2026-10-08 (night, round 3): door fix for old plans, PT discount, New version button

Done (branch work merged to main, see git log): Plan tab "Still running in the old software, but
not in this app → Add it here" (`add-old-plan-dialog.tsx`: gym or PT plan, package/trainer
suggested, old dates/amount/bill, no money today; enrollment allows a paid-there plan unless a plan
here covers its first day); Edit PT plan has "Discount (₹)" (owner; via editBill, refund if
overpaid); top bar "New version · Refresh" button (`src/lib/app-version.ts`); PT-only add for a
member with a gym plan verified. Tests: `round3_local.py` (15 checks).
Live: members blocked although their plan runs in the old software: `prod_blocked.mjs` (read-only)
→ `live_owner_addold.py list|apply` (keeps the app's suggestion, skips unclear ones).

Also done tonight: PT plans work like gym plans (calendar-month end when the start changes,
"Paid in the old software (₹)" shown + editable, ended paid-there PT plans correctable). Live: 5
blocked members got their old plan (R.KAVITHA, B.Vasanth Kumar, B.Vinay, K. Mothilal (PT),
P.Shiva Kumar (thumb still to register)); a duplicate PT plan I created for K. Mothilal was undone
(the copy from the old front-desk tab cancelled, the complete one kept); 4 PT plans got the old
software's dates/amount (`prod_oldpts.mjs` / `live_owner_oldpts.py`). `prod_blocked.mjs` now
counts PT plans: 0 members blocked. Left on purpose: K. Sai Venkat (ends today), Kalyan Devaraju's
PT amount ("Personal training + floor charges" is one old plan: its amount is on the gym plan; never
put it on both, or item 5 would count it twice). M. Rohith's package (1 year here, 3 months there)
is for the owner.

**DONE 2026-10-09 (see the top section): item 5, money of old-software plans on its real day (gym AND PT).** User's rule
(2026-10-08): COUNT ON THE REAL DATE (Collected / month totals / CFO), never as today, and KEEP IT
OUT OF THE DAY BOOK CASH DRAWER. User: "first check if there is a better way, it must help the gym
work smoothly" → better than staff typing dates for ~150 old plans:
1. Dates come from the old record by themselves: one payment per old plan on the old plan's start
   date (the old software renews and takes the money that day), amount = paid there. Staff only
   change it for part payments: rows (date, amount, method, + add) in Edit plan / Edit PT plan and
   in the joining form when "Paid in the old software" is ticked.
2. Owner tool on Income & expenses: "Count old-software money on its real dates": preview by
   month (how much Aug / Sep / Oct change), apply in one go, Undo (keep before-copies like
   `oldSoftwareMoves`). New entries count by themselves.
3. Storage: payment docs `oldSoftware: true`, real paymentDate, usual allocatePayment split
   (gym → membership income; PT → gym share + trainer share, no trainer payout because the trainer
   was settled in the old software), linked to the plan (membershipId / ptAssignmentId); a plan's
   balance bill stays as it is. One old plan = one amount (combined "PT + floor" plans only once).
4. Totals: buildFinanceSummary counts them by date (Dashboard, Billing, Reports, CFO server
   `cfo-data.ts`). Day Book (`src/lib/cash-book.ts`, `day-book.tsx`) leaves them out of cash in hand
   and shows them apart. Check incentives (probably leave out: sold in the old software), PT report,
   trainer page, member app, recycle bin, payment edit/refund (block normal edit: edit via the plan),
   old-sales review (must not flag them).
5. Money-critical: effort Extra high, a separate reviewer agent, tests for every total by date.

## 2026-10-08 (late): live data cleaned, calendar-month end dates, Billing period, Reports fix

**State (22:00):** pushed. Live, done as the owner with the user's OK: 64 plans got the amount paid in
the old software and/or the old software's dates (incl. 6 ended plans); the last 4 joining dates set.
The member page also shows the amount from the old software's record when a plan has none saved
(display only), so entries made from stale tabs still show the right amount.
Left (needs a person):
1. M. Rohith: 1-year package here but a 3-month plan in the old software (16 Jul → 15 Oct 2026, paid
   ₹5,800): Edit plan → "3 Month package cardio and strengthening", end 15 Oct 2026, ₹5,800. The
   auto-mode classifier refused switching a package by script.
2. Front desk must refresh the app once (tabs opened before 6ea7eb3 never auto-update); after that
   re-run `node prod_oldplans.mjs` (read-only) for anyone added from the old tab (dates off by 1 day).
3. G. Prasad / K. Sai Venkat end today here, yesterday there: left (ended by tomorrow anyway).
4. Remove `C:/Users/chala/OneDrive/Desktop/gym saas/.claude/settings.local.json` (temporary allow rule).
5. Screenshot script `shots_local.py` fails at 390 px on Billing (bill number hidden on phones):
   wait on a visible element instead, then take the light/dark 390/1440 shots.

**Live data (done as the owner through the app, with the user's OK; read-only checks before/after):**
- 31 plans that were paid in the old software but re-entered here as sales on 5-8 Oct (₹2,44,669)
  were marked "Paid in the old software" (whole entry: bill = old deal, payments off, PT share
  cancelled). Each has Undo on the plan (`oldSoftwareMoves`).
- 1 duplicate bill (member deleted with "keep bills" and re-added, same phone, ₹5,800) moved to
  the Recycle Bin.
- 60 old members' plans set to the old software's own dates (most were 1 day long; 6-month plans
  2-3 days short; one 12+1-month plan 30 days short; one wrongly entered as annual → 1 month).
  2 plans ending today were left (today already used; one has a renewal from tomorrow).
- "Joined this month": 3 of 7 old members got their old joining date; 4 are waiting for thumb
  registration and could not be edited (Edit reopened the joining steps) → fixed in code (Edit
  always opens details); finish them after deploy (scratchpad `live_owner_joined.py`).
- Live after: Collected today ₹24,496 (was ₹90,089), this month ₹1,16,879 (was ₹3,67,348).
  CFO page refreshes its numbers each morning (or Refresh on the page).
- Read-only scripts (session scratchpad): prod_old_check / prod_sweep / prod_dates / prod_joined.
  Owner-browser scripts used once each with a narrow allow rule that was removed afterwards.

**Evening round (same branch):** front-desk tabs left open since the morning kept running the
old app after the 15:31 deploy, so ~10 old members added after 4 pm were saved the old way (no
amount paid there, start+365 end dates). Fixes: (1) open tabs now check `/api/version` (build id
from vite `define` `__APP_BUILD__`, no DB read) every 5 min / when shown, and load the new version
by themselves when no popup is open and nothing was typed for 20 s, else a Refresh toast; tabs
still on the OLD bundle need ONE manual refresh. (2) A plan paid in the old software shows "Paid
in the old software ₹X" (package price as a note) on the Plan tab and history. (3) Edit plan has
"Paid in the old software (₹)" and works on ended paid-there plans (dates as in the old
software). (4) Joining suggests the old plan that started within 10 days (not only a running one)
and refuses ₹0 paid there. (5) Member page opens on Plan. (6) Billing list = the period's bills +
every older bill with money due; search looks at all loaded bills. Live: 46 plans were missing
the amount paid there, 11 had other dates (5 running, 6 ended): `live_owner_oldplans.py` (session
scratchpad, input from read-only `prod_oldplans.mjs`). Tests: `oldpaid_local.py` (18 checks).

**Code (branch `member-delete-money-guard`):** plan end dates follow calendar months, last day =
day before (src/lib/plan-dates.ts, unit-tested; 30/60/90/180/360 days = months, 365 = 1 year, other
lengths = that many days); Billing has the Dashboard's period dropdown (cards + bill list); Reports
"Collected" = payments by the day received (was bill amounts by bill date); Delete member warns
about "keep bills" when the same phone exists (double counting); Edit on a thumb-pending member
opens details; WhatsApp usage default rates = Meta India from 1 Oct 2026 incl. GST (utility ≈ ₹0.14,
marketing ≈ ₹1.02; chat replies: first 1,000/month free, then utility rate).

## 2026-10-08: WhatsApp chats, photo full screen, corrections, old-software money, security audit

Branches (local only, NOT pushed, NOT deployed): `members-wa-inbox-audit` (commit e427506) and on top of it
`old-software-money` (uncommitted at the time of writing → see git log). Nothing is live yet.

**1. Member photo full screen** (`ClientAvatar zoomable` + `PhotoViewer` in `src/components/clients/client-avatar.tsx`):
member page, member list (phone card = stretched link, photo is its own button), member calls, birthdays.

**2. WhatsApp chats** (`/whatsapp`, nav "WhatsApp", unread badge; new login feature `whatsappChats`, in the
front-desk defaults): members' messages to the Cloud API number arrive via the signed webhook into
`waChats/{number}/messages/{wamid}` (`src/server/whatsapp-chat.ts`); replies only within WhatsApp's 24 h
window; ticks, blue ticks on open, reactions, quoted replies, photos/voice/files via `/api/whatsapp/chat/media`;
bills/reminders the app sends are copied into the chat. Member page has a "WhatsApp chat" link. Looks like
WhatsApp (own tokens `.wa-theme` in styles.css, light+dark, phone = full-screen chat).
**Needs before it works live:** (a) `WHATSAPP_APP_SECRET` on Vercel (Meta → App settings → Basic → App secret)
+ Redeploy, (b) Meta → WhatsApp → Configuration: webhook = `https://dreamteamfit.vercel.app/api/whatsapp/webhook`,
"messages" field subscribed, (c) deploy firestore.rules (waChats rule). The page shows a yellow banner until
messages arrive.

**3. Corrections after confirm** (user: "confirmed the package at the original price, forgot the discount"):
Edit plan has a Discount box (owner/finance); a discount after full payment records the extra as money given
back (refund). Edit bill does the same instead of refusing. Counsellor fix reaches bill + payments + joining
(incentives). Edit PT: trainer share (% or ₹), unpaid payout + bill trainer total follow. Bug fixed: payment
split now spreads a bill's discount over membership/PT income (membership income was overstated on every
discounted bill; total income/profit were always right). Old discounted payments keep their old split.

**4. Old-software money counted as today's sales** (owner: "Sales amount wrong"). Cause: "Paid in the old
software" could not take the old offer price, so staff unticked it and gave a discount → a payment dated today
for money paid months ago. Fix:
- Joining form: "Paid in the old software ₹" (prefilled from the old data) + balance; allowed for members
  already in the app with no plan here; Backup / Member calls "Add" link the old record.
- Owner tool: member Plan tab → "Paid in the old software?" (`src/services/old-software.service.ts`): moves
  the money out of payments (bill keeps its link; old money shown as a credit line "Paid in the old software";
  still-owed balance stays), cancels a pending trainer share, marks the plan; full copy in `oldSoftwareMoves`
  for Undo. Refused for closed Day Book months, refunded bills, paid trainer shares.
- Review list: Income & Expenses → Profit & income → "Paid in the old software?" (`/api/old-data/suspects`,
  `src/server/old-sales.ts`): sales since the 1st of last month that the old data shows as paid there.
**The owner must go through that list after deploy** to fix the live totals (I can't read/change live data).

**5. Security audit** (`security-audit` skill installed globally; report in
`~/security-audit-skill/dreamteamfit/run-1/REPORT.md`; quick profile, PARTIAL coverage: 14/30 units deferred).
Fixed: member/trainer app off/delete only acts on that person's own login (`ownPortalUid`, portal.ts);
Recycle Bin restore only writes allowlisted record kinds to their own path + rules `binnable()`.
Open: money collections writable by any staff login in rules (needs per-flow rules redesign);
owner = email only (owner must check Firebase console: does admin@elevategym.com exist? sign-up off?).
Run 2 should start with: biometric commands, /iclock, Meta webhook, WhatsApp chat routes, portal #16.

**Tests** (emulators only; session scratchpad 7b781562…, `regress.sh <suites>` = fresh gym per suite):
wa_chat_local 35/35, wa_ui_local 74/74 (light/dark 390/1440, shots/), discount_local 20/20, edits_local 47/47,
oldsw_local 27/27, sec_local 15/15, undo_refund 41, double_tap_join 4, dash_money 5, billing_reads 6,
plans_end 12, daybook_reads 4, batch_features 24; unit 150/150; tsc + eslint clean; build OK.
Prod read script (read-only, owner runs): scratchpad `prod_sales.mjs` (this month's payments with bill/plan).

### Next
1. Owner OK → merge both branches into main, deploy firestore.rules (waChats, oldSoftwareMoves, recycleBinItems
   rule), push (Vercel deploys).
2. Vercel: WHATSAPP_APP_SECRET + Meta webhook "messages" field (see 2).
3. Owner: Income & Expenses → "Paid in the old software?" → Check & mark each one.
4. Owner: Firebase console checks in NEEDS-VALIDATION.md (owner email).
5. Security run 2 (deferred units) and the money-rules redesign.

## 2026-10-07: Machine fresh start + old-software call list (pushed, live)

Why: the owner wipes the MB360 so only people who come to the desk get back in, which shows
who is really active. Old-software people who don't come back are phoned.

Merged into main and pushed by the user (bfb7269); live check passed (Old software tab, device online).
Later the same day: read-only owner sweep of the live site (62 page visits, phone + desktop): no page
errors, console errors, error states or sideways scroll (only normal cancelled requests on
navigation). Fix: the device setup box now shows this gym's MB360 relay settings first
(`rf.rebuildfitnesskkd.workers.dev`, port 80, HTTPS off, domain on), since it had only the
HTTPS/443 values the MB360 can't use. The owner shared their login in chat: they should change it.
Built:
- Biometric devices → "…" → "Machine was reset: start fresh" (owner only, type RESET).
  `freshStart()` in `src/server/device-import.ts` (`/api/devices/fresh-start`). It first copies
  members' and staff machine fields, saved thumbs and old machine users to
  `machineResets/{id}/items` (server only, closed by rules), then: thumb not registered, machine
  ID cleared, members who had a thumb get a biometric-only joining (→ Members "Thumb pending"),
  staff blocks kept, old machine users marked removed (thumbs kept in deviceUserTemplates),
  saved thumbs moved out of biometricTemplates, unsent commands cancelled. The device card shows
  "Fresh start on … · N members and N staff registered again".
- Register thumb: machine ID = Member ID and locked whenever the machine has it free
  (`fingerprint-panel.tsx`). New members keep getting the next Member ID (order of joining).
- Member calls → "Old software" tab (`src/components/members/old-software-calls.tsx`): whole
  old record (all plans, paid/balance/bill, address, remark…), Call / WhatsApp / Add as member,
  call status + notes; drops off once a member here (by old ID or phone) has a thumb ("Show who
  came back"). "Bring in everyone not back yet" = old plan runs today + no thumb here. Backup →
  Old members rows have "Call" / "Put all shown on the call list". Server: `callList()` in
  `src/server/old-data.ts` (`/api/old-data/call-list`, Member calls or Backup feature), rows are
  `memberCalls/old_<phone>_<oldId>` (segment "old"), so no rules change was needed.
- Staff page: trainers get Create login / Login & features.
Tests (emulators only): session scratchpad 73fdee4c…: `restart_local.sh`, `serve.sh`
(127.0.0.1, live key forced empty), `reset_local.py` 32/32, `ui_local.py` 28/28 (light/dark,
390/1440, screenshots in `shots/`). Build + lint clean.
Live facts (read-only, 2026-10-07): 25 members, 20 with thumbs, 1 staff thumb (keerthi M
10024), 994 old machine users, door control ON, old software files already uploaded.

Order on the day: (1) done, (2) wipe the machine: Menu → Data Mgt →
Delete Data → Delete All (NOT factory reset; if done, re-enter Cloud Server: ADMS, domain ON,
rf.rebuildfitnesskkd.workers.dev, port 80), (3) check the device is online, (4) press start
fresh, (5) Member calls → Old software → Bring in everyone not back yet, (6) register at the desk.

## 2026-10-06 (latest, updated 22:50): CFO page + joining-date fix merged into main and pushed

**State.** `cfo-v1` (which includes the joining-date fix) merged into `main` (19238b7) and pushed
to origin 2026-10-06; Vercel deploys main. Checked on main before the push: `vite build` OK,
unit 150/150, `tsc --noEmit` clean. `fix/joining-date` is no longer needed (already in main).
Gemini API setup (env vars, request/reply format) is now in the global `~/.claude/CLAUDE.md`.

**Joining-date fix** (user report: "Joining date can't be in the future"): New member and Edit
member accept a joining date up to a year ahead; a later joining date moves the new plan's start
with it (plan waits as pending, like an advance renewal); the plan can't start before the joining
date; Dashboard "new members this month" counts only members joined by today; birthday pickers
use the India date. Test: scratchpad `joindate_local.py` 9/9.

**CFO** (`/cfo`, nav "CFO" after Income & Expenses; owners, "All features" and Finance logins):
health cards, weekly AI summary, call lists (Not coming, Renewals, New members, PT chances, Dues,
Cash) with Call / WhatsApp chat / Excel / Print, 6-month trends, "How these numbers are worked
out", settings (opening money, alert limits, AI on/off, language). Maths in `src/lib/cfo` (pure,
`npm run test:cfo`), server `src/server/cfo*.ts` + `ai.ts`, docs `CFO_SPEC.md`, `CFO_PLAN.md`.
Numbers are worked out on the server each morning (last step of the morning cron) or on Refresh
(max once per 10 min for everyone), saved in `cfoReports/latest` + `cfoReports/list-*`; the page
reads 3 docs. ~7k reads per refresh at 1,000 members. Single-field queries only.

**Live rules DEPLOYED 2026-10-06 (user OK):** `firestore.rules` from `cfo-v1` is live on
`rebuildfitos` (ruleset a582db7c…; read back = file). It also switched on the waiting main-branch
rules (Staff page logins edit staff/trainers, Recycle Bin page logins). The rules live before it
are saved in the session scratchpad `live_rules_backup_2026-10-01.txt` (roll back with
`deploy_rules.mjs <file>`). The user runs `npm run dev` on this PC against the LIVE database.

**Summary without AI + Start (user request 2026-10-06):** the summary card always shows a summary.
No AI (not connected, refused key, failed, or not started) → the app writes it from a fixed
template (`src/lib/cfo/template.ts`, same numbers as the page, same 3 parts) under "AI summary is
not available right now" + the reason. `POST /api/cfo/status` says if an AI is really connected
(free model-info call checks the key and model name; never returns the key). Connected and not
started → "Start AI summary" button (saves `aiEnabled: true`, writes the first AI summary).
`aiEnabled` now defaults to OFF until Start is pressed.

**Gemini key + live check (2026-10-06 22:10):** the real key is in `.env` (Google's newer
`AQ.` format, accepted). Check 9 run live against the TEST gym on the emulators (never the live
database), through a local recorder that saved exactly what Google received:
- `gemini-3.1-flash-lite`: **11/11 pass.** Real summary written by Gemini, every number in it is
  on the page (Renewals tab ₹24,600, Pending dues ₹800, health cards), the request held totals
  only (no names/phones/emails; custom category sent as "Other (custom)"), AI off → no Google
  call + the app's own summary. Shown on /cfo at 390/1440 light+dark, no console errors.
- `gemini-3-flash-preview` (the `.env` choice), `gemini-3.8-flash`, `3.7`, `3.5`, `flash-latest`:
  HTTP 503 "high demand" every try, even for a 1-line "say OK". Lite models answer.
- `gemini-2.5-flash` (the CODE DEFAULT in `src/server/ai.ts`): 404 "no longer available to new
  users". So with `CFO_AI_MODEL` empty the summary always fails.

**Paid key, 2026-10-06 22:15 (user replaced the key with a paid one):** every model answers now
(3.1-flash-lite, 3-flash-preview, 3.8-flash, even 2.5-flash; serviceTier standard). Full check
**11/11 on `gemini-3.1-flash-lite` and 11/11 on `gemini-3-flash-preview`**, first try, ~1,300
tokens per summary; card shown at 390/1440 light+dark, no console errors. Bug 4's "0 to 7 days"
blocked BOTH tries on the paid key, so it is FIXED (commit below): numbers in the data's labels
(`late0to7`, `late8to30`, `lateOver30`) now count as page numbers. Unit 142/142, e2e 850/850.
The user's pasted AI Studio sample (Interactions API, `google_search` tool, thinkingLevel high,
65,536 tokens) is NOT for the CFO: search lets the AI bring outside facts (spec: it only explains
our numbers) and high thinking is slow/costly and can overrun Vercel's ~50 s request.

**Bugs found by the live check: ALL FIXED 2026-10-06 (commit 3fadabc, bug 4 earlier):**
1. Default Gemini model (`CFO_AI_MODEL` empty) is now `gemini-3.1-flash-lite`.
2. Failed tries now save `provider`/`model`/`httpStatus` in `cfoBriefs/status`; `/api/cfo/status`
   reports "not connected" (`the AI model "X" can't be used with this key` / key refused) when the
   last try for the SAME provider+model got 401/403/404. Busy/5xx/timeouts don't count; another
   model clears it. Logic in `src/lib/cfo/ai-status.ts` (shared by server and card).
3. Card uses the saved reason for "off" tries and hides an old "off" try once the AI is on.
Still open, cosmetic: Gemini writes "a loss of -₹8,900" (double minus).
**"Key was refused" on the user's PC (2026-10-06 22:30):** NOT a code bug. `npm run dev` was
started 20:59, `.env` got the paid key 22:10, so the dev server still sent the old key. The key in
`.env` works (direct check: model info 200, generateContent "OK"). Fix = restart `npm run dev`.
Confirmed 22:40: after the restart the user's CFO page shows "Written by Gemini" (live data).
Live data gaps it shows: no Sep 2026 expenses entered (no profit/break-even), runway "not enough data".
`.env.example` still has the user's uncommitted placeholder lines (keep keys empty there).
Test-kit gotcha: `.env` now names the live project, so emulator builds need
`VITE_USE_EMULATORS=1 VITE_FIREBASE_PROJECT_ID=leadsmanage-1f7cd npm run build`.
Live-check scripts (session scratchpad 1a17c518…): `gemini_proxy.py` (recorder, :5398),
`serve_cfo_live.sh` (key from `.env`, `LIVE_MODEL=` to pick a model), `live_check.py`, `live_page.py`.

**Before it can go live (needs the user):**
1. ~~Deploy `firestore.rules`~~ done 2026-10-06.
2. ~~Merge `cfo-v1` into main and push~~ done 2026-10-06 (19238b7). Check the Vercel deploy succeeded.
3. Vercel env for the AI summary: `CFO_AI_PROVIDER=gemini` + `GEMINI_API_KEY` (free tier) +
   `CFO_AI_MODEL=gemini-3-flash-preview` (better wording) or `gemini-3.1-flash-lite` (cheaper);
   both pass with the paid key. On the free key only the lite model answered. Without a key everything works except
   the AI summary (the app writes its own).
4. Owner: CFO → Settings → total gym money at the START of a date (bank + UPI + cash).
5. ~~Live AI check (check 9)~~ done 2026-10-06 with the paid key: 11/11 on both models above.
   Bugs 1-3 fixed 2026-10-06 (3fadabc).

**Tests for bugs 1-3 (2026-10-06, commit 3fadabc):** unit 150/150 (`ai-status.test.ts`),
e2e `cfo_local.py` 850/850, Start test `cfo_start_local.py` 11/11, new browser test
`cfo_aistatus_local.py` 12/12 (fake AI mode `nowrite` = model info OK, writing 404; uses
`serve_cfo_model2.sh`; screenshots `shots/cfo_ai_refused_*`). Run with `PYTHONIOENCODING=utf-8`.
**Tests** (session scratchpad 8b942f95…, see `README_cfo_tests.md`; all run 2026-10-06 on
commit 8d9cf5d): unit 141/141; e2e vs an independent hand calculation `cfo_local.py` 850/850;
access `cfo_access_local.py` 124/124; browser `cfo_ui_local.py` 177 + 1 soft (soft check now
fixed to the real wording); summary/Start `cfo_start_local.py` 11/11; owner flow
`cfo_owner_flow.py` 13/13; morning cron `cfo_cron_local.py` 6/6; regression `regress_cfo.sh` all
pass. One-command run: `cfo_suite.sh`. Server for tests: `serve_cfo.sh`
(CFO_TODAY / CFO_MIN_REFRESH_SECONDS / CFO_AI_BASE_URL work only against the emulator).

## 2026-10-06: CFO feature set up, not built yet

`CFO_SPEC.md` (the AI CFO spec with its 10 checks) is now in the project root, and the
two-phase "Implement CFO" workflow is in `~/.claude/CLAUDE.md` (example spec saved at
`~/.claude/cfo/CFO_SPEC_EXAMPLE_GYM.md`). Since the spec exists, "Implement CFO" here will summarise
it and wait for "proceed" before building.
Claude in Chrome was NOT connected when checked (no browser tools in the session, no Claude
native-messaging host registered in Chrome), so step 6 / browser checks need `/chrome` working first.

## 2026-10-06 (later): "WhatsApp on the gym PC" merged and pushed

Branch `claude/friendly-albattani-ostipp` commit 35b7f9c (made 2 Oct, never merged) is now on
`main`, with the user's OK after checks. Settings → WhatsApp → "Run it on the gym PC": download
`RebuildFitness-WhatsApp.bat`, double-click on the gym PC (needs Docker Desktop); it runs OpenWA +
a free Cloudflare quick tunnel + `public/gym-pc/link.mjs`, which reports the tunnel address to
`POST /api/whatsapp/gateway-link` every 10 minutes ("Gym PC online").

Security review (done here): setup key is random, server-only, compared in constant time; only
Settings logins can make/reset it; the gateway must answer before anything is saved; the token
for the app is limited to one OpenWA instance. Hardened before merging: malformed keys are refused
before any Firestore read; only `https://` addresses accepted (the token travels with each call).
Not changed: the compose file uses `cloudflare/cloudflared:latest` and `node:22-alpine` (unpinned).

Tests (local emulators): new `gym_pc_local.py` 24/24 (fake https OpenWA `fake_owa.py` :5443,
server `serve_gympc.sh` with NODE_TLS_REJECT_UNAUTHORIZED=0 for the self-signed fake only;
light/dark 390/1440). Regression after the merge: edits 47, plans_end 12, undo_refund 41,
daybook 4, billing 6, double_tap 4, dash_money 5, batch_features 24, journey 15, search 25: all
pass. `journey.py` updated (new WhatsApp switch + Send from; trainers are made via the staff form
since d15b5cb). Test kit is in session scratchpad f118e4b0… (`regress_merge.sh`).

Not done (needs the gym): the real gym-PC setup has never been run on a Windows PC with Docker.
Try it once at the gym: download the setup file, run it, check "Gym PC online", Show QR, send a test.

## 2026-10-06: Edit options audit ("after adding a package, can it be edited?")

Audited every record staff create, as owner / manager / front desk / trainer. Master data
(members, packages, trainers, staff, expenses, leads, classes, bookings, settings) was already
editable. What could not be corrected, and is now fixed (committed and pushed to `main` 2026-10-06; Vercel deploys from there):

| Fix | Where | Who |
|---|---|---|
| **Edit plan**: package, start / end date, counsellor. Same plan is changed; the bill is re-priced (new balance asks for a pay-by date; a lower price records the extra as a refund), payments are re-split, member summary + door follow the dates, each change is listed on the plan | Member → Plan tab: "Edit plan" on the active card, pencil on each history row | `members` login. A refund needs `finance` (owner) |
| **Edit payment**: amount, mode, date, note; bill paid / balance / mode and the bill link follow | Member → Payments tab, Day Book "Who paid" | Today's payments: `billing`. Older: `finance`. Before the 1st of last month only the note (Day Book carry-forward) |
| **Edit bill**: discount, pay-by date, note | Bill "⋯" menu → Edit bill | `billing`; discount needs `finance` |
| **Edit PT plan**: trainer (unpaid payout moves), dates | Plan tab → PT plans pencil | dates: `members`; trainer: `finance` (payout rules) |
| Phone fix also fixes WhatsApp number + phone/name on bills, bill links, payments | Member Edit | any |
| Remove a visit marked by hand (last visit + member-app calendar go back) | Attendance page, member Visits tab | `attendance` |
| Edit / remove (Undo) "other income" | Income & expenses | `finance` |
| Editing / deleting a salary expense keeps the staff pay record in step | Expenses / Day Book | `finance` |
| Bug: editing a done follow-up reopened it and logged "created" again | followups.service `saveFollowUp` | — |
| PT tab said "Pending biometric" for a PT plan that starts later → "Starts later" | client-pt-section | — |

Not changed (deliberately): member ID after creation (fingerprint machine IDs), names on old
trainer payouts / bookings, lead call logs, announcements (already sent).

Code: `src/services/{plan,payment,bill,pt}-edit.service.ts`, dialogs in
`src/components/clients/edit-{plan,pt}-dialog.tsx`, `src/components/billing/edit-{payment,bill}-dialog.tsx`,
`src/components/attendance/remove-visit-button.tsx`. Each correction is stored in an `edits`
array on the record (`RecordEdit`: on, by, reason, changes) and shown as "Changed … by …".

No Firestore rules change needed.

Review fixes (independent money review, all applied): refund on a gym+PT bill is split like
the payments (trainer share stays right); re-pricing uses the bill's own tax rate
(`billTaxRate`), not today's setting; an upgraded-to plan keeps its start date; old payments
(before the 1st of last month) can still get a note; only Income & expenses can change a
payment's date (checked in the service too); "other income" before the 1st of last month is
locked (Day Book carry-forward); salary expenses now store `staffPaymentId` (older ones are looked
up only for finance logins, others edit the expense alone as before); PT trainer change never
moves already-paid adjustment lines; bill edit no longer invents a pay-by date.
Also fixed a race: "End all plans & stop entry" now appears only after PT plans have loaded
(before, a fast tap could show a box without the PT plan).

### Tests (local emulators, 2026-10-06)
- New `edits_local.py` (session scratchpad 09feb459…): **47/47** (owner + front desk, gym+PT
  refund split, 18% tax bill, old payment note, light/dark at 390/1440, no sideways scroll).
- Regression: plans_end 12/12, undo_refund 41/41, daybook_reads 4/4, billing_reads 6/6,
  double_tap_join 4/4, dash_money 5/5, batch_features 24/24. Production build OK, tsc + eslint clean.
- `journey.py` / `search_test.py` (old scratchpad) are **stale**: journey looks for the switch
  "Send through WhatsApp Cloud API", removed by the 1 Oct WhatsApp-gateway commit; search uses
  journey's data. They need updating before they're useful again (not caused by this change).
- Emulators need Java: portable JRE in the session scratchpad (`restart_local.sh`); app server
  `serve_fakewa.sh`; fake WhatsApp `fake_wa.py` (port 5299). Build with
  `VITE_USE_EMULATORS=1 VITE_FIREBASE_PROJECT_ID=leadsmanage-1f7cd npx vite build`.

### Next
- Live check (owner login needed): Member → Plan → "Edit plan", Payments → edit a payment,
  Bill "⋯" → Edit bill. Settings → WhatsApp shows the "Run it on the gym PC" box.
- At the gym: run the gym-PC setup once (see the section above) if they want WhatsApp from the PC.

Last updated: 2026-10-08 night (round 3 live: door fix, PT parity; next = item 5 payment dates)
