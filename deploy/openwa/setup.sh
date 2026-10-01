#!/usr/bin/env bash
# One-time setup of the gym's WhatsApp gateway on a fresh Ubuntu 22.04 / 24.04 server:
#   sudo bash /opt/openwa/setup.sh
# Safe to run again (it keeps .env and the linked phone). See README.md in this folder.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo bash $DIR/setup.sh" >&2
  exit 1
fi

# Oracle Cloud's Ubuntu images come with their own firewall rules (only SSH in) that the server
# needs to boot; Oracle warns that UFW breaks them. There, those rules are kept as they are.
on_oracle() {
  grep -qi oraclecloud /sys/class/dmi/id/chassis_asset_tag 2>/dev/null ||
    grep -q InstanceServices <<<"$(iptables -S 2>/dev/null || true)"
}

echo "== 1/5 System updates and tools"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl python3 fail2ban unattended-upgrades
# Security updates install by themselves every day.
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
systemctl enable --now fail2ban >/dev/null 2>&1 || true

echo "== 2/5 Firewall: only SSH comes in (the gateway is reached through Cloudflare)"
if on_oracle; then
  echo "Oracle Cloud: its own firewall already lets only SSH in (UFW is not used there)."
else
  apt-get install -y -q ufw
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  ufw allow OpenSSH >/dev/null
  ufw --force enable >/dev/null
  ufw status | head -5
fi

echo "== 3/5 Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null

# Chrome needs memory: add 2 GB of swap on small servers that have none.
if [ "$(free -m | awk '/^Mem:/{print $2}')" -lt 3000 ] && [ -z "$(swapon --show)" ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  echo "Added 2 GB swap."
fi

echo "== 4/5 Settings (.env)"
[ -f .env ] || cp .env.example .env
chmod 600 .env
setting() { grep -E "^$1=" .env | cut -d= -f2- || true; }
put() { # name value
  if grep -qE "^$1=" .env; then
    python3 - "$1" "$2" <<'PY'
import sys
name, value = sys.argv[1], sys.argv[2]
lines = open(".env").read().splitlines()
open(".env", "w").write("\n".join(f"{name}={value}" if l.startswith(name + "=") else l for l in lines) + "\n")
PY
  else
    echo "$1=$2" >>.env
  fi
}
if [ -z "$(setting CLOUDFLARE_TUNNEL_TOKEN)" ]; then
  read -r -s -p "Paste the Cloudflare tunnel token (it stays hidden), then Enter: " TOKEN
  echo
  TOKEN="${TOKEN##* }" # the whole "cloudflared … --token xyz" line works too
  [ -n "$TOKEN" ] || { echo "No token given." >&2; exit 1; }
  put CLOUDFLARE_TUNNEL_TOKEN "$TOKEN"
fi
if [ -z "$(setting PUBLIC_HOSTNAME)" ]; then
  read -r -p "The tunnel's public hostname (e.g. wa.yourgym.in): " HOST
  HOST="${HOST#https://}"
  put PUBLIC_HOSTNAME "${HOST%/}"
fi

echo "== 5/5 Start the gateway"
docker compose pull -q
docker compose up -d
bash "$DIR/connect.sh"
