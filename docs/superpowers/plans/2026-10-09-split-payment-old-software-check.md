# Cash + UPI split payment + old-software records check — Implementation Plan

> **For agentic workers:** executed inline (superpowers:executing-plans). Steps use `- [ ]`.

**Goal:** Take one payment in two modes (Cash + UPI) everywhere money is typed in, correct it later,
and warn when "paid in the old software" is ticked for a plan the old software's records don't have.

**Architecture:** A split = two `payments` docs sharing `splitId` (UPI part first), so every money
reader stays unchanged; pure helpers in `src/lib/split-pay.ts`. The old-software check is a pure
matcher `oldPlanCovering` in `src/lib/old-data.ts`, used by the checkout, Edit plan / Edit PT plan
and the server's owner list.

**Tech Stack:** React 19 + TanStack Start, Firestore (client SDK through `@/lib/firestore`),
node:test unit tests (`npm run test:cfo`), Python Playwright emulator suites (scratchpad harness).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-09-split-payment-old-software-check-design.md`.
- Mode label is exactly `Cash + UPI`; both parts > ₹0; parts stored UPI first, then Cash.
- No money reader may change meaning: Day Book cash = Cash payments only, as today.
- No Firestore rules change (staff already write `payments`); no composite indexes (one equality
  or one range per query).
- Lib files tested by node: relative `.ts` imports, `import type` only for `@/` types.
- Phone width 390 px; light + dark; 4.5:1 contrast; keyboard reachable.

---

### Task 1: Split helpers (pure, TDD)

**Files:** Create `src/lib/split-pay.ts`, `src/lib/split-pay.test.ts`; add the test to `test:cfo`
in `package.json`.

**Produces:**
- `SPLIT_MODE = "Cash + UPI"`, `type PayMode = PaymentMethod | typeof SPLIT_MODE`
- `splitParts(total, cash): { method: "UPI" | "Cash"; amount: number }[]` (UPI first)
- `splitProblem(total, cash): string` ("" = fine)
- `splitAllocation<T extends Record<string, number>>(whole: T, first: T): T` (second part)
- `billModes(parts: {method; amount}[]): { paymentMethod; paymentModes: PaymentMethod[] | null }`
- `billModesLabel(bill: { paymentMethod: string; paymentModes?: readonly string[] | null }): string`

Tests: 1800/1500 → UPI 300 + Cash 1500; cash 0 / cash ≥ total / total 0 → problems; allocation
second part = whole − first (e.g. trainer 1166.67 whole, 194.44 first → 972.23); labels.

### Task 2: Data fields + mappers

**Files:** `src/types/models.ts` (Payment `splitId?: string`; Invoice + PublicInvoice
`paymentModes?: PaymentMethod[] | null`), payment mapper (`finance.service.ts`), invoice mapper
(`invoices.service.ts`), public invoice reader (`routes/invoice.$token.tsx`).

### Task 3: `PayModeField` (shared UI)

**Files:** Create `src/components/billing/pay-mode-field.tsx`.
Props: `{ id; mode: PayMode; onMode(m); cash: string; onCash(s); total: number; error?: string;
split?: boolean /* offer Cash + UPI, default true */ }`. Chips Cash · UPI · Card · Bank Transfer ·
Cash + UPI (radiogroup, same classes as today). Split: "Cash part ₹" input + live line
"UPI ₹300 + Cash ₹1,500" or the `splitProblem` text.

### Task 4: Checkout split

**Files:** `src/services/enrollment.service.ts` (input `split?: { cash: number } | null`; two
payment docs with `splitId`, allocation via `splitAllocation`, bill `paymentModes`),
`src/components/enrollment/enrollment-wizard.tsx` (mode + cash state, draft, validation,
summary line, Day Book hint).

### Task 5: Collect balance split + Undo

**Files:** `src/services/finance.service.ts` (`recordBalancePayment` opts `cash?: number` → two
docs; returns `{ paymentId, paymentIds }`; `undoBalancePayment` takes back every part sharing the
`splitId`), `src/components/billing/invoice-actions.tsx` (PayModeField).

### Task 6: Edit payment edits a split as one payment; Paid on moves both

**Files:** `src/services/payment-edit.service.ts` (`PaymentEditForm.cash?: number | null`;
`editPayment({... group })`: one → split (new Cash doc), re-balance, split → one (delete the other
part); total fixed while split; date/note to all parts; bill `paymentMethod`/`paymentModes` for
initial payments; `paymentChanges` describes the group), `src/services/finance.service.ts`
(`getSplitParts(splitId)`), `src/components/billing/edit-payment-dialog.tsx`,
`src/components/clients/paid-on-field.tsx` (pass the group).

### Task 7: Remove guard, labels, row tags

**Files:** `src/lib/payment-remove.ts` (refuse a split part: "choose one mode in Edit payment
first"), bill label via `billModesLabel` in `routes/invoice.$token.tsx`, `lib/invoice-pdf.ts`,
`routes/_authenticated/billing.tsx`, `hooks/use-reports-data.ts`, `hooks/use-dashboard-metrics.ts`;
"· Cash + UPI" on payment rows (dashboard lists, member page payments, Day Book).

### Task 8: Old-software records check

**Files:** `src/lib/old-data.ts` (`oldPlanCovering(person, { kind, start, end })`,
`oldPersonFor(records, { oldMemberId, name })`), `src/lib/old-data.test.ts`;
`src/server/old-sales.ts` (`notInOld` rows in the suspects reply); `src/components/finance/
old-sales-review.tsx` (second list "Saved as paid in the old software, not in its records");
hook `src/components/clients/use-old-record-check.ts` used by the wizard (warning + "Paid here
(untick)" + ConfirmDialog on save) and Edit plan / Edit PT plan (note).

### Task 9: Verify

- `npx tsc --noEmit`, `npx eslint <changed files>`, `npm run test:cfo`, `npm run build`.
- Emulator suite `split_local.py` (scratchpad harness from 32d649c3…): checkout split → Day Book
  cash/UPI + bill label + public bill; Collect balance split + Undo; Edit payment split /
  re-balance / merge; Paid on moves both; Remove refuses a part; old-software warning + confirm +
  untick; Edit plan note; owner list; screenshots 390/1440 light/dark.
- Regressions: paidon, paidon_edit, latedates, remove, moneyfix, audit2, audit9.
- One reviewer agent (money code). Update `docs/HANDOFF.md`, memory; commit locally.
