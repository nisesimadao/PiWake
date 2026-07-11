#!/usr/bin/env bash
# PiWake installer — run on the Raspberry Pi from the repo root:
#   bash deploy/install.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="piwake"
RUN_USER="${SUDO_USER:-$USER}"
ENV_FILE="/etc/default/piwake"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18+ is required. Install it first (e.g. via https://deb.nodesource.com)." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node.js 18+ is required (found $(node -v))." >&2
  exit 1
fi

echo "==> Installing dependencies and building the web console"
cd "$REPO_DIR"
npm ci
npm run build

echo "==> Writing $ENV_FILE (kept if it already exists)"
if [ ! -f "$ENV_FILE" ]; then
  sudo tee "$ENV_FILE" >/dev/null <<EOF
# PiWake configuration
PIWAKE_PORT=8787
# Optional bearer token (recommended). Generate one with: openssl rand -hex 16
# Leave empty to rely on Tailscale ACLs only.
PIWAKE_TOKEN=
# Broadcast address for magic packets, e.g. 192.168.1.255
PIWAKE_BROADCAST=255.255.255.255
# Seconds to wait for a device to come up after a magic packet
PIWAKE_WAKE_TIMEOUT=90
EOF
fi

echo "==> Installing systemd service ($SERVICE_NAME, user $RUN_USER)"
sudo tee "/etc/systemd/system/${SERVICE_NAME}.service" >/dev/null <<EOF
[Unit]
Description=PiWake API and web console
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${REPO_DIR}
EnvironmentFile=-${ENV_FILE}
Environment=PIWAKE_DATA_DIR=/var/lib/piwake
StateDirectory=piwake
ExecStart=$(command -v node) ${REPO_DIR}/server/index.js
Restart=on-failure
RestartSec=3
ProtectSystem=full

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

echo
echo "PiWake is running."
echo "  Local:      http://$(hostname).local:8787"
if command -v tailscale >/dev/null 2>&1; then
  TS_IP="$(tailscale ip -4 2>/dev/null | head -n1 || true)"
  [ -n "$TS_IP" ] && echo "  Tailscale:  http://${TS_IP}:8787"
fi
echo "  Logs:       journalctl -u ${SERVICE_NAME} -f"
echo "  Config:     ${ENV_FILE}"
