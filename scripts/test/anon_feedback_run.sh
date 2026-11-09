#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/../.."; REPO="$(pwd)"
# Build first (emulator build): VITE_FIREBASE_PROJECT_ID=leadsmanage-1f7cd VITE_USE_EMULATORS=1 VITE_EMU_AUTH_PORT=9699 VITE_EMU_FIRESTORE_PORT=8680 npm run build
OUT="${ANON_TEST_OUT:-${TMPDIR:-/tmp}/anon-feedback-test}"; mkdir -p "$OUT"
export JAVA_HOME="${JAVA_HOME:-/c/Users/chala/AppData/Local/Temp/claude/c--Users-chala-OneDrive-Desktop-gym-saas/8b942f95-a77a-4d9a-8252-65d8d9b15612/scratchpad/jre/jdk-21.0.12.1+1-jre}"
export PATH="$JAVA_HOME/bin:$PATH"
kill_ports() {
  powershell -NoProfile -Command 'foreach ($port in 8680, 9699, 4451, 4551, 9570, 5999) { Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)"; if ($p -and ($p.CommandLine -match "cloud-firestore-emulator|firebase-tools|firebase.js|emulators:start|index.mjs")) { Stop-Process -Id $p.ProcessId -Force -Confirm:$false -ErrorAction SilentlyContinue } } }' >/dev/null 2>&1
}
kill_ports; sleep 2; trap kill_ports EXIT
RULES_DIR="$(pwd -W 2>/dev/null || pwd)"
sed "s#\"rules\": \"firestore.rules\"#\"rules\": \"$RULES_DIR/firestore.rules\"#" scripts/test/firebase.sheet-test.json > "$OUT/firebase.json"
nohup npx firebase emulators:start --only firestore,auth --project leadsmanage-1f7cd --config "$OUT/firebase.json" > "$OUT/emu.log" 2>&1 &
for i in $(seq 1 120); do grep -q "All emulators ready" "$OUT/emu.log" && break; sleep 2; done
grep -q "All emulators ready" "$OUT/emu.log" || { echo "emulators did not start"; tail -20 "$OUT/emu.log"; exit 3; }
export FIREBASE_SERVICE_ACCOUNT="$(node -e '
const { generateKeyPairSync } = require("node:crypto");
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
process.stdout.write(JSON.stringify({ project_id: "leadsmanage-1f7cd", client_email: "t@leadsmanage-1f7cd.iam.gserviceaccount.com", private_key: privateKey }));
')"
export PORT=5999 HOST=127.0.0.1 FIRESTORE_EMULATOR_HOST=127.0.0.1:8680 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9699 \
  CRON_SECRET=localtest VITE_FIREBASE_PROJECT_ID=leadsmanage-1f7cd GEMINI_API_KEY= CFO_AI_PROVIDER=off LOGIN_VAULT_KEY=local-test-only-key
unset FIREBASE_PRIVATE_KEY WHATSAPP_ACCESS_TOKEN WHATSAPP_PHONE_NUMBER_ID
nohup node .output/server/index.mjs > "$OUT/server.log" 2>&1 &
for i in $(seq 1 30); do curl -s "http://127.0.0.1:5999/api/version" | grep -q build && break; sleep 1; done
export EMU_OWNER_PASSWORD="$(node -e 'console.log(require("crypto").randomBytes(12).toString("base64url"))')"
export REPO SHOTS="$OUT/shots"
python scripts/test/anon_feedback_e2e.py; code=$?
echo "--- server log tail"; tail -5 "$OUT/server.log"
exit $code
