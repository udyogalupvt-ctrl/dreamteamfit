# WhatsApp Cloud API setup

The application is complete in Mock mode. Mock messages are written to `whatsappMessages` and never leave the application.

## Firebase Functions configuration

Configure these values in the Firebase project before deploying Functions:

- Secret `WHATSAPP_ACCESS_TOKEN`: permanent Meta system-user token.
- Secret `WHATSAPP_APP_SECRET`: Meta app secret used to verify webhook signatures.
- Secret `WHATSAPP_VERIFY_TOKEN`: a strong shared value also entered in Meta's webhook form.
- Parameter `WHATSAPP_PHONE_NUMBER_ID`: the sending phone-number ID.
- Parameter `WHATSAPP_GRAPH_API_VERSION`: Graph API version, default `v23.0`.

Never add these values to a `VITE_` variable, frontend file, or Firestore document.

## Meta webhook

After deploying Firebase Functions, configure the HTTPS function named `whatsappWebhook` as the WhatsApp callback URL. Subscribe to message status events and use the same value stored as `WHATSAPP_VERIFY_TOKEN` during verification.

The endpoint verifies the GET challenge, validates every POST with `X-Hub-Signature-256`, records each callback idempotently, and updates message lifecycle status without downgrading later states.

## Templates

Create and approve the four template names configured under Settings → WhatsApp:

- Invoice delivery: member name, invoice number, public invoice URL.
- Membership renewal: member name, expiry date.
- Birthday greeting: member name.
- Follow-up: member name, reason, follow-up date.

Template languages and parameter order must match the Meta-approved templates.

## Deployment limitation

Real sends and webhook callbacks cannot be verified until the Meta WhatsApp Business connection, credentials, approved templates, and Firebase Functions deployment access are available.