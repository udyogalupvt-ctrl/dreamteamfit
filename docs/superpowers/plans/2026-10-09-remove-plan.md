# Remove a plan added by mistake: design + implementation plan

> **For agentic workers:** use superpowers:executing-plans (inline; lean build: one builder, plus one
> reviewer agent at the end because this is money code). Steps use `- [ ]` checkboxes.

**Goal:** A gym or PT plan added by mistake can be **removed** (as if it never happened), not
cancelled. Cancel stays for a member who really bought it and stops.

**User decisions (2026-10-09, in chat):**
- Build it as below.
- The Cancel box drops its "entered by mistake" choice and points to Remove instead.
- **Access:** the owner always. The owner can give a staff login the right on the Staff page
  (a new delete switch, "Plans added by mistake").

**Real case to prove it on:** K. Sri Devi.
- PT "Monthly PT (Daily)" sold 9 Oct on bill RF-2026-000082, ₹10,000 cash.
- It was then cancelled with a −₹10,000 cash refund; the dashboard shows the "Paid and given back" pair.
- Remove on that cancelled PT must take out the plan, the bill, the payment, the refund and the trainer
  share. The pair disappears and Collected doesn't change.

## Global constraints
- All Firestore writes go through `@/lib/firestore` (it writes the audit log).
- Plain-English UI copy, ₹ via `formatPrice`, dates via `formatDateISO`.
- Pure maths in `src/lib/*.ts` with relative imports, tested with `node --test` (add the file to `npm run test:cfo`).
- Never delete without a copy: everything goes to the Recycle Bin (`recycleBin` + `recycleBinItems`),
  and Undo / Restore puts it back.
- Accessibility: buttons have aria-labels, and focus is kept.
- Screenshots light/dark at 390 and 1440.
- Production rules change → ask the user before deploying (Rules REST API, see memory).

## What Remove takes out ("the sale")
Start from the chosen plan P and grow the set S until nothing changes:
1. The bill of any plan in S (`bill.membershipId` / `bill.ptAssignmentId` / `plan.invoiceId`). Every
   plan on that bill joins S (a gym + PT sold together goes together).
2. An old-software payment (`oldSoftware: true`) linked to a plan in S: its other plan joins S (an old
   gym + PT pair shares one payment).
3. A cancelled plan in S: every plan with the same `cancelId` must already be in S. Otherwise refuse:
   "It was cancelled together with <names>. Restore it first, then remove this plan."

Then the records:
- Bills linked to S, plus their `publicInvoices/<publicToken>`.
- Payments with `invoiceId` in those bills. Leave out a refund whose `cancelId` belongs to a
  cancellation outside S.
- Payments with `cancelId` in S's cancellations (the refunds).
- Old-software payments linked to S.
- Any other payment whose `membershipId` / `ptAssignmentId` is in S.
- Trainer payouts with `ptAssignmentId` in S, or `invoiceId` in those bills, or `cancelId` in S's
  cancellations (adjustment lines too).
- `enrollments/<plan.enrollmentId>` for the plans in S.

**Refused (with what to do instead):**
- A payout in the set with `status === "paid"`: "Trainer X was already paid ₹Y for this: use Cancel
  (their next payout goes down)."
- A non-old payment dated before `cashOpenFrom(today)` (closed Day Book month): "₹X paid on D is in
  a closed Day Book month: use Cancel instead."
- An upgrade plan whose old plan is itself cancelled or gone: refuse, and use Edit plan.

**Put back (plans that stay, changed by the sale):**
- **Upgrade:** a plan Q with `upgradedTo` in S gets back `endDate = originalEndDate`, status by
  dates (`pending` if it starts later, `active` if today is inside, `expired` if ended), and loses
  `upgradedTo/upgradeFrom/upgradeCredit/originalEndDate`.
- **Renewal that ended earlier plans** (`prevActive` in `enrollment.service.ts:404`):
  - From now on the sale stamps `endedBy: <new membershipId>` and `statusBeforeSale` on each plan it
    expires. Remove puts back `statusBeforeSale` (or status by dates).
  - Older sales (no stamp): if S has a gym plan and, after removal, no gym plan of the member runs
    today, the latest non-cancelled, non-upgraded gym plan with status `expired` and
    `endDate >= today` goes back to status by dates.
- **The member's `currentMembership`:**
  - A plan running today (latest start) wins; else the next upcoming; else the latest ended; else
    `null`.
  - Set `client.status = "active"` only when one runs.
- **Door:** queue a `door_check` biometricCommand (see `doorCheck()` in recycle-bin.service).

## Files
- Create `src/lib/plan-remove.ts`: the pure decision, `planRemoval(facts) → RemovalPlan`.
- Create `src/lib/plan-remove.test.ts`.
- Create `src/services/plan-remove.service.ts`:
  - `previewRemovePlan(client, kind, plan)` reads the member's memberships, ptAssignments, invoices
    and payments (by `clientId`), the payouts for the PT ids, and enrollments by id. It returns
    `{ error, lines, plan }`.
  - `removePlan(client, kind, plan, by)` re-reads, re-plans, then writes ONE batch:
    - copies of every deleted or changed doc as recycleBinItems (the changed plans' copies hold their
      as-was state);
    - the bin entry (section `"plans"`, `extra: { kind: "plan", clientId, planIds }`);
    - the deletes, the put-back patches, the client update and the door check.

    It returns the bin id.
- Create `src/components/clients/remove-plan-dialog.tsx`, matching the agreed mockup:
  - title "Remove <plan>?";
  - "Added by mistake: it is taken out as if it was never added.";
  - the list of what goes;
  - a note when Collected / income change (or "these add up to ₹0");
  - buttons [Keep it] [Remove plan], or the refusal text with no Remove button.
- Modify:
  - `src/types/models.ts`: add `"deletePlans"` to STAFF_FEATURES, `"plans"` to DELETE_SECTIONS, and
    optional `endedBy?` / `statusBeforeSale?` on Membership.
  - `src/constants/features.ts`:
    - `deletePlans: { label: "Plans added by mistake", hint: "Remove a gym or PT plan with its bill, payments and trainer share" }`
    - add it to DELETE_FEATURES
    - `DELETE_FEATURE_OF.plans = "deletePlans"`
  - `src/routes/_authenticated/recycle-bin.tsx`: SECTIONS gets `plans: { label: "Plans", icon: … }`.
  - `src/services/recycle-bin.service.ts` `restoreFromBin`: for `extra.kind === "plan"`, after writing
    the items back, recompute `currentMembership` (same helper) and queue a door check.
  - `src/services/enrollment.service.ts:404`: stamp `endedBy` + `statusBeforeSale` on `prevActive`
    plans.
  - The plan rows show a bin icon "Remove <plan> (added by mistake)" when `canDelete("plans")`, on
    running, upcoming and cancelled plans:
    - `src/routes/_authenticated/clients.$clientId.tsx`: Active card ~line 965, Membership history
      ~line 750;
    - `src/components/clients/plans-control.tsx` (`ClientPtPlans`).
  - `plans-control.tsx` CancelPlansDialog:
    - remove the old-money radio (see "Leftover" below);
    - add a muted line: "Added by mistake? Don't cancel: use Remove (bin icon) — it takes the plan
      and its money out as if it was never added."
  - `firestore.rules` trainerPayouts: `read` and `delete` also `|| can('deletePlans')`. Deploy only
    with the user's OK; until then the owner works, and a staff login with the switch fails on PT
    plans with a trainer share.

## Leftover from this chat (branch `cancel-old-money`, NOT committed)
Step 2 was first built as a choice in the Cancel box. It is superseded by Remove (user's decision).
Discarding it was blocked by the auto-mode safety check, so the working tree still holds it:
- `src/lib/cancel-old-money.ts` + test, and `package.json` test:cfo entry;
- `plan-cancel.service.ts` `oldMoneyOut` take-out + Restore put-back;
- CFO `oldMoneyOut` in `lib/cfo/{plans,types}.ts`, `server/cfo-data.ts` + 2 tests;
- `models.ts`, `memberships.service.ts`, `pt.service.ts` `oldMoneyOut`;
- the radio UI in `plans-control.tsx`.

With the user's OK, start the new branch clean: `git stash push -u -m "step2 cancel choice (superseded)"`,
then `git checkout main && git checkout -b remove-plan`. Without an OK, build on top and delete those
parts by hand.

## Tasks
- [x] **1. Pure decision** (`src/lib/plan-remove.ts` + tests first). Cases:
  - a gym sale on its own bill;
  - gym + PT on one bill (both go);
  - Sri Devi: a cancelled PT with a refund (payment + refund + payout go, lines say ₹0 net);
  - an old-software plan with its payments;
  - an old gym + PT shared payment;
  - cancelled together with a plan outside → refused;
  - a paid payout → refused;
  - a payment before openFrom → refused;
  - an upgrade → put back the old plan's end date;
  - a renewal with `endedBy` stamp → put back; legacy renewal → revive rule;
  - an unrelated refund pointing at the bill → kept;
  - currentMembership picks.

  Run `npm run test:cfo`. Commit.
- [x] **2. Service + sale stamp** (`plan-remove.service.ts`, `enrollment.service.ts` stamp,
  `restoreFromBin` hook). Typecheck. Commit.
- [x] **3. UI + access** (dialog, bin icons, feature switch, Recycle Bin section, Cancel-box line,
  rules file). Lint and typecheck. Commit.
- [x] **4. Emulator suite** `remove_local.py` (copy the harness from scratchpad
  376e89b1…: `emu.py`, `serve.sh`, `restart_local.sh`, `regress.sh` with its own path).
  - Seed Sri Devi's case, gym + PT bill, old plan, upgrade, renewal.
  - Check that Remove clears the records, Undo / Restore put back exactly, and refusals show.
  - Check that a staff login without the switch sees no bin icon, and with it can remove.
  - Check that Dashboard Collected loses the pair.
  - Screenshots light/dark 390/1440.
  - Then run `bash regress.sh remove_local.py plans_end_local.py undo_refund_local.py moneyfix_local.py latedates_local.py olddates_local.py`.
- [x] **5. Review**: one reviewer agent on the money paths. Fix what it confirms, then re-run the
  suites.
- [x] **6. Handoff + memory**: update HANDOFF, ask about merge/push and the rules deploy.
