# Live Rebuild: security + money hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the live Rebuild app's audit items 1-10 (HANDOFF "NEXT", aigym audit `../aigym/docs/audit/2026-10-17-platform-audit.md` M1/M4-M8, S1-S3, S5, S8, S9) so a staff login with browser dev tools can no longer wipe the fingerprint machine, gain rights through the Recycle Bin, or hide/alter cash, and so undo/cancel can no longer rewrite closed Day Book months.

**Architecture:** Firestore rules become per-collection for money and machine commands (Option A of item 4: rules with field/amount/date checks; NOT server endpoints — see "Decisions"). The server re-validates every machine command and PIN before it reaches the machine. Browser money flows get the closed-month guard and a transaction where they had none. Each rule change is proven in the Firestore emulator with `@firebase/rules-unit-testing`; flows are proven with the existing Playwright regression kit against emulators.

**Tech Stack:** Firestore rules v2, firebase JS SDK (browser), firebase-admin (server, Vercel), TanStack Start, node:test, Playwright (Python), Firebase CLI 14.1 emulators, Java 21.

## Global Constraints

- LIVE gym data. Never write to production from a test. Production reads only via scripts the owner runs (auto mode denies service-key reads).
- Push to GitHub (= Vercel deploy) and production rules deploy each need the founder's explicit OK, every time.
- Deploy order: **app first, rules after** (new rules + old open tabs must not half-write; open tabs reload to the new version when idle — wait for that).
- Rules deploy recipe: `read_live_rules.mjs` (backup + diff live vs repo's previous file) then `deploy_rules.mjs` (firebase-admin `releaseFirestoreRulesetFromSource`, read back + compare) — both in scratchpad `fe259a89…`.
- Closed Day Book month = `paymentDate < cashOpenFrom(today)` = before the 1st of last month (`src/services/finance.service.ts:215`). Rules compute the same from server time in IST.
- `todayISO()` is browser-local time (`src/lib/format.ts:11`); desk PCs are IST.
- Every browser write also writes `auditLogs` lines and may write `biometricCommands` door notes in the same batch (`src/lib/firestore.ts`): rules must keep allowing those.
- Plain words in every message the staff see. No new global installs. Check `git branch --show-current` before every commit (other chats share this folder).
- Emulator ports for this work: firestore 8780, auth 9780 (other chats use 8080/8180/8680).

## Decisions (made in planning, 2026-10-17)

1. **Item 4 = Option A (rules), Option B deferred.** B means moving ~18 browser payment write sites (all inside browser transactions: sale, balance, edit, split, cancel, remove, put-back, bin, old-money) to server endpoints: weeks, and the live till changes everywhere at once. A closes the practical cash-theft moves of a desk login: delete a payment, lower an amount, invent a refund, rewrite a closed month, reset the bill counter. It does NOT stop a desk login typing a lower price on a new sale or changing a package (same as today, visible in the activity log). B is planned for Aagami (multi-gym needs server money anyway) and can be ported back.
2. **Closed months are frozen for cash facts only**: `amount`, `method`, `paymentDate`, `kind`, `oldSoftware`. Split fields (`gymAmount`, `membershipGymAmount`, `ptGymAmount`, `otherGymAmount`, `trainerShareAmount`) stay editable because Edit plan re-splits every payment of a bill (`src/services/plan-edit.service.ts:572-599`) including old ones; freezing them would break Edit plan on older plans. (M12 "re-split open months only" stays a later item.)
3. **The freeze applies to the owner's browser too** (only the server/admin bypasses). All owner browser flows already refuse closed months, or will after Task 6.
4. **Refunds (negative payments) need Finance**, including putting one back from the Recycle Bin. A desk login inventing a refund is the cleanest way to take cash.
5. **S1 email-verified check is conditional** on the owner's live account being `emailVerified: true` (Task 0). If it is false, the check is NOT added (it would lock the owner out); flag it for the founder instead.
6. **Deferred** (need a founder decision or are too big for this pass): M8 financial-year bill series (changes the live bill-number format), M9 payout paid = cash line (changes Day Book/CFO maths), M11 single-transaction restore (bins with hundreds of attendance rows exceed one batch), M2/M3 GST, S6 passwords/App Check, S7 fallbacks, CSP enforce (Report-Only first).

## File Structure

| File | Change |
|---|---|
| `firestore.rules` | Money collections and `biometricCommands` leave the staff wildcard and get their own blocks; date helpers; counters +1 only; bin rules per collection/section; owner list |
| `firebase.rules-test.json` | Create: emulator config on ports 8780/9780 for the rules tests |
| `tests/rules/helpers.mjs` | Create: test env, users (owner, desk, finance, deleteBills…), seed with rules off, IST date helpers |
| `tests/rules/*.test.mjs` | Create: one file per area (commands, bin, owner, payments, invoices-plans, counters) |
| `package.json` | devDependency `@firebase/rules-unit-testing`; script `test:rules` |
| `src/server/biometric.ts` | `commandOk()` before dispatch; PIN check + "really deleted / really off" check in server tasks |
| `src/server/biometric-guard.ts` + `.test.ts` | Create: pure validators (command text per type, PIN) |
| `src/services/recycle-bin.service.ts` | Restore never writes `biometricCommands`; closed-month + refund guard; bin bill refuses refunds/paid payouts; bin member forces "keep accounts" for closed months |
| `src/lib/closed-month.ts` + `.test.ts` | Create: pure `closedMoney(payments, openFrom)` used by bin/restore/cancel-restore |
| `src/services/plan-cancel.service.ts` | `cancelPlans` in `runTransaction` with re-read; refund on the plan's own bill; restore refuses closed-month refunds |
| `src/services/enrollment.service.ts` | `planSeq` on the member read + bumped inside the sale transaction (M7) |
| `src/constants/owners.ts` | Dev email removed |
| `src/server/auth*.ts` (where `isOwnerEmail` is used server-side) | `email_verified` (conditional, Task 0) |
| `scripts/test/*.py` | Dev email + password removed; emulator owner from env |
| `src/server/admin.ts`, `src/server/router.ts` | `/api/health` detail only for an owner token |
| `src/server/automation.ts` | Cron secret compared with `timingSafeEqual` |
| `vite.config.ts` | Security headers (nitro `routeRules`), CSP Report-Only |
| `src/server/biometric.ts`, `tools/cloudflare-relay.js` | Task 11: relay key (accept old + new, then enforce) |

---

## Task 0: Facts from production (the founder runs it; no code)

- [ ] Ask the founder to run (read-only, prints yes/no facts only):
  `node "C:/Users/chala/AppData/Local/Temp/claude/c--Users-chala-OneDrive-Desktop-gym-saas/11359acb-2cda-47fc-98e8-3aa1650a7110/scratchpad/prod_owner_check.mjs" "C:/Users/chala/OneDrive/Desktop/gym saas/dreamteamfit"`
  (if the scratchpad is gone, recreate it from this snippet: firebase-admin `getAuth().getUserByEmail(email)` for both owner emails, print `exists, emailVerified, disabled, providers, lastSignInTime`; plus GET `https://identitytoolkit.googleapis.com/admin/v2/projects/rebuildfitos/config` with a service-account access token and print `signIn.email.enabled` and `client.permissions.disabledUserSignup`).
- [ ] Record in HANDOFF: does `admin@elevategym.com` exist live (if yes: who uses it, when last signed in); owner `emailVerified`; public sign-up still disabled.
- [ ] If the dev account exists live: founder decides "disable it" (Firebase console → Authentication → disable) — its password is in git history (`scripts/test/*.py`), so it must be disabled or its password changed even after we remove it from the owner list.

## Task 1: Rules test harness

**Files:** Create `firebase.rules-test.json`, `tests/rules/helpers.mjs`, `tests/rules/smoke.test.mjs`; Modify `package.json`.

- [ ] Step 1: Check the firebase SDK major in `package.json`; install the matching `@firebase/rules-unit-testing` as a devDependency (project-local, exact version): `npm i -D @firebase/rules-unit-testing@<matching> --save-exact`.
- [ ] Step 2: `firebase.rules-test.json`:
```json
{ "firestore": { "rules": "firestore.rules" },
  "emulators": { "firestore": { "port": 8780 }, "ui": { "enabled": false } } }
```
- [ ] Step 3: `package.json` script:
`"test:rules": "firebase emulators:exec --config firebase.rules-test.json --only firestore --project demo-rules \"node --test tests/rules/\""`
(JAVA_HOME = `C:/Users/chala/.jdks/jdk-21.0.12.1+1`.)
- [ ] Step 4: `tests/rules/helpers.mjs`:
```js
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
export const OWNER = "rebuildfitnesskkd@gmail.com";
export async function env() {
  return initializeTestEnvironment({
    projectId: "demo-rules",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8780 },
  });
}
// IST day as YYYY-MM-DD, n days from today (same as the rules' istNow()).
export const day = (n = 0) =>
  new Date(Date.now() + 330 * 60_000 + n * 86_400_000).toISOString().slice(0, 10);
export const firstOfLastMonth = () => {
  const [y, m] = day().split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
};
export const closedDay = () => {           // the day before the lock
  const d = new Date(firstOfLastMonth() + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
// Logins. Staff features live in staffAccess/{uid} (seeded with rules off).
export const owner = (t) => t.authenticatedContext("owner", { email: OWNER, email_verified: true }).firestore();
export const staff = (t, uid) => t.authenticatedContext(uid, { email: `${uid}@x.test` }).firestore();
export async function seed(t, docs) {
  await t.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    for (const [path, data] of Object.entries(docs)) await db.doc(path).set(data);
  });
}
export const LOGINS = {
  "staffAccess/desk":    { active: true, admin: false, permissions: ["members", "billing", "daybook"] },
  "staffAccess/fin":     { active: true, admin: false, permissions: ["members", "billing", "finance"] },
  "staffAccess/bills":   { active: true, admin: false, permissions: ["members", "deleteBills"] },
  "staffAccess/delmem":  { active: true, admin: false, permissions: ["members", "deleteMembers"] },
  "staffAccess/plans":   { active: true, admin: false, permissions: ["members", "deletePlans"] },
  "staffAccess/sett":    { active: true, admin: false, permissions: ["settings"] },
  "staffAccess/off":     { active: false, admin: true, permissions: [] },
};
```
- [ ] Step 5: `tests/rules/smoke.test.mjs`: owner reads `settings/business`, `desk` reads it, `off` and an unknown uid are refused (`assertSucceeds`/`assertFails`). Run `npm run test:rules` → PASS on the CURRENT rules (harness proven before any rule changes).
- [ ] Step 6: Commit `test: Firestore rules test harness (emulator, port 8780)`.

## Task 2: S3 — machine commands (rules + server)

**Files:** `firestore.rules`; Create `src/server/biometric-guard.ts`, `src/server/biometric-guard.test.ts`; Modify `src/server/biometric.ts:180-227` (server tasks), `:338-356` (dispatch); `tests/rules/commands.test.mjs`; add the test to `test:cfo` list in `package.json`.

Browser-created command types today (survey 2026-10-17): `user_upsert`, `enroll_fp` (with command text: `enrollment.service.ts:872-884`, `staff.service.ts:267-279`), and the empty-command server tasks `door_check`, `forget`, `bin_off`, `staff_off`, `photo_sync` (`src/lib/firestore.ts:77-156`, `recycle-bin.service.ts:191,321`). Browser updates: only `status → "cancelled"` on pending/sent. **Implementation step 0: re-grep `biometricCommands` in `src/` (not `src/server`) and confirm no other type is created.**

- [ ] Step 1: Rules tests first (`tests/rules/commands.test.mjs`), each `assertFails` on current rules for the bad cases:
  - desk creates `{type:"user_upsert", status:"pending", biometricUserId:"12", command:"CLEAR DATA"}` → FAIL
  - desk creates `{type:"user_upsert", biometricUserId:"12", command:"DATA UPDATE USERINFO PIN=12\tName=Ravi\tPri=14\t…"}` → FAIL (Pri=14 = machine admin)
  - desk creates the exact app text `DATA UPDATE USERINFO PIN=12\tName=Ravi K\tPri=0\tPasswd=\tCard=\tGrp=1\tTZ=0000000100000000\tVerify=0` → OK
  - desk creates `ENROLL_FP PIN=12\tFID=5\tRETRY=3\tOVERWRITE=1` with `biometricUserId:"12"` → OK; with PIN 13 in the text → FAIL
  - desk creates `{type:"forget", command:"", biometricUserId:"1\nC:9:CLEAR DATA"}` → FAIL; `biometricUserId:"IIFM12"` → OK
  - desk creates `{type:"delete_user", command:"DATA DELETE USERINFO PIN=5"}` → FAIL (server-only type)
  - desk updates a pending command `{status:"cancelled", updatedAt}` → OK; changes `command` → FAIL; sets `status:"pending"` on a cancelled one → FAIL
  - desk deletes a command → FAIL; `delmem` deletes → OK
- [ ] Step 2: Rules: remove `'biometricCommands'` from the staff wildcard list and add:
```
    // Machine commands. The app queues only these, with the exact text it builds; everything
    // else (deletes, template restores, imports) is made by the server. The server checks again
    // before anything reaches the machine (src/server/biometric-guard.ts).
    function cmdCreateOk(d) {
      return d.status == 'pending'
        && d.biometricUserId is string && d.biometricUserId.matches('[A-Za-z0-9]{0,24}')
        && d.command is string
        && ((d.type in ['door_check', 'forget', 'bin_off', 'staff_off', 'photo_sync'] && d.command == '')
          || (d.type == 'user_upsert' && d.biometricUserId.matches('[0-9]{1,9}')
            && d.command.matches('DATA UPDATE USERINFO PIN=' + d.biometricUserId
              + '\\tName=[^\\t\\r\\n]{0,40}\\tPri=0\\tPasswd=\\tCard=\\tGrp=1\\tTZ=0000000100000000\\tVerify=0'))
          || (d.type == 'enroll_fp' && d.biometricUserId.matches('[0-9]{1,9}')
            && d.command.matches('ENROLL_FP PIN=' + d.biometricUserId + '\\tFID=5\\tRETRY=3\\tOVERWRITE=1')));
    }
    match /biometricCommands/{id} {
      allow read: if isStaff();
      allow create: if isStaff() && cmdCreateOk(request.resource.data);
      allow update: if isStaff()
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'updatedAt'])
        && resource.data.status in ['pending', 'sent'] && request.resource.data.status == 'cancelled';
      allow delete: if can('deleteMembers') || can('devices');
    }
```
  (If the emulator shows `\\t` is not read as a tab by `matches`, switch to the literal tab escape and note which form works in a rules comment.)
- [ ] Step 3: Run `npm run test:rules` → commands tests PASS.
- [ ] Step 4: Pure server guard, tests first (`src/server/biometric-guard.test.ts`, node:test):
```ts
import { commandOk, pinOk } from "./biometric-guard.ts";
// pinOk: letters/digits, 1-24 chars (old machine IDs like IIFM12)
assert.equal(pinOk("12"), true); assert.equal(pinOk("IIFM12"), true);
assert.equal(pinOk(""), false); assert.equal(pinOk("1\nC:9:CLEAR DATA"), false); assert.equal(pinOk("1 2"), false);
// commandOk: no line breaks ever; app-made types must be the exact app text for their PIN
assert.equal(commandOk({ type: "delete_user", command: "DATA DELETE USERINFO PIN=5" }), true);
assert.equal(commandOk({ type: "delete_user", command: "DATA DELETE USERINFO PIN=5\r\nC:9:CLEAR DATA" }), false);
assert.equal(commandOk({ type: "user_upsert", biometricUserId: "12", command: "CLEAR DATA" }), false);
assert.equal(commandOk({ type: "enroll_fp", biometricUserId: "12", command: "ENROLL_FP PIN=12\tFID=5\tRETRY=3\tOVERWRITE=1" }), true);
assert.equal(commandOk({ type: "user_upsert", biometricUserId: "12",
  command: "DATA UPDATE USERINFO PIN=12\tName=Ravi\tPri=0\tPasswd=\tCard=\tGrp=1\tTZ=0000000100000000\tVerify=0" }), true);
```
- [ ] Step 5: `src/server/biometric-guard.ts`:
```ts
/** Machine IDs: letters and digits only (old software used IDs like IIFM12). */
export const pinOk = (pin: string) => /^[A-Za-z0-9]{1,24}$/.test(pin);
const APP_TEXT: Record<string, (pin: string) => RegExp> = {
  user_upsert: (pin) =>
    new RegExp(`^DATA UPDATE USERINFO PIN=${pin}\\tName=[^\\t\\r\\n]{0,40}\\tPri=0\\tPasswd=\\tCard=\\tGrp=1\\tTZ=0000000100000000\\tVerify=0$`),
  enroll_fp: (pin) => new RegExp(`^ENROLL_FP PIN=${pin}\\tFID=5\\tRETRY=3\\tOVERWRITE=1$`),
};
/**
 * Last check before a command goes to the machine. Nothing with a line break (one line = one
 * command). Types the app may queue must be exactly the app's own text for that member's PIN;
 * every other type is written only by the server (firestore.rules refuses them from the app).
 */
export function commandOk(d: { type?: unknown; command?: unknown; biometricUserId?: unknown }) {
  const command = String(d.command ?? "");
  if (/[\r\n]/.test(command)) return false;
  const app = APP_TEXT[String(d.type)];
  if (!app) return true;
  const pin = String(d.biometricUserId ?? "");
  return /^\d{1,9}$/.test(pin) && app(pin).test(command);
}
```
- [ ] Step 6: In `nextCommands` (`biometric.ts`, inside the dispatch loop before `seq += 1`): if `!commandOk(d)` → `tx.update(cmd.ref, { status: "failed", error: "Not sent: this command is not one the app makes.", completedAt, updatedAt })`, `console.warn`, `continue`.
- [ ] Step 7: In `runServerTasks` (`:180`): for `staff_off`/`forget`/`bin_off`, fail the task when `biometricUserId` is non-empty and `!pinOk`. `forget`/`bin_off`: also fail unless `clients/{clientId}` does NOT exist (the member really was deleted) and no live member holds that PIN on that device (`clients where biometricUserId == pin` limit 2, ignore other devices). `staff_off`: fail unless `staff/{staffId}` exists with `active === false` or is gone. Error text: "Refused: <reason>".
- [ ] Step 8: Add `src/server/biometric-guard.test.ts` to the `test:cfo` list; run `npm run test:cfo`, `npx tsc --noEmit` → PASS.
- [ ] Step 9: Commit `fix(security): machine commands only as the app builds them (S3)`.

## Task 3: S5 — Recycle Bin can't launder rights

**Files:** `firestore.rules` (`recycleBin`, `recycleBinItems`, `binnable`); `src/services/recycle-bin.service.ts:151-181, 214-300`; `tests/rules/bin.test.mjs`.

- [ ] Step 1: Tests first: desk creates a bin item `{collection:"staff", …, deletedByUid:"desk"}` → FAIL; owner → OK. Desk creates item for `staffPrivate` → FAIL. Desk creates item for `payments` → FAIL; `bills` login → OK. Desk creates item for `memberships` → FAIL; `plans` → OK. Desk creates item for `inquiries` → OK (unchanged). Desk creates a `recycleBin` entry `{section:"staff"}` → FAIL; `{section:"bills"}` → FAIL; `bills` login `{section:"bills"}` → OK; `fin` login `{section:"bills"}` → OK (Remove payment uses section bills).
- [ ] Step 2: Rules:
```
    // Who may put a record of each kind in the bin: whoever may delete it. Restoring runs with the
    // restorer's rights, so a copy planted by a login without that right must not get in.
    function canBin(c) {
      return (c in ['staff', 'staffPrivate'] && isOwner())
        || (c in ['payments', 'invoices', 'publicInvoices', 'trainerPayouts']
          && (can('deleteBills') || can('deleteMembers') || can('deletePlans') || can('finance')))
        || (c in ['memberships', 'ptAssignments', 'enrollments'] && (can('deleteMembers') || can('deletePlans')))
        || (c in ['clients', 'biometricCommands'] && can('deleteMembers'))
        || (c in ['trainers', 'packages'] && (can('deletePackages') || isOwner()))
        || (!(c in ['staff', 'staffPrivate', 'payments', 'invoices', 'publicInvoices', 'trainerPayouts',
            'memberships', 'ptAssignments', 'enrollments', 'clients', 'biometricCommands', 'trainers',
            'packages']) && isStaff());
    }
    // Each bin entry's section needs that section's delete right (DELETE_FEATURE_OF in
    // src/constants/features.ts); "bills" also takes Finance (Remove payment).
    function binSectionOk(s) {
      return (s == 'staff' && isOwner())
        || (s == 'members' && can('deleteMembers'))
        || (s == 'leads' && can('deleteLeads'))
        || (s == 'bills' && (can('deleteBills') || can('finance')))
        || (s == 'packages' && can('deletePackages'))
        || (s == 'expenses' && can('deleteExpenses'))
        || (s == 'plans' && can('deletePlans'))
        || (!(s in ['staff', 'members', 'leads', 'bills', 'packages', 'expenses', 'plans']) && isStaff());
    }
```
  `recycleBin` create adds `&& binSectionOk(request.resource.data.section)`; `recycleBinItems` create adds `&& canBin(request.resource.data.collection)`. **Step 2a:** grep every `section:` passed to `moveToBin`/bin writers and confirm each section maps to the right feature (e.g. a "payments"/"plans" section written by Remove payment/Remove plan).
- [ ] Step 3: `npm run test:rules` → PASS.
- [ ] Step 4: `recycle-bin.service.ts`: remove `"biometricCommands"` from `RESTORABLE` (restore drops them with the entry; the door check already re-syncs the machine). Remove the now-dead `biometricCommands` branch at `:242`.
- [ ] Step 5: `tsc`, commit `fix(security): bin entries only from logins that may delete that record (S5)`.

## Task 4: S1 — one real owner, no dev account, no password in git

**Files:** `firestore.rules:10-13`; `src/constants/owners.ts:5`; server owner check (grep `isOwnerEmail` in `src/server`); `scripts/test/sheet_backup_browser.py:18`, `sheet_backup_local.py:81`, `sheet_restore_local.py:52`; `tests/rules/owner.test.mjs`.

- [ ] Step 1: Tests: token `{email:"admin@elevategym.com", email_verified:true}` writes `staffAccess/x` → FAIL. Owner token writes → OK. (Only if Task 0 says verified:) owner email with `email_verified:false` → FAIL.
- [ ] Step 2: Rules `isOwner()`: list = `['rebuildfitnesskkd@gmail.com']`; add `&& request.auth.token.email_verified == true` only if Task 0 confirmed. `owners.ts`: same list. Server (`requireStaff`/owner check): if the verified check is on, also require `decoded.email_verified === true`.
- [ ] Step 3: Test scripts: owner email from `os.environ.get("EMU_OWNER_EMAIL", "rebuildfitnesskkd@gmail.com")`, password from `os.environ.get("EMU_OWNER_PASSWORD") or secrets.token_urlsafe(12)` (emulator-only, made up per run). Emulator owner needs `emailVerified: true` if the check is on: set it via the Auth emulator REST `accounts:update` with `Authorization: Bearer owner`.
- [ ] Step 4: `npm run test:rules`, `tsc`, run `scripts/test/sheet_backup_local.py` once on emulators → PASS.
- [ ] Step 5: Commit `fix(security): dev owner account removed; no password in test scripts (S1)`.

## Task 5: M1/S4 — money collections get their own rules

**Files:** `firestore.rules`; `tests/rules/payments.test.mjs`, `tests/rules/invoices-plans.test.mjs`, `tests/rules/counters.test.mjs`.

Survey of browser writers (2026-10-17): payments 17 sites, invoices 15, memberships 11, ptAssignments 7, enrollments 8, counters 2 (`enrollment.service.ts:394-403`, `invoices.service.ts:186-253`, `{ invoiceSeqYYYY: old+1, updatedAt }`, merge). Gates in the app: `paymentEditRights` (`payment-edit.service.ts:40`): `finance || (billing && (paymentDate == today || typed today))`; refunds need Finance everywhere (`plans-control.tsx:99,182`, `bill-edit.service.ts:99`, `plan-edit.service.ts:333-352`); delete rights per `DELETE_FEATURE_OF`.

**Step 0 (before writing rules):** grep `src/` (not server) for every `.delete(`/`deleteDoc`/`batch.delete`/`tx.delete` on `payments`, `invoices`, `publicInvoices`, `memberships`, `ptAssignments`, `enrollments` and every update that changes a payment's `amount|method|paymentDate|kind|oldSoftware`; list each with its UI gate in the commit message. Any writer not covered by the rules below must either get a rule clause or a code change — never leave a live flow that the rules silently break.

- [ ] Step 1: Tests first (date-relative with `day()`, `closedDay()` from helpers; seed with rules off):
  - payments create: desk, `amount 2000`, `paymentDate day(0)` → OK; `paymentDate closedDay()` → FAIL (owner too → FAIL); desk `amount -500 kind refund` → FAIL; fin refund → OK; desk `oldSoftware:true` any date → FAIL; fin → OK; `paymentDate day(3)` → FAIL; `kind:"gift"` → FAIL.
  - payments update: desk changes `amount` on a payment dated today created today → OK; on one dated 5 days ago created 5 days ago → FAIL; fin same → OK; fin on a closed-month payment → FAIL; owner closed-month amount → FAIL; anyone changes only `note`/`edits`/`gymAmount` on a closed-month payment → OK (Edit plan re-split); desk sets `oldSoftware:true` → FAIL; fin edits an `oldSoftware` payment from last year → OK.
  - payments delete: desk deletes a today balance payment it typed (`createdByUid` = desk, `createdAt` now) → OK; its own today SALE payment (`kind initial`, no splitId) → FAIL; desk deletes one part of today's Cash + UPI pair (`splitId` set) → OK; another desk's balance → FAIL; desk deletes yesterday's → FAIL; `bills` login deletes an open-month payment → OK; closed-month (non-old) by owner → FAIL; desk deletes a refund with `cancelId` (Restore cancellation) → OK; fin deletes an `oldSoftware` row from last year → OK.
  - invoices: desk changes `invoiceNumber` / `publicToken` / `invoiceDate` → FAIL; desk changes `amountPaid/balanceDue/paymentStatus` → OK; desk deletes → FAIL; `bills`/`delmem`/`plans` delete → OK. publicInvoices delete same as invoices.
  - memberships / ptAssignments / enrollments: desk create/update → OK; desk delete → FAIL; `plans`/`delmem` delete → OK.
  - counters: desk `invoiceSeq<thisYear>` 41 → 42 → OK; 41 → 1 → FAIL; 41 → 43 → FAIL; adds another key → FAIL; deletes the doc → FAIL; `sett` login any change → OK; last year's key +1 → OK.
  - wildcard: desk still writes `inquiries`, `attendance` (unchanged).
- [ ] Step 2: Rules. Remove `'memberships', 'invoices', 'ptAssignments', 'payments', 'enrollments'` from the staff wildcard list. Add:
```
    // ---- Money. Today in India as a number (20261017). The Day Book closes every day before the
    // 1st of last month (cashOpenFrom in src/services/finance.service.ts): cash there never changes.
    function istNow() { return request.time + duration.value(330, 'm'); }
    function todayNum() { return istNow().year() * 10000 + istNow().month() * 100 + istNow().day(); }
    function openFromNum() {
      return istNow().month() == 1
        ? (istNow().year() - 1) * 10000 + 1201
        : istNow().year() * 10000 + (istNow().month() - 1) * 100 + 1;
    }
    function isDay(s) { return s is string && s.matches('[0-9]{4}-[0-9]{2}-[0-9]{2}'); }
    function dayNum(s) { return int(s.replace('-', '')); }
    function isOld(d) { return d.get('oldSoftware', false) == true; }
    // Cash facts of a payment: what the Day Book adds up.
    function payOpen(d) { return isDay(d.paymentDate) && dayNum(d.paymentDate) >= openFromNum(); }
    function payShapeOk(d) {
      return d.amount is number && isDay(d.paymentDate) && dayNum(d.paymentDate) <= todayNum() + 1
        && d.get('kind', 'initial') in ['initial', 'balance', 'refund'];
    }
    function typedToday() {
      return resource.data.get('createdAt', null) is timestamp
        && (resource.data.createdAt + duration.value(330, 'm')).date() == istNow().date();
    }
    function payEditOk() {
      let a = resource.data;
      let b = request.resource.data;
      let keys = b.diff(a).affectedKeys();
      return !keys.hasAny(['amount', 'method', 'paymentDate', 'kind', 'oldSoftware'])
        || (payShapeOk(b)
          && (!keys.hasAny(['kind', 'oldSoftware']) || can('finance'))
          && ((isOld(a) && isOld(b))
            ? can('finance')
            : payOpen(a) && payOpen(b) && (b.amount >= 0 || can('finance'))
              && (can('finance')
                || (can('billing') && (dayNum(a.paymentDate) == todayNum() || typedToday())))));
    }
    match /payments/{id} {
      allow read: if isStaff();
      allow create: if isStaff() && payShapeOk(request.resource.data)
        && (isOld(request.resource.data)
          ? (can('finance') || can('deleteMembers') || can('recycleBin'))
          : payOpen(request.resource.data) && (request.resource.data.amount >= 0 || can('finance')));
      allow update: if isStaff() && payEditOk();
      allow delete: if isStaff() && (
        (isOld(resource.data) && (can('finance') || can('deleteMembers')))
        || (payOpen(resource.data) && !isOld(resource.data) && (
          can('finance') || can('deleteBills') || can('deleteMembers') || can('deletePlans')
          // Restore cancellation takes its refund back out (only ever adds cash back).
          || (resource.data.amount < 0 && resource.data.get('kind', '') == 'refund'
            && resource.data.get('cancelId', '') != '')
          // Undo right after collecting a balance: your own, typed today (never a sale's payment).
          || (resource.data.get('kind', '') == 'balance'
            && resource.data.get('createdByUid', '') == request.auth.uid && typedToday())
          // Edit payment joins a Cash + UPI pair back into one (same rights as editing it).
          || (resource.data.get('splitId', '') != '' && can('billing')
            && (dayNum(resource.data.paymentDate) == todayNum() || typedToday())))));
    }
    function billDeleter() {
      return can('deleteBills') || can('deleteMembers') || can('deletePlans');
    }
    match /invoices/{id} {
      allow read: if isStaff();
      allow create: if isStaff() && request.resource.data.invoiceNumber is string;
      allow update: if isStaff() && !request.resource.data.diff(resource.data).affectedKeys()
        .hasAny(['invoiceNumber', 'publicToken', 'invoiceDate']);
      allow delete: if billDeleter();
    }
    match /memberships/{id} {
      allow read, create, update: if isStaff();
      allow delete: if can('deletePlans') || can('deleteMembers');
    }
    match /ptAssignments/{id} {
      allow read, create, update: if isStaff();
      allow delete: if can('deletePlans') || can('deleteMembers');
    }
    match /enrollments/{id} {
      allow read, create, update: if isStaff();
      allow delete: if can('deletePlans') || can('deleteMembers') || can('deleteBills');
    }
```
  `publicInvoices`: `allow delete: if billDeleter();` (create/update stay `isStaff()`; `get` stays public).
  Counters inside `match /settings/{id}`:
```
    // Bill numbers: a desk may only take the next number (+1), this year's or last year's series.
    function counterStepOk() {
      let a = resource.data;
      let b = request.resource.data;
      let k1 = 'invoiceSeq' + string(istNow().year());
      let k0 = 'invoiceSeq' + string(istNow().year() - 1);
      let keys = b.diff(a).affectedKeys();
      return keys.hasOnly([k1, k0, 'updatedAt'])
        && (!keys.hasAny([k1]) || b[k1] == a.get(k1, 0) + 1)
        && (!keys.hasAny([k0]) || b[k0] == a.get(k0, 0) + 1);
    }
    match /settings/{id} {
      allow read: if isStaff();
      allow create, delete: if can('settings');
      allow update: if can('settings') || (id == 'counters' && isStaff() && counterStepOk());
    }
```
  (If the emulator rejects the `? :` operator, rewrite as `(cond && a) || (!cond && b)`.)
- [ ] Step 3: `npm run test:rules` → all PASS. Then run the Step 0 list again against the rules: every writer accounted for.
- [ ] Step 4: Commit `fix(security): money collections have their own rules: closed months, refunds, deletes, bill counter (M1/S4)`.

## Task 6: M5 — undo and delete never rewrite closed months

**Files:** Create `src/lib/closed-month.ts`, `src/lib/closed-month.test.ts`; Modify `src/services/plan-cancel.service.ts:379-414`, `src/services/recycle-bin.service.ts` (`binBill` ~466, `binMember` ~385, `restoreFromBin` ~214), `src/services/payment-remove.service.ts` (`putBackPayment` ~220-310); the bin-member dialog (find the "keep accounts" checkbox).

- [ ] Step 1: Tests first (`closed-month.test.ts`):
```ts
import { closedMoney } from "./closed-month.ts";
const pay = (paymentDate: string, amount = 100, oldSoftware = false) => ({ paymentDate, amount, oldSoftware });
assert.deepEqual(closedMoney([pay("2026-09-30"), pay("2026-10-02")], "2026-09-01"), []);
assert.equal(closedMoney([pay("2026-08-31")], "2026-09-01").length, 1);
assert.deepEqual(closedMoney([pay("2025-01-05", 900, true)], "2026-09-01"), []); // old-software money is never drawer cash
```
- [ ] Step 2: `src/lib/closed-month.ts`:
```ts
/** Payments dated in a closed Day Book month (before `openFrom`, the 1st of last month): their
 * cash was carried forward, so nothing may add, remove or change them. Old-software money never
 * was in the drawer and is not counted. */
export function closedMoney<T extends { paymentDate: string; oldSoftware?: boolean }>(
  payments: T[],
  openFrom: string,
) {
  return payments.filter((p) => !p.oldSoftware && p.paymentDate < openFrom);
}
```
- [ ] Step 3: Guards (each throws a plain message before any write):
  - `restoreCancellation`: if `closedMoney(pays)` is non-empty → "The refund of this cancellation is dated {date}, in a closed Day Book month: it can't be undone. Sell the plan again instead."
  - `binBill`: closed-month payments on the bill → "This bill has money dated in a closed Day Book month ({date}): it can't be deleted."
  - `binMember`: if the member has closed-month payments and "keep bills & payments" is NOT ticked → refuse with "{name} has money in closed Day Book months: tick "Keep bills and payments" to delete the member." (Also make the dialog tick it and lock it on when that's the case, if the dialog already has the payments loaded; otherwise the message is enough.)
  - `restoreFromBin` and `putBackPayment`: items with closed-month payments → "This has money dated {date}, in a closed Day Book month: it can't be put back." Also refunds (amount < 0) need `can('finance')`: pass `viewer.finance` and refuse with "Only Finance can put back money given back."
- [ ] Step 4: `npm run test:cfo`, `tsc` → PASS. Commit `fix(money): undo and delete never change closed Day Book months (M5)`.

## Task 7: M6 — a refund belongs to the cancelled plan's bill

**Files:** `src/services/plan-cancel.service.ts:161-175, 338-345`; caller `src/components/clients/plans-control.tsx` (`latestBill`); `src/services/recycle-bin.service.ts` `binBill`.

- [ ] Step 1: In `cancelPlans` the refund's `invoiceId`/`invoiceNumber` = the first cancelled plan's own bill (`input.plans[0]?.invoiceId ?? input.pts[0]?.invoiceId`, number from the bill doc read in Task 8's transaction), falling back to `latestBill` only when the plan has no bill (old-software carry). Rename the input to `fallbackBill` with a comment.
- [ ] Step 2: `binBill`: refuse when the bill has a refund payment with a `cancelId` ("This bill carries the refund of a cancelled plan: Restore that cancellation first.") or a trainer payout with `status == "paid"` ("The trainer was already paid for this bill: cancel the plan instead.").
- [ ] Step 3: Emulator regression in Task 10 covers it (cancel with refund → bin a newer unrelated bill → refund still there). Commit `fix(money): refund stays with the cancelled plan's bill (M6)`.

## Task 8: M4 — Cancel plan in a transaction, re-reading everything

**Files:** `src/services/plan-cancel.service.ts:202-367`.

- [ ] Step 1: Keep the reads that need queries outside (payout lookups by `ptAssignmentId`, `currentAfter`), then `runTransaction`: `tx.get` every plan, PT plan, bill in `closeBills`/`lowerBills`, each found payout, and the refund bill. Refuse with "Something changed on this member since you opened Cancel (a payment or another change). Close and open Cancel again." when any of: a plan's `status` ≠ the screen's; a bill's `amountPaid`, `balanceDue`, `paymentStatus` or `cancelledDue` ≠ the screen's; a payout's `status`/`grossAmount` ≠ what was read. Then do the same writes with `tx.update`/`tx.set` (values from the fresh reads, e.g. `beforeCancel.balanceDue` = fresh `balanceDue`).
- [ ] Step 2: Note the wrapper (`@/lib/firestore` `runTransaction`) adds audit/door lines; confirm it handles `tx.set` on new payout/refund docs (it does for the sale).
- [ ] Step 3: Emulator regression (Task 10): desk A opens Cancel, desk B collects the balance, desk A saves → refused; after re-open → the bill is not closed with a stale due.
- [ ] Step 4: Commit `fix(money): Cancel plan re-reads inside one transaction (M4)`.

## Task 9: M7 — two desks can't sell overlapping plans

**Files:** `src/services/enrollment.service.ts:262-276, 373-430`.

- [ ] Step 1: Before the memberships query (`:264`), read the member doc and keep `planSeq0 = Number(data.planSeq ?? 0)`. Inside the transaction `tx.get(clientRef)`; if `Number(fresh.planSeq ?? 0) !== planSeq0` → "Another desk just changed this member's plans. Close and start the sale again." Write `planSeq: planSeq0 + 1` with the client update (existing clients only; new members start at 1).
- [ ] Step 2: (M8 part done by Task 5's counter rule; financial-year series deferred — Decision 6.) `createInvoice`'s `createMembership` path has no browser caller (survey): leave a comment "no overlap check: unused path" — don't build on it.
- [ ] Step 3: Commit `fix(money): a sale refuses if another desk changed the member's plans meanwhile (M7)`.

## Task 10: S8/S9 small + full regression

**Files:** `src/server/admin.ts:82-120`, `src/server/router.ts:24`, `src/server/automation.ts:596-597`, `vite.config.ts`.

- [ ] Step 1: `/api/health`: without an owner bearer token answer only `{ ok: true|false }` (ok = service account + firestore ok); with an owner token the current detail. Update the two "open /api/health" error messages to "(the owner can open /api/health)".
- [ ] Step 2: Cron: `const ok = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));` (same helper as `whatsapp-gateway.ts:588`) and use it for the `authorization` check.
- [ ] Step 3: Headers via nitro `routeRules` in `vite.config.ts` for `/**`: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy: camera=(self), microphone=(), geolocation=()`, and `Content-Security-Policy-Report-Only` listing the real origins (Firebase, Google APIs, Cloudinary, the app). Not `/invoice/*` framing changes. Check the photo capture page still gets the camera.
- [ ] Step 4: **Full regression on emulators** (ports 8780/9780, own app port): copy the latest kit (scratchpad `32d649c3…/regress.sh` + suites; owner email → `rebuildfitnesskkd@gmail.com`, emulator password made up), then run: journey, audit2_local, remove_local, split-pay suites, plus a NEW `hardening_local.py` that, as a desk login with default features: sells a plan, collects a balance, undoes it, edits today's payment, registers a thumb (commands created OK); as Finance: cancel with refund, restore cancellation, Edit plan on a plan from 3 months ago (re-split works), remove payment; as deleteBills: bins a bill; the M4/M6/M7 two-desk cases. Every suite PASS (known stale: `olddates_local.py` 6 checks — fail on main too).
- [ ] Step 5: `npm run test:cfo`, `npm run test:rules`, `npx tsc --noEmit`, `npm run build` → PASS. Screens touched (Cancel, bin dialogs): screenshots 390 px + 1440 px, light + dark.
- [ ] Step 6: Commit `fix(security): health detail owner-only, constant-time cron secret, security headers (S8/S9)`.

## Task 11: S2 — only the relay may talk to /iclock (staged, founder in the loop)

**Files:** `src/server/biometric.ts:1404-1416`; `tools/cloudflare-relay.js`; `src/routes/_authenticated/biometric-devices.tsx:229` (relay host out of the public bundle).

The machine can't hold a secret (plain HTTP, fixed paths), so the relay proves the request came through it: the Worker adds header `x-relay-key` from a Worker secret; the server compares it (constant time) with `serverSecrets/iclockRelay.key`.

- [ ] Step 1: Server: `relayCheck(request)` → `"ok" | "missing" | "wrong"`. Mode from `serverSecrets/iclockRelay.mode` (cached 3 min like `findDevice`): `"off"` (default; accept all, journal "missing"/"wrong" once a minute), `"enforce"` (refuse with plain `OK` and no work on anything but `"ok"`).
- [ ] Step 2: `tools/cloudflare-relay.js`: `headers: { …, "x-relay-key": env.RELAY_KEY }` (`fetch(request, env)` signature).
- [ ] Step 3: Unit test the check (constant-time compare, modes). Emulator: fake machine requests with/without the header in both modes.
- [ ] Step 4: **Founder steps (after the app deploy with mode "off"):** (a) we write `serverSecrets/iclockRelay {key: <random 32 bytes hex>, mode: "off"}` with the founder's OK; (b) founder (or we, in the ICONOIQ/owner browser they name) pastes the new Worker code and adds secret `RELAY_KEY` in Cloudflare; (c) we read the device log: every machine request shows "ok" for a day, door + punches normal; (d) with the founder's OK set mode "enforce"; (e) watch one full day. Rollback = set mode "off" (no deploy needed).

---

## After the build (each needs the founder's OK)

1. Adversarial review (multi-agent workflow, ~5 agents, ultracode on): rules bypasses, broken live flows, money maths in Tasks 6-9. Fix what it confirms; re-run Task 10 Step 4-5.
2. Merge to main, **push** (founder OK) → wait for `/api/version` = new commit, wait for open tabs to update.
3. **Rules deploy** (founder OK): `read_live_rules.mjs` backup + diff (only the intended blocks change) → `deploy_rules.mjs`. Then a live smoke the owner does (sell nothing new; open Billing, Day Book, a member's plans, the bin; desk login registers a thumb if someone is there).
4. Task 11 staged steps.
5. HANDOFF + memory: rules shape, closed-month freeze, deferred list.
