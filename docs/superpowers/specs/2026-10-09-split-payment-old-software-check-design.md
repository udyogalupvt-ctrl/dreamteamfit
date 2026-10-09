# Cash + UPI split payment, and the "paid in the old software" check

Date: 2026-10-09. Approved by the user in chat ("Yes, build it all"). Source: the October register
check (front desk register vs app): 2 part-cash payments were saved all UPI, and 3 new October
payments were saved "paid in the old software".

## 1. Cash + UPI (split payment)

**Where money is typed with a mode:** checkout (enrollment wizard), Collect balance, Edit payment.
Each gets a fifth "Paid by" choice, **Cash + UPI**: the total stays in "Amount received", plus a
**Cash ₹** box; UPI = the rest (shown live: "UPI ₹300 + Cash ₹1,500"). Both parts must be above ₹0.

**Stored as two `payments` docs** (UPI part first, then Cash), same bill, same day, same `kind`,
both carrying `splitId` (= the UPI part's id). Every money reader (Day Book cash, Collected by mode,
This month filters, CFO, Excel, incentives) already adds payments one by one, so none of them
changes. The gym / PT / trainer allocation of the two parts adds up exactly to what one payment
of the total would get (`splitAllocation`: second part = whole − first part, field by field).

**Bill label:** a checkout split sets `paymentModes: ["UPI", "Cash"]` on the bill and its public
copy; `paymentMethod` = the bigger part's mode (old readers keep working). Shown as "UPI + Cash"
via `billModesLabel()` on the bill page, PDF, Billing list, bills Excel and dashboard lists.
Balance payments never change the bill label (as today).

**Correcting later (Edit payment):** a split pair is edited as ONE payment: the dialog shows the
pair total and the Cash part. Changes:
- one payment → Cash + UPI: this doc becomes the UPI part, a new Cash doc is added (`splitId`),
- re-balance a pair (Cash part changes, total same),
- Cash + UPI → one mode: this doc takes the total, the other part is deleted (edit line kept on
  the remaining doc; the audit log keeps the delete),
- date and note apply to both parts; the total can't change while split (choose one mode first).
Rights = the existing "mode" rights (`rights.money` + date rights for a date change).
"Paid on" in Edit plan / Edit PT plan moves both parts.

**Undo / Remove:** Collect balance's Undo takes back both parts. Owner Remove refuses one part of a
split ("choose one mode in Edit payment first"); Remove plan already takes all the bill's payments.

**Shown:** payment rows in This month / Collected / member page get "· Cash + UPI" so the two rows
read as one payment.

## 2. "Paid in the old software" check (no fixed date)

The user can't give a last day for the old software ("mostly from Oct 5 after, don't depend on
it"). So the check uses the old software's own records (Backup data, `oldMembers`), not a date:
a plan ticked "paid in the old software" is suspicious when the member's old record has **no plan
of the same kind (gym / PT), paid there, covering these days**. A newer export upload moves the
check along by itself.

- **Checkout:** with the tick on (and not a plan still running there), the wizard looks up the
  phone's old records; if none matches → amber warning under the tick: "The old software's records
  have no <gym/PT> plan for this member for these days. Paid now by cash or UPI? That's new money:
  untick this and enter it as paid here." with a **Paid here (untick)** button. Saving with the
  warning showing asks once (ConfirmDialog: Go back / Yes, paid in the old software).
- **Edit plan / Edit PT plan** of an old-software plan: the same note (information only).
- **Owner list (Income & expenses):** "Saved as paid in the old software, not in its records":
  old-software payments since the 1st of last month whose plan has no matching old plan; each row
  links to the member; fix = Remove plan (added by mistake) and sell again with the right mode, or
  leave it when it really was paid there (records older than the export). Same endpoint as
  "Paid in the old software?" (`/api/old-data/suspects` returns `notInOld` too); no extra reads of
  payments.
- Shared matcher: `oldPlanCovering(person, {kind, start, end})` in `src/lib/old-data.ts` (pure,
  tested), used by the server list and the browser checks.

## Tests

Unit: split parts / allocation / labels, old-plan matcher. Emulator suite `split_local.py`:
checkout split → Day Book cash and UPI totals + bill label; Collect balance split + Undo; Edit
payment split / re-balance / merge; Paid on moves both; old-software warning + confirm; Edit plan
note; owner list; 390 / 1440 px light + dark screenshots. Regressions: paidon, paidon_edit,
latedates, remove, moneyfix, audit2, audit9. One reviewer agent for the money code.
