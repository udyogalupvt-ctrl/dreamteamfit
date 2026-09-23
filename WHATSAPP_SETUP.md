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
   `gym_bill` message goes out with a **View bill** button. Renewal reminders (7 days before
   expiry) and birthday wishes go out every morning.

## 1. Create these 3 templates

Meta Business Manager → WhatsApp Manager → Message templates → **Create template**.
For all three: Category **Utility**, Language **English (en)**, no header, no footer.
Names must match exactly (also editable in *Settings → WhatsApp*).

Replace `YOUR-APP-DOMAIN` with the address where the app is hosted (for example
`app.rebuildfitness.in`). The button URL can't be changed freely after approval, so decide the
domain first.

### `gym_bill`

**Body**

```
Hi {{1}}, thank you for your payment at {{2}}.

Bill no: {{3}}
Amount paid: ₹{{4}}
Balance due: ₹{{5}}

Tap View bill below to see, download or print your bill.
```

Body samples: {{1}} `Ravi Kumar` · {{2}} `Rebuild Fitness` · {{3}} `INV-2026-000004` ·
{{4}} `4,000` · {{5}} `1,500`

**Button** → Call to action → Visit website

| Field | Value |
| --- | --- |
| Button text | `View bill` |
| URL type | Dynamic |
| Website URL | `https://YOUR-APP-DOMAIN/invoice/{{1}}` |
| Sample URL | `https://YOUR-APP-DOMAIN/invoice/1b9c4f0e2a7d4c8e9f3a5b6c7d8e9f0a1b2c3d4e5f6a7b8c` |

The app fills {{1}} with the bill's secret code, so each member only sees their own bill.

### `gym_renewal_reminder`

```
Hi {{1}}, your membership at {{2}} ends on {{3}}. Please renew at the front desk to continue your training without a break.
```

Samples: `Ravi Kumar` · `Rebuild Fitness` · `23 Oct 2026`. No button.

### `gym_birthday_wish`

```
Hi {{1}}, happy birthday from all of us at {{2}}! Wishing you a healthy and strong year ahead.
```

Samples: `Ravi Kumar` · `Rebuild Fitness`. No button.

Meta reviews the category itself. Bills and renewal reminders are account updates and stay
**Utility**. Meta usually re-classifies birthday wishes as **Marketing**; it still sends (at the
marketing rate). To stay 100% Utility, turn off birthday wishes in *Settings → Reminders*.

{{2}} is always the gym name from *Settings → Gym & bills*, so the same three templates work
for every gym you run on this WhatsApp number.

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
