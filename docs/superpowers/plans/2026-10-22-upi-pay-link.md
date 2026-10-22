# A. UPI pay link: implementation plan

> Spec: `docs/superpowers/specs/2026-10-22-five-features-design.md` section A. Money code: a reviewer
> agent checks it before the commit. Executed in the five-features session itself.

**Goal:** members can pay a balance or renew by UPI from a link; the desk confirms each payment
through the normal Collect / Renew paths. Nothing ever marks itself paid.

**Architecture:** `payLinks/{token}` docs are written only by the server (`src/server/pay-links.ts`,
admin SDK) and by the desk's confirm / not-received updates (rules-checked). The public page
`/pay/$token` talks to `/api/pay/*`; the member app asks `/api/portal/pay-link` for a link. Pure
rules (UPI ID shape, upi:// link, UTR, renewal offer, amounts) live in `src/lib/pay-links.ts`.

## Decisions (made by Claude, founder asked for no per-step approvals)

1. **UPI ID is owner-only** (`settings/upi`, same rule as the health form). A staff login with
   Settings could otherwise point members' money to their own UPI ID. Staff see it read-only.
2. **Test QR for ₹1 in Settings**: scanning it shows the bank's account name in the UPI app, so a
   valid-but-wrong UPI ID is caught before members pay a stranger. Hint: use the gym's business
   (merchant) UPI ID; some apps block pay links to personal UPI IDs, scanning still works.
3. Three ways to pay on `/pay`: "Pay with a UPI app" (upi:// link), the QR (another phone or
   "scan from gallery"), and the UPI ID with a Copy button.
4. "I've paid" takes an optional UPI reference (6-35 letters/digits, spaces dropped). The same
   reference already on another link is flagged to the desk (`utrSeenBefore`).
5. Amounts are worked out by the server every time: balance = the bill's balance now; renewal =
   the latest plan's package price now, with tax as in Gym & bills. `memberAmount` is the amount
   the member saw when they tapped "I've paid".
6. A link closes itself (status `cancelled`, reason shown) when the bill has nothing left to pay,
   the package stopped being sold, or the member's plans changed after it was made (planSeq). Open
   links expire after 30 days (a new one is made on the next tap); `member_paid` never expires.
7. Confirm writes the payment and the link in **one transaction**; the payment carries
   `payLinkId`, and rules allow `confirmed` only when that payment exists and names the link.
   Undo of that balance payment puts the link back to `member_paid` (rules: only once the payment
   is gone). A later Remove payment / Remove plan by Finance leaves the link closed (deliberate:
   it records that the desk confirmed the UPI money; fixing money afterwards is a Finance job).
8. Renewal offer in the member app: only when UPI is on, the latest plan's package is still sold,
   no plan is queued after today, and the current plan ends within 7 days (or has ended).
9. The renewal reminder (`gym_membership_expiry`) has no URL button, so it is unchanged (no new
   template). `gym_payment_due` already opens `/invoice/<token>`, which gets the pay button.
10. Collect balance gets an optional **Note** field (any payment; prefilled "UPI ref …" from a
    link). `Payment.note` already exists and Edit payment already writes it.

## Data

`settings/upi`: `{ upiId: string ("" = off), payeeName: string, updatedAt, updatedBy }`.

`payLinks/{token}` (token: 24 URL-safe random characters):
`clientId, clientName, memberCode, kind: "balance"|"renewal", invoiceId, invoiceNumber,
invoiceToken, packageId, packageName, planSeq, amount, status: open|member_paid|confirmed|cancelled,
closedReason, utr, utrSeenBefore, memberAmount, memberPaidAt, paidTimes[], deskNote, paymentIds[],
saleBillId, checkedBy, checkedByUid, checkedAt, createdAt, updatedAt, expiresOn`.

## Files

- Create `src/lib/pay-links.ts` + `src/lib/pay-links.test.ts` (UPI ID, payee name, upi:// link,
  note text, UTR, token, rate limit, renewal offer, renewal amount, status texts).
- Create `src/server/pay-links.ts`: `handlePay` (`GET/POST /api/pay/<token>`,
  `GET/POST /api/pay/bill/<invoiceToken>`), `memberPayLink(clientId, body)`,
  `memberPayInfo(clientId, ...)` for `memberData`.
- Modify `src/server/router.ts` (`/api/pay/`), `src/server/portal.ts` (`pay-link` action, `pay`
  data in `memberData`), `src/constants/portal.ts` (types).
- Create `src/services/pay-links.service.ts` (`subscribeUpiSettings`, `saveUpiSettings`,
  `subscribeLinksToConfirm`, `markNotReceived`) and `src/services/upi` types in `models.ts`.
- Create `src/components/pay/upi-qr.tsx` (QR as one SVG path, `uqr`), `src/routes/pay.$token.tsx`.
- Create `src/components/billing/pay-links-to-confirm.tsx` (Billing section, Not received dialog).
- Create `src/hooks/use-pay-links-badge.ts`; modify `nav-list.tsx`, `topbar.tsx`, `dashboard.tsx`.
- Modify `invoice-actions.tsx` (export the Collect dialog, `fromLink` prefill, Note field),
  `finance.service.ts` (`note`, `payLinkId`, confirm in the same transaction, Undo puts it back),
  `enrollment-context.tsx` + `enrollment-wizard.tsx` (`payLink` prefill, no draft restore),
  `enrollment.service.ts` (`payLinkId`: confirm in the sale's transaction).
- Modify `settings.tsx` (Online payment (UPI) section), `invoice.$token.tsx` (Pay button),
  `m.$code.tsx` (Pay on bills, Renew online), `audit-describe.ts` (payLinks lines),
  `firestore.rules` + `tests/rules` (payLinks, settings/upi).
- Dependency: `uqr` (zero-dependency QR encoder), exact version.

## Rules

```
settingsWriter: healthForm and upi = owner only; upi shape = upiId/payeeName strings ≤ 100 / 50.
payLinks: read = billing; create/delete = never (server only); update = billing and one of
  member_paid → open      (keys: status, deskNote, utr, memberAmount, memberPaidAt, checked*)
  member_paid → confirmed (keys: status, paymentIds, saleBillId, checked*; getAfter(payment
                           paymentIds[0]).payLinkId == token)
  confirmed → member_paid (same keys; !existsAfter(payment a.paymentIds[0]))
```

## Tests

- Unit: every function in `src/lib/pay-links.ts`.
- Rules: billing reads, others can't; create denied; not-received ok and field limits; confirm
  without a matching payment denied, with one ok; undo while the payment exists denied; settings/upi
  owner-only and shape.
- E2E `upi_local.py`: hidden while UPI is empty; owner sets UPI (bad ID error, test QR), staff
  can't; member app Pay on a bill → `/pay` (amount, upi:// href, QR, Copy) → "I've paid" with a
  reference → thanks; desk badge + bell + card (reference, same-reference warning); Confirm →
  Collect prefilled → saved → link confirmed, member page says received; Undo → back to the list;
  Not received with note → member sees the note; invoice page Pay button; Renew online → Confirm →
  wizard prefilled → sale → confirmed; bill paid at the desk closes an open link; permissions
  (no billing = no list, rules 403); activity lines; screenshots light/dark 390/1440 of `/pay`,
  the Billing section, Settings UPI, member Payments.
