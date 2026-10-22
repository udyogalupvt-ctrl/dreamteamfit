# Handoff

Last updated: 2026-10-22 (E + B built on branch `five-features`; C in progress. Old history: `docs/archive/HANDOFF-history-to-2026-10-22.md`)

## NEXT: 5 new features for Rebuild Fitness (founder picked 2026-10-22)

**State (branch `five-features`, local only):** spec `docs/superpowers/specs/2026-10-22-five-features-design.md`, plan
`docs/superpowers/plans/2026-10-22-five-features.md`. E DONE (b63bd80). B DONE (8d9cf46, E2E 33/33; kit suite
`progress_local.py`). C: core logic + tests committed (`src/lib/review-prompt.ts`, `src/lib/feedback.ts`); next = server
`src/server/portal-feedback.ts`, rules (`settings/memberApp`, `feedback`), /feedback inbox page, Settings review link,
member-app review card + feedback tab, E2E. Then D, then A. Rules for healthForms/bodyProgress NOT deployed.
**Founder 2026-10-22: no approval per step.**
Decide the brainstorm answers and designs yourself (write them into the plan), then plan → build → test end to end
(build, tests, emulator rules tests, light/dark 390/1440 screenshots). Ask the founder ONLY for: push to live,
production rules deploy, real-money actions on the live app, paid spend, and facts only they have (gym UPI ID,
Google review link: build with Settings fields so these can be filled later). Money feature (A) = reviewer agent.
Suggested order: E, B, C, D, then A.
Check `git branch --show-current` / `git log` first: other chats may work in this folder. Main = 12c8fac (+ local
handoff commits).

| # | Feature | Founder's decision / notes |
|---|---|---|
| A | **Online payment by UPI link** | An ADD-ON (founder 2026-10-22): desk payment stays exactly as it is; this is one extra way to pay. Founder OK'd the manual desk Confirm. NO gateway (no Razorpay). Gym's UPI ID in Settings. Renewal reminder (WhatsApp) + member app `/m` show "Pay ₹X" → hosted page (`/pay/<token>`: QR + `upi://pay?pa=…&am=…&tn=<bill no>` button; WhatsApp buttons need https). Member taps "I've paid" (+ optional UTR). Desk gets a "Payments to confirm" list, checks the bank app, Confirm = normal collect path (same rules, closed months, undo). Nothing auto-marks paid. |
| B | **Body progress tracking** | Weight, body fat, measurements, progress photos; logged by trainer (`/t`), desk, or member (`/m`); chart in member app. |
| C | **Google review requests + feedback** | Google review link in Settings; ask at a good moment (after first month / at renewal). Watch WhatsApp cost (founder cares): prefer member-app prompt + reuse existing templates; new templates need Meta approval. Feedback/complaint box in `/m` → owner inbox. |
| D | **Referral rewards** | "Referred by" member at enrollment/inquiry. Owner decides the reward each time: app shows "Reward due" list; owner records what was given (free days / discount / gift + note). |
| E | **Health form / waiver** | In the member app: member fills it on their own phone (PAR-Q style questions + consent), once. Profile + desk show "Health form: done (date) / pending". Founder 2026-10-22: Claude writes the best possible starting form (questions + consent text), and the OWNER can edit it in Settings (add/remove/reword questions, edit the consent text), save, and the app uses the saved version from then on. Each acceptance stores the form version + answers + date, so old answers stay readable after edits; the owner can choose "ask everyone to accept again" after a big change. Mark the starting draft `[NEED: owner approval]`, never present it as legal text. |

Every feature: finish the whole flow (edit later, shown on profile, filters, staff permission in
`constants/features.ts`, Firestore rules + emulator rules tests, light/dark 390/1440 screenshots). Rules change ⇒
production rules deploy needs the founder's OK (recipe below).

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
