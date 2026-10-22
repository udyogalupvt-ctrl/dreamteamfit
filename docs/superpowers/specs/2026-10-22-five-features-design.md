# Five member features: design (2026-10-22)

Founder picked five features for Rebuild Fitness on 2026-10-22 and asked Claude to take the design decisions
(no approval per step). This file records those decisions. Build order: **E, B, C, D, A**.

Ask the founder only for: live push, production rules deploy, real-money actions on the live app, paid spend,
and facts only they have. Those facts are Settings fields that stay empty until filled:
`[NEED: gym UPI ID + payee name]`, `[NEED: Google review link]`, `[NEED: owner approval of the health form text]`.

## Shared decisions

- **Members and trainers never write Firestore directly** (same as today, except chat and planLogs). Every
  member/trainer action is a `POST /api/portal/<action>` handled with the admin SDK in a NEW small server file
  per feature (`src/server/portal-health.ts`, `portal-progress.ts`, `portal-feedback.ts`, `portal-referral.ts`,
  `pay-links.ts`), dispatched from `handlePortal` (portal.ts stays a router plus the existing code). New
  collections are therefore closed to portal logins in the rules; only staff rules are needed.
- **Pure logic in `src/lib/<feature>.ts` with node tests** (`*.test.ts`, relative `.ts` imports, appended to
  the `test:cfo` script). UI and services stay thin.
- **`/api/portal/me` grows by small fields** (one extra doc read per feature at most). No whole-collection reads.
- **Staff permissions:** new switches only where a new kind of power appears: `feedback` (read and answer member
  feedback) and `referrals` (record referral rewards). Everything else rides on `members`. Both new switches are
  off for new front-desk logins; the owner has everything.
- **Feature switched off until its owner fact exists:** health form (owner turns it on after approving the
  text), Google review prompt (needs the link), UPI pay (needs the UPI ID). Progress, feedback and referrals
  work from day one.
- **Every flow is finished:** create, edit later, show on the member profile, a list or filter where staff need
  one, permission-checked, Firestore rules + emulator rules tests, unit tests, an emulator E2E suite, light/dark
  screenshots at 390 and 1440.
- **Placement:** Settings gets a new tab **"Member app"** (health form editor, Google review link). The UPI ID goes
  in **"Gym & bills"** as an "Online payment (UPI)" section. The member profile gets the new cards on its
  **Profile** tab and a **Progress** entry in its "More" menu.

## E. Health form (PAR-Q style) + consent

**Data**
- `settings/healthForm` (owner-only write): `{ enabled, version, requiredVersion, title, intro, questions:
  [{ id, text, kind: "yesno" | "text", detailOnYes }], consent, updatedAt, updatedBy }`. Missing doc = the
  built-in starting form (version 1, `enabled: false`). Saving bumps `version` only when the text changed.
  "Ask everyone to accept again" sets `requiredVersion = version`.
- `healthForms/{autoId}`: one per acceptance, never edited: `{ clientId, clientName, version, title,
  answers: [{ id, text, kind, answer: "yes" | "no" | "", detail }], consent (full text as shown), signedName,
  method: "app" | "paper", by (staff name for paper), signedOn: "YYYY-MM-DD", createdAt }`. The question text and
  consent are copied in, so old answers stay readable after the owner edits the form.
- Summary on the member: `clients.healthForm = { version, signedOn, method, flags: string[] }` (flags = short
  texts of "yes" answers) so lists and the profile need no extra reads.

**Status:** done when `client.healthForm.version >= form.requiredVersion`, otherwise pending. Shown only while
the form is enabled.

**Member app:** while pending, Home shows a card "Health form: 2 minutes, once" → full form view (`?tab=health`):
yes/no buttons, a details box when "yes" and `detailOnYes`, written answers for `text` questions, the consent
text, an "I agree" checkbox and their full name typed as the signature. Submit → `POST /api/portal/health-form`
(server checks the version is current and every yes/no question is answered). After that Home shows nothing;
the Profile area of the app shows "Health form: done (date)" with a read-only view of their answers. If any
answer is "yes", the done screen says to check with a doctor before hard training and tells the trainer.

**Desk:** member profile → Profile tab card "Health form": Done (date, app/paper) with flags in warning colour
("Said yes: heart condition…"), "View answers" (every acceptance, newest first), or Pending with **"Received on
paper"** (staff tick for members without a phone: records method "paper", staff name, date; Undo by toast). The
members list gets a "Health form pending" filter chip (only while enabled).

**Trainer app:** PT member detail shows the member's flags ("Health: said yes to …"), so the trainer knows.

**Settings → Member app → Health form (owner edits, others read):** switch "Ask members to fill it" (turning it
on the first time explains that the text is a starting draft the owner must check), title, intro, questions
(add, remove, reword, move up/down, Yes/No or written answer, "ask for details on Yes"), consent text, Save,
"Reset to the starting form", "Ask everyone to accept again" (confirm dialog that says how many members will be
asked again).

**Starting form (`[NEED: owner approval]`, own wording in the PAR-Q style, not legal text):**
1. Has a doctor ever said you have a heart condition or high blood pressure?
2. Do you get chest pain at rest, in daily life or when you exercise?
3. In the last 12 months, have you lost your balance because of dizziness, or fainted?
4. Do you have diabetes, asthma, epilepsy or another long-term medical condition?
5. Do you take regular medicine for a medical condition?
6. Do you have a bone, joint, back or muscle problem (now or in the last 12 months) that exercise could make
   worse?
7. Have you had surgery or a serious injury in the last 12 months?
8. Has a doctor ever told you to exercise only under medical supervision?
9. Are you pregnant, or did you give birth in the last 6 months? (answer No if this doesn't apply)
10. Anything else your trainer should know? (written answer, optional)

Consent: "I confirm my answers are true to the best of my knowledge, and I will tell the gym if my health
changes. I understand exercise carries some risk of injury. I will follow the trainers' guidance, use equipment
safely and stop if I feel unwell. If I answered Yes to any question, the gym advises me to check with my doctor
before starting or increasing exercise. REBUILD FITNESS keeps these answers to keep me safe; only gym staff and
my trainer see them."

**Rules:** `settings/healthForm` write: owner only. `healthForms`: read `can('members')`; create `can('members')`
only with `method == 'paper'` and a valid shape; delete `can('members')` only for paper (Undo); update never.

## B. Body progress

**Data:** `bodyLogs/{autoId}`: `{ clientId, date, weightKg, bodyFatPct, measurements: { chest, waist, hips,
arm, thigh } (cm, 0 = not measured), photos: [≤3 Cloudinary urls], note, by: { kind: "member" | "trainer" |
"staff", id, name }, createdAt, updatedAt }`. Ranges: weight 20–300 kg, body fat 2–70 %, each measurement
10–250 cm, at least one number or photo. One entry per day per author is not enforced (a re-weigh is fine).

**Who:** the member (own), their running-PT trainer (`/t`), desk staff with `members`. The author or staff can
edit or delete an entry (Undo by toast; not a money record, so no Recycle Bin).

**Member app:** Home card "My progress": latest weight, change since the first entry, a tiny line, "Add today's
weight". Opens `?tab=progress` (not in the bottom nav; header back to Home): chart with chips Weight / Body
fat / Waist / Chest / Arm (recharts), entries list (date, numbers, who logged it, photos), "Compare photos"
(first vs latest, side by side), add/edit sheet with photo upload (Cloudinary, same as the member photo).
**Trainer app:** PT member detail gets a Progress section (same chart + list + add). **Desk:** member profile
"More → Progress" (same component, staff mode).

**Rules:** `bodyLogs` read/write `can('members')`; server writes member/trainer entries (server checks the
trainer has a running PT plan with that member, and that images are this gym's Cloudinary).

## C. Google review requests + member feedback

**Google rule:** Google forbids "review gating" (asking only happy members, or steering unhappy ones away). So
every eligible member sees the same review card, and the feedback box is a separate, always-available link,
never a step that decides who is asked.

**Review prompt (free, no new WhatsApp template):** setting `settings/memberApp.googleReviewUrl` (https only).
The member app Home shows "Enjoying REBUILD FITNESS? A Google review helps others find us" with **Write a review**
(opens the link, records `clients.review.tappedAt`) and **Not now** (records `dismissedAt`). Eligible when the
link is set, the member has a running plan, and either they joined ≥ 30 days ago or a new plan started in the
last 14 days; not after tapping (ever) and not within 60 days of "Not now". Desk profile: "Google review: opened
the link on …" plus **"Ask on WhatsApp"** (wa.me share from the desk phone with the link: free; stamps
`review.askedAt`).

**Feedback box:** member app Home link "Complaint or idea? Tell the owner" + a section listing their past
messages and replies. Form: kind (Complaint / Idea / Praise), message (≤ 1000 chars), "Please call me" tick.
`POST /api/portal/feedback` (max 5 a day per member). Stored in `feedback/{autoId}`: `{ clientId, clientName,
memberCode, phone, kind, message, wantsCall, status: "new" | "resolved", reply, resolvedBy, resolvedAt,
createdAt }`.

**Owner inbox:** new page `/feedback` "Member feedback" (switch `feedback`; sidebar badge = new count): filters
New / Resolved / All + period picker, each card with member link, call button when "call me", **Reply / mark
resolved** (reply text shows in the member app; a phone notification goes out if the member has the app
installed). Reopen is allowed (edit later).

**Rules:** `settings/memberApp` write `can('settings')`. `feedback` read/update `can('feedback')` (update may
change only status/reply/resolved fields); create never from a browser; delete owner only.

## D. Referral rewards

**Data:** `referredBy: { clientId, name, memberCode } | null` on inquiries and clients. `referrals/{newClientId}`
(one per referred member): `{ referrerId, referrerName, newClientId, newClientName, joinedOn, status: "due" |
"promised" | "given" | "skipped", reward: { kind: "free_days" | "discount" | "gift" | "other", days, amount,
note } | null, decidedBy, decidedAt, givenOn, createdAt, updatedAt }`.

**Capture:** inquiry form and the joining wizard get a "Referred by (member)" search picker (shown when the
source is "Referral", and the picker sets the source to Referral). Converting an inquiry carries it over. The
member edit form can set or change it later (changing the referrer is refused once a reward is given). The
`referrals` doc is created with status `due` when a member with `referredBy` is saved.

**Reward due list:** new page `/referrals` (sidebar under Members; `members` to view): tabs Due / Promised /
Given / All, period picker, each row = referrer → new member, the new member's plan status. Recording a reward
needs the `referrals` switch (owner always): choose free days / discount / gift / other + note, and either
"Given now" or "Promised (apply at their next renewal)", or "No reward" with a reason. **Free days are recorded,
not added to the plan automatically**: the dialog links to the member's Edit plan to add them (plan dates drive
the door; the existing edit path keeps its checks). A promised reward shows as a chip on the referrer's profile
and in their renewal checkout header until it is marked given.

**Profiles:** new member shows "Referred by X"; referrer shows "Referred N members" with each reward.
**Member app:** Home card "Bring a friend": share text by wa.me (free) and "Friends you brought: N" with rewards
given.

**Rules:** `referrals` read `can('members') || can('referrals')`; create `can('members')` only with status `due`
and no reward; update: `can('referrals')`, or `can('members')` changing only the referrer while `due`; delete
`can('referrals')` or `can('members')` while `due`.

## A. UPI pay link (money: reviewer agent required)

An **extra** way to pay; desk payment is unchanged. No gateway, nothing auto-marks paid.

**Settings → Gym & bills → Online payment (UPI):** UPI ID (validated `name@bank` shape) and payee name. Empty =
the feature is hidden everywhere.

**Pay links:** `payLinks/{token}` (token = 24 random url-safe chars; server-only collection): `{ clientId,
clientName, kind: "balance" | "renewal", invoiceId, invoiceNumber, packageId, packageName, amount, upiNote
(bill number or "Renewal <member ID>"), status: "open" | "member_paid" | "confirmed" | "cancelled", utr,
memberPaidAt, confirmedBy, confirmedAt, paymentIds, saleBillId, createdAt, expiresOn }`. One open link per
bill / per member renewal; amounts are recomputed by the server when the link is opened (a bill paid at the desk
meanwhile closes the link).

**Public page `/pay/<token>`** (no login, https, works from WhatsApp buttons): gym name and logo, member first
name, amount, what it is for, a QR of `upi://pay?pa=<id>&pn=<name>&am=<amount>&cu=INR&tn=<note>`, a "Pay with a
UPI app" button (same link), then **"I've paid"** with an optional UTR / reference. The page never says "paid"
by itself: it says "Thanks, the gym will confirm".

**Where links come from:** the existing approved `gym_payment_due` template's button already opens
`/invoice/<token>`; that page gets a "Pay ₹X by UPI" button (no new template). The member app shows "Pay ₹X"
on open bills and, for an ending plan, "Renew online: ₹X" (same package's current price). The renewal reminder
gets the link only if its template has a URL button; otherwise the member app is the path (no new template
without Meta approval; check `gym_membership_expiry` while building).

**Desk: "Payments to confirm"** (Billing page section + dashboard/bell count, feature `billing`): each
"member says paid" row shows amount, UTR, time. Staff check the bank app, then **Confirm**: balance → the normal
Collect balance path prefilled (method UPI, amount, reference = UTR); renewal → the normal Renew checkout
prefilled (package, UPI, amount). Same rules as a desk payment (closed months, limits, undo). **Not received**
puts the link back to open with a note the member sees. Nothing is marked paid without a staff Confirm.

**Rules:** `payLinks` closed to browsers except staff `billing` read + status updates the server cannot do; the
money writes stay the existing collect/checkout writes. Detailed plan + reviewer agent before merge.

## Testing (every feature)

`npm run build`, `npm run test:cfo` (unit), `npm run test:rules` (new rules tests per collection), lint on
changed files, an emulator E2E suite in the session kit (`<scratchpad>/k`, `bash regress.sh <suite>`):
`health_local.py`, `progress_local.py`, `feedback_local.py`, `referral_local.py`, `upi_local.py`, each saving
light/dark screenshots at 390 and 1440. Rules changes need a production rules deploy: founder's OK.
