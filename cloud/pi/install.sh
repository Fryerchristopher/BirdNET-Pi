#!/usr/bin/env bash
# Install the BirdNET-Pi Cloud agent on a Pi that already runs BirdNET-Pi.
#
#   bash ~/BirdNET-Pi/cloud/pi/install.sh https://birds.example.com <INGEST_TOKEN> [station_id]
#
# Creates /etc/birdnet/cloud_agent.conf and the birdnet_cloud_agent systemd
# service, then starts it. Re-running updates the config and restarts.
set -euo pipefail

CLOUD_URL="${1:-}"
TOKEN="${2:-}"
STATION="${3:-default}"
if [ -z "$CLOUD_URL" ] || [ -z "$TOKEN" ]; then
  echo "usage: $0 https://your-site.example.com INGEST_TOKEN [station_id]" >&2
  exit 1
fi

USER_NAME="${SUDO_USER:-$USER}"
HOME_DIR="$(getent passwd "$USER_NAME" | cut -d: -f6)"
AGENT_SRC="$(cd "$(dirname "$0")" && pwd)/cloud_agent.py"
AGENT_DST="$HOME_DIR/BirdNET-Pi/scripts/cloud_agent.py"

install -m 0755 -o "$USER_NAME" -g "$USER_NAME" "$AGENT_SRC" "$AGENT_DST"

sudo tee /etc/birdnet/cloud_agent.conf >/dev/null <<EOF
CLOUD_URL=$CLOUD_URL
INGEST_TOKEN=$TOKEN
STATION_ID=$STATION
PUSH_INTERVAL=10
HEARTBEAT_INTERVAL=60
UPLOAD_MEDIA=1
PURGE_SCAN_HOUR=4
EOF
sudo chmod 0640 /etc/birdnet/cloud_agent.conf
sudo chown root:"$USER_NAME" /etc/birdnet/cloud_agent.conf

sudo tee /etc/systemd/system/birdnet_cloud_agent.service >/dev/null <<EOF
[Unit]
Description=BirdNET-Pi Cloud agent (pushes detections and media to the cloud site)
After=network-online.target birdnet_analysis.service
Wants=network-online.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$HOME_DIR/BirdNET-Pi
ExecStart=/usr/bin/python3 $AGENT_DST
Restart=always
RestartSec=15
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now birdnet_cloud_agent.service
sudo systemctl restart birdnet_cloud_agent.service
echo "birdnet_cloud_agent installed. Follow it with:  journalctl -fu birdnet_cloud_agent"
