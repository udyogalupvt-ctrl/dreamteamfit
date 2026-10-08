# Handoff

## 2026-10-08 (late): live data cleaned, calendar-month end dates, Billing period, Reports fix

**State (21:00):** merged into main and pushed (6ea7eb3). NOT yet done on live data (the auto-mode
classifier refused applying it without the user seeing the list first):
1. `node prod_oldplans.mjs` (read-only) → `python live_owner_oldplans.py list` (preview, nothing
   saved) → show the user → `python live_owner_oldplans.py apply`: 46 plans get the amount paid in
   the old software, 11 get the old software's dates (5 running, 6 ended). Needs `owner_pw.tmp`.
2. `python live_owner_joined.py`: 4 old members' joining dates (Edit now opens details).
3. Front desk: refresh the app once (tabs opened before 6ea7eb3 can't auto-update); then re-run step 1
   for anyone they add before refreshing. Scripts are in session scratchpad 7b781562….
4. Remove `C:/Users/chala/OneDrive/Desktop/gym saas/.claude/settings.local.json` (temporary allow rule).

**Live data (done as the owner through the app, with the user's OK; read-only checks before/after):**
- 31 plans that were paid in the old software but re-entered here as sales on 5-8 Oct (₹2,44,669)
  were marked "Paid in the old software" (whole entry: bill = old deal, payments off, PT share
  cancelled). Each has Undo on the plan (`oldSoftwareMoves`).
- 1 duplicate bill (member deleted with "keep bills" and re-added, same phone, ₹5,800) moved to
  the Recycle Bin.
- 60 old members' plans set to the old software's own dates (most were 1 day long; 6-month plans
  2-3 days short; one 12+1-month plan 30 days short; one wrongly entered as annual → 1 month).
  2 plans ending today were left (today already used; one has a renewal from tomorrow).
- "Joined this month": 3 of 7 old members got their old joining date; 4 are waiting for thumb
  registration and could not be edited (Edit reopened the joining steps) → fixed in code (Edit
  always opens details); finish them after deploy (scratchpad `live_owner_joined.py`).
- Live after: Collected today ₹24,496 (was ₹90,089), this month ₹1,16,879 (was ₹3,67,348).
  CFO page refreshes its numbers each morning (or Refresh on the page).
- Read-only scripts (session scratchpad): prod_old_check / prod_sweep / prod_dates / prod_joined.
  Owner-browser scripts used once each with a narrow allow rule that was removed afterwards.

**Evening round (same branch):** front-desk tabs left open since the morning kept running the
old app after the 15:31 deploy, so ~10 old members added after 4 pm were saved the old way (no
amount paid there, start+365 end dates). Fixes: (1) open tabs now check `/api/version` (build id
from vite `define` `__APP_BUILD__`, no DB read) every 5 min / when shown, and load the new version
by themselves when no popup is open and nothing was typed for 20 s, else a Refresh toast; tabs
still on the OLD bundle need ONE manual refresh. (2) A plan paid in the old software shows "Paid
in the old software ₹X" (package price as a note) on the Plan tab and history. (3) Edit plan has
"Paid in the old software (₹)" and works on ended paid-there plans (dates as in the old
software). (4) Joining suggests the old plan that started within 10 days (not only a running one)
and refuses ₹0 paid there. (5) Member page opens on Plan. (6) Billing list = the period's bills +
every older bill with money due; search looks at all loaded bills. Live: 46 plans were missing
the amount paid there, 11 had other dates (5 running, 6 ended): `live_owner_oldplans.py` (session
scratchpad, input from read-only `prod_oldplans.mjs`). Tests: `oldpaid_local.py` (18 checks).

**Code (branch `member-delete-money-guard`):** plan end dates follow calendar months, last day =
day before (src/lib/plan-dates.ts, unit-tested; 30/60/90/180/360 days = months, 365 = 1 year, other
lengths = that many days); Billing has the Dashboard's period dropdown (cards + bill list); Reports
"Collected" = payments by the day received (was bill amounts by bill date); Delete member warns
about "keep bills" when the same phone exists (double counting); Edit on a thumb-pending member
opens details; WhatsApp usage default rates = Meta India from 1 Oct 2026 incl. GST (utility ≈ ₹0.14,
marketing ≈ ₹1.02; chat replies: first 1,000/month free, then utility rate).

## 2026-10-08: WhatsApp chats, photo full screen, corrections, old-software money, security audit

Branches (local only, NOT pushed, NOT deployed): `members-wa-inbox-audit` (commit e427506) and on top of it
`old-software-money` (uncommitted at the time of writing → see git log). Nothing is live yet.

**1. Member photo full screen** (`ClientAvatar zoomable` + `PhotoViewer` in `src/components/clients/client-avatar.tsx`):
member page, member list (phone card = stretched link, photo is its own button), member calls, birthdays.

**2. WhatsApp chats** (`/whatsapp`, nav "WhatsApp", unread badge; new login feature `whatsappChats`, in the
front-desk defaults): members' messages to the Cloud API number arrive via the signed webhook into
`waChats/{number}/messages/{wamid}` (`src/server/whatsapp-chat.ts`); replies only within WhatsApp's 24 h
window; ticks, blue ticks on open, reactions, quoted replies, photos/voice/files via `/api/whatsapp/chat/media`;
bills/reminders the app sends are copied into the chat. Member page has a "WhatsApp chat" link. Looks like
WhatsApp (own tokens `.wa-theme` in styles.css, light+dark, phone = full-screen chat).
**Needs before it works live:** (a) `WHATSAPP_APP_SECRET` on Vercel (Meta → App settings → Basic → App secret)
+ Redeploy, (b) Meta → WhatsApp → Configuration: webhook = `https://dreamteamfit.vercel.app/api/whatsapp/webhook`,
"messages" field subscribed, (c) deploy firestore.rules (waChats rule). The page shows a yellow banner until
messages arrive.

**3. Corrections after confirm** (user: "confirmed the package at the original price, forgot the discount"):
Edit plan has a Discount box (owner/finance); a discount after full payment records the extra as money given
back (refund). Edit bill does the same instead of refusing. Counsellor fix reaches bill + payments + joining
(incentives). Edit PT: trainer share (% or ₹), unpaid payout + bill trainer total follow. Bug fixed: payment
split now spreads a bill's discount over membership/PT income (membership income was overstated on every
discounted bill; total income/profit were always right). Old discounted payments keep their old split.

**4. Old-software money counted as today's sales** (owner: "Sales amount wrong"). Cause: "Paid in the old
software" could not take the old offer price, so staff unticked it and gave a discount → a payment dated today
for money paid months ago. Fix:
- Joining form: "Paid in the old software ₹" (prefilled from the old data) + balance; allowed for members
  already in the app with no plan here; Backup / Member calls "Add" link the old record.
- Owner tool: member Plan tab → "Paid in the old software?" (`src/services/old-software.service.ts`): moves
  the money out of payments (bill keeps its link; old money shown as a credit line "Paid in the old software";
  still-owed balance stays), cancels a pending trainer share, marks the plan; full copy in `oldSoftwareMoves`
  for Undo. Refused for closed Day Book months, refunded bills, paid trainer shares.
- Review list: Income & Expenses → Profit & income → "Paid in the old software?" (`/api/old-data/suspects`,
  `src/server/old-sales.ts`): sales since the 1st of last month that the old data shows as paid there.
**The owner must go through that list after deploy** to fix the live totals (I can't read/change live data).

**5. Security audit** (`security-audit` skill installed globally; report in
`~/security-audit-skill/dreamteamfit/run-1/REPORT.md`; quick profile, PARTIAL coverage: 14/30 units deferred).
Fixed: member/trainer app off/delete only acts on that person's own login (`ownPortalUid`, portal.ts);
Recycle Bin restore only writes allowlisted record kinds to their own path + rules `binnable()`.
Open: money collections writable by any staff login in rules (needs per-flow rules redesign);
owner = email only (owner must check Firebase console: does admin@elevategym.com exist? sign-up off?).
Run 2 should start with: biometric commands, /iclock, Meta webhook, WhatsApp chat routes, portal #16.

**Tests** (emulators only; session scratchpad 7b781562…, `regress.sh <suites>` = fresh gym per suite):
wa_chat_local 35/35, wa_ui_local 74/74 (light/dark 390/1440, shots/), discount_local 20/20, edits_local 47/47,
oldsw_local 27/27, sec_local 15/15, undo_refund 41, double_tap_join 4, dash_money 5, billing_reads 6,
plans_end 12, daybook_reads 4, batch_features 24; unit 150/150; tsc + eslint clean; build OK.
Prod read script (read-only, owner runs): scratchpad `prod_sales.mjs` (this month's payments with bill/plan).

### Next
1. Owner OK → merge both branches into main, deploy firestore.rules (waChats, oldSoftwareMoves, recycleBinItems
   rule), push (Vercel deploys).
2. Vercel: WHATSAPP_APP_SECRET + Meta webhook "messages" field (see 2).
3. Owner: Income & Expenses → "Paid in the old software?" → Check & mark each one.
4. Owner: Firebase console checks in NEEDS-VALIDATION.md (owner email).
5. Security run 2 (deferred units) and the money-rules redesign.

## 2026-10-07: Machine fresh start + old-software call list (pushed, live)

Why: the owner wipes the MB360 so only people who come to the desk get back in, which shows
who is really active. Old-software people who don't come back are phoned.

Merged into main and pushed by the user (bfb7269); live check passed (Old software tab, device online).
Later the same day: read-only owner sweep of the live site (62 page visits, phone + desktop): no page
errors, console errors, error states or sideways scroll (only normal cancelled requests on
navigation). Fix: the device setup box now shows this gym's MB360 relay settings first
(`rf.rebuildfitnesskkd.workers.dev`, port 80, HTTPS off, domain on), since it had only the
HTTPS/443 values the MB360 can't use. The owner shared their login in chat: they should change it.
Built:
- Biometric devices → "…" → "Machine was reset: start fresh" (owner only, type RESET).
  `freshStart()` in `src/server/device-import.ts` (`/api/devices/fresh-start`). It first copies
  members' and staff machine fields, saved thumbs and old machine users to
  `machineResets/{id}/items` (server only, closed by rules), then: thumb not registered, machine
  ID cleared, members who had a thumb get a biometric-only joining (→ Members "Thumb pending"),
  staff blocks kept, old machine users marked removed (thumbs kept in deviceUserTemplates),
  saved thumbs moved out of biometricTemplates, unsent commands cancelled. The device card shows
  "Fresh start on … · N members and N staff registered again".
- Register thumb: machine ID = Member ID and locked whenever the machine has it free
  (`fingerprint-panel.tsx`). New members keep getting the next Member ID (order of joining).
- Member calls → "Old software" tab (`src/components/members/old-software-calls.tsx`): whole
  old record (all plans, paid/balance/bill, address, remark…), Call / WhatsApp / Add as member,
  call status + notes; drops off once a member here (by old ID or phone) has a thumb ("Show who
  came back"). "Bring in everyone not back yet" = old plan runs today + no thumb here. Backup →
  Old members rows have "Call" / "Put all shown on the call list". Server: `callList()` in
  `src/server/old-data.ts` (`/api/old-data/call-list`, Member calls or Backup feature), rows are
  `memberCalls/old_<phone>_<oldId>` (segment "old"), so no rules change was needed.
- Staff page: trainers get Create login / Login & features.
Tests (emulators only): session scratchpad 73fdee4c…: `restart_local.sh`, `serve.sh`
(127.0.0.1, live key forced empty), `reset_local.py` 32/32, `ui_local.py` 28/28 (light/dark,
390/1440, screenshots in `shots/`). Build + lint clean.
Live facts (read-only, 2026-10-07): 25 members, 20 with thumbs, 1 staff thumb (keerthi M
10024), 994 old machine users, door control ON, old software files already uploaded.

Order on the day: (1) done, (2) wipe the machine: Menu → Data Mgt →
Delete Data → Delete All (NOT factory reset; if done, re-enter Cloud Server: ADMS, domain ON,
rf.rebuildfitnesskkd.workers.dev, port 80), (3) check the device is online, (4) press start
fresh, (5) Member calls → Old software → Bring in everyone not back yet, (6) register at the desk.

## 2026-10-06 (latest, updated 22:50): CFO page + joining-date fix merged into main and pushed

**State.** `cfo-v1` (which includes the joining-date fix) merged into `main` (19238b7) and pushed
to origin 2026-10-06; Vercel deploys main. Checked on main before the push: `vite build` OK,
unit 150/150, `tsc --noEmit` clean. `fix/joining-date` is no longer needed (already in main).
Gemini API setup (env vars, request/reply format) is now in the global `~/.claude/CLAUDE.md`.

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

**Live rules DEPLOYED 2026-10-06 (user OK):** `firestore.rules` from `cfo-v1` is live on
`rebuildfitos` (ruleset a582db7c…; read back = file). It also switched on the waiting main-branch
rules (Staff page logins edit staff/trainers, Recycle Bin page logins). The rules live before it
are saved in the session scratchpad `live_rules_backup_2026-10-01.txt` (roll back with
`deploy_rules.mjs <file>`). The user runs `npm run dev` on this PC against the LIVE database.

**Summary without AI + Start (user request 2026-10-06):** the summary card always shows a summary.
No AI (not connected, refused key, failed, or not started) → the app writes it from a fixed
template (`src/lib/cfo/template.ts`, same numbers as the page, same 3 parts) under "AI summary is
not available right now" + the reason. `POST /api/cfo/status` says if an AI is really connected
(free model-info call checks the key and model name; never returns the key). Connected and not
started → "Start AI summary" button (saves `aiEnabled: true`, writes the first AI summary).
`aiEnabled` now defaults to OFF until Start is pressed.

**Gemini key + live check (2026-10-06 22:10):** the real key is in `.env` (Google's newer
`AQ.` format, accepted). Check 9 run live against the TEST gym on the emulators (never the live
database), through a local recorder that saved exactly what Google received:
- `gemini-3.1-flash-lite`: **11/11 pass.** Real summary written by Gemini, every number in it is
  on the page (Renewals tab ₹24,600, Pending dues ₹800, health cards), the request held totals
  only (no names/phones/emails; custom category sent as "Other (custom)"), AI off → no Google
  call + the app's own summary. Shown on /cfo at 390/1440 light+dark, no console errors.
- `gemini-3-flash-preview` (the `.env` choice), `gemini-3.8-flash`, `3.7`, `3.5`, `flash-latest`:
  HTTP 503 "high demand" every try, even for a 1-line "say OK". Lite models answer.
- `gemini-2.5-flash` (the CODE DEFAULT in `src/server/ai.ts`): 404 "no longer available to new
  users". So with `CFO_AI_MODEL` empty the summary always fails.

**Paid key, 2026-10-06 22:15 (user replaced the key with a paid one):** every model answers now
(3.1-flash-lite, 3-flash-preview, 3.8-flash, even 2.5-flash; serviceTier standard). Full check
**11/11 on `gemini-3.1-flash-lite` and 11/11 on `gemini-3-flash-preview`**, first try, ~1,300
tokens per summary; card shown at 390/1440 light+dark, no console errors. Bug 4's "0 to 7 days"
blocked BOTH tries on the paid key, so it is FIXED (commit below): numbers in the data's labels
(`late0to7`, `late8to30`, `lateOver30`) now count as page numbers. Unit 142/142, e2e 850/850.
The user's pasted AI Studio sample (Interactions API, `google_search` tool, thinkingLevel high,
65,536 tokens) is NOT for the CFO: search lets the AI bring outside facts (spec: it only explains
our numbers) and high thinking is slow/costly and can overrun Vercel's ~50 s request.

**Bugs found by the live check: ALL FIXED 2026-10-06 (commit 3fadabc, bug 4 earlier):**
1. Default Gemini model (`CFO_AI_MODEL` empty) is now `gemini-3.1-flash-lite`.
2. Failed tries now save `provider`/`model`/`httpStatus` in `cfoBriefs/status`; `/api/cfo/status`
   reports "not connected" (`the AI model "X" can't be used with this key` / key refused) when the
   last try for the SAME provider+model got 401/403/404. Busy/5xx/timeouts don't count; another
   model clears it. Logic in `src/lib/cfo/ai-status.ts` (shared by server and card).
3. Card uses the saved reason for "off" tries and hides an old "off" try once the AI is on.
Still open, cosmetic: Gemini writes "a loss of -₹8,900" (double minus).
**"Key was refused" on the user's PC (2026-10-06 22:30):** NOT a code bug. `npm run dev` was
started 20:59, `.env` got the paid key 22:10, so the dev server still sent the old key. The key in
`.env` works (direct check: model info 200, generateContent "OK"). Fix = restart `npm run dev`.
Confirmed 22:40: after the restart the user's CFO page shows "Written by Gemini" (live data).
Live data gaps it shows: no Sep 2026 expenses entered (no profit/break-even), runway "not enough data".
`.env.example` still has the user's uncommitted placeholder lines (keep keys empty there).
Test-kit gotcha: `.env` now names the live project, so emulator builds need
`VITE_USE_EMULATORS=1 VITE_FIREBASE_PROJECT_ID=leadsmanage-1f7cd npm run build`.
Live-check scripts (session scratchpad 1a17c518…): `gemini_proxy.py` (recorder, :5398),
`serve_cfo_live.sh` (key from `.env`, `LIVE_MODEL=` to pick a model), `live_check.py`, `live_page.py`.

**Before it can go live (needs the user):**
1. ~~Deploy `firestore.rules`~~ done 2026-10-06.
2. ~~Merge `cfo-v1` into main and push~~ done 2026-10-06 (19238b7). Check the Vercel deploy succeeded.
3. Vercel env for the AI summary: `CFO_AI_PROVIDER=gemini` + `GEMINI_API_KEY` (free tier) +
   `CFO_AI_MODEL=gemini-3-flash-preview` (better wording) or `gemini-3.1-flash-lite` (cheaper);
   both pass with the paid key. On the free key only the lite model answered. Without a key everything works except
   the AI summary (the app writes its own).
4. Owner: CFO → Settings → total gym money at the START of a date (bank + UPI + cash).
5. ~~Live AI check (check 9)~~ done 2026-10-06 with the paid key: 11/11 on both models above.
   Bugs 1-3 fixed 2026-10-06 (3fadabc).

**Tests for bugs 1-3 (2026-10-06, commit 3fadabc):** unit 150/150 (`ai-status.test.ts`),
e2e `cfo_local.py` 850/850, Start test `cfo_start_local.py` 11/11, new browser test
`cfo_aistatus_local.py` 12/12 (fake AI mode `nowrite` = model info OK, writing 404; uses
`serve_cfo_model2.sh`; screenshots `shots/cfo_ai_refused_*`). Run with `PYTHONIOENCODING=utf-8`.
**Tests** (session scratchpad 8b942f95…, see `README_cfo_tests.md`; all run 2026-10-06 on
commit 8d9cf5d): unit 141/141; e2e vs an independent hand calculation `cfo_local.py` 850/850;
access `cfo_access_local.py` 124/124; browser `cfo_ui_local.py` 177 + 1 soft (soft check now
fixed to the real wording); summary/Start `cfo_start_local.py` 11/11; owner flow
`cfo_owner_flow.py` 13/13; morning cron `cfo_cron_local.py` 6/6; regression `regress_cfo.sh` all
pass. One-command run: `cfo_suite.sh`. Server for tests: `serve_cfo.sh`
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

Last updated: 2026-10-08 21:00 (pushed 6ea7eb3; live old-amount/date fix waiting for the user's OK)
