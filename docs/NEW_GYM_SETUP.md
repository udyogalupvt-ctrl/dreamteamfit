# New gym setup and data migration

Last checked: 2026-10-14, branch `sheet-backup`. This file covers four things: bringing a gym's past data into the app (from old software or from paper books), setting up a new gym, the values that change from gym to gym, and the risks of one client's data or keys reaching another.

No secret values appear here. Keys, tokens and service-account files stay out of git and out of this document.

All paths are relative to the project root (`dreamteamfit/`). Time and effort figures are estimates, not measurements.

---

## 1. Bringing data from old software

The app has four ways in. Only some of them carry money.

### 1a. Settings → Import / export wizard (works with any software, carries no money)

- **Code:** `src/components/settings/data-import-wizard.tsx`, `src/lib/data-import.ts` (reading and checks), `src/services/data-import.service.ts` (writing). Each run is recorded in `importBatches`.
- **Files:** CSV, XLSX or XLS up to 10 MB. Staff can pick the sheet.
- **Column matching:** the wizard suggests a match for each column from a list of aliases, and staff can change any of them. Member ID accepts "member no", "reg no", "enroll id", "biometric id" and similar names.
- **Dates it understands:** Excel date numbers, ISO (YYYY-MM-DD), day-first DD/MM/YY(YY), and text with a month name.
- **What it can import:**
  - **Clients:** Member ID, name\*, phone\* (10 digits), email, date of birth, gender, joining date, address, emergency contact, notes.
  - **Packages:** name\*, days\*, price\*, category, description.
  - **Trainers:** name, phone, email, specialization, joining date, share %.
  - **Memberships:** matched to a member by Member ID or phone; package\*, start\*, end, price, status, trainer name. A package or trainer the app doesn't know can be mapped to an existing one, created, or skipped.
  - **Expenses:** any past date is accepted.
- **What carries over:** the file's Member ID becomes the member's ID. Members without one get the lowest free number, skipping numbers the fingerprint machine still uses. Importing the same file twice is blocked. Staff can tick WhatsApp opt-in for imported members.
- **What does not carry over:** money. A plan comes in with its dates, price and status only. There is no payment, bill, amount paid, balance, PT plan, old member ID, counsellor, bill number, photo or visit history. The CFO page treats these plans as old money, not new sales.
- **How staff use it:**
  1. Settings → Import / export.
  2. Import Packages first, then Clients (with a Member ID column), then Memberships. Trainers and Expenses are optional.
  3. Each time: upload → match columns → preview → fix errors and duplicates (an error file can be downloaded) → confirm.
- **Who can use it:** anyone with the Settings feature. The database also requires the Packages feature for packages, Packages or Staff for trainers, and Finance or Day Book for expenses.

### 1b. Backup page: upload the old software's exports (works for one product only)

- **Code:** `src/routes/_authenticated/backup.tsx`, `src/server/old-data.ts`, `src/lib/old-data.ts`.
- **Files read:** only two CSV exports from the software Rebuild Fitness used before, a "Customer report" and a "Subscription report". The app recognises them by their exact column names. Any other file is stored as "Other file" and never read.
  - **Customer report columns:** Member Id, First Name, Last Name, Contact, Gender, Date Of Birth, Married Status, Anniversary Date, Councellor (or Counsellor), Email, Address, Remark, Status, Registration Date.
  - **Subscription report columns:** Membership Name, Membership Cost, Discount, Amount to be paid, Balance Amount, Start Date, Expires On, Next Payment, Status, Councellor, CreatedBy, Remark, Member Name. A bill number is read from text like "BILL NO :- 344" in Remark.
  - **Dates:** YYYY-MM-DD, DD-MM-YYYY or DD/MM/YYYY only.
- **Storage:** the original files are kept exactly as uploaded, with a checksum, and every download is logged. The app builds one record per phone number from the newest Customer report and the newest Subscription report. A member with no phone number is dropped.
- **Limits:** owner only. Up to 10 files and about 3 MB per upload. The file picker offers .xlsx and .xls, but the app never reads them.
- **What uses this data:**
  - **Joining form:** typing a phone shows "Use old details", which fills in the name, gender, date of birth, joining date, old member ID and counsellor.
  - **Member profile:** an "Old software record" card with Link and Unlink.
  - **Member app:** a linked member sees their old history.
  - **"Link members already added"** (owner only): fills a blank old member ID, joining date, date of birth and gender, matched by phone plus name. It changes nothing else.
  - **Call lists:** "Call" or "Put all shown on the call list" on the Backup page, and Member calls → Old software → "Bring in everyone not back yet".

### 1c. Carrying old plans and money as they are (needs the data from 1b)

- **Code:** `src/server/old-migrate.ts`, `src/lib/old-migrate.ts`. Each carry is recorded in `oldSoftwareMoves`.
- **What one carry does:**
  - **Member:** creates the member if needed. The old ID becomes the Member ID only if it is a number from 1 to 8999. Otherwise the next free number is used and the old ID is kept separately.
  - **Plan:** creates a gym plan, a PT plan or both, chosen from the plan name. It keeps the old name, dates and amount.
  - **Money paid:** one payment on the plan's start day, with mode "Not recorded", marked as old-software money. This never enters drawer cash.
  - **Balance:** a "Balance from the old software" bill, due on the old "Next Payment" date. No reminder goes out until staff confirm it.
  - **Fingerprint machine:** the app re-checks that member's door access.
  - **Which plans:** plans running today or paid in advance. On a member's first carry it also takes their latest ended plan. Plans with missing dates are skipped.
- **How staff start it (one member at a time, needs the Members feature):**
  - Backup → Old members → "To add" → **Add**;
  - global search → "In the old software";
  - the joining form's "Carry the old plan as it is" banner;
  - Member calls → Old software → Add.
- **Bulk carry:** the owner-only preview, apply and undo endpoints still exist, but no screen calls them. The live migration was run with a script. Carries made before the 2026-10-13 audit fix can't be undone through the API.

### 1d. Users and fingerprints from the fingerprint machine

- **Code:** `src/server/device-import.ts`, `src/server/biometric.ts`, `src/components/biometrics/device-users-section.tsx`.
- **Machines:** only ZKTeco / eSSL machines that use the cloud push protocol (ADMS).
- **How it works:** "Read users from the machine" (needs the Fingerprint devices feature) opens a 30-minute window. The machine sends each user's ID, name, admin flag, user settings and finger templates. Faces, cards and photos are not carried.
- **Linking:** it never creates members. It links a machine user to a member or staff member when the IDs match **and** the names agree. A linked member keeps their stored fingerprint, so they don't need to scan again. Anyone left unlinked is listed for a manual Link or Remove.
- **Limits:** only the last 7 days of punches are taken. Pointing the machine at this app disconnects the old software. **Import members first, then press Read users.** Pressing it again links anyone missed.

### Steps for a new gym today

**If the old software is the same product Rebuild Fitness used:**
1. Export the Customer report and the Subscription report as CSV.
2. Backup → Save to backup.
3. Press "Link members already added".
4. Carry each member with Add or search.
5. Put members who haven't come back on the call list.
6. Fingerprint devices → add the device → Read users → link the rest.

**If it is any other product:**
- **Path A (recommended today):** use the wizard for packages, then clients, then memberships, then press Read users. Amounts paid and balances are lost.
- **Path B (undocumented, error-prone):** rename the export's columns by hand to the exact headers in 1b, save as CSV, and use the Backup + carry path.
- **Don't mix the two paths for the same members.** A carry adds a second plan next to the one the wizard imported.

### Known gaps

1. The Backup path has no column matching: fixed headers, CSV only, two report types.
2. The Backup picker accepts .xlsx and .xls but never reads them, and it doesn't say so.
3. Only the newest Customer report and Subscription report are used, so exports split by year or branch can't be combined.
4. The wizard carries no money: no payments, bills, balances, PT plans or counsellors.
5. Member IDs must be numbers from 1 to 8999. In the wizard, any other ID makes the row an error and the row is not imported.
6. Dates are always read day-first, so a month-first (US) export is silently misread. The Backup path also rejects text months ("01-Oct-2026") and 2-digit years.
7. PT is detected from the plan name only.
8. The bulk carry has no screen, and the Backup upload has no preview or per-row error report.
9. Never imported: visit history (beyond 7 days of machine punches), photos, non-trainer staff, PT packages, leads, past bills, and machines that are not ADMS ZKTeco / eSSL.

---

## 2. Entering data from paper books

### What works today

**Members with old joining dates**
- The sale form's Joining date has no earliest date, so any past date works. If it is left blank and the plan started in the past, the joining date becomes the plan's start day.
- It can be changed later from the member's profile → Edit.
- There is no "add member without a sale" form. A new member needs a sale or an import.

**Plans with a past start date**
- For a new member, or one whose plans have all ended, Start date has no earliest date. A plan that has already ended is saved as expired.
- **Catch:** once a member has a plan running today or starting later, Start date is hidden and staff only get "Renew from" or Upgrade. The server also refuses two gym plans on the same days. So each member's history must be typed **oldest plan first**.

**"Paid on" at checkout**
- It defaults to the plan's first day if the plan started in the past, otherwise today.
- The picker allows only the 1st of last month up to today, and the server checks the same.
- **Catch:** if the plan started before the 1st of last month, the payment is dated **today** (`src/lib/late-sales.ts`, the `start >= openFrom` check). The book money then shows in today's Collected, and in today's Day Book cash if it was cash.

**Payment modes:** Cash, UPI, Card, Bank Transfer, and Cash + UPI (saved as two linked payments). There is no other split, such as Card + Cash. A part payment leaves a balance, needs a next payment date of today or later, and sends a WhatsApp reminder that morning.

**"Paid before the app" / "Not recorded":** only the old-software carry (1c) creates these. Checkout never offers them. **A paper gym has no screen to record money paid before it started using the app.**

**Old balances:** the only routes are a sale with a part payment, or Billing → Create bill. Create bill is always dated and due today, so reminders start at once.

**Day Book:** opening cash can be set for any day ("Set the opening cash of this day") by a Day Book or Finance login.

**Who can change a payment's amount, mode or date:**

| Login | Can change |
|---|---|
| Billing (front desk) | Only payments dated today or typed in today |
| Finance | Any day from the 1st of last month |
| Anyone | Before the 1st of last month: the note only |

This rule is enforced in the browser only. The database rules let any staff login write payments.

**The ₹1 top-up:** at checkout, a payment up to ₹99 over the board price offers "Make the bill ₹X", ticked by default. After a sale, a Finance login can use Edit plan → Price.

**WhatsApp:** every sale sends a bill on WhatsApp unless staff untick the opt-in. It is on by default.

**Excel import:** this is the only bulk route for paper books (see 1a), and it brings in no money.

### How long one-by-one entry takes (estimated from the fields, not timed)

| Step | Estimate |
|---|---|
| Details (name, phone, ID, date of birth, joining date, gender, untick WhatsApp) | 60-90 s |
| Package, start date, counsellor | 30-45 s |
| Amount, mode, paid on, next payment date | 30-60 s |
| Save, then "Finish later" on the fingerprint step | 10-15 s |
| **One member, one plan** | **about 2.5-5 min** |
| Each extra past plan | about 1.5-2 min |

### Proposed feature: bulk entry from the register

**Page:** a spreadsheet-style grid, with a downloadable template and paste from Excel. One row per register line:
- paid date, book bill number, name, phone, member ID;
- row type: new, renewal, PT, balance or top-up;
- package (closest match), start date (end worked out), price, discount, paid amount, mode (with a cash-part column), balance, next due date, counsellor, trainer, note;
- keyboard movement, fill-down, and each row checked as it is typed.

**Dry run before saving:**
- match existing members by member ID first, then by phone plus a name word;
- flag duplicates and overlapping plans;
- sort each member's plans by date;
- show totals by day and by mode to check against each register page.

**Money rules:**
- Pick a **cut-over date**. Rows on or after it become normal payments on their real date, in the Day Book, with Cash + UPI pairs.
- Rows before it become "before the app" payments, keeping the mode or "Not recorded". They never count as drawer cash, incentives or trainer payouts.
- Old balances become balance bills that send no reminder until staff tick them.
- Set Day Book opening cash and the CFO opening balance on the cut-over date.

**Saving:**
- Owner or Finance only, saved on the server in one run.
- One transaction per member, with fixed row IDs so a retry never duplicates.
- A run record with Undo, following the `oldSoftwareMoves` pattern.
- App data loaded once per run, not once per row.
- Bill numbers from the counter, the current plan worked out again, door access re-checked.
- **No WhatsApp messages or automations.**

**Proof:** unit tests for each row decision, an emulator test suite, screenshots in light and dark mode at 390 px and 1440 px, and a check against the paper totals by month and mode.

**Effort:** not estimated in the research. Treat it as a feature-sized build that needs the brainstorm → plan → build steps and a money-code review.

---

## 3. New gym setup checklist (in order)

**0. Collect from the client**
- [ ] Gym name and short name
- [ ] Square logo PNG, at least 512 px
- [ ] Owner Gmail address(es)
- [ ] Address, phone, GSTIN, tax rate, invoice prefix
- [ ] Packages and prices
- [ ] WhatsApp number plan: their own WhatsApp Business Account, or the gym-PC route
- [ ] Fingerprint machine model and serial, and whether it supports HTTPS
- [ ] Export files from their previous software, or photos of the register

**1. Code copy**
- [ ] `git clone` into a new folder. **Never copy the folder** (see section 6).
- [ ] Point `origin` at the client's own repo.
- [ ] Check the folder has no `*adminsdk*.json`, `.env`, `.output/` or `.wrangler/`.

**2. Code edits (needed until section 5 is built)**
- [ ] `src/constants/owners.ts` and `firestore.rules` (`isOwner`): the client's emails only. Remove Rebuild's email and the dev test account.
- [ ] Brand: `src/constants/navigation.ts`, the "Rebuild Fitness" text (about 70 lines in about 48 files under `src/`), `public/manifest.webmanifest`, `public/offline.html`, `public/sw.js`, the manifest in `src/server/portal.ts`, and the icons in `public/`.
- [ ] `src/lib/cloudinary.ts`: remove the fallback account values.
- [ ] `src/server/sheet-backup.ts`: set `DEFAULT_SHEET_ID` to `""`.
- [ ] `RELAY_HOST` in `src/routes/_authenticated/biometric-devices.tsx`, and `APP` in `tools/cloudflare-relay.js`.
- [ ] Default reminder texts in `src/lib/automation-templates.ts`.
- [ ] Run `npm run build`, `npm run test:cfo` and the emulator regression.

**3. Firebase**
- [ ] New project with Firestore in Native mode. Pick a location that matches the Vercel function region. Rebuild uses nam5 with Vercel's default US-East region. If you pick asia-south1, set Vercel to bom1.
- [ ] Upgrade to Blaze and add a budget alert.
- [ ] Authentication: turn on Email/Password and **turn off sign-up**. The app creates all logins on the server.
- [ ] Register a web app and copy its config into the 7 `VITE_FIREBASE_*` variables.
- [ ] Generate a service-account key and **store it outside the repo**.
- [ ] Turn on the Google Sheets API in the same Google Cloud project.
- [ ] Deploy `firestore.rules` and read them back. No composite indexes are needed.

**4. First owner login:** Firebase console → Authentication → Add user, using an email from the owner list. The app has no sign-up or password-reset screen.

**5. Cloudinary:** the client's own account, with an unsigned upload preset. Set `VITE_CLOUDINARY_CLOUD_NAME` and `VITE_CLOUDINARY_UPLOAD_PRESET`.

**6. Vercel**
- [ ] New project from the client's repo.
- [ ] Env vars: the 7 `VITE_FIREBASE_*`, the 2 `VITE_CLOUDINARY_*`, `FIREBASE_SERVICE_ACCOUNT`, `CRON_SECRET` (a new random value) and `APP_URL` (the final domain, decided now). Optional: `LOGIN_VAULT_KEY`, `CFO_AI_PROVIDER`, `CFO_AI_MODEL` and the client's own AI key.
- [ ] Build every env var fresh. Never copy them from another client's project.
- [ ] Deploy, then check `/api/health` and `/api/version`. The 4 crons register automatically.

**7. In the app, as owner**
- [ ] Settings → Gym & bills: name (also used in WhatsApp messages), logo, address, GSTIN, tax, invoice prefix. Set these before the first bill.
- [ ] Settings → Appearance (colours).
- [ ] Settings → Reminders: rewrite the texts.
- [ ] Packages.
- [ ] Staff → add staff → Create login → choose features.

**8. WhatsApp**
- [ ] The client's own WhatsApp Business Account and number (business verification, permanent token).
- [ ] Create the 7 templates (`WHATSAPP_SETUP.md` §1 plus `gym_member_app`), with buttons on the client's domain. Wait for approval. The button URL can't be changed after approval.
- [ ] Set the 6 `WHATSAPP_*` env vars and redeploy.
- [ ] Meta webhook: `https://<domain>/api/whatsapp/webhook`, subscribed to "messages".
- [ ] Settings → WhatsApp: template names, Cloud API on, Test connection.
- [ ] Or use the gym-PC route instead: Settings → WhatsApp → Run it on the gym PC.

**9. Fingerprint machine**
- [ ] With HTTPS: server = the app domain, port 443.
- [ ] Without HTTPS: a Cloudflare Worker in the client's own account, running the relay code pointed at their domain.
- [ ] Fingerprint devices → add the device (ADMS + serial). Set the machine's Cloud Server Setting. Check it shows online.
- [ ] Import members first (step 11), then press Read users.

**10. Sheet backup**
- [ ] The client creates a Google Sheet and shares it as Editor with the service-account email shown on the Backup page.
- [ ] Paste the link on the Backup page, then Sync now (full). Do this before the first night's cron.

**11. Data import:** follow section 1 or section 2.

**12. Final check**
- [ ] Run one test sale and confirm the bill, the WhatsApp message, the member-app link and the push notification.
- [ ] Run the `security-audit` skill (quick profile).

---

## 4. Every gym-specific value

Kind: **Code** = written in the code, **Env** = Vercel or `.env` variable, **Settings** = changed in the app, **Outside** = Meta, Cloudflare or Google console. Effort: S under 30 min, M 1-3 h, L a day or more.

| Item | Where | Kind | How to change | Effort |
|---|---|---|---|---|
| Owner emails (two copies that must match) | `src/constants/owners.ts`, `firestore.rules` `isOwner()` | Code + rules | Edit both, remove the dev test account, deploy rules | S |
| Push contact email | `src/server/push.ts` (first owner email) | Code | Follows `owners.ts` | – |
| Gym name in the app | `src/constants/navigation.ts` (`APP_NAME`, `GYM_NAME`) plus about 70 literal lines in about 48 files (page titles, login, top bar, menus, brand mark, settings) | Code | Search and replace. `VITE_APP_NAME` exists in `.env.example` but nothing reads it | M |
| Gym name on bills, WhatsApp and member pages | Settings → Gym & bills (`businessName`), with fallbacks in code | Settings | Owner types it | S |
| PWA name and offline page | `public/manifest.webmanifest`, `public/offline.html`, `public/sw.js`, member/trainer manifest in `src/server/portal.ts` ("RF Trainer") | Code | Edit the files | S |
| Logo, favicon, app icons, theme colour | About 11 images in `public/` and `public/icons/`; `brand-mark.tsx`; theme colour in `__root.tsx`, the manifest and `portal.ts` | Code | Replace the images | M |
| Logo on bills | Settings → Gym & bills → Logo on bills | Settings | Owner uploads it | S |
| Colours | Settings → Appearance. The bill PDF yellow is fixed in `src/lib/invoice-pdf.ts` | Settings / Code | Settings, or edit the PDF constant | S |
| Invoice prefix | Settings → Gym & bills (default "INV") | Settings | Set before the first bill | S |
| GST, address, phone, email | Settings → Gym & bills | Settings | Owner | S |
| Firebase project | 7 `VITE_FIREBASE_*` variables; `FIREBASE_SERVICE_ACCOUNT` (server). Test scripts default to a retired project | Env | New project + env | S |
| Firestore rules deploy | The README command. The working deploy-and-read-back script is not in the repo | Outside | `npx firebase-tools deploy --only firestore:rules --project <id>` | S |
| Photo storage (Cloudinary) | `src/lib/cloudinary.ts` **falls back to Rebuild's account** if the env vars are missing. `src/server/member-photo.ts` accepts any Cloudinary URL if the env var is empty. Folder names `rebuild-fitness/...` | Env + Code | Set both env vars and remove the fallbacks | S |
| App domain | `APP_URL`, otherwise the last request's address. Also in `tools/cloudflare-relay.js`, `tools/adms-relay.mjs` and the docs | Env + Outside | Set `APP_URL` | S |
| Member/trainer login email domain | `src/constants/portal.ts` (`EMAIL_DOMAIN`) | Code | **Never change it in a live project.** It is part of every member and trainer login | – |
| WhatsApp template button URLs | In the Meta templates, not in code | Outside | New templates on the new domain | M + Meta wait |
| WhatsApp template names | Settings → WhatsApp (defaults `gym_payment_receipt`, `gym_membership_expiry`, `gym_payment_due`, `gym_birthday_wish`, `gym_miss_you`, `gym_announcement`, `gym_member_app`) | Settings | Same names work in a new account | S |
| WhatsApp number and token | 6 `WHATSAPP_*` env vars. Country code in Settings | Env + Outside | The client's own WhatsApp Business Account | M |
| Gym-PC WhatsApp (OpenWA) | `OPENWA_*` env vars or Settings. File names and the placeholder number mention Rebuild | Settings + Code (labels) | Labels are cosmetic | S |
| Google Sheet backup | `DEFAULT_SHEET_ID` in `src/server/sheet-backup.ts` **points at Rebuild's sheet**. The night cron runs it every night | Code + Settings | Set to `""`, then connect the client's sheet on the Backup page | S |
| Fingerprint machine relay | `RELAY_HOST` in `src/routes/_authenticated/biometric-devices.tsx` **is Rebuild's Worker**; `APP` in `tools/cloudflare-relay.js` | Code + Outside | New Worker in the client's account, edit both | M |
| Cron secret | `CRON_SECRET`. Without it all crons are off. Times are fixed for India in `vite.config.ts` | Env | New random value | S |
| Push keys | Created automatically | Auto | Nothing | – |
| Password safe key | `LOGIN_VAULT_KEY` (optional); fixed salt in `src/server/vault.ts` | Env | **Never change the salt in a live project** | – |
| CFO AI | `CFO_AI_PROVIDER`, `CFO_AI_MODEL`, provider key | Env | The client's own key, or none | S |
| Time zone | Asia/Kolkata, fixed in several files. The Settings timezone field is never read | Code | Only for a gym outside India | L |
| Currency and number format | INR, "₹" and en-IN formats throughout | Code | Only for a gym outside India | L |
| Member and staff ID ranges | Members 1-8999, staff from 9001, numbers only | Code | Change if the client's machine uses other IDs | M |
| Default reminder texts | `src/lib/automation-templates.ts` mentions Rebuild Fitness. Editable in Settings → Reminders | Settings + defaults | Owner edits, or fix the defaults | S |
| Old-software import | Expects one product's report headers (`src/lib/old-data.ts`); "Backup (old software data)" feature switch | Code | Use the Import wizard for other software | – / M to hide |
| Cosmetic names | `package.json`, browser storage keys, export file names, sheet title, OpenWA key name | Code | Optional | S |

---

## 5. Changes so a new gym needs no code edits

Estimated total: about 3-4 developer days, or about 2-2.5 days without time zone and currency.

| # | Change | What it removes | Effort |
|---|---|---|---|
| 1 | **One gym config file** (`src/config/gym.ts`) built from `VITE_GYM_NAME`, `VITE_GYM_SHORT_NAME`, `VITE_GYM_SLUG`. Replace the literal names, photo folders, storage keys, file names and reminder defaults | The search-and-replace across about 48 files | ~0.5 day |
| 2 | **Manifest and icons served by the app.** Build the manifest on the server (`portal.ts` already does this for the member app). Use the Settings logo through Cloudinary for the sidebar and icons, with the static file as fallback. Make `offline.html` generic, and have `sw.js` take the title from the push message | Replacing ~11 images and the static files | 0.5-1 day |
| 3 | **Owners from config.** A Firebase custom claim `owner: true`, checked in the rules and on the server, granted once from an `OWNER_EMAILS` env var by a setup script | The two owner lists that must match, and the email-only owner check (risk 5) | ~1 day. Security work: emulator rules tests plus a reviewer |
| 4 | **Remove dangerous defaults.** No Cloudinary fallback (uploads turn off with a message). `member-photo.ts` requires the env var. `DEFAULT_SHEET_ID = ""`, so the backup skips and asks "Connect your Google Sheet" | Risks 2 and 3 | ~2 h with tests |
| 5 | **Relay host as data.** Store it with the device or in settings, editable on the Devices page. The Worker reads `APP_URL` | Risk 6 and two code edits | 1-2 h |
| 6 | **Commit a rules-deploy script** with read-back, and put placeholders in the docs instead of the client's domain and number | The recipe that lives only in an old session folder | 1-2 h |
| 7 | **Setup check.** Extend `/api/health`, or add an owner "Setup" card, that flags anything missing: `APP_URL`, Cloudinary, owners, WhatsApp, sheet, relay | Silent misconfiguration | 3-4 h |
| 8 | Optional: member/staff ID ranges in Settings (2-3 h); a switch to hide the old-software screens (M); one region file for time zone, currency, number format and cron times (1-1.5 days, only for a gym outside India) | | |

Import improvements, sized separately:
- money columns (amount paid, mode, paid date, balance) in the wizard's Memberships import, using the "before the app" rules from section 2;
- Excel files and column matching on the Backup path;
- a screen for the bulk carry;
- a date-order choice (day-first or month-first).

**Leave these alone in live projects:** `EMAIL_DOMAIN` in `src/constants/portal.ts` and the vault salt in `src/server/vault.ts`. Changing either breaks existing logins or saved passwords. It is fine to keep both unchanged in new copies.

**Deployment model:** one shared repo, with one Vercel project and one Firebase project per gym. Bug fixes then reach every gym, but one push also deploys to every gym, so release in stages (for example, one production branch per client).

---

## 6. Risks: one client's keys or data reaching another

| # | Risk | What could happen | Prevention |
|---|---|---|---|
| 1 | **Copying the folder** | The project folder holds the live gym's admin key file, an old project's key file, `.env`, a build folder and `.wrangler/`. They are git-ignored and not in git history, but a folder copy brings them along. With a copied `.env`, the new gym's test data goes into Rebuild's live database. The copied `.git` still pushes to Rebuild's repo, so a push could deploy the new gym's code to Rebuild's live site | Always `git clone`. Check for key files. Set a new `origin` |
| 2 | **Photo storage fallback** | Without the env vars, the new gym's member photos (personal data) upload to Rebuild's Cloudinary account | Set the env vars. Remove the fallback (section 5, item 4) |
| 3 | **Sheet backup fallback** | The new gym's nightly backup targets Rebuild's sheet. Today only the sheet's sharing blocks it. A reused service account or wider sharing would let it overwrite Rebuild's backup | Set `DEFAULT_SHEET_ID` to `""`. Never reuse a service account |
| 4 | **Shared WhatsApp number** | Meta allows one webhook per app, and incoming chats are filtered only by number ID, so the new gym's member replies would land in Rebuild's chats. The template buttons point to Rebuild's domain, so the new gym's bills and member-app links would open Rebuild's app | Each gym gets its own number, account and templates |
| 5 | **Owner check trusts the email alone** | The rules and server never check that the email is verified. If Rebuild's email or the dev test account stays in a new copy and sign-up is on (Firebase's default), anyone could register that email and become owner. A test password for the dev account is in a committed test script | Remove both emails, turn off sign-up, move to the owner claim (section 5, item 3). Confirm whether the dev account exists on live |
| 6 | **Relay host on the Devices page** | New gym staff would point their machine at Rebuild's relay. No data is stored for unknown machines, but the machine silently fails and Rebuild's database pays for the extra reads | Edit `RELAY_HOST` or make it a setting (section 5, item 5) |
| 7 | **Copying Vercel env vars between projects** | This would carry the WhatsApp token and the service-account key | Build each client's env fresh, then check `/api/health` |
| 8 | Smaller items | The push contact address and a placeholder phone number would still be Rebuild's | Covered by the code edits in section 3, step 2 |

**Rule:** one client's keys never go into another client's project. Before handing a new gym over, run the `security-audit` skill (quick profile).
