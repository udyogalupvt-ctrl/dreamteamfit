# Rebuild Fitness — Gym Management

Front-desk software for gyms: members join in one flow (details → package / PT → payment →
bill on WhatsApp → first thumb on the fingerprint device), leads get follow-up calls, and the
owner sees income, expenses, trainer shares and profit. Every action is written to a
tamper-proof activity log.

## Stack

- **App:** React 19 + TanStack Start (Vite), Tailwind CSS 4, TypeScript
- **Data:** Firebase Auth + Firestore (rules in `firestore.rules`)
- **Server:** Firebase Cloud Functions (`functions/`): WhatsApp Cloud API, bill PDFs,
  fingerprint devices (eSSL / ZKTeco ADMS), door lock, daily reminders, activity log
- **Images:** Cloudinary (member photos, gym logo)

## Run locally

```sh
npm install
cp .env.example .env        # fill in the values
npm run dev                 # http://localhost:8080
```

## Build and host the app

```sh
npm run build
npm start                   # Node server on $PORT (default 3000)
```

The build also deploys to Vercel, Netlify or Cloudflare without changes (Nitro auto-detects
the platform).

## Deploy the server side (Firebase)

Needs the Firebase **Blaze** plan (Cloud Functions).

```sh
npm install -g firebase-tools
firebase login
firebase use leadsmanage-1f7cd
npm run secrets:whatsapp          # copies WHATSAPP_ACCESS_TOKEN from .env to Firebase Secret Manager
cd functions && npm install && npm run build && cd ..
firebase deploy --only functions,firestore:rules
```

## Configuration

| Where | What |
| --- | --- |
| `.env` (git-ignored) | Firebase web config, Cloudinary, WhatsApp IDs + access token |
| `.env.example` | Template of the above, safe to commit |
| `functions/.env` | WhatsApp phone number ID / API version for the functions (not secret) |
| Firebase Secret Manager | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` |

## Guides

- [WhatsApp setup and templates](WHATSAPP_SETUP.md)
- [Fingerprint device setup](BIOMETRIC_SETUP.md)

## Project layout

```
src/routes/        pages (dashboard, members, leads, billing, expenses, settings …)
src/components/    UI — enrollment/ is the joining flow, biometrics/ the thumb panel
src/services/      all Firestore reads/writes
functions/src/     biometric.ts (ADMS + door lock), whatsapp.ts, invoice-pdf.ts, audit.ts
tools/             adms-relay.mjs for fingerprint devices without HTTPS
```
