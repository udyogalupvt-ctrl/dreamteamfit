# WhatsApp setup

Account checked on 24 Sep 2026: number **+91 79896 17553 (Dream Team Services)**, status
CONNECTED, quality GREEN, business verified, permanent system-user token with messaging and
template permissions. Test sends of `hello_world` and `order_confirmed` were accepted by Meta.

There are two ways a bill reaches the member:

1. **Share on WhatsApp (works without any setup).** After payment, staff tap
   *Share bill on WhatsApp*; WhatsApp opens on the member's chat with the bill link typed, staff
   press Send.
2. **Automatic (Cloud API).** Turn on in *Settings → WhatsApp*. Right after payment the bill PDF
   is sent from the business number to members who ticked "Send bill & reminders on WhatsApp".
   Renewal reminders (7 days before expiry) and birthday wishes go out every morning.

## 1. Create these 3 templates

Meta Business Manager → WhatsApp Manager → Message templates → **Create template**.
Language **English (en)** for all. Names must match exactly (they are also editable in
*Settings → WhatsApp*). Emoji and the ₹ sign are fine.

### `gym_bill` — Category: **Utility**

- **Header:** Document (upload any sample PDF when Meta asks)
- **Body:**

```
Hi {{1}}, thank you for your payment at {{2}}.

Bill no: {{3}}
Amount paid: ₹{{4}}
Balance due: ₹{{5}}

Your bill PDF is attached. You can also view it online: {{6}}

See you at the gym!
```

- **Samples:** {{1}} `Ravi Kumar` · {{2}} `Rebuild Fitness` · {{3}} `INV-2026-000004` ·
  {{4}} `4,000` · {{5}} `1,500` · {{6}} `https://your-app-domain/invoice/3f9c2a`
- Footer / buttons: none

### `gym_renewal_reminder` — Category: **Utility**

```
Hi {{1}}, your membership at {{2}} ends on {{3}}. Renew at the front desk or reply to this message to keep training without a break. See you soon!
```

Samples: `Ravi Kumar` · `Rebuild Fitness` · `23 Oct 2026`

### `gym_birthday_wish` — Category: **Marketing** (Meta counts greetings as marketing)

```
Happy birthday {{1}}! 🎉 Everyone at {{2}} wishes you a strong and healthy year ahead. Keep training!
```

Samples: `Ravi Kumar` · `Rebuild Fitness`

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

## How the bill PDF is attached

No file storage is used. The cloud function `invoicePdf` builds the PDF from the bill's secret
link on request, and WhatsApp downloads it from there. Members can also press
*Download PDF* on the bill page, which builds it on their phone.

## If a send fails

The reason is shown to staff and saved in *More → Message History*. Common ones: template not
approved yet or name mismatch, the member did not agree to WhatsApp messages, or an invalid
number. *Share on WhatsApp* always works as a fallback.
