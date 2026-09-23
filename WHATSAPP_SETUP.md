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

## 1. Create these 4 templates

Meta Business Manager → WhatsApp Manager → Message templates → **Create template**.
For all four: Category **Utility**, Language **English (en)**, no header, no footer.
Names must match exactly (also editable in *Settings → WhatsApp*).

Replace `YOUR-APP-DOMAIN` with the address where the app is hosted (for example
`app.rebuildfitness.in`). The button URL can't be changed freely after approval, so decide the
domain first.

### `gym_payment_receipt` — sent right after payment

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

### `gym_renewal_reminder` — 7 days before the plan ends

```
Hi {{1}}, your {{2}} membership ends on {{3}} ⏳

You've put in the work, so don't let the momentum stop now! 💪
Renew at the front desk and keep your streak going strong.

Your goals don't take a break, and neither should you. 🔥
```

Samples: `Ravi Kumar` · `Rebuild Fitness` · `23 Oct 2026`. No button.

### `gym_birthday_wish` — on the member's birthday, morning

```
Happy birthday, {{1}}! 🎉🎂

Everyone at {{2}} is cheering for you today. Here's to a year of new personal bests, more strength and great health.

Celebrate hard, train harder. Keep crushing it! 💪
```

Samples: `Ravi Kumar` · `Rebuild Fitness`. No button.

### `gym_miss_you` — missed-workout nudge, 9:30 PM (optional, off by default)

```
Hey {{1}}, we missed you at {{2}} today! 👋

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

Submit all four as **Utility**, but Meta decides the final category. The payment receipt and
renewal reminder are account updates and stay Utility. Meta usually moves birthday wishes and
missed-workout nudges to **Marketing**: they still send, at the marketing rate. To keep
everything Utility, leave birthday wishes and the missed-workout nudge switched off.

{{2}} is always the gym name from *Settings → Gym & bills*, so the same templates work for every
gym you run on this WhatsApp number.

## 2. Server configuration

Values live in `.env` (git-ignored) and `functions/.env`. Put the secrets into Firebase and
deploy (needs the Blaze plan):

```sh
firebase login
firebase use leadsmanage-1f7cd
npm run secrets:whatsapp            # WHATSAPP_ACCESS_TOKEN / APP_SECRET / VERIFY_TOKEN from .env
cd functions && npm install && npm run build && cd ..
firebase deploy --only functions,firestore:rules
```

Then in the app: *Settings → WhatsApp → Send through WhatsApp Cloud API* ON → **Test connection**.

## 3. Delivery ticks (optional)

Meta app → WhatsApp → Configuration → Webhook:

- Callback URL: `https://us-central1-leadsmanage-1f7cd.cloudfunctions.net/whatsappWebhook`
- Verify token: the `WHATSAPP_VERIFY_TOKEN` value from `.env`
- Subscribe to **messages**. Also set `WHATSAPP_APP_SECRET` (Meta app → Settings → Basic).

## The bill page

The **View bill** button and the shared link open `/invoice/<secret code>` on the app. The page
shows the bill and has **Download PDF** (built on the member's phone) and **Print**. No files are
stored anywhere.

## If a send fails

The reason is shown to staff and saved in *More → Message History*. Common ones: template not
approved yet or name mismatch, the member did not agree to WhatsApp messages, or an invalid
number. *Share on WhatsApp* always works as a fallback.
