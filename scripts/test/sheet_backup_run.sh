#!/usr/bin/env bash
# Runs the Google Sheet backup test against LOCAL stand-ins only: Firestore + Auth emulators, a fake
# Sheets/token server, and the built app server. Nothing reaches production or the real sheet.
#
#   VITE_FIREBASE_PROJECT_ID=leadsmanage-1f7cd VITE_USE_EMULATORS=1 VITE_EMU_AUTH_PORT=9699 VITE_EMU_FIRESTORE_PORT=8680 npm run build   # once, and again after changing src
#   bash scripts/test/sheet_backup_run.sh
# (the browser test needs the emulator build above; a plain `npm run build` is enough for the server test alone)
# Screenshots from the browser test go to $SHEET_SHOTS (default: $OUT/shots).
# SHEET_SKIP_BROWSER=1 runs only the server checks; SHEET_SKIP_SERVER=1 only the browser checks.
#
# Needs: Java for the emulators (JAVA_HOME, or the portable JRE path below), Python 3, Node 22.
# Ports (not the other kit's): firestore 8680, auth 9699, hub 4451, logging 4551, ws 9570, app 5999, fake sheets 5799.
set -u
cd "$(dirname "$0")/../.."
REPO="$(pwd)"
OUT="${SHEET_TEST_OUT:-${TMPDIR:-/tmp}/sheet-backup-test}"
mkdir -p "$OUT"
DEFAULT_JRE="/c/Users/chala/AppData/Local/Temp/claude/c--Users-chala-OneDrive-Desktop-gym-saas/8b942f95-a77a-4d9a-8252-65d8d9b15612/scratchpad/jre/jdk-21.0.12.1+1-jre"
export JAVA_HOME="${JAVA_HOME:-$DEFAULT_JRE}"
export PATH="$JAVA_HOME/bin:$PATH"

kill_ports() {
  powershell -NoProfile -Command 'foreach ($port in 8680, 9699, 4451, 4551, 9570, 5999, 5799) { Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)"; if ($p -and ($p.CommandLine -match "cloud-firestore-emulator|firebase-tools|firebase.js|emulators:start|fake-sheets|index.mjs")) { Stop-Process -Id $p.ProcessId -Force -Confirm:$false -ErrorAction SilentlyContinue } } }' >/dev/null 2>&1
}
kill_ports
sleep 2
trap kill_ports EXIT

[ -f .output/server/index.mjs ] || { echo "Build first: npm run build"; exit 2; }

# Emulator config with an absolute rules path.
CONFIG="$OUT/firebase.json"
# The emulator is a Windows program: give it a Windows-style path (C:/...), not the Git Bash one (/c/...).
RULES_DIR="$(pwd -W 2>/dev/null || pwd)"
sed "s#\"rules\": \"firestore.rules\"#\"rules\": \"$RULES_DIR/firestore.rules\"#" scripts/test/firebase.sheet-test.json > "$CONFIG"
nohup npx firebase emulators:start --only firestore,auth --project leadsmanage-1f7cd --config "$CONFIG" > "$OUT/emu.log" 2>&1 &
for i in $(seq 1 120); do grep -q "All emulators ready" "$OUT/emu.log" && break; sleep 2; done
grep -q "All emulators ready" "$OUT/emu.log" || { echo "emulators did not start, see $OUT/emu.log"; exit 3; }

nohup node scripts/test/fake-sheets.mjs 5799 > "$OUT/fake-sheets.log" 2>&1 &

# A throwaway service account (made now, never saved): the app signs its Google token with it, the fake only checks the shape.
export FIREBASE_SERVICE_ACCOUNT="$(node -e '
const { generateKeyPairSync } = require("node:crypto");
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
process.stdout.write(JSON.stringify({ project_id: "leadsmanage-1f7cd", client_email: "backup-test@leadsmanage-1f7cd.iam.gserviceaccount.com", private_key: privateKey }));
')"
export PORT=5999 HOST=127.0.0.1 FIRESTORE_EMULATOR_HOST=127.0.0.1:8680 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9699 \
  CRON_SECRET=localtest VITE_FIREBASE_PROJECT_ID=leadsmanage-1f7cd \
  SHEETS_API_BASE=http://127.0.0.1:5799 GOOGLE_TOKEN_URL=http://127.0.0.1:5799/token \
  GEMINI_API_KEY= CFO_AI_PROVIDER=off LOGIN_VAULT_KEY=local-test-only-key
unset FIREBASE_PRIVATE_KEY WHATSAPP_ACCESS_TOKEN WHATSAPP_PHONE_NUMBER_ID
nohup node .output/server/index.mjs > "$OUT/server.log" 2>&1 &
for i in $(seq 1 30); do curl -s "http://127.0.0.1:5999/api/version" | grep -q build && break; sleep 1; done

export SERVER_LOG="$OUT/server.log" FAKE_SHEETS=http://127.0.0.1:5799
code=0
if [ "${SHEET_SKIP_SERVER:-0}" != "1" ]; then
  python scripts/test/sheet_backup_local.py
  code=$?
fi
if [ "${SHEET_SKIP_BROWSER:-0}" != "1" ]; then
  SHEET_SHOTS="${SHEET_SHOTS:-$OUT/shots}" python scripts/test/sheet_backup_browser.py || code=1
fi
if [ "${SHEET_SKIP_RESTORE:-0}" != "1" ] && [ "${SHEET_SKIP_SERVER:-0}" != "1" ]; then
  python scripts/test/sheet_restore_local.py || code=1
fi
echo "(logs: $OUT)"
exit $code
