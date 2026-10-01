#!/usr/bin/env bash
# Prints the three values for the gym app (Settings → WhatsApp → The gym's own WhatsApp number):
# gateway address, instance ID and token. Makes the WhatsApp instance once, and a NEW token each
# run that can only use that instance (older app tokens stop working). Run on the server:
#   bash /opt/openwa/connect.sh
set -euo pipefail

API="${OPENWA_API:-http://127.0.0.1:2785/api}"
NAME="${SESSION_NAME:-gym-whatsapp}"
KEY_NAME="${KEY_NAME:-rebuild-fitness-app}"
DIR="$(cd "$(dirname "$0")" && pwd)"

# The admin key OpenWA made on its first start. It never leaves this server.
ADMIN="${OPENWA_ADMIN_KEY:-$(docker exec openwa cat /app/data/.api-key 2>/dev/null || true)}"
if [ -z "$ADMIN" ]; then
  echo "Can't read OpenWA's admin key. Is it running? Try: docker compose -f $DIR/docker-compose.yml ps" >&2
  exit 1
fi

printf "Waiting for OpenWA"
for _ in $(seq 1 60); do
  if curl -fsS "$API/health/ready" >/dev/null 2>&1; then break; fi
  printf "."
  sleep 2
done
echo
curl -fsS "$API/health/ready" >/dev/null || { echo "OpenWA is not answering on $API" >&2; exit 1; }

call() { # method path [json body]
  curl -fsS -X "$1" "$API$2" -H "X-API-Key: $ADMIN" -H "Content-Type: application/json" \
    ${3:+-d "$3"}
}
json() { python3 -c "import json,sys; d=json.load(sys.stdin); $1"; }

SESSION_ID="$(call GET /sessions | json "print(next((s['id'] for s in d if s.get('name')=='$NAME'), ''))")"
if [ -z "$SESSION_ID" ]; then
  SESSION_ID="$(call POST /sessions "{\"name\":\"$NAME\"}" | json "print(d['id'])")"
  echo "Made the WhatsApp instance \"$NAME\"."
fi

# One app token at a time: the old ones stop working.
for OLD in $(call GET /auth/api-keys | json "print(' '.join(k['id'] for k in d if k.get('name')=='$KEY_NAME' and k.get('isActive')))"); do
  call POST "/auth/api-keys/$OLD/revoke" >/dev/null
  echo "Old app token switched off."
done

# "operator" + only this instance: it can send and link the phone, but can't make keys, see
# other instances or change OpenWA's settings.
TOKEN="$(call POST /auth/api-keys "{\"name\":\"$KEY_NAME\",\"role\":\"operator\",\"allowedSessions\":[\"$SESSION_ID\"]}" | json "print(d['apiKey'])")"

HOST=""
if [ -f "$DIR/.env" ]; then HOST="$(grep -E '^PUBLIC_HOSTNAME=' "$DIR/.env" | cut -d= -f2- || true)"; fi

cat <<EOF

────────────────────────────────────────────────────────────
 Put these in the gym app: Settings → WhatsApp → Send from →
 "The gym's own WhatsApp number" → Save connection

   Gateway address : https://${HOST:-<the hostname you set in the Cloudflare tunnel>}
   Instance ID     : $SESSION_ID
   Token (API key) : $TOKEN

 The token is shown only now. Don't share it or send it on chat;
 run this script again for a new one.
────────────────────────────────────────────────────────────
EOF
