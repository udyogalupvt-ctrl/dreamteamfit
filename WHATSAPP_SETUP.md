# WhatsApp setup

Account checked on 24 Sep 2026: number **+91 79896 17553 (Dream Team Services)**, status
CONNECTED, quality GREEN, business verified, permanent system-user token with messaging and
template permissions. Test sends of `hello_world` and `order_confirmed` were accepted by Meta.

There are two ways a bill reaches the member. Both send the **bill page** (not a PDF file):
the member opens it and can view, download the PDF, or print.

1. **Share on WhatsApp (works without any setup).** After payment, staff tap
   *Share bill on WhatsApp*; WhatsApp opens on the member's chat with the bill link typed, staff
   press Send.
2. **Automatic (Cloud API).** Turn on in *Settings → WhatsApp*. Right after payment the
   `gym_payment_receipt` message goes out with a **View bill** button. Renewal reminders
   (7 days before expiry) and birthday wishes go out at 8 AM; missed-workout nudges at 9:30 PM.

## 1. Templates (5)

Meta Business Manager → WhatsApp Manager → Message templates → **Create template**.
Language **English (en)**, no header, no footer. Category is given for each template below.
Names must match exactly (also editable in *Settings → WhatsApp*).

Replace `YOUR-APP-DOMAIN` with the address where the app is hosted (for example
`app.rebuildfitness.in`). The button URL can't be changed freely after approval, so decide the
domain first.

### `gym_payment_receipt` — sent right after payment (Utility)

**Body**

```
Hi {{1}}, thanks for powering up with {{2}}! 💪

Your payment is confirmed ✅
🧾 Bill no: {{3}}
💰 Amount paid: ₹{{4}}
⏳ Balance due: ₹{{5}}

Tap View bill to see, download or print your bill.

Keep showing up, every rep counts. See you on the floor! 🔥
```

Samples: {{1}} `Ravi Kumar` · {{2}} `Rebuild Fitness` · {{3}} `INV-2026-000004` ·
{{4}} `4,000` · {{5}} `1,500`

**Button** → Call to action → Visit website

| Field | Value |
| --- | --- |
| Button text | `View bill` |
| URL type | Dynamic |
| Website URL | `https://YOUR-APP-DOMAIN/invoice/{{1}}` |
| Sample URL | `https://YOUR-APP-DOMAIN/invoice/1b9c4f0e2a7d4c8e9f3a5b6c7d8e9f0a1b2c3d4e5f6a7b8c` |

The app fills the button's {{1}} with the bill's secret code, so each member only sees their own bill.

### `gym_payment_due` — balance reminder (Utility, created and approved)

Sent once a day at about 8 AM from 3 days before the member's next payment date (set when they
pay part of a bill) up to that day. Days before is set in *Settings → Reminders*.

```
Hello {{1}}, this is a payment reminder from {{2}}.

A balance of ₹{{3}} for bill {{4}} is due on {{5}}. You can pay at the front desk.

Tap View bill to see your bill. If you have already paid, please ignore this message.
```

Button: **View bill** → `https://dreamteamfit.vercel.app/invoice/{{1}}`.

### `gym_membership_expiry` — 7 days before the plan ends (Utility)

Kept strictly factual so Meta approves it as **Utility** (no motivational or sales wording).

```
Hello {{1}}, this is an account update from {{2}}.

Your membership is valid until {{3}}. To continue your gym access without a break, please renew your plan at the front desk on or before this date.

If you have already renewed, please ignore this message.
```

Samples: `Ravi Kumar` · `Rebuild Fitness` · `23 Oct 2026`. No button.

### `gym_birthday_wish` — on the member's birthday, morning (Marketing only)

```
Happy birthday, {{1}}! 🎉🎂

Everyone at {{2}} is cheering for you today. Here's to a year of new personal bests, more strength and great health.

Celebrate hard, train harder. Keep crushing it! 💪
```

Samples: `Ravi Kumar` · `Rebuild Fitness`. No button.

### `gym_miss_you` — missed-workout nudge, 9:30 PM (Marketing; optional, off by default)

```
Hey {{1}}, we have missed you at {{2}}! 👋

It's been {{3}} days since your last workout.

💬 "{{4}}"

Your goals are waiting. Let's get back at it from tomorrow — see you on the floor! 💪🔥
```

Samples: `Ravi Kumar` · `Rebuild Fitness` · `3` · `The only bad workout is the one you skipped.`

How it works: every night at **9:30 PM** (after closing) the server looks at each member's
last thumb punch at the door. A member with a running plan who hasn't punched in for the number
of days set in *Settings → Reminders* (default 3) gets **one** message with a rotating quote.
They are not messaged again until they come back and then miss again. It is **off by default**
because every message has a WhatsApp charge; switch it on in *Settings → Reminders*.

### About the category

- `gym_payment_receipt` and `gym_membership_expiry` are account updates → **Utility**.
- `gym_birthday_wish` and `gym_miss_you` are greetings / engagement. Meta classifies these as
  **Marketing** whatever the wording, so create them as Marketing. They still send, at the
  marketing rate. Keep them switched off in *Settings → Reminders* if you want Utility-only costs.
- If a Utility template is flagged, remove anything promotional (offers, "don't miss out",
  motivation, many emojis) and resubmit under a new name.

{{2}} is always the gym name from *Settings → Gym & bills*, so the same templates work for every
gym you run on this WhatsApp number.

## 2. Server configuration (Vercel)

The WhatsApp token lives only on the server. In Vercel → Project → Settings → Environment
Variables add `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_GRAPH_API_VERSION`,
`FIREBASE_SERVICE_ACCOUNT` and `CRON_SECRET` (see README), then redeploy.

Then in the app: *Settings → WhatsApp → Send through WhatsApp Cloud API* ON → **Test connection**.

Renewal reminders and birthday wishes go out once a day around 8 AM, missed-workout nudges
around 9:30 PM (Vercel Cron; on the free plan the exact minute varies within the hour).

## 3. Delivery ticks (optional)

Meta app → WhatsApp → Configuration → Webhook:

- Callback URL: `https://dreamteamfit.vercel.app/api/whatsapp/webhook`
- Verify token: the `WHATSAPP_VERIFY_TOKEN` value
- Subscribe to **messages**. Also set `WHATSAPP_APP_SECRET` (Meta app → Settings → Basic).

## The bill page

The **View bill** button and the shared link open `/invoice/<secret code>` on the app. The page
shows the bill and has **Download PDF** (built on the member's phone) and **Print**. No files are
stored anywhere.

## If a send fails

The reason is shown to staff and saved in *More → Message History*. Common ones: template not
approved yet or name mismatch, the member did not agree to WhatsApp messages, or an invalid
number. *Share on WhatsApp* always works as a fallback.

## Usage and cost

*More → WhatsApp Usage* shows how many messages went out per kind (bills, balance reminders,
renewal, birthday, missed workout), whether each is Utility or Marketing, and the approximate
cost. Set the ₹-per-message rates there to match your Meta invoice.
