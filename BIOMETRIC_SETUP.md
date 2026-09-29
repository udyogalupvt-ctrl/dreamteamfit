# Fingerprint device setup (eSSL / ZKTeco)

Members become active only when the fingerprint device itself reports that their thumb was
enrolled. Nothing in the web app can mark a thumb as registered on its own.

## How it works

eSSL and ZKTeco devices with **ADMS / Cloud Server** support (most models from the last few
years, e.g. eSSL X990, K30 Pro, MB20, ZKTeco K40, SpeedFace with fingerprint) talk directly to
the Firebase function `iclock`:

| Device call | What the app does |
| --- | --- |
| `GET /iclock/cdata?options=all` | Answers with push settings (poll every 10 s, upload punches and fingerprint events). |
| `GET /iclock/getrequest` | Hands over queued commands: create user, then `ENROLL_FP` for the right thumb. |
| `POST /iclock/devicecmd` | Records each command's result; failures are shown to staff with "Try again". |
| `POST /iclock/cdata?table=OPERLOG` / `BIODATA` | A new fingerprint for the member's ID = proof → member activated. |
| `POST /iclock/cdata?table=ATTLOG` | Punches become attendance, with allowed / blocked decided from the membership. |

An uploaded fingerprint template is proof that enrollment happened. It is also kept in
`biometricTemplates`, a server-only collection that no browser can read (Firestore rules deny it),
so the door lock can put a renewed member back on the device without a new scan. A stored
template only counts as proof while staff are actively registering that member, so a device's
first upload of existing users can't activate anyone by ID coincidence. Deleting a member erases
their stored template and removes them from the device.

## Door lock

- Plan ends, is cancelled, or staff press **Block entry** → the member is removed from the
  device (`DATA DELETE USERINFO`), so the door does not open for them.
- Renewal, new PT package, or **Allow entry** → the user and saved thumb are pushed back.
- Runs on the device's next poll after every change (about 15 seconds), and on the first poll
  after midnight for everyone (plans end without any edit).
- If no saved thumb exists, the member is flagged **Register thumb** instead of getting in.

## One-time setup

1. The app must be live on Vercel with `FIREBASE_SERVICE_ACCOUNT` set (see README).
2. In the app: **Fingerprint Devices → Add device**, choose **Cloud (ADMS)** and enter the
   device serial number (device menu → System info → Device info).
3. On the device: **Menu → Comm. → Cloud Server Setting** (may be called ADMS or Webserver):
   - Server address: the app's domain, e.g. `dreamteamfit.vercel.app` (shown on the page)
   - Port: `443`, HTTPS / SSL: **on**, Proxy: off
4. Restart the device. Within a minute it shows **Online** on the Fingerprint Devices page.

### Devices without HTTPS

Vercel only answers HTTPS (a plain `http://` request gets a redirect the machine can't follow).
A machine whose Cloud Server Setting has no HTTPS / SSL switch needs a relay in between:

- **Cloudflare Worker (recommended, free, no PC):** paste `tools/cloudflare-relay.js` into a new
  Worker. On the machine: Enable Domain Name **ON**, Server Address = the worker's address
  (`<name>.<account>.workers.dev`), Server Port **80**, Proxy off.
- **A PC in the gym (must stay on):** `node tools/adms-relay.mjs https://dreamteamfit.vercel.app/iclock 8081`,
  then Server Address = that PC's LAN IP (give it a fixed IP in the router), port `8081`.

Test the relay before touching the machine: `http://<relay>/iclock/cdata?SN=TEST&options=all`
must answer `OK` (unknown serial numbers get `OK`; the real one gets the settings list).

## Registering a thumb (front desk)

After payment in the joining screen (or **Resume setup** / **Register thumb** on the member's
profile): choose the device, keep the suggested member ID and press **Register thumb on
device**. Within ~10 seconds the device asks for the thumb; the member presses 3 times. The
screen turns green by itself when the device confirms.

Enrolling directly on the device menu also works: create the user with the same member ID
shown in the app and enroll a finger; the device reports it and the member is activated.

## Limits to know

- Member IDs are numbers and must not already belong to someone else on the device.
- Punches older than 7 days are ignored on first connection (no bulk history import).
- Keep the device serial number private; it is how the cloud recognises the device.

## Staff on the same device

*Staff → Thumb* registers a staff member's thumb (device IDs start at 9001, so they never clash
with member IDs). Their punches become staff attendance (*Attendance → Staff*), not member
visits, and always open the door while they are active. *Mark as left* removes them from the
device.

## ZKTeco MB360

The gym's MB360 (face + fingerprint) has *Menu → Comm. → Cloud Server Setting* with Server Mode
ADMS, but no HTTPS switch: use a relay (above). Its old software used the same method (ADMS to a
server at a fixed IP, port 86), so remote thumb registration works the same way: the app sends
"create user + enroll", the machine asks for the thumb 3 times.

Only one cloud server can be set: pointing the machine at this app disconnects the old software
at that moment. The machine opens the door by itself for anyone registered on it, even while the
internet is down; punches wait on the machine and upload when it is back.

After a thumb is registered (and after a renewed member is put back) the app also sends the
member's photo (`DATA UPDATE USERPIC`, a 240x320 JPEG made by Cloudinary), so the machine shows
ID, name and photo after each punch, as it did before.
