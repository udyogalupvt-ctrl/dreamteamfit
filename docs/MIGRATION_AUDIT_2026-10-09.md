# Migration audit: what old-software members can get wrong (2026-10-09)

Read-only code sweep. Worst first. Tags: **[MESSAGE]** a member is contacted, **[MONEY]** books or payouts change, **[DISPLAY]** screen only.
Each item ends with the proposed fix.

1. **FIXED (audit-fixes-1)** **[MESSAGE] Balance-due reminders go out for old balances.**
   - `src/server/automation.ts:330-373` picks every bill with `dueDate` in the next 3 days (max 7) and `balanceDue > 0`.
   - It never skips an old-balance bill (`isOldBalanceBill`, `src/lib/old-money.ts`). That bill comes from the CSV "Balance Amount", which can be stale: the money was often paid back then.
   - The due date defaults to today + 7 (`add-old-plan-dialog.tsx:104`).
   - So a member who cleared ₹4,000 in the old software can get "₹4,000 is due" up to 4 times, and twice a day if they have 2 such bills.
   - Fix: skip old-balance bills in the cron unless staff tick "remind" on that bill, or remind only after staff confirm the balance.
2. **FIXED (audit-fixes-2)** **[MONEY] Duplicate plans are hardly ever caught.**
   - Two copies of one old plan both count their `oldSoftwarePaid`. The backfill (`old-money.ts:314-401`) holds back only cancelled plans with no refund.
   - A normal sale over a carried-over plan isn't checked in `enrollMember`, and `prevActive` silently expires the old plan (`enrollment.service.ts:404`).
   - Fix: warn at sale and save time when plans overlap. Owner list "Plans that overlap" on Income & expenses. **Remove (added by mistake)** for the duplicate (being built).
3. **FIXED (audit-fixes-1)** **[MESSAGE] Expiry reminders double up or go missing.**
   - `automation.ts:236-247`: two active plans with the same end date mean 2 renewal messages.
   - A stray duplicate that ends later hides the reminder for the real plan.
   - Fix: one reminder per member, based on the member's latest-ending plan.
4. **FIXED (audit-fixes-2, PT + in-app old plans; look-back unchanged)** **[MONEY] The "Paid in the old software?" review list is narrow** (`src/server/old-sales.ts`).
   - It only looks back to the 1st of last month, and misses PT-only sales (line 66).
   - It only matches the uploaded CSV, never the old plans already in the app.
   - Without a CSV match, it flags only sales typed in 7 or more days after the plan started.
   - Fix: include PT, and compare with plans already in the app.
5. **FIXED (audit-fixes-1)** **[MONEY] A refund on a member with no bills here has no limit** (`plans-control.tsx`, `capped = invoices.length > 0`).
   - Example: ₹50,000 typed for a ₹5,000 old plan goes through and lowers Day Book cash.
   - Fix: cap at the old-software paid amount (or the plan price).
6. **FIXED (audit-fixes-1)** **[MONEY] "Fixed ₹ per joining" incentive counts old-balance bills as joinings** (`staff-pay-section.tsx:88-93`; the bill gets the old counsellor at `enrollment.service.ts:573`).
   - Closed and refunded bills count too.
   - Fix: skip old-balance, closed and refunded bills.
7. **[MONEY, reporting] The CFO values migrated plans at today's package price** (`cfo-data.ts:137`).
   - It never uses `oldSoftwarePaid` / `oldSoftwareBalance`, so earned income is overstated when the old price was lower.
   - Fix: pass the old paid + balance as the plan's value.
8. **FIXED (audit-fixes-2)** **[DISPLAY] "Current membership" is picked by six different rules.**
   - `automation.ts` rollPlans, enrollMember, plan-edit, data-import, `member-plans.ts` and portal all choose differently.
   - Lists use only the `currentMembership` snapshot, so a member can show as Renewal due / not renewed by mistake.
   - Fix: one shared helper (running today, latest start; else the next upcoming; else the latest ended), used everywhere.
9. **FIXED (2026-10-09, `src/lib/bill-cancel.ts`)** **[MESSAGE] A combined gym + PT bill stays open when only one plan is cancelled.**
   - The same happens if "stop asking" is unticked. Reminders continue.
   - Fix: on a partial cancel, lower the bill by the cancelled plan's share, or warn.
10. **[DISPLAY] Member app** (`server/portal.ts`, `routes/m.$code.tsx`):
    - The balance includes stale old balances.
    - A migrated plan is listed twice ("Packages taken" + "Earlier packages").
    - Old payments have no label, and refunds print as "₹-2,000".
    - The pill reads "Part paid" with ₹0 paid, and a refunded bill reads "Paid".
11. **[DISPLAY] The dashboard "Trainer share owed" card includes PT shares settled in the old software** (`finance.service.ts:433`).
12. **[DISPLAY] "Miss you" day count can start from an old plan's start** (`automation.ts:415-433`; off by default).
13. **[DISPLAY] Billing's "Paid" filter shows Closed bills** (`billing.tsx:112-115`), and Reports "Gross sales" includes old-balance bills.
14. **FIXED (audit-fixes-2, overlap check)** **[Latent MONEY] `enrollMember` accepts an old plan when a later plan already runs, then expires the running plan.**
    - The UI blocks this, but the service should too.
15. **[DISPLAY] The old-software call list still lists members already renewed here but not yet on the thumb machine** (`server/old-data.ts:427-430`).

## Checked and fine
- Closed bills: no reminders, and Restore asks again.
- ₹0 and refunded bills are skipped everywhere.
- Past due dates are never messaged; one reminder per bill per day.
- Cancelled plans get no renewals.
- The cash drawer, CFO cash, incentives and late-sale mover all skip old-software payments.
- Old payments are locked against Edit.
- Old PT creates no trainer payout.
- The backfill uses one fixed id per plan.
- Closed bills can't be collected or edited.
