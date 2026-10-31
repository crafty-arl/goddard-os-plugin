# Goddard OS (pilot)

Made by GM! Carl.

A calm phone home for your Claude Code background sessions. You give jobs to named helpers ("dogs"), approve each
plan with one tap, and get one ping when something needs you. It runs on your Mac; your phone opens it in the browser.

## Install

In Claude Code on your Mac, paste these one at a time:

```
/plugin marketplace add crafty-arl/goddard-os-plugin
```
```
/plugin install goddard-os@goddard-os
```
```
/goddard-os:start
```

The first start installs what it needs, signs this Mac's browser in, and opens Setup: six short steps (you, your
phone, your dogs, a dog computer, pings, more connections). Every step after the first can be skipped. Nothing starts
a Claude session until Setup is saved.

## Needs

- A Mac with Claude Code on a paid plan. Background helpers use your plan's limits fast.
- Bun and Node.
- For your phone away from home: Tailscale.

`/goddard-os:stop` stops it. Your profile, passkeys and boards live in `~/.claude/channels/gm-chat`, so updates keep them.

## For the maintainer

`./bundle.sh` copies the app and the door into `plugin/` from their repos (tracked files only).

## License

MIT. See LICENSE.
