# Five member features: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use `- [ ]`.
> Spec: `docs/superpowers/specs/2026-10-22-five-features-design.md` (read it first; it holds every decision).

**Goal:** health form (E), body progress (B), Google review + feedback (C), referral rewards (D), UPI pay link (A)
for the Rebuild Fitness app, each finished end to end.

**Architecture:** pure logic in `src/lib/<feature>.ts` (node tests); member/trainer writes through new server
files dispatched by `handlePortal` (admin SDK, members never write Firestore); staff writes through
`src/services/<feature>.service.ts` using `@/lib/firestore` (audit-logged); UI components in
`src/components/<feature>/`; rules + `tests/rules/<feature>.test.mjs`; an emulator E2E suite per feature.

**Tech:** TanStack Start + React 19, Firestore (client + admin SDK), shadcn/ui, recharts, zod, node:test,
Firebase emulator, Playwright (python) suites in the session kit.

## Global constraints

- Branch `five-features`; local commits only; never push or deploy; production rules deploy needs the founder.
- Members/trainers: only `POST|GET /api/portal/<action>`; check `portalActive` before any member write.
- In `handlePortal`, member actions go BEFORE the `who.kind !== "trainer"` line.
- No composite indexes: single-field `where` + filter/sort in code. Load only what the page shows.
- Reuse: `PeriodPicker` for date filters, `toastWithUndo` for undo, `ConfirmDialog`, `FormSection`,
  `surface-card`, `StatusPill`, promise-returning `onClick` for busy buttons, `useLive` for live docs.
- Strings the founder must supply stay empty + hidden: `[NEED: …]` in docs, never invented.
- Every new lib test file is appended to the `test:cfo` script in `package.json`.
- Verify per feature: `npm run build`, `npm run test:cfo`, `npm run test:rules`, eslint on changed files (ignore
  CRLF "Delete ␍"), the emulator suite, light/dark screenshots at 390 and 1440.
- Kit: `<scratchpad>/k` (`bash regress.sh [--nobuild] <suite>.py`), ports 8880 firestore, 9880 auth, app 5999.

---

## Feature E: health form

### Task E1: logic + types
**Files:** create `src/lib/health-form.ts`, `src/lib/health-form.test.ts`; modify `src/types/models.ts`
(`HealthFormSettings`, `HealthQuestion`, `HealthAnswer`, `HealthFormRecord`, `Client.healthForm`),
`package.json` (`test:cfo`).
**Produces:**
- `defaultHealthForm(gymName: string): HealthFormSettings` (version 1, requiredVersion 1, enabled false).
- `normalizeHealthForm(raw: unknown, gymName: string): HealthFormSettings` (missing doc → default).
- `formChanged(a, b): boolean` (title/intro/questions/consent differ).
- `nextFormVersion(saved, edited): number` (bump only if changed).
- `validateFormEdit(form): string` ("" = ok; 1–30 questions, text 3–300 chars, consent 20–3000).
- `validateAnswers(form, answers): string` (every yes/no answered, details ≤ 500, text ≤ 500).
- `healthFlags(answers): string[]` (short label per "yes", first 60 chars).
- `healthStatus(client.healthForm, form): "off" | "done" | "pending"`.
**Tests:** default form has 10 questions + gym name in consent; unchanged edit keeps the version, changed edit
bumps; validation messages for empty question, missing answer; flags only for yes; status off/done/pending
(version ≥ requiredVersion).

### Task E2: server + rules
**Files:** create `src/server/portal-health.ts` (`healthFormFor(clientDoc)` → `{ form, status, last }` for
`/me`, `submitHealthForm(clientId, body)` → transaction: add `healthForms` doc + set `clients.healthForm`,
audit log); modify `src/server/portal.ts` (member `POST health-form`, `memberData` adds `health`),
`src/constants/portal.ts` (`MemberPortalData.health`, `TrainerMemberDetail.healthFlags`), `firestore.rules`
(`settings/healthForm` owner-only write; `healthForms` rules per spec), create `tests/rules/health.test.mjs`.
**Rules tests:** owner can write `settings/healthForm`, a `settings` staff login cannot; desk (members) can
create a paper record, cannot create `method: "app"`, cannot update, can delete paper only; a login without
`members` cannot read; nobody signed out reads anything.

### Task E3: desk UI
**Files:** create `src/services/health-form.service.ts` (`subscribeHealthForm`, `saveHealthForm`,
`askEveryoneAgain`, `listHealthRecords(clientId)`, `markPaperForm(client, form)` → returns undo fn),
`src/components/health/health-form-editor.tsx` (Settings), `src/components/health/health-card.tsx` (profile),
`src/components/health/health-answers-dialog.tsx`; modify `src/routes/_authenticated/settings.tsx` (new tab
`memberapp` "Member app"), `src/routes/_authenticated/clients.$clientId.tsx` (card on Profile tab),
`src/routes/_authenticated/clients.index.tsx` (chip "Health form pending" while enabled).

### Task E4: member + trainer apps
**Files:** create `src/components/portal/health-form-view.tsx` (fill + read-only view); modify
`src/routes/m.$code.tsx` (Home nudge card, `?tab=health` not in bottom nav, done row with "View"),
`src/routes/t.$code.tsx` (flags on PT member detail).

### Task E5: verify + commit
Suite `health_local.py`: owner turns the form on, member fills it in `/m`, desk sees Done + flags, trainer sees
flags, owner edits a question + asks again → member sees pending, paper tick + undo. Screenshots.
Commit `feat(health): member health form with owner-editable questions`.

## Feature B: body progress

### Task B1: logic + types
**Files:** `src/lib/body-progress.ts` + test; models `BodyLog`, `BodyMeasurements`.
**Produces:** `validateBodyLog(input): string`, `cleanBodyLog(input): BodyLogInput` (numbers rounded to 0.1,
zeros dropped), `progressSeries(logs, metric): { date, value }[]` (date-sorted, one point per date = the last
entry that day), `progressSummary(logs): { latest, first, change }` per metric, `BODY_METRICS` (label, unit,
key).
**Tests:** ranges (weight 20–300, fat 2–70, cm 10–250), empty entry refused, a photo alone allowed, series
ordering and same-day collapse, change sign.

### Task B2: server + rules
**Files:** `src/server/portal-progress.ts`: `bodyLogsFor(clientId, limit 60)`, member
`POST body-log {action: add|edit|delete, …}` (own entries; edit/delete only own), trainer
`POST trainer-body-log` (running PT with that member), `isOurImage` check; `/me` adds `progress` (last 60
logs), `trainer-member` adds `progress`. Rules: `bodyLogs` read/create/update/delete `can('members')` with shape
checks. `tests/rules/progress.test.mjs`.

### Task B3: UI
**Files:** `src/components/progress/progress-chart.tsx` (recharts line, metric chips),
`src/components/progress/progress-list.tsx`, `src/components/progress/body-log-dialog.tsx` (numbers + up to 3
photos via `uploadImage`), `src/components/progress/progress-panel.tsx` (composes them; `mode: member |
trainer | staff`, `save(input)`/`remove(id)` callbacks), `src/services/body-logs.service.ts` (staff:
subscribe by client, add, edit, delete+undo). Wire: member Home card + `?tab=progress`; trainer member detail
section; profile "More → Progress".

### Task B4: verify + commit
Suite `progress_local.py`: member adds weight twice → chart + change; trainer adds an entry for a PT member;
desk edits and deletes with undo. Commit `feat(progress): body progress tracking`.

## Feature C: Google review + feedback

### Task C1: logic + types
**Files:** `src/lib/review-prompt.ts` + test (`reviewEligible({ url, today, joinedOn, planStart, planEnd,
review }): boolean`, `isGoogleReviewUrl(url)`), `src/lib/feedback.ts` + test (`validateFeedback`,
`FEEDBACK_KINDS`, `feedbackRateOk(times, now)`). Models `MemberAppSettings`, `Feedback`, `Client.review`.
**Tests:** eligible after 30 days, within 14 days of a new plan, not without a running plan, not after tapped,
not within 60 days of later; https-only link; message length; 5 a day.

### Task C2: server + rules
**Files:** `src/server/portal-feedback.ts`: member `POST review {action: tapped|later}`, member
`POST feedback {kind, message, wantsCall}`; `/me` adds `review: { url, show }` and `feedback` (member's last
10 with replies). Reply push via `src/server/push.ts` if the member has a token. Rules:
`settings/memberApp` (`can('settings')`), `feedback` per spec. `StaffFeature` `feedback` in models +
`constants/features.ts` (+ `PAGE_FEATURES` `/feedback`). `tests/rules/feedback.test.mjs`.

### Task C3: UI
**Files:** `src/routes/_authenticated/feedback.tsx` (inbox with tabs + `PeriodPicker`, reply dialog),
`src/services/feedback.service.ts`, sidebar item in `src/constants/navigation.ts` with new-count badge,
Settings "Member app" tab: review link field, `src/components/portal/review-card.tsx`,
`src/components/portal/feedback-sheet.tsx`, profile "Google review" row + "Ask on WhatsApp".

### Task C4: verify + commit
Suite `feedback_local.py`. Commit `feat(feedback): review prompt and member feedback inbox`.

## Feature D: referrals

### Task D1: logic + types
**Files:** `src/lib/referrals.ts` + test (`referralFor(newClient)`, `validateReward(input)`,
`canChangeReferrer(referral)`, `REWARD_KINDS`, `rewardLabel`). Models `ReferredBy`, `Referral`,
`Inquiry.referredBy`, `Client.referredBy`; `StaffFeature` `referrals`.

### Task D2: services + rules
**Files:** `src/services/referrals.service.ts` (create due on client create/edit when `referredBy` set, list by
status with period filter, record reward, undo), hooks into `clients.service.ts`/`enrollment.service.ts`/
`inquiries.service.ts` conversion. Rules + `tests/rules/referrals.test.mjs`.

### Task D3: UI
**Files:** `src/components/referrals/member-picker.tsx` (search members by name/phone/ID from the members
list the page already has), `src/routes/_authenticated/referrals.tsx`, reward dialog, profile chips; inquiry
form, enrollment wizard, client edit form get the picker; member app "Bring a friend" card (server `/me` adds
`referrals: { count, rewardsGiven }`).

### Task D4: verify + commit
Suite `referral_local.py`. Commit `feat(referrals): referred-by and reward tracking`.

## Feature A: UPI pay link

Detailed plan written when reached (money: Extra-high care, reviewer agent before merge). Outline: `src/lib/
upi.ts` (+test: `upiUri`, `isUpiId`, amount format), `src/server/pay-links.ts` (create/open/member-paid,
recompute amount from the bill), public route `src/routes/pay.$token.tsx`, `qrcode` project dependency,
invoice page button, member app buttons, desk "Payments to confirm" on Billing opening the existing collect /
renew dialogs prefilled, rules + tests, suite `upi_local.py`.
