#!/bin/sh
# The plugin's tool server, for sessions the owner opens themselves. The door's own sessions turn the plugin off and
# carry their own copy. The door's packages arrive with the first /goddard-os:start.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATH="$PATH:$HOME/.bun/bin"
[ -d "$ROOT/door/node_modules" ] && command -v bun >/dev/null || exit 0
GM_CHAT_PLAIN=1 exec bun "$ROOT/door/server.ts"
