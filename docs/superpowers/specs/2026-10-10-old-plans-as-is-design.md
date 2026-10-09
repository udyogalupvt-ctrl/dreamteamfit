# Old-software members: keep the old plan as it is — design (agreed 2026-10-10)

Agreed with the owner in chat (2026-10-10). Status: **approved, not built**. Before building: show ONE screen
preview (an old member's page) and get a yes (global rule: no big build on a guess).

## Why
Almost every October problem came from one step: staff re-creating an old-software plan by picking one of
our packages and typing amounts (wrong package/dates, ₹1 gaps, duplicates, "paid in the old software"
ticked on new money, old plan locks). Removing that step removes the bug class.

## What changes
1. **Old plan kept as-is.** A member from the old software gets their old plan exactly as in the backup
   Excel (`oldMembers` data): old plan name, start date, end date, amount, balance. No package picking, no
   bill, no WhatsApp. Marked "From old software" on the plan only (for staff to see where it came from).
2. **Money is money.** What was paid counts as normal money on the plan's start date (paid date = start
   date; editable later). No separate "Old software" chip/total. Mode is unknown in the old records:
   saved as "Not recorded" (editable to Cash/UPI). Never added to past days' Day Book drawer cash (that cash
   was counted in the book already).
3. **Old balance** (old record balance > 0): shown on the member page with Collect; no WhatsApp reminder
   unless staff tick it.
4. **Door:** thumb works until the old plan's end date (thumb registered once).
5. **Running plan (case 1):** shows as current plan; when it ends → "Renewal due" → renew with OUR
   packages as a normal sale. **Ended plan (case 2):** latest old plan shows as ended; renew normally.
6. **Missing details** (counsellor, DOB, joining date): filled BY HAND by staff (not from the old record).
7. **Bring everyone over:** all old members with a running plan are added now in one go; members whose
   plans ended are added on first visit ("Add from old software" in search).
8. **Fix the existing mess automatically (no approval list; owner said "just process"):** compare each
   member's app plans with their old record: duplicates of an old plan → Recycle Bin; old plans entered
   with a wrong package/dates/amount → replaced by the exact old plan. NOT touched: plans sold here
   (renewals, new money), payments taken here, Day Book cash, trainer shares. "Paid in the old software"
   plans NOT in the old records (likely new October money): not changed, listed for the owner.
9. **Owner page "Old software check"** (Income & expenses): every change made (was → now), Undo per line,
   Undo all; the list of things not changed with the reason.
10. Entries written only in the paper book after the backup date: staff add them as normal sales with
    Paid on (owner: "little things, we will do them").
11. Protection: an old plan can be carried once; a sale here can't silently overlap it (refused with why).

## Owner answers (2026-10-10)
- Old software stopped last week; the backup Excel already uploaded is the final data.
- An old plan that started in October counts in October (that money is in the paper register).
- Bring over everyone with a running plan now: OK.
- No approval list for the clean-up: just process, with a page to view and revert.
- Mode "Not recorded" + not in past Day Book cash: OK.

## Constraints
- Live data: back up before the run; test everything on emulators first (own ports, see HANDOFF);
  Undo for every change. Production names never in git-tracked files.
- Another chat may be working in the same folder (branch `split-pay`, Cash + UPI split): check
  `git branch --show-current`, use a separate worktree on main, commit only your own files.
- Effort Extra high, ultracode on (owner to switch on).
