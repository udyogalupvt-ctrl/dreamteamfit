# The gym's own WhatsApp gateway (OpenWA)

This sends the **bill after payment** and the **member app link** from the gym's own WhatsApp
number (+91 96664 46131). The number stays on the gym's phone, like WhatsApp Web. It is the same
way the old software worked, on a small server the gym controls.

Time needed: about 1 hour. You need:

- the gym's phone with WhatsApp on +91 96664 46131 (to scan a QR code at the end);
- a Cloudflare account with the gym's domain in it;
- a server (step 1): **free on Oracle Cloud**, or a paid one (about ₹500–1,000 a month).

**Want to see it work first?** Run the gateway on your own computer for 15 minutes, from VS Code,
and send a test from the live app: [local/README.md](local/README.md).

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

## 1. Get the server

Whichever you choose: **in India** (WhatsApp sees where the linked device connects from; the
same country as the phone looks normal), **Ubuntu 24.04**, **2 GB RAM or more** (WhatsApp Web runs
in Chrome).

### Free: Oracle Cloud "Always Free"

Oracle gives one small server free, with no end date (since June 2026: up to 2 CPUs and 12 GB in
total). A debit or credit card is needed to sign up, for verification only.

1. Sign up at [oracle.com/cloud/free](https://www.oracle.com/cloud/free/). As **Home Region**
   choose **India West (Mumbai)** or **India South (Hyderabad)**. It can't be changed later, and
   the free server can only be made there.
2. **Compute → Instances → Create instance**:
   - Image: **Canonical Ubuntu 24.04**.
   - Shape: **Ampere → VM.Standard.A1.Flex**, **1 OCPU, 4 GB memory** (marked "Always Free").
   - Networking: keep the new network and **Assign a public IPv4 address**.
   - SSH keys: **Generate a key pair for me → Save private key**. Keep that file safe: it is the
     only way into the server.
   - **Create.** Note the **Public IP address**. The user name is **`ubuntu`**.
3. "Out of capacity"? Free servers are popular. Try another availability domain, or try again a
   few hours later.
4. Oracle may stop a free server that stays almost idle for 7 days. To avoid that (and the
   capacity problem), upgrade the account to **Pay As You Go**. Always Free resources stay free,
   and only usage above them is charged. Set a small budget alert (**Billing → Budgets**) so
   you'd notice anything that isn't free.

You don't need to open any port in Oracle: the gateway goes out through the Cloudflare tunnel,
and Oracle's own firewall already lets only SSH in. `setup.sh` leaves that firewall as it is
(Oracle warns that UFW breaks its servers).

### Paid

Any VPS company is fine, e.g. Hostinger VPS (India), DigitalOcean (Bangalore) or AWS Lightsail
(Mumbai), about ₹500–1,000 a month. Note the **IP address** and the **root password** (or SSH key).
The user name is usually **`root`**.

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

On your computer, in the project folder (VS Code terminal, PowerShell or Terminal). `USER` is
`ubuntu` on Oracle, `root` on most others; leave out `-i KEYFILE` if you log in with a password:

```
scp -i KEYFILE -r deploy/openwa USER@SERVER_IP:~/openwa
```

On Windows, if it says the key file is "unprotected", run this once (in PowerShell), then again:

```
icacls KEYFILE /inheritance:r /grant:r "$($env:USERNAME):(R)"
```

## 4. Run the setup

```
ssh -i KEYFILE USER@SERVER_IP
sudo mkdir -p /opt/openwa && sudo cp -r ~/openwa/. /opt/openwa/
sudo bash /opt/openwa/setup.sh
```

It installs everything and asks two things:

- **the tunnel token** from step 2 (pasting the whole command also works; it stays hidden);
- **the hostname**, e.g. `wa.yourgym.in`.

At the end it prints three values: **Gateway address**, **Instance ID** and **Token**. The token is
shown only once. Don't send it on WhatsApp or email: paste it straight into the app (step 5). If it
is lost, run `sudo bash /opt/openwa/connect.sh` for a new one (the old one stops working).

In Cloudflare, the tunnel should now show **Healthy**.

## 5. Link the phone and test (bills still go through the Cloud API)

1. In the gym app: **Settings → WhatsApp**. Keep Send from on **WhatsApp Cloud API (Meta)**
   for now. The section **Gym's own WhatsApp number (linked phone)** says "Not in use yet".
2. Paste the Gateway address, Instance ID and Token there, **Save connection**.
3. **Start**, wait about 30 seconds, then **Show QR to link the phone**.
4. On the gym's phone: WhatsApp → **Linked devices** → **Link a device** → scan the QR.
   It shows **Connected +91 96664 46131**.
5. **Send test** to your own number. It should arrive in a few seconds, from the gym's number.

## 6. Switch over

1. Turn off WhatsApp sending in the old software, so members don't get two bills.
2. On the gym's phone: WhatsApp → **Linked devices**: remove the old software's device. Keep the
   one you linked today.
3. In the gym app: **Send from → The gym's own WhatsApp number → Save**. From now on bills and
   member app links go from the gym's number.

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

## Server commands (on the server, after `ssh -i KEYFILE USER@SERVER_IP`)

```
sudo -i                                  # the commands below need root
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
| The gateway refused the API key                                 | Run `sudo bash /opt/openwa/connect.sh` and paste the new token.                                                                                                                                               |
| No QR right now                                                 | Press Start, wait 30 seconds, Show QR again.                                                                                                                                                                  |
| Today's sending limit is reached                                | The day's safety limit (it resets at 5:30 AM India time). Use the backup (Cloud API) or share bills by hand until then. To raise it, change `DAILY_LIMIT` in `/opt/openwa/.env`, then `docker compose up -d`. |
| The phone asks to "Create a passkey" and linking never finishes | A WhatsApp check that OpenWA can't do yet (OpenWA issue #560). Use the backup (Cloud API), update the gateway later and try again.                                                                            |
