#!/bin/bash
# The dogs' own computer (VM 113, dog-box). The only thing the gm-chat dogs can run on this host:
# their SSH key is pinned to this script in authorized_keys, and it only ever touches VM 113.
set -u
VM=113
set -- ${SSH_ORIGINAL_COMMAND:-$*}
act=${1:-status}; arg=${2:-}
name_ok() { [[ "$arg" =~ ^[A-Za-z0-9_-]{1,40}$ ]] || { echo "save point names are letters, numbers, - and _ (up to 40)"; exit 2; }; }
ip_of() { qm guest cmd $VM network-get-interfaces 2>/dev/null | python3 -c 'import json,sys
for i in json.load(sys.stdin):
  if i.get("name")=="lo": continue
  for a in i.get("ip-addresses",[]):
    if a.get("ip-address-type")=="ipv4": print(a["ip-address"]); sys.exit()' ; }
case "$act" in
  status)
    st=$(qm status $VM | awk '{print $2}')
    echo "state: $st"
    [ "$st" = running ] && echo "ip: $(ip_of)"
    qm config $VM | grep -E '^(cores|memory):'
    echo "host memory free: $(awk '/MemAvailable/{printf "%d MB", $2/1024}' /proc/meminfo)"
    echo "save points:"; qm listsnapshot $VM | grep -v 'current' | sed 's/^[ `>-]*/  /' ;;
  ip) ip_of ;;
  start)
    [ "$(qm status $VM | awk '{print $2}')" = running ] && { echo "already on, ip $(ip_of)"; exit 0; }
    need=$(( $(qm config $VM | awk '/^memory:/{print $2}') + 512 ))
    have=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
    [ "$have" -lt "$need" ] && { echo "not started: the box has ${have} MB free and the dog computer needs ${need} MB"; exit 3; }
    qm start $VM && for i in $(seq 1 24); do sleep 5; ip=$(ip_of); [ -n "$ip" ] && { echo "on, ip $ip"; exit 0; }; done; echo "on, still booting" ;;
  stop) qm shutdown $VM --timeout 90 && echo off || { echo "clean shutdown timed out"; exit 4; } ;;
  save) name_ok; qm snapshot $VM "$arg" --description "saved by a dog $(date -Is)" && echo "saved: $arg" ;;
  undo) name_ok; qm rollback $VM "$arg" && echo "rolled back to $arg (the computer is off now)" ;;
  *) echo "actions: status, ip, start, stop, save <name>, undo <name>"; exit 2 ;;
esac
