// Rebuild Fitness: keeps the gym app connected to WhatsApp running on this PC.
//
// Runs next to OpenWA (the WhatsApp gateway) and a Cloudflare quick tunnel (docker-compose.yml in
// this folder). Every 20 seconds it:
//   1. reads the tunnel's https address (a new one each time the PC or the tunnel restarts),
//   2. tells the app that address, with this PC's own token for the WhatsApp instance, whenever it
//      changed (and every 10 minutes, so the app can show "Gym PC: online"),
//   3. starts WhatsApp again if it stopped after having been linked.
// Nothing to type: the setup key in .env is what lets this PC (and only this PC) update the app.
// OpenWA's admin key never leaves this PC.
import { readFile, writeFile, mkdir } from "node:fs/promises";

const env = (k, d = "") => (process.env[k] ?? d).trim();
const APP = env("APP_URL").replace(/\/+$/, "");
const LINK_KEY = env("LINK_KEY");
const API = env("OPENWA_API", "http://openwa:2785/api");
const METRICS = env("TUNNEL_METRICS", "http://tunnel:2000");
const KEY_FILE = env("OPENWA_KEY_FILE", "/owa/.api-key");
const STATE_FILE = env("STATE_FILE", "/state/link.json");
// A fixed address instead of the quick tunnel (e.g. your own named Cloudflare tunnel).
const PUBLIC_URL = env("PUBLIC_URL").replace(/\/+$/, "");
const SESSION_NAME = env("SESSION_NAME", "gym-whatsapp");
const KEY_NAME = "rebuild-fitness-gym-pc";
const EVERY_MS = Number(env("CHECK_EVERY_MS", "20000"));
const HEARTBEAT_MS = 10 * 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const time = () =>
  new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });
const log = (m) => console.log(`[${time()}] ${m}`);

async function http(url, { method = "GET", headers = {}, body, timeoutMs = 20_000 } = {}) {
  try {
    const r = await fetch(url, {
      method,
      headers: {
        ...headers,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const raw = await r.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { message: raw.slice(0, 200) };
    }
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { message: String(e?.message ?? e) } };
  }
}

let state = {};
async function loadState() {
  state = JSON.parse(await readFile(STATE_FILE, "utf8").catch(() => "{}"));
}
async function saveState() {
  await mkdir(STATE_FILE.replace(/\/[^/]+$/, ""), { recursive: true }).catch(() => undefined);
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2)).catch((e) =>
    log(`Couldn't save state: ${e.message}`),
  );
}

/** OpenWA's admin key: made by OpenWA on its first start, read from its data folder. */
async function adminKey() {
  for (;;) {
    const k = (await readFile(KEY_FILE, "utf8").catch(() => "")).trim();
    if (k.startsWith("owa_k1_")) return k;
    log("Waiting for WhatsApp gateway to finish its first start…");
    await sleep(10_000);
  }
}

async function waitForGateway() {
  for (let i = 0; ; i++) {
    if ((await http(`${API}/health/ready`, { timeoutMs: 5000 })).ok) return;
    if (i % 6 === 0) log("Waiting for WhatsApp gateway to start…");
    await sleep(5000);
  }
}

/** The WhatsApp instance for the gym's number, and a token that can use only that instance. */
async function instanceAndToken(admin) {
  const as = { "X-API-Key": admin };
  const list = await http(`${API}/sessions`, { headers: as });
  if (!list.ok) throw new Error(`gateway sessions: ${list.status}`);
  let session = (Array.isArray(list.data) ? list.data : []).find((s) => s.name === SESSION_NAME);
  if (!session) {
    const made = await http(`${API}/sessions`, {
      method: "POST",
      headers: as,
      body: { name: SESSION_NAME },
    });
    if (!made.ok) throw new Error(`gateway new session: ${made.status}`);
    session = made.data;
    log(`Made the WhatsApp instance "${SESSION_NAME}".`);
  }
  // The saved token still works for this instance: keep it (the app already has it).
  if (state.apiKey && state.sessionId === session.id) {
    const ok = await http(`${API}/sessions/${encodeURIComponent(session.id)}`, {
      headers: { "X-API-Key": state.apiKey },
    });
    if (ok.ok) return { sessionId: session.id, apiKey: state.apiKey };
  }
  // A new token for the app ("operator", this instance only); older ones are switched off.
  const keys = await http(`${API}/auth/api-keys`, { headers: as });
  for (const k of Array.isArray(keys.data) ? keys.data : [])
    if (k.name === KEY_NAME && k.isActive)
      await http(`${API}/auth/api-keys/${k.id}/revoke`, { method: "POST", headers: as });
  const made = await http(`${API}/auth/api-keys`, {
    method: "POST",
    headers: as,
    body: { name: KEY_NAME, role: "operator", allowedSessions: [session.id] },
  });
  if (!made.ok || !made.data.apiKey) throw new Error(`gateway new token: ${made.status}`);
  state = { ...state, sessionId: session.id, apiKey: made.data.apiKey, announcedUrl: "" };
  await saveState();
  log("Made a new token for the app.");
  return { sessionId: session.id, apiKey: made.data.apiKey };
}

/** This PC's https address right now (the quick tunnel's), once it answers; "" when not yet. */
async function publicAddress() {
  let url = PUBLIC_URL;
  if (!url) {
    const q = await http(`${METRICS}/quicktunnel`, { timeoutMs: 5000 });
    const host = String(q.data?.hostname ?? "").trim();
    if (!host) return "";
    url = `https://${host}`;
  }
  const up = await http(`${url}/api/health/ready`, { timeoutMs: 15_000 });
  return up.ok ? url : "";
}

let pausedUntil = 0;
async function announce(url, ids) {
  const r = await http(`${APP}/api/whatsapp/gateway-link`, {
    method: "POST",
    headers: { Authorization: `Bearer ${LINK_KEY}` },
    body: { url, sessionId: ids.sessionId, apiKey: ids.apiKey },
    timeoutMs: 45_000,
  });
  if (r.ok) {
    if (state.announcedUrl !== url)
      log(`Connected to the app: ${r.data.statusLabel ?? "ok"} (address ${url}).`);
    state = { ...state, announcedUrl: url, announcedAt: Date.now() };
    await saveState();
    return true;
  }
  if (r.status === 401) {
    log(
      "The app refused this PC's setup key (a new one was made in Settings). Download the setup again in the app: Settings → WhatsApp → Gym PC.",
    );
    pausedUntil = Date.now() + 10 * 60 * 1000;
  } else {
    log(
      `Couldn't reach the app (${r.status || "offline"}): ${r.data?.error ?? r.data?.message ?? ""}`,
    );
    // Try again in 2 minutes, not every 20 seconds (each try costs the app a little).
    pausedUntil = Date.now() + 2 * 60 * 1000;
  }
  return false;
}

let lastStart = 0;
/** WhatsApp stopped after having been linked (e.g. the internet dropped): start it again. */
async function keepStarted(ids) {
  const s = await http(`${API}/sessions/${encodeURIComponent(ids.sessionId)}`, {
    headers: { "X-API-Key": ids.apiKey },
  });
  if (!s.ok) return;
  const status = String(s.data.status ?? "");
  if (status === "ready" && !state.linked) {
    state = { ...state, linked: true };
    await saveState();
    log(`WhatsApp is linked${s.data.phone ? ` (+${s.data.phone})` : ""}.`);
  }
  if (
    state.linked &&
    ["created", "disconnected", "failed"].includes(status) &&
    Date.now() - lastStart > 3 * 60 * 1000
  ) {
    lastStart = Date.now();
    log(`WhatsApp was ${status}: starting it again.`);
    await http(`${API}/sessions/${encodeURIComponent(ids.sessionId)}/start`, {
      method: "POST",
      headers: { "X-API-Key": ids.apiKey },
      timeoutMs: 90_000,
    });
  }
}

async function main() {
  if (!APP || !LINK_KEY) {
    log("APP_URL or LINK_KEY is missing in .env: download the setup again from the app.");
    await sleep(60 * 60 * 1000);
    return;
  }
  await loadState();
  await waitForGateway();
  const admin = await adminKey();
  let ids = await instanceAndToken(admin);
  log("Ready. Keeping the app connected to WhatsApp on this PC.");
  let n = 0;
  let down = false;
  for (; ; n++) {
    try {
      if (Date.now() >= pausedUntil) {
        const url = await publicAddress();
        if (!url) {
          if (n % 3 === 0) log("Waiting for the internet address (tunnel)…");
          down = true;
        } else {
          if (down) log(`Internet address working again: ${url}`);
          down = false;
          if (url !== state.announcedUrl || Date.now() - (state.announcedAt ?? 0) > HEARTBEAT_MS)
            await announce(url, ids);
        }
      }
      if (n % 3 === 0) await keepStarted(ids);
    } catch (e) {
      log(`Check failed: ${e.message}`);
      // The gateway was reset (new data): make the instance and token again.
      ids = await instanceAndToken(admin).catch(() => ids);
    }
    await sleep(EVERY_MS);
  }
}

for (;;) {
  try {
    await main();
  } catch (e) {
    log(`Restarting after an error: ${e.message}`);
    await sleep(15_000);
  }
}
