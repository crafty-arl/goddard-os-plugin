#!/bin/sh
# Passes a hook event to this session's Goddard OS page, once the session has joined the door.
F="${GM_CHAT_STATE:-$HOME/.claude/channels/gm-chat}/plain/$CLAUDE_CODE_SESSION_ID"
[ -f "$F" ] || exit 0
GM_CHAT_PORT="$(cat "$F")" exec sh "$(cd "$(dirname "$0")/.." && pwd)/door/hook.sh"
