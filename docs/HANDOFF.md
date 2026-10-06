# Handoff

## 2026-10-06 (latest): CFO page built on branch `cfo-v1`; joining-date fix

**State.** Local branches, nothing pushed or deployed:
- `cfo-v1` = main + CFO spec/plan + joining-date fix + the CFO feature (commits c8b036d..).
- `fix/joining-date` = main + only the joining-date fix (7049a94), so it can go live alone.

**Joining-date fix** (user report: "Joining date can't be in the future"): New member and Edit
member accept a joining date up to a year ahead; a later joining date moves the new plan's start
with it (plan waits as pending, like an advance renewal); the plan can't start before the joining
date; Dashboard "new members this month" counts only members joined by today; birthday pickers
use the India date. Test: scratchpad `joindate_local.py` 9/9.

**CFO** (`/cfo`, nav "CFO" after Income & Expenses; owners, "All features" and Finance logins):
health cards, weekly AI summary, call lists (Not coming, Renewals, New members, PT chances, Dues,
Cash) with Call / WhatsApp chat / Excel / Print, 6-month trends, "How these numbers are worked
out", settings (opening money, alert limits, AI on/off, language). Maths in `src/lib/cfo` (pure,
`npm run test:cfo`), server `src/server/cfo*.ts` + `ai.ts`, docs `CFO_SPEC.md`, `CFO_PLAN.md`.
Numbers are worked out on the server each morning (last step of the morning cron) or on Refresh
(max once per 10 min for everyone), saved in `cfoReports/latest` + `cfoReports/list-*`; the page
reads 3 docs. ~7k reads per refresh at 1,000 members. Single-field queries only.

**Before it can go live (needs the user):**
1. Deploy `firestore.rules` (new `cfoSettings`, `cfoReports`, `cfoBriefs` blocks) BEFORE the code;
   until then the page says "CFO is being set up".
2. Merge `cfo-v1` (or `fix/joining-date` first) into main and push (Vercel deploys main).
3. Vercel env for the AI summary: `CFO_AI_PROVIDER=gemini` + `GEMINI_API_KEY` (free tier).
   Optional: `CFO_AI_MODEL`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`. Without a key everything
   works except the summary ("not set up yet").
4. Owner: CFO → Settings → total gym money at the START of a date (bank + UPI + cash).
5. The real AI provider has never been called (all tests use `fake_ai.py`): one live check
   with the user's key is still owed (check 9).

**Tests** (session scratchpad 8b942f95…, see `README_cfo_tests.md`): unit 137/137; e2e vs an
independent hand calculation `cfo_local.py` 850/850; access `cfo_access_local.py` 116/116;
browser `cfo_ui_local.py` 178/178; owner flow `cfo_owner_flow.py`; morning cron
`cfo_cron_local.py`; regression `regress_cfo.sh`. Server for tests: `serve_cfo.sh`
(CFO_TODAY / CFO_MIN_REFRESH_SECONDS / CFO_AI_BASE_URL work only against the emulator).

## 2026-10-06: CFO feature set up, not built yet

`CFO_SPEC.md` (the AI CFO spec with its 10 checks) is now in the project root, and the
two-phase "Implement CFO" workflow is in `~/.claude/CLAUDE.md` (example spec saved at
`~/.claude/cfo/CFO_SPEC_EXAMPLE_GYM.md`). Since the spec exists, "Implement CFO" here will summarise
it and wait for "proceed" before building.
Claude in Chrome was NOT connected when checked (no browser tools in the session, no Claude
native-messaging host registered in Chrome), so step 6 / browser checks need `/chrome` working first.

## 2026-10-06 (later): "WhatsApp on the gym PC" merged and pushed

Branch `claude/friendly-albattani-ostipp` commit 35b7f9c (made 2 Oct, never merged) is now on
`main`, with the user's OK after checks. Settings → WhatsApp → "Run it on the gym PC": download
`RebuildFitness-WhatsApp.bat`, double-click on the gym PC (needs Docker Desktop); it runs OpenWA +
a free Cloudflare quick tunnel + `public/gym-pc/link.mjs`, which reports the tunnel address to
`POST /api/whatsapp/gateway-link` every 10 minutes ("Gym PC online").

Security review (done here): setup key is random, server-only, compared in constant time; only
Settings logins can make/reset it; the gateway must answer before anything is saved; the token
for the app is limited to one OpenWA instance. Hardened before merging: malformed keys are refused
before any Firestore read; only `https://` addresses accepted (the token travels with each call).
Not changed: the compose file uses `cloudflare/cloudflared:latest` and `node:22-alpine` (unpinned).

Tests (local emulators): new `gym_pc_local.py` 24/24 (fake https OpenWA `fake_owa.py` :5443,
server `serve_gympc.sh` with NODE_TLS_REJECT_UNAUTHORIZED=0 for the self-signed fake only;
light/dark 390/1440). Regression after the merge: edits 47, plans_end 12, undo_refund 41,
daybook 4, billing 6, double_tap 4, dash_money 5, batch_features 24, journey 15, search 25: all
pass. `journey.py` updated (new WhatsApp switch + Send from; trainers are made via the staff form
since d15b5cb). Test kit is in session scratchpad f118e4b0… (`regress_merge.sh`).

Not done (needs the gym): the real gym-PC setup has never been run on a Windows PC with Docker.
Try it once at the gym: download the setup file, run it, check "Gym PC online", Show QR, send a test.

## 2026-10-06: Edit options audit ("after adding a package, can it be edited?")

Audited every record staff create, as owner / manager / front desk / trainer. Master data
(members, packages, trainers, staff, expenses, leads, classes, bookings, settings) was already
editable. What could not be corrected, and is now fixed (committed and pushed to `main` 2026-10-06; Vercel deploys from there):

| Fix | Where | Who |
|---|---|---|
| **Edit plan**: package, start / end date, counsellor. Same plan is changed; the bill is re-priced (new balance asks for a pay-by date; a lower price records the extra as a refund), payments are re-split, member summary + door follow the dates, each change is listed on the plan | Member → Plan tab: "Edit plan" on the active card, pencil on each history row | `members` login. A refund needs `finance` (owner) |
| **Edit payment**: amount, mode, date, note; bill paid / balance / mode and the bill link follow | Member → Payments tab, Day Book "Who paid" | Today's payments: `billing`. Older: `finance`. Before the 1st of last month only the note (Day Book carry-forward) |
| **Edit bill**: discount, pay-by date, note | Bill "⋯" menu → Edit bill | `billing`; discount needs `finance` |
| **Edit PT plan**: trainer (unpaid payout moves), dates | Plan tab → PT plans pencil | dates: `members`; trainer: `finance` (payout rules) |
| Phone fix also fixes WhatsApp number + phone/name on bills, bill links, payments | Member Edit | any |
| Remove a visit marked by hand (last visit + member-app calendar go back) | Attendance page, member Visits tab | `attendance` |
| Edit / remove (Undo) "other income" | Income & expenses | `finance` |
| Editing / deleting a salary expense keeps the staff pay record in step | Expenses / Day Book | `finance` |
| Bug: editing a done follow-up reopened it and logged "created" again | followups.service `saveFollowUp` | — |
| PT tab said "Pending biometric" for a PT plan that starts later → "Starts later" | client-pt-section | — |

Not changed (deliberately): member ID after creation (fingerprint machine IDs), names on old
trainer payouts / bookings, lead call logs, announcements (already sent).

Code: `src/services/{plan,payment,bill,pt}-edit.service.ts`, dialogs in
`src/components/clients/edit-{plan,pt}-dialog.tsx`, `src/components/billing/edit-{payment,bill}-dialog.tsx`,
`src/components/attendance/remove-visit-button.tsx`. Each correction is stored in an `edits`
array on the record (`RecordEdit`: on, by, reason, changes) and shown as "Changed … by …".

No Firestore rules change needed.

Review fixes (independent money review, all applied): refund on a gym+PT bill is split like
the payments (trainer share stays right); re-pricing uses the bill's own tax rate
(`billTaxRate`), not today's setting; an upgraded-to plan keeps its start date; old payments
(before the 1st of last month) can still get a note; only Income & expenses can change a
payment's date (checked in the service too); "other income" before the 1st of last month is
locked (Day Book carry-forward); salary expenses now store `staffPaymentId` (older ones are looked
up only for finance logins, others edit the expense alone as before); PT trainer change never
moves already-paid adjustment lines; bill edit no longer invents a pay-by date.
Also fixed a race: "End all plans & stop entry" now appears only after PT plans have loaded
(before, a fast tap could show a box without the PT plan).

### Tests (local emulators, 2026-10-06)
- New `edits_local.py` (session scratchpad 09feb459…): **47/47** (owner + front desk, gym+PT
  refund split, 18% tax bill, old payment note, light/dark at 390/1440, no sideways scroll).
- Regression: plans_end 12/12, undo_refund 41/41, daybook_reads 4/4, billing_reads 6/6,
  double_tap_join 4/4, dash_money 5/5, batch_features 24/24. Production build OK, tsc + eslint clean.
- `journey.py` / `search_test.py` (old scratchpad) are **stale**: journey looks for the switch
  "Send through WhatsApp Cloud API", removed by the 1 Oct WhatsApp-gateway commit; search uses
  journey's data. They need updating before they're useful again (not caused by this change).
- Emulators need Java: portable JRE in the session scratchpad (`restart_local.sh`); app server
  `serve_fakewa.sh`; fake WhatsApp `fake_wa.py` (port 5299). Build with
  `VITE_USE_EMULATORS=1 VITE_FIREBASE_PROJECT_ID=leadsmanage-1f7cd npx vite build`.

### Next
- Live check (owner login needed): Member → Plan → "Edit plan", Payments → edit a payment,
  Bill "⋯" → Edit bill. Settings → WhatsApp shows the "Run it on the gym PC" box.
- At the gym: run the gym-PC setup once (see the section above) if they want WhatsApp from the PC.

Last updated: 2026-10-06 (CFO build)
