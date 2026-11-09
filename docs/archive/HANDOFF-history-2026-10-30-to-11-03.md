# Handoff history 2026-10-30 to 2026-11-03

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

