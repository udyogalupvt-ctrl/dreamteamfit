# Handoff

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

Last updated: 2026-10-06
