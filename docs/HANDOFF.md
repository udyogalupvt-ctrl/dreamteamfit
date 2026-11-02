# Handoff

Last updated: 2026-11-02 (WhatsApp fix a9938fb local, needs founder OK to push; before: wrong-thumb fix LIVE: main 494620f, /api/version = 494620f4eba0; rules 5377c302. History: `docs/archive/HANDOFF-history-to-2026-10-22.md`, `docs/archive/HANDOFF-history-2026-10-22-to-24.md`)

## State: wrong-thumb fix LIVE (2026-10-30, 21a0e51, main 494620f)

- Problem: another member's finger got registered for a member. Now: member page → Entry (thumb) →
  "Wrong thumb? Register again" (confirm). Server task `thumb_reset` (src/server/biometric.ts `resetThumb`,
  checked in `taskRefusal`: the ID must be that person's and no one else's) at the machine's next check-in:
  DATA DELETE USERINFO PIN=x, erases `biometricTemplates/<id>`, cancels the old enroll/query commands (a late
  upload can't come back), member → firstThumbRegistered false, not_enrolled (a staff block stays), audit line.
  Then the normal "Register thumb" shows. Staff dialog "Register again" does the same first, then the form opens.
- Checks: tsc OK, unit 505/505, rules 72/72 (thumb_reset cases added), build OK, local E2E 14/14
  (scratchpad 9c17ca11…/k/rethumb_local.py, `bash regress.sh rethumb_local.py`; shots in shots_rethumb/).
- SHIPPED 2026-10-30 (founder OK): production rules 5377c302 deployed first (matches file; old ruleset 9d846f06 backup
  in scratchpad 74f47232…/live_rules_backup_2026-10-30.txt), then main + five-features pushed, live build 494620f4eba0.
  Founder confirmed it works live.
- Visits logged under the wrong member while the wrong thumb was on: remove them with the existing remove-visit button.

## State: WhatsApp over-messaging fix (2026-11-02, a9938fb, LOCAL only, not pushed)

- Missed-workout nudge counts only OPEN days: Sundays + gym holidays skipped, no nudge on those nights
  (`gymClosed`/`openDaysMissed` in src/lib/reminders.ts). Settings → Reminders → "Gym holidays" list
  (settings/automation `holidays: string[]`, ISO dates; rules unchanged).
- Balance due: was daily for N+1 days; now one message N days before + one on the due day
  (`paymentDueToday`), max one per member per day.
- Checks: unit tests pass, build OK, local E2E 8/8 (scratchpad 9c17ca11…/k/holidays_local.py; shots_holidays/).
- Javani (other repo, a55db98 local): fee reminders 3 per fee (5 days before, due day, 3 days late), late rental every 72 h.

## Next steps

- Push a9938fb (Rebuild) and a55db98 (Javani) only on the founder's OK; no rules deploy needed. After push: add the gym's holidays in Settings → Reminders.

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
