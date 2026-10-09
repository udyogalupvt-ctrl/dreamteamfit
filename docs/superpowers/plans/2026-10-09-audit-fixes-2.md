# Audit fixes 2: items 2, 4, 8 (2026-10-09)

Branch `audit-fixes-2` (on top of `audit-fixes-1`, not merged). Audit: [MIGRATION_AUDIT_2026-10-09.md](../../MIGRATION_AUDIT_2026-10-09.md).
Design approved by the user 2026-10-09 (PT-only sales: list + fix in place).

## Design

**8. One rule for the member's current plan** (`src/lib/current-plan.ts`, moved from `plan-remove.ts`
`pickCurrent`): running today (not cancelled / ended early, latest start) → else next upcoming
(earliest start) → else latest ended → else latest cancelled → else none. Used by every writer of
`clients.currentMembership` (sale, Add old plan, Edit plan, Cancel / Restore, Remove, thumb in the app
and on the machine, Excel import) and by the lists (`planByClient`). The morning `rollPlans` also
compares each member-with-a-live-plan's stored summary with the rule and corrects it (self-healing:
fixes wrong snapshots already in production). Also fixes: a sale / old plan whose dates are all past is
saved `expired` (it was saved `active`, became "current" and ended the running plan).

**2. Overlapping gym plans** (`src/lib/plan-overlap.ts`, pure):
- `enrollMember` (any gym sale except an upgrade's own plan) and Edit plan refuse dates that overlap
  another non-cancelled gym plan of the member, saying which plan and what to do (Edit its dates /
  Remove the copy). Also covers audit item 14 (old plan under a running later plan).
- Owner list "Plans that overlap" on Income & expenses: gym plans ending on/after the 1st of last
  month, pairs of one member's plans sharing ≥ 1 day. Not shown: cancelled; a plan ended by a renewal
  (`endedBy`, or ended in the same write as the sale: `updatedAt == createdAt` of the other); an
  upgrade (old plan already cut); pairs the owner marked "Not a duplicate" (`overlapOk: [otherId]` on
  both plans). Server `GET /api/old-data/overlaps` (finance).

**4. "Paid in the old software?" list**:
- PT-only sales are listed (payments with `ptAssignmentId` and no `membershipId`); old CSV plans
  matched by kind (PT ↔ PT plans, gym ↔ gym plans).
- Compared with old-software plans already in the app: a sale here sharing days with the member's
  `paidInOldSoftware` plan of the same kind → reason "Already in this app as an old-software plan …",
  strength strong.
- "Check & mark" works on a PT-only bill: `markPaidInOldSoftware` takes a gym OR a PT plan
  (plan doc `ptAssignments`, payment link `membershipId: null`, basis `{gym: null, pt}`); Undo already
  restores `before.ptAssignment`.
- Not done: looking back before the 1st of last month (those payments are in a closed Day Book month;
  the mark tool refuses them).

## Tasks
1. `current-plan.ts` + tests; `plan-remove.ts` imports it. Writers switched; `planByClient` uses it;
   `rollPlans` self-heals. Past-dated plans saved `expired`.
2. `plan-overlap.ts` + tests; guards in `enrollMember` + plan edit; overlaps endpoint + review component
   + "Not a duplicate".
3. `old-sales.ts`: PT, kind match, in-app old plans; `OldSaleSuspect` gains `kind`, `ptAssignmentId`.
   Mark/dialog for PT-only bills.
4. Checks: `npm run test:cfo`, tsc, eslint, build; emulator suite (sale overlap refusal, past old plan
   status, rollPlans heal, overlaps list + Not a duplicate, PT-only suspect + mark + Undo);
   screenshots light/dark 390/1440; one reviewer agent (money).
