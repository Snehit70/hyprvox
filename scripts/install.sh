#!/bin/bash

# Voice CLI systemd installation script
# This script installs the voice-cli as a user-level systemd service.

set -e

SERVICE_NAME="voice-cli"
SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SERVICE_DIR/$SERVICE_NAME.service"
WORKING_DIR=$(pwd)
BUN_PATH=$(which bun || echo "$HOME/.bun/bin/bun")
ENTRY_POINT="$WORKING_DIR/index.ts"
USER_ID=$(id -u)

# Ensure systemd user directory exists
mkdir -p "$SERVICE_DIR"

echo "Installing systemd service for $SERVICE_NAME..."

# Check if bun is installed
if [ ! -x "$BUN_PATH" ]; then
    echo "Error: bun not found. Please install bun first."
    exit 1
fi

# Create service file from template or heredoc
cat <<EOF > "$SERVICE_FILE"
[Unit]
Description=Voice CLI Daemon
After=network.target sound.target

[Service]
Type=simple
WorkingDirectory=$WORKING_DIR
ExecStart=$BUN_PATH run $ENTRY_POINT start --no-supervisor
Restart=always
RestartSec=5
StartLimitIntervalSec=300
StartLimitBurst=3
Environment=PATH=$PATH
Environment=DISPLAY=$DISPLAY
Environment=XAUTHORITY=$XAUTHORITY
Environment=WAYLAND_DISPLAY=$WAYLAND_DISPLAY
Environment=XDG_RUNTIME_DIR=/run/user/$USER_ID

[Install]
WantedBy=default.target
EOF

# Reload systemd and enable service
echo "Reloading systemd daemon..."
systemctl --user daemon-reload

echo "Enabling $SERVICE_NAME service..."
systemctl --user enable "$SERVICE_NAME"

echo "Starting $SERVICE_NAME service..."
systemctl --user start "$SERVICE_NAME"

echo "------------------------------------------------"
echo "Installation complete!"
echo "Status: $(systemctl --user is-active $SERVICE_NAME)"
echo "Use 'systemctl --user status $SERVICE_NAME' to check details."
echo "Use 'journalctl --user -u $SERVICE_NAME -f' to see logs."
echo "------------------------------------------------"
