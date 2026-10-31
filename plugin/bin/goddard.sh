#!/bin/bash
# Starts or stops Goddard OS from the plugin folder: the door (door/) and the app (app/).
# State (profile, passkeys, boards) lives in ~/.claude/channels/gm-chat, outside the plugin, so updates keep it.
# Ports: 5173 for the app and 8787 for the door, unless GODDARD_APP_PORT / GM_DOOR_PORT say otherwise.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$HOME/Library/Logs/goddard-os.log"
STATE="${GM_CHAT_STATE:-$HOME/.claude/channels/gm-chat}"
APP_PORT="${GODDARD_APP_PORT:-5173}"
DOOR_PORT="${GM_DOOR_PORT:-8787}"
export GODDARD_APP_PORT="$APP_PORT" GM_DOOR_PORT="$DOOR_PORT"
mkdir -p "$(dirname "$LOG")"
# Goddard OS is the thing answering on the app port (not some other app that has the port)
is_app() { curl -s -m 2 "http://127.0.0.1:$APP_PORT/auth/state" | grep -q passwordSignIn; }
listening() { lsof -ti "tcp:$1" -sTCP:LISTEN 2>/dev/null; }

case "${1:-start}" in
  start)
    [ "$(uname)" = "Darwin" ] || { echo "✕ Goddard OS runs on a Mac for now."; exit 1; }
    command -v claude >/dev/null || { echo "✕ Claude Code isn't on the PATH."; exit 1; }
    command -v bun >/dev/null || { echo "✕ Bun is missing. Install it: curl -fsSL https://bun.sh/install | bash"; exit 1; }
    command -v node >/dev/null || { echo "✕ Node is missing (the app is built with it). Install it from nodejs.org."; exit 1; }
    if ! is_app && [ -n "$(listening "$APP_PORT")" ]; then
      echo "✕ Another app is using port $APP_PORT (often another project's dev server). Close it, then run /goddard-os:start again."; exit 1
    fi
    if [ ! -d "$ROOT/door/node_modules" ]; then echo "Installing the door…"; (cd "$ROOT/door" && bun install --no-summary >>"$LOG" 2>&1) || { echo "✕ Couldn't install the door. See $LOG"; exit 1; }; fi
    if [ ! -d "$ROOT/app/node_modules" ]; then echo "Installing the app…"; (cd "$ROOT/app" && bun install --no-summary >>"$LOG" 2>&1) || { echo "✕ Couldn't install the app. See $LOG"; exit 1; }; fi
    GM_CHAT_DIR="$ROOT/door" bun "$ROOT/app/scripts/boot.ts" --no-slots >>"$LOG" 2>&1 || { echo "✕ $(tail -1 "$LOG" | sed 's/^\[[^]]*\] //')"; exit 1; }
    for _ in $(seq 1 90); do is_app && break; sleep 1; done
    if is_app; then
      echo "✓ Goddard OS is running: http://localhost:$APP_PORT"
      # signs this Mac's browser in on the way (the password goes straight to the browser, never to this output)
      if [ -z "${GODDARD_NO_OPEN:-}" ]; then
        if [ -f "$STATE/password" ]; then open "http://localhost:$APP_PORT/welcome?p=$(cat "$STATE/password")" 2>/dev/null; else open "http://localhost:$APP_PORT" 2>/dev/null; fi
      fi
      [ -f "$STATE/profile.json" ] || echo "First run: Setup is open in your browser."
    else
      echo "✕ The app didn't start. See $LOG"; exit 1
    fi ;;
  stop)
    # only what listens on Goddard OS's own two ports
    for p in $(listening "$APP_PORT") $(listening "$DOOR_PORT"); do kill "$p" 2>/dev/null; done
    echo "✓ Goddard OS is stopped. Your helpers' sessions are untouched." ;;
  *) echo "usage: goddard.sh start|stop"; exit 2 ;;
esac
