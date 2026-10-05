# Try it on your computer first (VS Code, about 15 minutes)

> **For everyday use on the gym PC**, don't use this folder: in the app, open **Settings →
> WhatsApp → Run it on the gym PC** and download the one setup file. It starts with the PC and
> keeps the app's address up to date by itself. This folder is a short developer test.

Before setting up the server, run the WhatsApp gateway on your own computer, link a phone, and
send a test from the **live app**. Live bills keep going through the WhatsApp Cloud API the whole
time: only **Send test** uses the linked phone.

**Link your own phone for this test, not the client's.** Then the client's number is linked only
once, on the real server (linking is when WhatsApp checks most). You also need a second phone
number to receive the test message.

## You need

- **Docker Desktop** (free): [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/).
  Install it, start it and wait until it shows **Engine running**. On Windows it may ask to
  install WSL 2: say yes and restart.
- This project open in **VS Code**, with Node.js (already needed for the app).

## Steps

In VS Code: **Terminal → New Terminal**, then:

```
cd deploy/openwa/local
docker compose up -d
node connect.mjs
```

The first `docker compose up -d` downloads about 1 GB, which takes a few minutes. `node connect.mjs`
prints three values: **Gateway address** (`https://….trycloudflare.com`), **Instance ID** and
**Token**.

Then, in the live app:

1. **Settings → WhatsApp.** Keep Send from on **WhatsApp Cloud API (Meta)**.
2. In **Gym's own WhatsApp number (linked phone)** (it says "Not in use yet"): paste the three
   values and press **Save connection**.
3. **Start**, wait about 30 seconds, then **Show QR to link the phone**.
4. On your phone: WhatsApp → **Linked devices** → **Link a device** → scan the QR. The app shows
   **Connected** with your number.
5. Type the second number next to **Send test** and press it. The message should arrive in a few
   seconds, from your number. The ticks appear in the app's WhatsApp messages.

That proves the whole path: the live app reaches the gateway, the gateway sends through WhatsApp,
and the delivery ticks come back.

## When you're done

1. On your phone: WhatsApp → **Linked devices** → remove the device you just linked.
2. In the terminal:

```
docker compose down -v
```

This stops the gateway and deletes everything of this test (`-v`). The app keeps the saved
address and token; they are replaced when you connect the real server.

## If something goes wrong

| What you see                                                    | Do this                                                                                                                                                             |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker` is not recognized                                      | Start Docker Desktop, then close and reopen VS Code.                                                                                                                |
| Can't read OpenWA's admin key                                   | Wait 30 seconds after `docker compose up -d` and run `node connect.mjs` again. Check `docker compose ps` (both "running") and `docker compose logs openwa`.         |
| No tunnel address / address not answering                       | Wait a minute and run `node connect.mjs` again. See `docker compose logs tunnel`. Some office networks block Cloudflare tunnels: try home Wi-Fi or a phone hotspot. |
| Can't reach the WhatsApp gateway (in the app)                   | The address changes whenever the tunnel restarts: run `node connect.mjs` again and paste the new address.                                                           |
| Start: couldn't open WhatsApp Web in time                       | Press Start again (the first start is slow).                                                                                                                        |
| The phone asks to "Create a passkey" and linking never finishes | A WhatsApp check that OpenWA can't do yet (OpenWA issue #560). That phone can't be linked for now.                                                                  |

## Also possible: the app on your computer

If you run the app itself with `npm run dev`, you can use `http://localhost:2785` as the gateway
address (no tunnel needed), but delivery ticks won't show. That copy of the app uses the **same
database** as the live app, so keep Send from on the Cloud API there too.
