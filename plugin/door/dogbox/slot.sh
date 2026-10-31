#!/bin/bash
# Hands out the session screens on dog-box, one per gm-chat session, never shared (Carl, 2026-10-30).
#   slot.sh claim <owner>   -> prints the slot number (reuses the owner's slot), or "full: <owners>"
#   slot.sh touch <slot>    -> marks the slot as still in use
#   slot.sh release <slot>  -> stops its screen and clears its browser and work folder
#   slot.sh status
# A slot nobody touched for 30 minutes counts as free (its session died without saying goodbye).
set -u
ROOT="$HOME/slots"; mkdir -p "$ROOT"
exec 9>"$ROOT/.lock"; flock 9
STALE=1800
owner_of() { cat "$ROOT/s$1/owner" 2>/dev/null; }
age_of() { local f="$ROOT/s$1/seen"; [ -f "$f" ] && echo $(( $(date +%s) - $(stat -c %Y "$f") )) || echo 99999; }
free_slot() {
  rm -rf "$ROOT/s$1"
}
case "${1:-}" in
  claim)
    who="${2:-}"; [[ "$who" =~ ^[A-Za-z0-9._-]{1,80}$ ]] || { echo "bad owner"; exit 2; }
    for n in 1 2 3; do [ "$(owner_of $n)" = "$who" ] && { touch "$ROOT/s$n/seen"; systemctl is-active -q "gm-slot@$n" || sudo systemctl start "gm-slot@$n"; echo "$n"; exit 0; }; done
    for n in 1 2 3; do
      o="$(owner_of $n)"
      if [ -z "$o" ] || [ "$(age_of $n)" -gt $STALE ]; then
        [ -n "$o" ] && { sudo systemctl stop "gm-slot@$n" 2>/dev/null; free_slot $n; }
        mkdir -p "$ROOT/s$n"
        # a copy of Carl's logins from the main browser (no locks or caches), so he logs in once
        rsync -a --exclude 'Singleton*' --exclude '*Cache*' --exclude 'GPUCache' --exclude 'Service Worker' "$HOME/browser/" "$ROOT/s$n/browser/" 2>/dev/null
        echo "$who" > "$ROOT/s$n/owner"; touch "$ROOT/s$n/seen"
        sudo systemctl start "gm-slot@$n"
        for i in $(seq 1 20); do curl -s -m 1 "127.0.0.1:923$n/json/version" >/dev/null && break; sleep 0.5; done
        echo "$n"; exit 0
      fi
    done
    echo "full: $(for n in 1 2 3; do owner_of $n; done | paste -sd ',' -)"; exit 3 ;;
  touch) [[ "${2:-}" =~ ^[1-3]$ ]] && touch "$ROOT/s$2/seen" ;;
  release)
    n="${2:-}"; [[ "$n" =~ ^[1-3]$ ]] || exit 2
    sudo systemctl stop "gm-slot@$n" 2>/dev/null; free_slot "$n"; echo "released $n" ;;
  status) for n in 1 2 3; do echo "$n: $(owner_of $n || true) idle $(age_of $n)s"; done ;;
  *) echo "claim|touch|release|status"; exit 2 ;;
esac
