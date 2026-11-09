# Handoff

Last updated: 2026-11-09 (anonymous feedback QR built + tested LOCAL; earlier states in `docs/archive/` incl. `HANDOFF-history-2026-10-30-to-11-03.md`)

## State: anonymous feedback QR (2026-11-09, LOCAL until the founder OKs the rules deploy + push)

- Staff page `/anonymous-feedback` (feature "feedback", menu badge = new messages): make many QR links
  (one per spot, named "Front desk" etc.), switch on/off, rename, remove only if 0 messages; per QR: Print
  poster (A4), Download PDF / PNG / QR only, copy/open link. Inbox: New/Resolved/All, filter by QR + type,
  period, summary (count, avg rating, complaints), note, resolve with Undo; Spam delete = owner only.
- Public page `/f/<token>` (no login): type, optional 1-5 stars, message; POST `/api/feedback/<token>`
  (src/server/anon-feedback.ts). Nothing about the sender is stored; time kept to the hour; no audit line.
  Limits (HMAC counters `anonFeedbackRate`): 5/day per phone+network, 40/day per network, 300/day per QR; honeypot.
- New rules blocks: feedbackLinks, anonymousFeedback, anonFeedbackRate → **production rules deploy needed BEFORE the push**.
- Also fixed: /feedback opened one WhatsApp-settings listener per message card (now one per page).
- Checks: tsc + build OK, unit 517/517, rules 77/77, E2E 30/30 (`bash scripts/test/anon_feedback_run.sh` after the
  emulator build in its header), screenshots light/dark 390/1440 checked.
- Optional later: Firestore TTL policy on `anonFeedbackRate.expireAt` (counters are 2-day junk otherwise).

## Next steps

- 2026-11-03 reminder fixes LIVE (0030e86): daily renewal 7..0 days, PT reminded alone, Meta-refused shows failed. Settings text "7 days remaining" removed. TODO: when Meta approves Utility template `gym_plan_renewal_due` (id 1047712781662645, check `GET /<id>?fields=status`), set `settings/whatsapp.renewalTemplate` = `gym_plan_renewal_due` (code sends the 4th days-left value for any template other than gym_membership_expiry). Check the 159 old notifications got status failed (one-off script in scratchpad, rerun idea: whatsappMessages failed → notifications/{referenceId}). Divya PT renewal sent manually via gym_announcement 2026-11-03.

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
