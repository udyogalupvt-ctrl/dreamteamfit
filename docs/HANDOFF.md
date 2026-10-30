# Handoff

Last updated: 2026-10-30 (wrong-thumb fix 21a0e51 on `five-features`, LOCAL only; needs rules deploy + push with founder OK. Live = main c0d4e0f. History: `docs/archive/HANDOFF-history-to-2026-10-22.md`, `docs/archive/HANDOFF-history-2026-10-22-to-24.md`)

## State: wrong-thumb fix on `five-features` (2026-10-30, 21a0e51, NOT live)

- Problem: another member's finger got registered for a member. Now: member page → Entry (thumb) →
  "Wrong thumb? Register again" (confirm). Server task `thumb_reset` (src/server/biometric.ts `resetThumb`,
  checked in `taskRefusal`: the ID must be that person's and no one else's) at the machine's next check-in:
  DATA DELETE USERINFO PIN=x, erases `biometricTemplates/<id>`, cancels the old enroll/query commands (a late
  upload can't come back), member → firstThumbRegistered false, not_enrolled (a staff block stays), audit line.
  Then the normal "Register thumb" shows. Staff dialog "Register again" does the same first, then the form opens.
- Checks: tsc OK, unit 505/505, rules 72/72 (thumb_reset cases added), build OK, local E2E 14/14
  (scratchpad 9c17ca11…/k/rethumb_local.py, `bash regress.sh rethumb_local.py`; shots in shots_rethumb/).
- To go live: production rules deploy (firestore.rules adds 'thumb_reset' to the note list) BEFORE the code
  push (old rules refuse the note: button would show an error), then merge to main + push. Both need founder OK.
- Visits logged under the wrong member while the wrong thumb was on: remove them with the existing remove-visit button.

## Earlier state: LIVE main c0d4e0f (2026-10-24)

- Collected today: a ONE-day "Collected" (Dashboard card + its list, Billing card) leaves out money paid in the
  old software (its date = the old plan's start; the old export has no payment date) and shows it apart, like the
  Day Book. Month totals and reports still count it. Helper `oldMoneyOnDay` in `lib/periods.ts`. Live check:
  24 Oct shows ₹0 + "₹7,500 paid in the old software" (Govindha Rao ₹5,000, R.KAVITHA ₹2,500, plans start today).
- Member 46 (B.Karthikeya) carry: the "clear that first" block now only counts old-marked rows of the SAME kind
  as the old plan (a PT hand-entry can't be a copy of an old gym plan). Founder-authorised, Claude pressed
  "Add it here, as it is" live: Annual Package (1 Dec 2025 → 30 Nov 2026) now active, thumb being added back.
  Left as is: his PT plan 17 Sep → 16 Oct "Paid in the old software" (₹12,000 price) that the old records don't
  have: owner decides if it was really paid there or here (would be money missing from October).
- Checks: tsc OK, unit 505/505, build OK. `.gitignore` local edit (`.env*`) is not ours, left uncommitted.

## Next steps

1. **Live look (founder or Claude in the "gym" Chrome):** owner login, Settings → UPI section, member app health
   form / progress / feedback. Then founder decisions in 2.
   2026-10-23 partial (Claude, "DREAM TEAM SERVICES" Chrome, logged in as staff keerthi M): live build c379405483e1
   (= b18c1a0 code + handoff). Referrals page and Announcements page load, no console errors; /settings correctly
   blocked for staff; bare /m is a 404 by design (links are /m/<code>). Owner (rebuildfitnesskkd, founder signed in)
   PASSED read-only: Settings → "Online payment (UPI)" card shows (UPI ID + Name members see empty, so Pay buttons are
   off); Settings → Member app tab: Health form (switch off, 10 draft questions, Version 1) + Google review link
   (empty); /feedback page loads ("All caught up"); new sidebar items Referrals, Announcements, Member feedback;
   no console errors. STILL TO DO: member app screens need a real member's code + DOB → founder checks on their phone.
2. **Founder decisions:** (a) member doc keeps only `{version, signedOn, method, flagCount}` of the health form
   (now flags/notes are readable by every staff login)? (b) UPI ID + payee name, ₹1 test QR; (c) Google review link;
   (d) health form text `[NEED: owner approval]`; (e)/(f) DONE 2026-10-23 (merge local, rules deployed).
3. Feature: "Paid online, waiting to confirm" banner + "Use it" in Collect (`invoice-actions.tsx`) and Renew wizard.
4. Low items: see run-3 REPORT "Not fixed" 5 and A's notes (two taps → two open links; renewal amount fixed at
   "I've paid"; Undo without Billing fails on the link; no per-IP limit on GET `/api/pay/<token>`).

## Still open (older)

- Task 4 left: add email_verified to `isOwner()` only if the owner's email is verified. Read-only check (founder runs,
  auto mode blocks it): `node "C:/Users/chala/AppData/Local/Temp/claude/c--Users-chala-OneDrive-Desktop-gym-saas/e0dbd847-18c9-4aa3-9551-cd18e501b39c/scratchpad/owner_check.mjs" "C:/Users/chala/OneDrive/Desktop/gym saas/dreamteamfit"`
- Adversarial security review of the hardening (needs ultracode). Task 11 (relay key).
- Reviewer notes: desk can create a bill with any invoiceNumber (duplicates); two Finance refunds at the same
  moment can pass the refund limit; door_check uses a staff-editable biometricUserId.
- Founder question: keep the closed-month lock for the owner too, or add an owner-only logged correction?
- Deferred founder decisions: financial-year bill series, payout paid = cash line, one-transaction restore, GST,
  App Check, CSP enforce.
- Plan of the hardening: `docs/superpowers/plans/2026-10-17-live-hardening.md`.

## Gotchas

- Tests: `npm run test:rules` (emulator 8780), `npm run test:cfo`, emulator regression kit `bash regress.sh`
  (details in the archive, 2026-10-18 section).
- Live push AND production rules deploy need the founder's explicit OK each time. Never leave test data in
  production. Real money writes on the live app: the founder does them (auto mode refuses).
- "I pushed main" may mean only the feature branch was pushed: `git fetch` and compare origin/main first.
- Scratchpad `13f12f45…/wt-main` is a worktree with a node_modules JUNCTION: `cmd /c rmdir` it before
  `git worktree remove`.
