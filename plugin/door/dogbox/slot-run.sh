#!/bin/bash
# One session's own screen on dog-box: display :1N, its own browser (CDP 923N), VNC 591N, websockify 608N.
# Run by gm-slot@N.service as user dog; everything stops together when the unit stops.
set -u
N="$1"; [[ "$N" =~ ^[1-3]$ ]] || { echo "slot is 1 to 3"; exit 2; }
D=":1$N"; S="$HOME/slots/s$N"
mkdir -p "$S/work"
trap 'kill $(jobs -p) 2>/dev/null; wait' EXIT TERM INT
Xvfb "$D" -screen 0 720x1560x24 -nolisten tcp & sleep 1
DISPLAY="$D" fluxbox >/dev/null 2>&1 &
DISPLAY="$D" chromium --user-data-dir="$S/browser" --remote-debugging-port=923$N --remote-debugging-address=127.0.0.1 \
  --no-first-run --no-default-browser-check --password-store=basic --start-maximized --window-size=720,1560 \
  file:///home/dog/web/idle.html >/dev/null 2>&1 &
x11vnc -display "$D" -localhost -rfbauth "$HOME/.vnc/passwd" -forever -shared -rfbport 591$N -quiet >/dev/null 2>&1 &
websockify --web /usr/share/novnc 608$N localhost:591$N >/dev/null 2>&1 &
wait -n
