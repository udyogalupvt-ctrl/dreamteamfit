# The gym's own WhatsApp gateway (OpenWA)

This sends the **bill after payment** and the **member app link** from the gym's own WhatsApp
number (+91 96664 46131). The number stays on the gym's phone, like WhatsApp Web. It is the same
way the old software worked, on a small server the gym controls.

Time needed: about 1 hour. You need:

- the gym's phone with WhatsApp on +91 96664 46131 (to scan a QR code at the end);
- a Cloudflare account with the gym's domain in it;
- a server (below), about ₹500–1,000 a month.

## Why a separate server (not Vercel, Cloudflare or Firebase)

A linked WhatsApp has to stay connected all day, like WhatsApp Web open in a browser, and keep its
login files on a disk. Vercel, Cloudflare Workers and Firebase Functions run code only for a
moment when a request comes in, then stop, with no disk that stays. So the phone would be
logged out all the time. They stay as they are: Vercel runs the app, Firebase keeps the data,
and **Cloudflare gives the server its safe https address** (step 2). Only the gateway needs the
small always-on server.

## How it stays safe

| Risk                              | What protects it                                                                                                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WhatsApp blocks the number        | Only bills and member app links are sent: people who just paid expect them. Reminders and announcements never go from this number (the app refuses them).                           |
| A mistake sends too much          | Daily limits on the server (60, then 80, then 100 a day; new chats 40/50/60). Extra messages are refused, not queued.                                                               |
| Looking like a robot              | Real Chrome (whatsapp-web.js), a typing pause before each message, a server in India like the phone.                                                                                |
| WhatsApp limits the number anyway | The app stops sending by itself and shows it in Settings → WhatsApp.                                                                                                                |
| Someone else uses the gateway     | No open ports: only Cloudflare's tunnel reaches it. The app's token can only use the gym's instance (it can't make keys or change settings). The admin key never leaves the server. |
| Server security                   | Firewall (SSH only), automatic security updates, blocking of repeated wrong SSH logins.                                                                                             |

What stays true: this is WhatsApp Web automation, not Meta's official API, so WhatsApp **can**
still limit the number. The steps above keep that risk low. The official way (Cloud API +
coexistence, see [WHATSAPP_SETUP.md](../../WHATSAPP_SETUP.md)) has no such risk.

## 1. Buy the server

Any VPS company is fine. Choose:

- **Location: India (Mumbai or Bangalore).** WhatsApp sees where the linked device connects
  from. The same country as the phone looks normal.
- **Ubuntu 24.04**, **2 GB RAM or more** (WhatsApp Web runs in Chrome), 1 CPU, 20 GB disk.

For example: Hostinger VPS (India), DigitalOcean (Bangalore) or AWS Lightsail (Mumbai). Note the
server's **IP address** and **root password** (or SSH key).

## 2. Make the Cloudflare tunnel

1. Cloudflare dashboard → **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel**.
   Cloudflare renames menus from time to time: search for "Tunnels" if it isn't there.
2. Type **Cloudflared**, name `gym-whatsapp`, Save.
3. Environment **Docker**. Copy the command shown (`docker run … --token eyJ…`). You need the long
   token at its end. Keep it private.
4. **Public hostname** (or "Published application routes"): subdomain `wa`, your domain,
   service type **HTTP**, URL **`openwa:2785`**. Save.

The gateway address is now `https://wa.<your domain>`. It works once step 4 has run.

## 3. Copy this folder to the server

On your computer, in the project folder (PowerShell or Terminal):

```
scp -r deploy/openwa root@SERVER_IP:/opt/openwa
```

## 4. Run the setup

```
ssh root@SERVER_IP
bash /opt/openwa/setup.sh
```

It installs everything and asks two things:

- **the tunnel token** from step 2 (pasting the whole command also works; it stays hidden);
- **the hostname**, e.g. `wa.yourgym.in`.

At the end it prints three values: **Gateway address**, **Instance ID** and **Token**. The token is
shown only once. Don't send it on WhatsApp or email: paste it straight into the app (step 5). If it
is lost, run `bash /opt/openwa/connect.sh` for a new one (the old one stops working).

In Cloudflare, the tunnel should now show **Healthy**.

## 5. Connect the app and link the phone

1. In the gym app: **Settings → Automatic WhatsApp**: turn on _Send WhatsApp messages
   automatically_, Send from: **The gym's own WhatsApp number**, **Save**.
2. In **Gym's own WhatsApp number (linked phone)**: paste the Gateway address, Instance ID and
   Token, **Save connection**.
3. **Start**, wait about 30 seconds, then **Show QR to link the phone**.
4. On the gym's phone: WhatsApp → **Linked devices** → **Link a device** → scan the QR.
   It shows **Connected +91 96664 46131**.
5. **Send test** to your own number. It should arrive in a few seconds.

## 6. Switch off the old software

So members don't get two bills:

1. Turn off WhatsApp sending in the old software.
2. On the gym's phone: WhatsApp → **Linked devices**: remove the old software's device. Keep the
   one you linked today.

## Day to day

- Use WhatsApp on the gym's phone normally. If the phone stays off for about 14 days, linked
  devices are logged out.
- Don't remove the gateway from Linked devices, and don't link it again and again. Linking is the
  moment WhatsApp checks most.
- Settings → WhatsApp shows the state. **Disconnected**: press Start. **Waiting for the QR**:
  Show QR and scan again.
- If WhatsApp limits the number, the app stops sending and says so. Keep using the phone
  normally and don't re-link. Switch to the backup below meanwhile.

## Backup: switch to the Cloud API in one step

If the gateway or the gym's phone is down, or WhatsApp limits the number, switch back to Meta's
official WhatsApp Cloud API (the gym's earlier number). Its settings on Vercel stay as they are,
so nothing needs to be set up again:

1. **Settings → Automatic WhatsApp → Send from → WhatsApp Cloud API (Meta) → Save.**
2. Press **Test connection**. From the next message on (within about 30 seconds), bills go from
   the Cloud API, and so do reminders and announcements.

Switch back the same way: **Send from → The gym's own WhatsApp number → Save**. The linked phone,
the gateway address and the token stay saved.

## Server commands (on the server, after `ssh root@SERVER_IP`)

```
cd /opt/openwa
docker compose ps                        # both should be "running"
docker compose logs --tail 100 openwa    # what the gateway is doing
docker compose restart openwa            # restart (the phone reconnects by itself)
docker compose pull && docker compose up -d   # update (monthly, or if linking stops working)
bash connect.sh                          # a new token for the app
```

Never run `docker compose down -v` or delete the `openwa_openwa-data` volume: that removes the
linked session, and the phone would have to be linked again.

## If something goes wrong

| The app says                                                    | Do this                                                                                                                                                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Can't reach the WhatsApp gateway                                | Cloudflare → Tunnels: is it Healthy? On the server: `docker compose ps`. Meanwhile, use the backup above (Cloud API).                                                                                         |
| The gateway refused the API key                                 | Run `bash connect.sh` and paste the new token.                                                                                                                                                                |
| No QR right now                                                 | Press Start, wait 30 seconds, Show QR again.                                                                                                                                                                  |
| Today's sending limit is reached                                | The day's safety limit (it resets at 5:30 AM India time). Use the backup (Cloud API) or share bills by hand until then. To raise it, change `DAILY_LIMIT` in `/opt/openwa/.env`, then `docker compose up -d`. |
| The phone asks to "Create a passkey" and linking never finishes | A WhatsApp check that OpenWA can't do yet (OpenWA issue #560). Use the backup (Cloud API), update the gateway later and try again.                                                                            |
