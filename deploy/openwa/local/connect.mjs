// Prints the three values for the gym app (Settings → WhatsApp → Gym's own WhatsApp number) for
// the gateway running on this computer: its temporary https address, the instance ID and a
// token that can only use that instance. Same steps as ../connect.sh on the server, in Node so
// it runs in VS Code on Windows, macOS or Linux:
//   node deploy/openwa/local/connect.mjs
import { spawnSync } from "node:child_process";

const API = process.env.OPENWA_API ?? "http://127.0.0.1:2785/api";
const CONTAINER = process.env.OPENWA_CONTAINER ?? "openwa-local";
const TUNNEL = process.env.TUNNEL_CONTAINER ?? "openwa-local-tunnel";
const NAME = process.env.SESSION_NAME ?? "gym-whatsapp";
const KEY_NAME = process.env.KEY_NAME ?? "rebuild-fitness-app";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function docker(...args) {
  const r = spawnSync("docker", args, { encoding: "utf8" });
  if (r.error) throw new Error("Docker isn't running or isn't installed. Start Docker Desktop.");
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
}
function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

// The admin key OpenWA made on its first start. It never leaves this computer.
const admin = (
  process.env.OPENWA_ADMIN_KEY ?? docker("exec", CONTAINER, "cat", "/app/data/.api-key")
).trim();
if (!admin.startsWith("owa_k1_"))
  fail(
    `Can't read OpenWA's admin key. Is it running? Run: docker compose up -d (in deploy/openwa/local)`,
  );

process.stdout.write("Waiting for OpenWA");
let up = false;
for (let i = 0; i < 90 && !up; i++) {
  up = await fetch(`${API}/health/ready`).then(
    (r) => r.ok,
    () => false,
  );
  if (!up) {
    process.stdout.write(".");
    await sleep(2000);
  }
}
console.log();
if (!up) fail(`OpenWA is not answering on ${API}. See: docker compose logs openwa`);

async function call(method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { "X-API-Key": admin, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) fail(`OpenWA said ${r.status} to ${method} ${path}: ${JSON.stringify(data)}`);
  return data;
}

let session = (await call("GET", "/sessions")).find((s) => s.name === NAME);
if (!session) {
  session = await call("POST", "/sessions", { name: NAME });
  console.log(`Made the WhatsApp instance "${NAME}".`);
}

// One app token at a time: the old ones stop working.
for (const k of await call("GET", "/auth/api-keys")) {
  if (k.name === KEY_NAME && k.isActive) {
    await call("POST", `/auth/api-keys/${k.id}/revoke`);
    console.log("Old app token switched off.");
  }
}
// "operator" + only this instance: it can send and link the phone, nothing else.
const { apiKey } = await call("POST", "/auth/api-keys", {
  name: KEY_NAME,
  role: "operator",
  allowedSessions: [session.id],
});

// The quick tunnel's address is in its log; it can take a few seconds to appear and to work.
process.stdout.write("Waiting for the temporary https address");
let address = "";
for (let i = 0; i < 30 && !address; i++) {
  address = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(docker("logs", TUNNEL))?.[0] ?? "";
  if (!address) {
    process.stdout.write(".");
    await sleep(2000);
  }
}
let reachable = false;
for (let i = 0; address && i < 20 && !reachable; i++) {
  reachable = await fetch(`${address}/api/health/ready`).then(
    (r) => r.ok,
    () => false,
  );
  if (!reachable) {
    process.stdout.write(".");
    await sleep(3000);
  }
}
console.log();

console.log(`
────────────────────────────────────────────────────────────
 Put these in the gym app: Settings → WhatsApp →
 "Gym's own WhatsApp number (linked phone)" → Save connection

   Gateway address : ${address || "(no tunnel address yet: run this again in a minute)"}
   Instance ID     : ${session.id}
   Token (API key) : ${apiKey}
${address && !reachable ? "\n   (The address isn't answering yet. Wait a minute before Save connection.)\n" : ""}
 Only for this test: the address changes every time the tunnel
 restarts. Don't share the token; run this again for a new one.
────────────────────────────────────────────────────────────`);
