#!/bin/bash
# Starts or stops Goddard OS from the plugin folder: the door (door/) and the app (app/).
# State (profile, passkeys, boards) lives in ~/.claude/channels/gm-chat, outside the plugin, so updates keep it.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$HOME/Library/Logs/goddard-os.log"
mkdir -p "$(dirname "$LOG")"
up() { curl -s -o /dev/null -m 2 "$1"; }

case "${1:-start}" in
  start)
    [ "$(uname)" = "Darwin" ] || { echo "✕ Goddard OS runs on a Mac for now."; exit 1; }
    command -v claude >/dev/null || { echo "✕ Claude Code isn't on the PATH."; exit 1; }
    command -v bun >/dev/null || { echo "✕ Bun is missing. Install it: curl -fsSL https://bun.sh/install | bash"; exit 1; }
    command -v node >/dev/null || { echo "✕ Node is missing (the app is built with it). Install it from nodejs.org."; exit 1; }
    if [ ! -d "$ROOT/door/node_modules" ]; then echo "Installing the door…"; (cd "$ROOT/door" && bun install --no-summary >>"$LOG" 2>&1) || { echo "✕ Couldn't install the door. See $LOG"; exit 1; }; fi
    if [ ! -d "$ROOT/app/node_modules" ]; then echo "Installing the app…"; (cd "$ROOT/app" && bun install --no-summary >>"$LOG" 2>&1) || { echo "✕ Couldn't install the app. See $LOG"; exit 1; }; fi
    GM_CHAT_DIR="$ROOT/door" bun "$ROOT/app/scripts/boot.ts" --no-slots >>"$LOG" 2>&1
    for _ in $(seq 1 60); do up http://127.0.0.1:5173/ && break; sleep 1; done
    if up http://127.0.0.1:5173/; then
      echo "✓ Goddard OS is running: http://localhost:5173"
      # signs this Mac's browser in on the way (the password goes straight to the browser, never to this output)
      PW_FILE="$HOME/.claude/channels/gm-chat/password"
      if [ -f "$PW_FILE" ]; then open "http://localhost:5173/welcome?p=$(cat "$PW_FILE")" 2>/dev/null; else open http://localhost:5173 2>/dev/null; fi
      [ -f "$HOME/.claude/channels/gm-chat/profile.json" ] || echo "First run: Setup is open in your browser."
    else
      echo "✕ The app didn't start. See $LOG"; exit 1
    fi ;;
  stop)
    pkill -f "$ROOT/door/door.ts" ; pkill -f "bun door.ts" ; pkill -f "vite preview --host --port 5173"
    echo "✓ Goddard OS is stopped. Your helpers' sessions are untouched." ;;
  *) echo "usage: goddard.sh start|stop"; exit 2 ;;
esac
