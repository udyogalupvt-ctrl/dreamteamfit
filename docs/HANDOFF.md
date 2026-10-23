# Handoff

Last updated: 2026-10-24 (SHIPPED main c0d4e0f, live c0d4e0f46ea4: Collected-today + member 46 carry fix. Before: main b18c1a0; prod rules 9d846f06 DEPLOYED. Earlier: carry fix + leads "Came back" 5eba9ee; member delete clean-up done on `five-features`, local only. Old history: `docs/archive/HANDOFF-history-to-2026-10-22.md`)

## State: LIVE main c0d4e0f (2026-10-24)

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

## Earlier: six features LIVE (main b18c1a0, 2026-10-23)

- 2026-10-23: founder OK'd merge + push + deploy and chose to drop the dev owner login: `admin@elevategym.com`
  removed from `firestore.rules` + `owners.ts` (2ff2498). Checks: tsc OK, unit 502/502, rules 72/72, build OK.
- Pushed main + five-features = b18c1a0 (gh logged in as udyogalupvt-ctrl via device code, `gh auth setup-git`).
  Vercel serves b18c1a040f2a; /, /login, /m, /t load. Not yet checked logged in (owner, Settings → UPI, member app).
- Production rules DEPLOYED 2026-10-23: ruleset 9d846f06 (read back, matches file). Rollback = previous live
  rules backup `C:/Users/chala/AppData/Local/Temp/claude/c--Users-chala-OneDrive-Desktop-gym-saas/e0dbd847-18c9-4aa3-9551-cd18e501b39c/scratchpad/live_rules_backup_2026-10-23.txt`
  via `node deploy_rules.mjs <file>` (097e3934 scratchpad below). New rules are safe with the old live app.
- Not done: `email_verified` in `isOwner()` (unknown if the owner's email is verified; lockout risk).

## Earlier state: 6 features + review fixes on `five-features`

Spec `docs/superpowers/specs/2026-10-22-five-features-design.md`, plans `docs/superpowers/plans/2026-10-22-*.md`.
Features: E health form, B body progress, C review + feedback, F app announcements, D referrals, A UPI pay link.
Review 2026-10-23 (4 Opus reviewers, every finding checked): report `~/security-audit-skill/dreamteamfit/run-3/REPORT.md`
(fixed list + not-fixed list). Checks after fixes: rules 64/64, unit 500/500, tsc + build OK, E2E 371/371 (health 40, progress 33, feedback 78, announce 68, referral 68, upi 84).
E2E kit: `C:/Users/chala/AppData/Local/Temp/claude/c--Users-chala-OneDrive-Desktop-gym-saas/9c17ca11-50d0-492f-802b-de2297dc0339/scratchpad/k/`
(`bash regress.sh <suite>.py`; suites health/progress/feedback/announce/referral/upi `_local.py`). Main = 12c8fac.
Check `git branch --show-current` first: other chats use this folder.

Member delete clean-up (2026-10-23, done): health forms, body progress, feedback and referral rewards (theirs + the
ones they earned) now go to the Recycle Bin with the member (`HELD` in `recycle-bin.service.ts`). Their bin copy sits
at the fixed id `recycleBinItems/<collection>_<docId>`; rules let the record leave only with that copy and come back
only as that copy (batches of 8: rules lookup limit). A held record that exists again (friend given a new referrer)
keeps its newer version. Also fixed: restoring a member who signed a health form failed (clients create blocked
`healthForm`; now allowed for Recycle Bin / Delete members logins). Checks: rules 72/72, unit 500/500, tsc OK,
E2E binheld 14 + referral 68 + health 40 + feedback 78 + progress 33 all pass. Known, by choice: friends keep
`referredBy` on their profile after their referrer is deleted; Delete forever does not erase Cloudinary progress
photos. Production needs the rules deploy (founder OK).

Carry fix + leads come back (2026-10-23, 5eba9ee, same branch). Member 46 "Could not carry the old plan": the carried
plan had been cancelled here later (likely End all plans); the banner ignored cancelled plans, the server refused with
a generic line. Now: banner shows Restore for that plan; carry from a member page/sale sends `clientId` (carries onto
THAT member only, refuses an old plan that belongs to someone else); `noCarryReason` (lib/old-migrate.ts) gives the
real reason; `oldPlanKey` on plans (old-data.ts `asIsKey`/`oldPlanInApp`). Leads: "Not interested" lead → Came back
(Interested, call today, Undo) on row/card/menu/detail; search spans all leads; new-lead form spots a repeat phone →
Open that lead; top search opens `/leads?lead=<id>`. Checks: unit 502/502, tsc + build OK, local E2E 24/24
(scratchpad a8c5924e…/leads_back_local.py). Member banner not E2E'd (needs old-software data locally).
Prod check for member 46: scratchpad a8c5924e…/prod_member46.mjs (read-only; the user runs it).

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

## Live state (2026-10-22)

- Live hardening SHIPPED 2026-10-18: main 12c8fac pushed, `/api/version` = `12c8fac213f1`; production rules
  deployed (ruleset d3ff71ad…). Rollback: `node deploy_rules.mjs <backup>`; scripts + backup + diff in scratchpad
  `C:/Users/chala/AppData/Local/Temp/claude/c--Users-chala-OneDrive-Desktop-gym-saas/097e3934-b572-475b-990f-4608bd2028aa/scratchpad/`
  (`read_live_rules.mjs`, `deploy_rules.mjs`, `live_rules_backup_2026-10-18.txt`, `rules_diff.txt`).
- Live browser check 2026-10-22 PASSED: salary-expense delete (owner) and staff login keerthi M (her 12 features
  load; /staff /settings /recycle-bin /backup blocked). NOT checked live: Delete-bills bin, desk collect/undo (money
  write; emulator 17/17), fingerprint enroll (real door command).

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
