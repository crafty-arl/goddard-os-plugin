#!/bin/sh
# Claude Code hook: pass the event (on stdin) to the gm-chat page server.
# Quiet and always exits 0, so it never slows or blocks Claude.
STATE="${GM_CHAT_STATE:-$HOME/.claude/channels/gm-chat}"
[ -f "$STATE/password" ] || exit 0
curl -s -m 2 -o /dev/null -X POST \
  -H "x-gm-chat: $(cat "$STATE/password")" -H 'content-type: application/json' \
  --data-binary @- "http://127.0.0.1:${GM_CHAT_PORT:-8788}/hook" 2>/dev/null
exit 0
