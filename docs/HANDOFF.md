# Handoff

Last updated: 2026-10-22 (all 6 features built on branch `five-features`, local only. Old history: `docs/archive/HANDOFF-history-to-2026-10-22.md`)

## State: 6 new features DONE on `five-features` (not merged, not pushed)

Spec `docs/superpowers/specs/2026-10-22-five-features-design.md`, plans `docs/superpowers/plans/2026-10-22-five-features.md`
and `docs/superpowers/plans/2026-10-22-upi-pay-link.md`. E health form (b63bd80), B body progress (8d9cf46), C review +
feedback (949c355), F app-only announcements (45ae50b), D referrals (9e6c106), **A UPI pay link (see git log)**.
Checks at A: rules 62/62, unit 500/500, E2E `upi_local.py` 81/81. E2E suites: session scratchpad kit `k/`
(`bash regress.sh <suite>.py`). Main = 12c8fac. Check `git branch --show-current` first: other chats use this folder.

**A in one line:** member taps Pay (app Payments / Home renew / bill page) → `/pay/<token>` (UPI app link, QR, UPI ID)
→ "I've paid" (+ optional UTR) → Billing "Paid online" card + bell + dashboard → desk finds the money, ticks
"I found this ₹X", confirms through normal Collect / Renew (one transaction, Undo works) or "Not received" + note.
Rules: confirm only with a NEW payment for that bill/member tagged with the link; `payLinkId` can't be edited.

## Next steps

1. **Whole-branch review before merge** (6 features, new public endpoints `/api/pay/*`, member-app endpoints):
   `requesting-code-review` + Cloudflare `security-audit` quick profile on the branch diff vs main. Fix confirmed items.
2. **Founder asks (only they can):** (a) gym UPI ID + payee name in Settings → Gym & bills, then scan the ₹1 test QR to
   see the bank name; (b) Google review link (Settings); (c) approve the health form text (`[NEED: owner approval]`);
   (d) OK to merge + push live; (e) OK to deploy production rules (healthForms, bodyProgress, feedback, memberApp
   setting, referrals, payLinks, settings/upi; recipe below). Optional: `gym_payment_due` text mentioning UPI.
3. A's lower-priority reviewer notes (not fixed): two taps at the same moment can make two open links (both work, the
   desk sees one card each); a renewal amount is fixed when the member taps "I've paid" (desk sees the price change in
   the wizard); Undo by a login without Billing fails on the link (Finance can remove instead); no per-IP limit on the
   public GET `/api/pay/<token>` (token is 24 random chars); a Finance Remove of a confirmed payment leaves the link
   confirmed (deliberate, plan decision 7).

| # | Feature | Founder notes |
|---|---|---|
| A | UPI pay link | ADD-ON: desk payment unchanged; manual desk confirm OK'd; no gateway |
| E | Health form | starting text `[NEED: owner approval]` |

Every feature followed: edit later, shown on profile, filters, permission in `constants/features.ts`, rules + emulator
tests, light/dark 390/1440 screenshots.

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
