#!/bin/sh
# Carl runs this once at the Mac so Goddard OS comes back by itself after a restart or login.
# Undo: launchctl bootout gui/$(id -u)/xyz.gmcarl.goddard-os && rm ~/Library/LaunchAgents/xyz.gmcarl.goddard-os.plist
set -e
cp "$(dirname "$0")/xyz.gmcarl.goddard-os.plist" "$HOME/Library/LaunchAgents/"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/xyz.gmcarl.goddard-os.plist" 2>/dev/null || true
echo "Goddard OS will now start on its own when you log in."
