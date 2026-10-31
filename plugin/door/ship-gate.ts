#!/usr/bin/env bun
// PreToolUse ship gate (Carl's house rule: nothing paid, public or live without his word). Anything that puts work in
// front of other people or changes a live system (deploys, pushes, publishing, sending email or messages, payments,
// infrastructure) stops here and goes to Carl as one card that says what goes live, with the ready check's findings.
// Only his tap lets it through; no answer in 20 minutes is a no. (2026-10-29: a session put an email live unasked.)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { own, mindDir } from './profile'
const h = JSON.parse(await Bun.stdin.text() || '{}')
const port = process.env.GM_CHAT_PORT
if (!port) process.exit(0)
const tool = String(h.tool_name ?? ''), input = h.tool_input ?? {}
const cmd = String(input.command ?? '')
const LIVE: [RegExp, string][] = [
  [/\bgit\s+push\b/, 'push code to GitHub'],
  [/\bwrangler\b[^;&|]*\b(deploy|publish|secret\s+put|d1\s+execute[^;&|]*--remote)\b/, 'deploy to Cloudflare'],
  [/\b(vercel|netlify|firebase|fly|flyctl|railway|heroku)\b[^;&|]*\b(deploy|--prod|up|release)\b/, 'deploy a site'],
  [/\b(npm|pnpm|yarn|bun)\s+publish\b/, 'publish a package'],
  [/\bgh\s+(release\s+create|pr\s+merge|repo\s+edit[^;&|]*--visibility)/, 'change GitHub for everyone'],
  [/\b(terraform|tofu)\s+(apply|destroy)\b|\bkubectl\s+(apply|delete)\b|\bsupabase\s+db\s+(push|reset)\b/, 'change live infrastructure'],
  [/\b\w*(send|blast|broadcast|publish|post_to|tweet)\w*\.(m?js|ts|py|sh)\b/i, 'run a send or publish script'],
  [/\bcurl\b(?=[^;&|]*(-X\s*(POST|PUT|PATCH|DELETE)|--data|-d\s|-F\s))(?![^;&|]*(localhost|127\.0\.0\.1|192\.168\.))[^;&|]*https?:\/\//i, 'send data to an outside service'],
  [/\bstripe\b|\bpayment|\bcheckout\b[^;&|]*(create|confirm)/i, 'touch payments'],
]
let what = ''
if (tool === 'Bash' || tool === 'mcp__gm-chat__vm_run') for (const [re, label] of LIVE) if (re.test(cmd)) { what = label; break }
// the dogs' own computer: rolling it back throws work away, so Carl says yes first
// the dog-box browser: buttons that post, send, buy or delete on a logged-in account ask Carl first
if (tool === 'mcp__gm-chat__web_click' && /\b(post|posting|send|publish|share|tweet|reply|comment|buy|pay|purchase|order|checkout|donate|subscribe|transfer|delete|remove|cancel|confirm|submit|sign\s*up|create|invite|accept|approve|go\s*live|schedule)\b/i.test(String(input.label ?? ''))) what = `click "${String(input.label).slice(0, 60)}" in the dog-box browser`
if (tool === 'mcp__gm-chat__vm_undo') what = `roll the dog computer back to save point "${String(input.name ?? '')}"`
// connector tools that post, publish or send on Carl's behalf (his own chat tools are fine)
if (!what && tool.startsWith('mcp__') && !/^mcp__(gm-chat|claude-code-remote|hearthbot)__/.test(tool) && /(publish|_post|post_|send|tweet|schedule_post|create_post|share|upload_media|payment|charge)/i.test(tool)) what = `use ${tool.replace(/^mcp__[^_]+__/, '')}`
if (!what) process.exit(0)

const decide = (d: 'allow' | 'deny', why: string) => { console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: d, permissionDecisionReason: own(why) } })); process.exit(0) }
// the ready check (keys left in code) runs on the repo this would ship, when there is one
let ready = ''
try {
  const p = Bun.spawnSync(['python3', join(mindDir().replace(/^~/, homedir()), 'skills', 'gm-ready', 'ready.py'), '--quick', String(h.cwd ?? process.cwd())], { stdout: 'pipe', stderr: 'ignore', timeout: 20_000 })
  ready = new TextDecoder().decode(p.stdout).trim().split('\n').slice(0, 4).join('\n')
} catch {}
const preview = (cmd ? cmd : JSON.stringify(input)).slice(0, 300) + (ready ? `\n\nReady check:\n${ready}` : '')
try {
  const token = readFileSync(join(process.env.GM_CHAT_STATE ?? join(homedir(), '.claude', 'channels', 'gm-chat'), 'password'), 'utf8').trim()
  const who = (process.env.GM_CHAT_NAME ?? 'A dog').replace(/^(Agent slot|Session) · /, '')
  void fetch('http://127.0.0.1:8787/api/push/urgent', { method: 'POST', headers: { cookie: `gm_chat=${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ who, text: `wants to go live: ${what}` }) }).catch(() => {})
  const r = await fetch(`http://127.0.0.1:${port}/hook-ask`, { method: 'POST', headers: { 'x-gm-chat': token, 'content-type': 'application/json' },
    body: JSON.stringify({ tool, preview, description: `${who} wants to go live: ${what}` }), signal: AbortSignal.timeout(21 * 60_000) })
  const j = await r.json() as { behavior?: string }
  if (j.behavior === 'allow') decide('allow', 'Carl allowed this on their Go-live card.')
  decide('deny', j.behavior === 'deny' ? 'Carl said no to going live. Stop, tell them in one line, and ask what they want instead.' : "Carl didn't answer the Go-live card in time. Don't retry; park it and tell them it's waiting on their OK.")
} catch {
  decide('deny', "Couldn't reach Carl for a Go-live OK. Don't retry; tell them it's waiting on their OK.")
}
