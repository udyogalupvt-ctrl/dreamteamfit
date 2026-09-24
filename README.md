# Rebuild Fitness — Gym Management

Front-desk software for gyms: members join in one flow (details → package / PT → payment →
bill on WhatsApp → first thumb on the fingerprint device), leads get follow-up calls, and the
owner sees income, expenses, trainer shares and profit. Every action is written to a
tamper-proof activity log.

## Stack

- **App:** React 19 + TanStack Start (Vite), Tailwind CSS 4, TypeScript
- **Data:** Firebase Auth + Firestore (rules in `firestore.rules`)
- **Server:** the app's own routes on Vercel (`src/server/`), free plan: WhatsApp Cloud API,
  fingerprint devices (eSSL / ZKTeco ADMS) and door lock, daily reminders (Vercel Cron).
  Firebase stays on the free Spark plan: only Auth and Firestore are used.
- **Images:** Cloudinary (member photos, gym logo)

## Run locally

```sh
npm install
cp .env.example .env        # fill in the values
npm run dev                 # http://localhost:8080
```

## Deploy (Vercel, free plan)

Push to GitHub; Vercel builds it. The whole app, including `/api/*` and `/iclock/*`, is
**one** Vercel function, and there are **2** cron jobs (8 AM and 9:30 PM India time), both
within the free (Hobby) limits.

In Vercel → Project → Settings → **Environment Variables**, add everything in `.env.example`:
the `VITE_*` values (used at build time) and the server values:

| Variable | What |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase console → Project settings → Service accounts → Generate new private key; paste the whole JSON |
| `WHATSAPP_ACCESS_TOKEN` | Meta system-user token |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_GRAPH_API_VERSION` | from `.env.example` |
| `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | only for delivery ticks (webhook) |
| `CRON_SECRET` | any long random text; Vercel uses it to call the daily reminder jobs |

Firestore rules (free, any plan): `firebase deploy --only firestore:rules`.

Local build without Vercel: `npm run build && npm start` (Node server on `$PORT`).

## Test locally with the Firebase emulators

```sh
firebase emulators:start --only firestore,auth      # needs Java
VITE_USE_EMULATORS=1 npm run build
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 PORT=5199 npm start
```

## Configuration

| Where | What |
| --- | --- |
| `.env` (git-ignored) | Firebase web config, Cloudinary, server values for local runs |
| `.env.example` | Template of the above, safe to commit |
| Vercel environment variables | Same values for the live site |

## Guides

- [WhatsApp setup and templates](WHATSAPP_SETUP.md)
- [Fingerprint device setup](BIOMETRIC_SETUP.md)

## Project layout

```
src/routes/        pages (dashboard, members, leads, billing, expenses, settings …)
src/components/    UI — enrollment/ is the joining flow, biometrics/ the thumb panel
src/services/      all Firestore reads/writes (through src/lib/firestore.ts, which also writes
                   the activity log and door-lock notes with every change)
src/server/        Vercel server routes: biometric.ts (ADMS + door lock), whatsapp.ts,
                   automation.ts (daily reminders), router.ts
tools/             adms-relay.mjs for fingerprint devices without HTTPS
```
