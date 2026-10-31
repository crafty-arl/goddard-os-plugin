# gm-chat

A GM! chat page for Claude Code. Claude runs on the Mac mini; you open the page from any computer or phone on the home network (or over Tailscale through the Proxmox subnet router). Every visit needs the password, which is saved on the Mac in `~/.claude/channels/gm-chat/password` and baked into the link.

Built on Claude Code Channels (research preview) and forked from Anthropic's fakechat demo (Apache-2.0). Claude's permission asks show as ALLOW / NO cards.

The link opens the **front door**: every running thread (needs you · working · done), which servers answer, and **+ NEW THREAD**. A new thread opens a real Claude window in Terminal on the Mac, in the folder you pick, and works on the server you pick over SSH. The first thread you start by hand also starts the door (`door.ts`, port 8787), and the door stays up after that thread closes. Threads use ports 8788 and up.

**Home** is pinned at the top: one always-open Claude in `~/gm-mind` for an ongoing chat, with Goddard on hand. START HOME opens it, and next time it picks up its last conversation. Its role is in `home.md`. It can list, read and message the other threads; hand jobs to Goddard over the GM! Bus; and read (never drive) the Claude project threads mirrored into gm-mind and the Claude Code sessions on the Mac.

Servers and folders live in `~/.claude/channels/gm-chat/door.json` (made on first run). Edit it to add a box or fix an SSH login.

While Claude works, the page shows a typing bubble with the current step, and a list of the steps it takes (files read, commands run, searches). The list folds to "✓ 5 steps" when Claude finishes. The steps come from the hooks in `.claude/settings.json` (`hook.sh` posts each event to the page server). They show what Claude does, not its private thinking.

## Run it on the Mac (one session, nothing installed for good)

```
cd ~/gmcarl && git fetch origin claude/project-thread-mjscx6 && git worktree add ~/gm-chat-test origin/claude/project-thread-mjscx6
cd ~/gm-chat-test/tools/gm-chat && claude --dangerously-load-development-channels server:gm-chat
```

Say yes to the prompts (the development channel and the project's MCP server). Then, in a second Terminal tab:

```
cat ~/.claude/channels/gm-chat/link.txt
```

Open that link on the PC or phone. Close the Claude window to stop it.

Needs Bun (`brew install oven-sh/bun/bun`).
