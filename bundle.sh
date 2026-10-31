#!/bin/bash
# Copies the app and the door into the plugin from their repos (tracked files only, no personal state).
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="${APP:-$HOME/goddard-os}"; DOOR="${DOOR:-$HOME/gm-chat-test/tools/gm-chat}"
rm -rf "$HERE/plugin/app" "$HERE/plugin/door"; mkdir -p "$HERE/plugin/app" "$HERE/plugin/door"
(cd "$APP" && git ls-files | grep -vE '^(design/|scripts/town-depth/|launchd/|PORTING.md)' | rsync -a --files-from=- . "$HERE/plugin/app/")
(cd "$DOOR" && git ls-files . | grep -vE '^(\.claude/|\.mcp\.json)' | rsync -a --files-from=- . "$HERE/plugin/door/")
echo "app: $(cd "$HERE/plugin/app" && find . -type f | wc -l) files · door: $(cd "$HERE/plugin/door" && find . -type f | wc -l) files"
