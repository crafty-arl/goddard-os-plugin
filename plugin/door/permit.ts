#!/usr/bin/env bun
// PermissionRequest hook for background dogs: a background session has no window where Carl could answer a
// permission prompt, so this hands the prompt to the dog's gm-chat page as an Allow / No card (and a push ping), waits
// for his answer, and gives it back to Claude Code. Without an answer in 20 minutes it says no. Carl's own tap is the
// only way it ever says yes. (Carl, 2026-10-28: a background Goddard sat stuck on a LaCie edit nobody could approve.)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { own } from './profile'
const h = JSON.parse(await Bun.stdin.text() || '{}')
const port = process.env.GM_CHAT_PORT
const say = (behavior: 'allow' | 'deny', message?: string) => {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior, ...(message ? { message: own(message) } : {}) } } }))
  process.exit(0)
}
if (!port) process.exit(0) // not one of ours: leave the prompt as it is
const input = h.tool_input ?? {}
const preview = String(input.command ?? input.file_path ?? input.url ?? JSON.stringify(input)).slice(0, 400)
try {
  const token = readFileSync(join(process.env.GM_CHAT_STATE ?? join(homedir(), '.claude', 'channels', 'gm-chat'), 'password'), 'utf8').trim()
  // this one can't wait for the hourly digest
  void fetch('http://127.0.0.1:8787/api/push/urgent', { method: 'POST', headers: { cookie: `gm_chat=${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ who: process.env.GM_CHAT_NAME?.replace(/^Agent slot · /, '') ?? 'A dog', text: `${h.tool_name}: ${preview}` }) }).catch(() => {})
  const r = await fetch(`http://127.0.0.1:${port}/hook-ask`, {
    method: 'POST', headers: { 'x-gm-chat': token, 'content-type': 'application/json' },
    body: JSON.stringify({ tool: String(h.tool_name ?? 'a tool'), preview }), signal: AbortSignal.timeout(21 * 60_000),
  })
  const j = await r.json() as { behavior?: 'allow' | 'deny' }
  if (j.behavior === 'allow') say('allow')
  say('deny', j.behavior === 'deny' ? 'Carl said no.' : "Carl didn't answer in time. Ask them in a reply instead.")
} catch {
  say('deny', "Couldn't reach Carl for this permission. Ask them in a reply instead.")
}
