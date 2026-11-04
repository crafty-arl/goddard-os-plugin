#!/bin/sh
# Runs one of the door's gates (go-live, big drive, save point) in a session the owner opened themselves.
PATH="$PATH:$HOME/.bun/bin"
command -v bun >/dev/null || exit 0
exec bun "$(cd "$(dirname "$0")/.." && pwd)/door/$1"
