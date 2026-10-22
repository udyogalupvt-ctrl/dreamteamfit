# Handoff

Last updated: 2026-10-23 (whole-branch review done on `five-features`, local only. Old history: `docs/archive/HANDOFF-history-to-2026-10-22.md`)

## State: 6 features + review fixes on `five-features` (not merged, not pushed)

Spec `docs/superpowers/specs/2026-10-22-five-features-design.md`, plans `docs/superpowers/plans/2026-10-22-*.md`.
Features: E health form, B body progress, C review + feedback, F app announcements, D referrals, A UPI pay link.
Review 2026-10-23 (4 Opus reviewers, every finding checked): report `~/security-audit-skill/dreamteamfit/run-3/REPORT.md`
(fixed list + not-fixed list). Checks after fixes: rules 64/64, unit 500/500, tsc + build OK, E2E 371/371 (health 40, progress 33, feedback 78, announce 68, referral 68, upi 84).
E2E kit: `C:/Users/chala/AppData/Local/Temp/claude/c--Users-chala-OneDrive-Desktop-gym-saas/9c17ca11-50d0-492f-802b-de2297dc0339/scratchpad/k/`
(`bash regress.sh <suite>.py`; suites health/progress/feedback/announce/referral/upi `_local.py`). Main = 12c8fac.
Check `git branch --show-current` first: other chats use this folder.

## Next steps

1. **Merge blocker: member delete clean-up.** "Delete forever" leaves `healthForms`, `bodyProgress`, `feedback`,
   `referrals` behind (medical data outlives delete; a deleted member's due referral still counts). Add them to the
   recycle-bin `MEMBER_RECORDS` + restore rules (`src/services/recycle-bin.service.ts` ~388, `binMember`), with
   rules tests and an E2E bin/restore/delete run.
2. **Push blocker (founder):** run the owner check (Still open, Task 0→4). `isOwner()` trusts the email only, and
   the owner sets the UPI ID members pay to.
3. **Founder decisions:** (a) member doc keeps only `{version, signedOn, method, flagCount}` of the health form
   (now flags/notes are readable by every staff login)? (b) UPI ID + payee name, ₹1 test QR; (c) Google review link;
   (d) health form text `[NEED: owner approval]`; (e) OK to merge + push; (f) OK to deploy production rules.
4. Feature: "Paid online, waiting to confirm" banner + "Use it" in Collect (`invoice-actions.tsx`) and Renew wizard.
5. Low items: see run-3 REPORT "Not fixed" 5 and A's notes (two taps → two open links; renewal amount fixed at
   "I've paid"; Undo without Billing fails on the link; no per-IP limit on GET `/api/pay/<token>`).

## Live state (2026-10-22)

- Live hardening SHIPPED 2026-10-18: main 12c8fac pushed, `/api/version` = `12c8fac213f1`; production rules
  deployed (ruleset d3ff71ad…). Rollback: `node deploy_rules.mjs <backup>`; scripts + backup + diff in scratchpad
  `C:/Users/chala/AppData/Local/Temp/claude/c--Users-chala-OneDrive-Desktop-gym-saas/097e3934-b572-475b-990f-4608bd2028aa/scratchpad/`
  (`read_live_rules.mjs`, `deploy_rules.mjs`, `live_rules_backup_2026-10-18.txt`, `rules_diff.txt`).
- Live browser check 2026-10-22 PASSED: salary-expense delete (owner) and staff login keerthi M (her 12 features
  load; /staff /settings /recycle-bin /backup blocked). NOT checked live: Delete-bills bin, desk collect/undo (money
  write; emulator 17/17), fingerprint enroll (real door command).

## Still open (older)

- Task 0 → Task 4: founder runs the read-only owner check and pastes output:
  `node "C:/Users/chala/AppData/Local/Temp/claude/c--Users-chala-OneDrive-Desktop-gym-saas/11359acb-2cda-47fc-98e8-3aa1650a7110/scratchpad/prod_owner_check.mjs" "C:/Users/chala/OneDrive/Desktop/gym saas/dreamteamfit"`
  Then remove `admin@elevategym.com` from rules + `owners.ts`; email_verified only if verified.
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
