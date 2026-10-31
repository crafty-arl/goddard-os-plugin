#!/usr/bin/env bun
/**
 * gm-chat: a GM! chat page for a running Claude Code session.
 *
 * Forked from Anthropic's fakechat channel (Apache-2.0,
 * github.com/anthropics/claude-plugins-official/external_plugins/fakechat).
 * Changes: serves on the home network instead of localhost only, every
 * request needs the session password, Claude's permission asks show as
 * Allow / No cards, GM! look, a typing bubble and a live list of the steps
 * Claude takes (fed by the hooks in .claude/settings.json). File uploads are
 * left out.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import type { ServerWebSocket } from 'bun'
import { DOOR_PORT, HEAD, HOST, SESSIONS_DIR, STATE_DIR, TOKEN, gate, isToken, lanAddress } from './common'
import { profile, has, own } from './profile'

// Threads take 8788 and up; the front door (door.ts) has 8787.
const PORT = Number(process.env.GM_CHAT_PORT ?? 8788)
const NAME = process.env.GM_CHAT_NAME || basename(process.cwd())
const ON = process.env.GM_CHAT_SERVER || 'Mac mini'
const HOME = process.env.GM_CHAT_HOME === '1'
// the router lane this thread was opened for; slots opened before the router run the default model (Opus), so 'best'
const MODE = process.env.GM_CHAT_MODE || 'best'
const SESSION_FILE = join(SESSIONS_DIR, `${PORT}.json`)
const LINK_FILE = join(STATE_DIR, 'link.txt')
const DOOR = `http://${lanAddress()}:${DOOR_PORT}/?p=${TOKEN}`

type Wire =
  | { type: 'msg'; id: string; from: 'user' | 'assistant'; text: string; ts: number; choices?: string[] }
  | { type: 'shot'; id: string; src: string; url: string; title: string; ts: number }
  | { type: 'edit'; id: string; text: string }
  | { type: 'ask'; request_id: string; tool_name: string; description: string; input_preview?: string }
  | { type: 'asked'; request_id: string; behavior: 'allow' | 'deny' }
  | { type: 'step'; id: string; text: string; ts: number }
  | { type: 'done' }
  | { type: 'busy'; on: boolean; text?: string }

const clients = new Set<ServerWebSocket<unknown>>()
const history: Wire[] = []
const openAsks = new Map<string, Wire>()
let seq = 0
// Busy = Claude is working on something; the page shows the typing bubble.
let busy: { on: boolean; text?: string } = { on: false }
// the steps the dog said it will take on this job, and which one it's on (shown to Carl as a checklist)
let plan: { steps: string[]; now: number; done: boolean; at: number; approved?: boolean } | null = null
// a session's system (Carl, 2026-10-28: "this artifact will always need a system ... will always need a plan"): what
// was brought, the goal, the phases (the plan), the working sheet filled from Carl's words, the resources, and done
type Board = { artifact: string; goal: string; phases: string[]; now: number; sheet: { name: string; value: string }[]; resources: string[]; done_when: string
  done?: { what: string; met: boolean }[]; done_ideas?: string[]; next?: string; finished?: { at: number; path: string; next?: string }; yours?: string[]; at: number }
let board: Board | null = null
// Auto (Carl, 2026-10-29): the session runs itself end to end until this time, then stops and reports
const autoUntil = Number(process.env.GM_CHAT_AUTO_UNTIL ?? 0)
const auto = { on: autoUntil > Date.now(), until: autoUntil, nudges: 0, timeUp: false, seen: 0, idle: 0 }
const BOARDS_DIR = join(STATE_DIR, 'boards')
const boardFile = () => join(BOARDS_DIR, `${NAME.replace(/[^\w-]+/g, '-').slice(0, 60)}.json`)
try { board = JSON.parse(readFileSync(boardFile(), 'utf8')) } catch {}
// a session's mode (Carl, 2026-10-30: "make plan mode its own mode to keep every chat different"): plan (phases, sheet,
// Done list, a Go first), talk (a plain chat) or do (straight to work). Kept next to the board so a switch sticks.
type SessionMode = 'plan' | 'talk' | 'do'
const sessionMode = (): SessionMode | undefined => {
  if (!NAME.startsWith('Session · ')) return undefined
  try { const m = readFileSync(boardFile().replace(/\.json$/, '.mode'), 'utf8').trim(); if (m === 'talk' || m === 'do') return m } catch {}
  return 'plan'
}
function saveBoard() { if (!board) return; try { mkdirSync(BOARDS_DIR, { recursive: true }); writeFileSync(boardFile(), JSON.stringify(board, null, 1), { mode: 0o600 }) } catch {} }
// Once a hook has called in, the Stop hook ends the bubble. Until then
// (hooks not trusted yet) a reply ends it.
let hooksSeen = false
// What the door's thread list shows for this thread.
let steps = 0
let last = { text: '', at: Date.now() }

function nextId() {
  return `m${Date.now()}-${++seq}`
}

let turn = { replied: true, nudge: false }
// a check-in from Goddard OS is told "if nothing is new, don't reply": its turn's words are never forwarded to Carl
let systemTurn = false
function broadcast(m: Wire) {
  if (m.type === 'msg' && m.from === 'assistant') turn.replied = true
  if (m.type === 'msg' || m.type === 'edit' || m.type === 'step' || m.type === 'done' || m.type === 'shot') {
    history.push(m)
    if (history.length > 200) history.shift()
  }
  const data = JSON.stringify(m)
  for (const ws of clients) if (ws.readyState === 1) ws.send(data)
}

// a Stop hook that never arrives (a background session that recapped or compacted instead) used to leave the bubble
// "Writing back" for good; with no hook for 10 minutes the session is idle, so the flag comes down (Carl, 2026-10-28)
let lastHook = Date.now()
const STALE_BUSY = 10 * 60_000
function setBusy(on: boolean, text?: string) {
  if (busy.on === on && busy.text === text) return
  busy = { on, text }
  broadcast({ type: 'busy', ...busy })
}

const short = (v: unknown, n = 70) => {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}
const base = (p: unknown) => String(p ?? '').split('/').filter(Boolean).pop() ?? ''

// One plain line per tool call: what Claude is doing, never the tool's output.
function stepText(tool: string, input: Record<string, any>): string | null {
  // the dog-box tools are real work Carl should see in the live steps; the chat tools show as bubbles instead
  const host = (u: unknown) => { try { return new URL(String(u)).host } catch { return 'a page' } }
  const box: Record<string, string> = {
    vm_status: 'Checking the dog computer', vm_power: input.on ? 'Turning the dog computer on' : 'Turning the dog computer off',
    vm_save: `Taking a save point: ${short(input.name, 30)}`, vm_undo: `Rolling the dog computer back to ${short(input.name, 30)}`,
    vm_run: `On the dog computer: ${short(input.command, 60)}`, web_open: `Browser: opening ${host(input.url)}`, web_look: 'Browser: looking at the page',
    web_click: `Browser: clicking "${short(input.label, 40)}"`, web_type: 'Browser: typing into a field', web_scroll: 'Browser: scrolling', web_back: 'Browser: going back',
    web_record: input.start ? `Watching you: recording "${short(input.name, 30)}"` : 'Saving the workflow', web_flows: 'Reading your workflows', web_flow: `Reading the workflow "${short(input.name, 30)}"`, web_screen: 'Getting the live view link',
  }
  const mine = tool.match(/^mcp__gm-chat__(.+)$/)?.[1]
  if (mine) return box[mine] ?? null
  switch (tool) {
    case 'Read': return `Reading ${base(input.file_path)}`
    case 'Edit': case 'MultiEdit': return `Editing ${base(input.file_path)}`
    case 'Write': return `Writing ${base(input.file_path)}`
    case 'NotebookEdit': return `Editing ${base(input.notebook_path)}`
    case 'Bash': return input.description ? short(input.description) : `Running ${short(input.command, 60)}`
    case 'Grep': return `Searching for "${short(input.pattern, 40)}"`
    case 'Glob': return `Finding files ${short(input.pattern, 50)}`
    case 'WebFetch': try { return `Opening ${new URL(input.url).host}` } catch { return 'Opening a web page' }
    case 'WebSearch': return `Searching the web: ${short(input.query, 50)}`
    case 'Task': case 'Agent': return `Starting a helper: ${short(input.description, 50)}`
    case 'TodoWrite': case 'TaskCreate': case 'TaskUpdate': return 'Updating the plan'
    case 'Skill': return `Using skill ${short(input.skill ?? input.command, 40)}`
  }
  const mcpTool = tool.match(/^mcp__(.+?)__(.+)$/)
  if (mcpTool) return `Using ${mcpTool[1]} · ${mcpTool[2]}`
  return `Using ${tool}`
}

// the dog's last text in this turn, from the Stop hook (newer Claude Code) or the transcript's tail
function lastWords(h: Record<string, any>): string {
  const clean = (t: string) => t.replace(/^I can't use the gm-chat reply tool[^\n]*\n+/i, '').trim().slice(0, 4000)
  if (typeof h.last_assistant_message === 'string' && h.last_assistant_message.trim()) return clean(h.last_assistant_message)
  try {
    const lines = readFileSync(String(h.transcript_path ?? ''), 'utf8').trimEnd().split('\n').slice(-60).reverse()
    for (const l of lines) {
      const d = JSON.parse(l)
      if (d.type === 'user' && typeof d.message?.content === 'string') return ''
      const text = d.type === 'assistant' && Array.isArray(d.message?.content) ? d.message.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n') : ''
      if (text.trim()) return clean(text)
    }
  } catch {}
  return ''
}

// Claude Code hook events, posted by hook.sh. Only a short summary goes to the page.
function onHook(h: Record<string, any>) {
  hooksSeen = true
  lastHook = Date.now()
  switch (h.hook_event_name) {
    case 'UserPromptSubmit':
      setBusy(true, 'Thinking it over')
      turn = { replied: false, nudge: systemTurn || /^\[Goddard OS · automatic/.test(String(h.prompt ?? '')) }
      systemTurn = false
      break
    case 'PreToolUse': {
      const text = stepText(String(h.tool_name ?? ''), h.tool_input ?? {})
      if (!text) { setBusy(true, 'Writing back'); break }
      broadcast({ type: 'step', id: nextId(), text, ts: Date.now() })
      steps++; last = { text, at: Date.now() }
      setBusy(true, text)
      break
    }
    case 'PostToolUse': {
      // a file the dog wrote, edited or published goes to the door, which keeps a live copy for Goddard OS
      const tool = String(h.tool_name ?? ''), input = h.tool_input ?? {}
      const files: string[] = []
      if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) files.push(input.file_path ?? input.notebook_path)
      let url: string | undefined
      if (tool === 'Artifact') {
        if (input.file_path) files.push(input.file_path)
        for (const f of input.file_paths ?? []) files.push(f)
        url = JSON.stringify(h.tool_response ?? '').match(/https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9-]+/)?.[0]
      }
      if (files.filter(Boolean).length || url) {
        fetch(`http://127.0.0.1:${DOOR_PORT}/api/track`, {
          method: 'POST', headers: { cookie: `gm_chat=${TOKEN}`, 'content-type': 'application/json' },
          body: JSON.stringify({ port: PORT, home: HOME, tool, files: files.filter(Boolean), url }), signal: AbortSignal.timeout(3000),
        }).catch(() => {})
      }
      break
    }
    case 'Stop':
      // a turn that ended without the reply tool (e.g. right after a reopen, before gm-chat connected) still reaches
      // Carl: its last words go to the page, so he never stares at an empty thread (Carl, 2026-10-29: "This is concerning")
      if (!turn.replied && !turn.nudge) {
        const said = lastWords(h)
        if (said) broadcast({ type: 'msg', id: nextId(), from: 'assistant', text: said, ts: Date.now() })
      }
      turn.replied = true
      if (busy.on) { broadcast({ type: 'done' }); last = { text: `✓ ${steps} ${steps === 1 ? 'step' : 'steps'}`, at: Date.now() }; steps = 0 }
      setBusy(false)
      autoNext()
      break
  }
}

// --- Home only: see and talk to the other gm-chat threads on this Mac ---

const HOME_TOOLS = [
  {
    name: 'threads',
    description: 'List the GM! chat threads running on this Mac: port, name, server, folder, and whether each is working, done, or waiting on Carl.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'thread_read',
    description: 'Read the recent messages and steps of one GM! chat thread.',
    inputSchema: { type: 'object', properties: { port: { type: 'number' }, limit: { type: 'number' } }, required: ['port'] },
  },
  {
    name: 'thread_send',
    description: 'Send a message into another GM! chat thread, as Home. Carl sees it on that thread\'s page marked as from Home. Only for things Carl asked you to pass on.',
    inputSchema: { type: 'object', properties: { port: { type: 'number' }, text: { type: 'string' } }, required: ['port', 'text'] },
  },
]

HOME_TOOLS.push(
  {
    name: 'task_start',
    description: 'Give one task to a free agent slot on this Mac (or queue it if none is free), the same way Goddard OS does: an installed skill plus a short brief. Pass agent (its number from the slots tool) to use the slot your plan named; the door refuses a slot it can\'t reach. Use parent to group the sub-tasks of one job. Returns the task with its id. Only start tasks Carl asked for; say how many and which skills before starting.',
    inputSchema: { type: 'object', properties: { skill: { type: 'string' }, brief: { type: 'string' }, parent: { type: 'string' }, agent: { type: 'number' }, mode: { type: 'string', enum: ['auto', 'cheap', 'creative', 'best'], description: 'Router lane. Leave it on auto unless Carl named one.' } }, required: ['skill', 'brief'] },
  },
  {
    name: 'plan_save',
    description: 'Save one long-running plan (a goal with a deadline) after Carl said it looks right: its goal, the "by" date (YYYY-MM-DD), the owning dog, 2 to 6 dated milestones, the next step, and things to remember (their rules for it, what they put off and until when). Pass id to update an existing plan (mark milestones done, move dates). Goddard OS shows it on the Plans screen; your check-ins act on milestones that are due.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, goal: { type: 'string' }, by: { type: 'string' }, owner: { type: 'string' }, next: { type: 'string' },
      milestones: { type: 'array', items: { type: 'object', properties: { date: { type: 'string' }, what: { type: 'string' }, done: { type: 'boolean' } }, required: ['date', 'what'] } },
      remember: { type: 'array', items: { type: 'string' } }, status: { type: 'string', enum: ['active', 'done', 'paused'] } }, required: ['goal', 'by', 'milestones'] },
  },
  {
    name: 'plans',
    description: 'List Carl\'s saved long-running plans with their milestones, next steps and what to remember.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'dog_new',
    description: 'Make a new named dog (its own background session) when no dog fits what Carl asked. Only call this after Carl tapped yes on your suggestion. Give a short name and their job for it in one line; the door drafts its full role and wakes it. Returns its agent number for task_start. Takes about a minute.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, job: { type: 'string' } }, required: ['name', 'job'] },
  },
  {
    name: 'slots',
    description: 'The agent slots that can take work right now, by Agent number, with which are free. These are the only places tasks can go.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'task_status',
    description: 'Status of one task (by id) or all recent tasks: queued / active / done / lost, which slot, whether that agent is working or needs Carl, and its last few lines.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
  },
  {
    name: 'task_send',
    description: 'Send a follow-up message into the agent working on a task (by id). Never use it to answer that agent\'s questions or permission asks for Carl.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'] },
  },
)

// --- Every dog: the dogs' own computer (VM 113 "dog-box" on the Proxmox box, light Debian, user dog) ---
// Power and save points go through /root/dogbox.sh on the host, which only knows VM 113; commands run inside over SSH
// with the dogs' own key. The ship gate still sees vm_run commands and vm_undo (Carl, 2026-10-29).

// the dog computer's host comes from the owner's profile (a Proxmox VM on a home server, for Carl)
const pve = () => profile().dogComputer?.host ?? ''
const DOG_KEY = join(STATE_DIR, 'dogvm_ed25519')
const VM_TOOLS = [
  { name: 'vm_status', description: 'The dog computer (your own Debian server, VM 113): on or off, its address, cores, memory, the host\'s free memory, and its save points.', inputSchema: { type: 'object', properties: {} } },
  { name: 'vm_power', description: 'Turn the dog computer on or off. On refuses when the box is short of memory. Turn it off when you are done with it.', inputSchema: { type: 'object', properties: { on: { type: 'boolean' } }, required: ['on'] } },
  { name: 'vm_save', description: 'Take a save point of the dog computer before anything risky (a name of letters, numbers, - and _).', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'vm_undo', description: 'Roll the dog computer back to a save point. Carl is asked first. It is off afterwards.', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'vm_run', description: 'Run a shell command inside the dog computer as user dog (passwordless sudo, Debian 12). It must be on. Returns its output, up to 10 minutes. Anything that would go live still asks Carl.', inputSchema: { type: 'object', properties: { command: { type: 'string' }, timeout_s: { type: 'number' } }, required: ['command'] } },
]

async function run(cmd: string[], ms: number, whole = false) {
  const p = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
  const t = setTimeout(() => p.kill(), ms)
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  clearTimeout(t)
  const text = (out + (err.trim() ? `\n[stderr]\n${err}` : '')).trim()
  return { code, text: !whole && text.length > 10_000 ? text.slice(0, 4000) + '\n…\n' + text.slice(-6000) : text }
}
const SSH = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10']
const dogbox = (...a: string[]) => run([...SSH, pve(), '/root/dogbox.sh', ...a], 180_000)

// The browser on dog-box (Chromium on its own screen, logins kept). Carl logs in himself through the live view;
// dogs never type passwords (web.mjs refuses), and a click names its label so the ship gate can ask about Post/Send/Buy.
const WEB = ['web_open', 'web_look', 'web_click', 'web_type', 'web_scroll', 'web_back', 'web_record', 'web_flows', 'web_flow', 'web_screen']
VM_TOOLS.push(
  { name: 'web_open', description: 'Open a web address in the dog-box browser (it keeps the logins Carl made there). Then call web_look.', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  { name: 'web_look', description: 'See the dog-box browser: a screenshot, the page text, and every numbered thing you can click or type into with its label.', inputSchema: { type: 'object', properties: { chars: { type: 'number', description: 'how much page text, default 3000' } } } },
  { name: 'web_click', description: 'Click a numbered item from web_look. Pass its label exactly as web_look showed it; a click on Post, Send, Publish, Buy, Pay, Delete, Confirm and the like asks Carl first.', inputSchema: { type: 'object', properties: { n: { type: 'number' }, label: { type: 'string' } }, required: ['n', 'label'] } },
  { name: 'web_type', description: 'Type text into a numbered field from web_look. Never for passwords, codes or card numbers: Carl does those themselves in the live view. Typing never submits; click the button.', inputSchema: { type: 'object', properties: { n: { type: 'number' }, text: { type: 'string' } }, required: ['n', 'text'] } },
  { name: 'web_scroll', description: 'Scroll the dog-box browser (dy pixels, negative is up).', inputSchema: { type: 'object', properties: { dy: { type: 'number' } } } },
  { name: 'web_back', description: 'Go back one page in the dog-box browser.', inputSchema: { type: 'object', properties: {} } },
  { name: 'web_record', description: 'Training: start: true begins writing down what Carl does in the live view as a named workflow; start: false saves it. Only when Carl says "watch me".', inputSchema: { type: 'object', properties: { start: { type: 'boolean' }, name: { type: 'string' } }, required: ['start'] } },
  { name: 'web_flows', description: 'List the workflows Carl has trained.', inputSchema: { type: 'object', properties: {} } },
  { name: 'web_flow', description: 'Read one trained workflow as steps, to replay with the web_ tools.', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'web_screen', description: 'The live view link Carl opens to watch the dog-box screen and log in themselves (on the home network). Give them the link; never the password: they get that on their Mac.', inputSchema: { type: 'object', properties: {} } },
)
// every session gets its own screen on the dog computer (Carl, 2026-10-30: "every session should not overlap"): slot.sh
// hands out up to 3, each its own display, browser (a copy of Carl's logins) and work folder. A 4th waits in line.
const OWNER = `s${PORT}-${NAME.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'dog'}`
let slot = 0, slotIp = ''
const dogSsh = (ip: string) => [...SSH, '-i', DOG_KEY, '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=accept-new', `dog@${ip}`]
async function claimSlot(ip: string): Promise<number | string> {
  let told = false
  for (let i = 0; i < 40; i++) {
    const r = await run([...dogSsh(ip), `~/web/slot.sh claim ${OWNER}`], 60_000)
    const n = Number(r.text.trim())
    if (n >= 1 && n <= 3) { slot = n; slotIp = ip; return n }
    if (!/^full/.test(r.text.trim())) return `couldn't get a screen on the dog computer: ${r.text.trim() || `exit ${r.code}`}`
    if (!told) { told = true; const t = 'Waiting for the dog computer: all 3 screens are in use'; broadcast({ type: 'step', id: nextId(), text: t, ts: Date.now() }); setBusy(true, t) }
    await Bun.sleep(15_000)
  }
  return 'The dog computer stayed full for 10 minutes (3 other sessions on it). Tell Carl and try again later.'
}
function releaseSlot(ip?: string) {
  if (!slot) return
  const n = slot; slot = 0
  const go = (addr: string) => Bun.spawnSync([...dogSsh(addr), `~/web/slot.sh release ${n}`], { timeout: 20_000 })
  if (ip || slotIp) go(ip || slotIp); else dogbox('ip').then(r => { const a = r.text.trim(); if (/^\d+\.\d+\.\d+\.\d+$/.test(a)) go(a) }).catch(() => {})
}
// when this session's page server closes (End, or the dog restarting), its screen is handed back
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(sig, () => { if (slot && slotIp) try { Bun.spawnSync([...dogSsh(slotIp), `~/web/slot.sh release ${slot}`], { timeout: 15_000 }) } catch {} process.exit(0) })
const slotEnv = (n: number) => `export DISPLAY=:1${n} GM_CDP=http://127.0.0.1:923${n} GM_SLOT_DIR=/home/dog/slots/s${n}; ~/web/slot.sh touch ${n};`
let usedBrowser = false
async function webTool(name: string, args: Record<string, unknown>) {
  usedBrowser = true
  const ip = (await dogbox('ip')).text.trim()
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return { content: [{ type: 'text', text: 'The dog computer is off or still booting. Turn it on with vm_power first.' }], isError: true }
  const got = slot || await claimSlot(ip)
  if (typeof got === 'string') return { content: [{ type: 'text', text: got }], isError: true }
  setBusy(true, stepText(name, args) || 'Using the browser')
  if (name === 'web_screen') return { content: [{ type: 'text', text: `This session's screen is live in its thread in Goddard OS (screen ${got} of 3). Carl taps Keyboard there to drive it themselves, for logins.` }] }
  const cmd = { web_rest: 'rest', web_open: 'open', web_look: 'look', web_click: 'click', web_type: 'type', web_scroll: 'scroll', web_back: 'back', web_flows: 'flows', web_flow: 'flow', web_record: args.start ? 'rec-start' : 'rec-stop' }[name]!
  const b64 = Buffer.from(JSON.stringify({ ...args, who: NAME.startsWith('Session · ') ? 'Goddard' : NAME })).toString('base64')
  const dog = dogSsh(ip)
  // this session's own screen and browser (claim also restarts it if it died)
  const r = await run([...dog, `${slotEnv(got)} cd ~/web && node web.mjs ${cmd} "$(echo ${b64} | base64 -d)"`], 90_000)
  const content: any[] = [{ type: 'text', text: r.text || `exit ${r.code}` }]
  if (cmd === 'look' && !r.code) {
    const img = await run([...dog, `base64 -w0 /home/dog/slots/s${got}/last.png`], 30_000, true) // whole: a cut picture is a broken one
    if (!img.code && img.text.length > 100) {
      const data = img.text.replace(/\s/g, '')
      content.push({ type: 'image', data, mimeType: 'image/png' })
      // Carl watches what the dog sees (Carl, 2026-10-29): the same picture goes to this thread's page, served by the door
      try {
        const dir = join(STATE_DIR, 'shots'), f = `${PORT}-${Date.now()}.png`
        mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, f), Buffer.from(data, 'base64'), { mode: 0o600 })
        for (const old of readdirSync(dir).filter(x => x.startsWith(`${PORT}-`)).sort().slice(0, -40)) unlinkSync(join(dir, old))
        let seen: { url?: string; title?: string } = {}; try { seen = JSON.parse(r.text) } catch {}
        broadcast({ type: 'shot', id: nextId(), src: `/door/api/shot?f=${f}`, url: String(seen.url ?? ''), title: String(seen.title ?? ''), ts: Date.now() })
      } catch {}
    }
  }
  return { content, ...(r.code ? { isError: true } : {}) }
}

async function vmTool(name: string, args: Record<string, unknown>) {
  if (WEB.includes(name)) return webTool(name, args)
  const out = (r: { code: number; text: string }) => ({ content: [{ type: 'text', text: r.text || `exit ${r.code}` }], ...(r.code ? { isError: true } : {}) })
  const save = String(args.name ?? '')
  if ((name === 'vm_save' || name === 'vm_undo') && !/^[A-Za-z0-9_-]{1,40}$/.test(save)) return { content: [{ type: 'text', text: 'name: letters, numbers, - and _ (up to 40)' }], isError: true }
  switch (name) {
    case 'vm_status': return out(await dogbox('status'))
    case 'vm_power': {
      if (!args.on) {
        // other sessions may be on their own screens: off only when nobody else is using the dog computer
        const ip = (await dogbox('ip')).text.trim()
        if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
          releaseSlot(ip)
          const st = await run([...dogSsh(ip), '~/web/slot.sh status'], 20_000)
          const others = st.text.split('\n').filter(l => /^\d: \S/.test(l))
          if (others.length) return { content: [{ type: 'text', text: `Left it on: other sessions are using the dog computer (${others.length}). Your screen is handed back.` }] }
        }
        return out(await dogbox('stop'))
      }
      const r = await dogbox('start')
      if (r.code) return out(r)
      // on means this session's own screen is on too, so Carl sees it in the thread from the first moment
      const ip = (await dogbox('ip')).text.trim()
      if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) { const got = slot || await claimSlot(ip); if (typeof got === 'string') return { content: [{ type: 'text', text: `${r.text}\n${got}` }] } }
      return { content: [{ type: 'text', text: `${r.text}\nYour own screen is up (screen ${slot} of 3); Carl watches it live in this thread.` }] }
    }
    case 'vm_save': return out(await dogbox('save', save))
    case 'vm_undo': return out(await dogbox('undo', save))
    case 'vm_run': {
      const ip = (await dogbox('ip')).text.trim()
      if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return { content: [{ type: 'text', text: 'The dog computer is off or still booting. Turn it on with vm_power first.' }], isError: true }
      const secs = Math.max(5, Math.min(600, Number(args.timeout_s ?? 120)))
      // commands run in this session's own work folder, on its own screen
      const got = slot || await claimSlot(ip)
      if (typeof got === 'string') return { content: [{ type: 'text', text: got }], isError: true }
      const r = await run([...dogSsh(ip), `${slotEnv(got)} cd /home/dog/slots/s${got}/work && { ${String(args.command ?? '')}\n}`], secs * 1000)
      return { content: [{ type: 'text', text: `${r.text || '(no output)'}\n[exit ${r.code}]` }] }
    }
  }
  return { content: [{ type: 'text', text: `unknown: ${name}` }], isError: true }
}

async function door(path: string, body?: unknown) {
  const r = await fetch(`http://127.0.0.1:${DOOR_PORT}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { cookie: `gm_chat=${TOKEN}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.ok === false) throw new Error(j.error ?? `door said ${r.status}`)
  return j
}

async function peer(port: number, path: string, body?: unknown) {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-gm-chat': TOKEN, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(3000),
  })
  if (!r.ok) throw new Error(`thread :${port} said ${r.status}`)
  return r.json()
}

async function homeTool(name: string, args: Record<string, unknown>) {
  const ok = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] })
  try {
    if (name === 'threads') {
      const out = []
      for (const f of readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'))) {
        const { port } = JSON.parse(readFileSync(join(SESSIONS_DIR, f), 'utf8'))
        if (port === PORT) continue
        try { out.push(await peer(port, '/state')) } catch {}
      }
      return ok(out.length ? out : 'No other threads are running.')
    }
    if (name === 'plan_save') { const { plan } = await door('/api/plans', args); return ok(plan) }
    if (name === 'plans') { const { plans } = await door('/api/plans'); return ok(plans.length ? plans : 'No plans saved yet.') }
    if (name === 'dog_new') {
      const r = await fetch(`http://127.0.0.1:${DOOR_PORT}/api/dogs/create`, {
        method: 'POST', headers: { cookie: `gm_chat=${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: args.name, job: args.job }), signal: AbortSignal.timeout(240_000),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.ok === false) throw new Error(j.error ?? `door said ${r.status}`)
      return ok(`${j.name} is awake as Agent ${j.agent}. Give it the job with task_start (agent ${j.agent}).`)
    }
    if (name === 'slots') {
      const { slots } = await door('/api/slots')
      return ok(slots.length ? slots.map((s: { agent: number; free: boolean; busy: boolean; needsYou: boolean; dog?: string; skill?: string; job?: string }) =>
        `Agent ${s.agent}${s.dog ? ` = ${s.dog}` : ''}: ${s.free ? 'free' : s.needsYou ? 'waiting on Carl' : s.busy ? 'working' : 'holding a task'}${s.skill ? ` · skill ${s.skill}` : ''}${s.job ? ` · ${s.job}` : ''}`).join('\n') : 'No dogs are open.')
    }
    if (name === 'task_start') {
      let port: number | undefined
      if (args.agent != null) {
        const { slots } = await door('/api/slots')
        port = slots.find((s: { agent: number }) => s.agent === Number(args.agent))?.port
        if (!port) throw new Error(`Agent ${args.agent} isn't reachable`)
      }
      const { task } = await door('/api/tasks', { skill: args.skill, brief: args.brief, parent: args.parent, by: 'home', port, mode: args.mode })
      return ok(task.status === 'queued' ? { ...task, note: 'No free slot yet; it starts when one frees up.' } : task)
    }
    if (name === 'task_status' || name === 'task_send') {
      const { tasks } = await door('/api/tasks')
      const pick = args.id ? tasks.filter((t: { id: string }) => t.id === args.id) : tasks.slice(-12)
      if (!pick.length) throw new Error('no such task')
      if (name === 'task_send') {
        const t = pick[0]
        if (t.status !== 'active' || !t.port) throw new Error(`task is ${t.status}, not running on an agent`)
        await peer(t.port, '/say', { text: String(args.text ?? '') })
        return ok('sent')
      }
      const out = []
      for (const t of pick) {
        let agent = null, lines: string[] = []
        if (t.port) {
          try { agent = await peer(t.port, '/state') } catch {}
          try { lines = (await peer(t.port, '/history?limit=6')).lines } catch {}
        }
        out.push({ ...t, agent: agent && { busy: agent.busy, doing: agent.doing, needsCarl: agent.needsYou }, last: lines })
      }
      return ok(out)
    }
    const port = Number(args.port)
    if (port === PORT) throw new Error("that's this thread")
    if (name === 'thread_read') return ok(await peer(port, `/history?limit=${Number(args.limit ?? 30)}`))
    await peer(port, '/say', { text: String(args.text ?? '') })
    return ok('sent')
  } catch (e) {
    return { content: [{ type: 'text' as const, text: (e as Error).message }], isError: true }
  }
}

const mcp = new Server(
  { name: 'gm-chat', version: '0.1.0' },
  {
    capabilities: {
      tools: {},
      experimental: { 'claude/channel': {}, 'claude/channel/permission': {} },
    },
    instructions: `Carl reads the GM! chat page on their phone or PC, not this terminal. Anything they should see must go through the reply tool; your transcript never reaches the page.\n\nMessages from the page arrive as <channel source="gm-chat" chat_id="web" message_id="...">. Answer with the reply tool. Keep replies short and plain: one idea per line, the result first. The page already shows a typing bubble and a live list of your tool calls, so don't narrate each step. For a progress note on a long job, use the status tool (one short line); save reply for answers and questions.`,
  },
)

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reply',
      description: 'Send a message to Carl on the GM! chat page. When you ask them to choose, also pass the options as `choices` (2 to 4 short answers, in their words, e.g. ["Keep it", "Delete it"]); the page shows them as one-tap buttons.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' }, choices: { type: 'array', items: { type: 'string' }, maxItems: 4 } },
        required: ['text'],
      },
    },
    {
      name: 'plan',
      description: 'Before you take any step on a job, post your plan: the 3 to 7 steps you will take, each a few plain words ("Check the calendar", "Write the LinkedIn post"). Carl sees them as a checklist before you start. Post it again if the plan changes.',
      inputSchema: { type: 'object', properties: { steps: { type: 'array', items: { type: 'string' } } }, required: ['steps'] },
    },
    {
      name: 'step',
      description: 'Mark which step of your plan you are on now (1 = the first). Call it as you start each step, and with done: true when the whole plan is finished.',
      inputSchema: { type: 'object', properties: { n: { type: 'number' }, done: { type: 'boolean' } } },
    },
    {
      name: 'status',
      description: 'Show one short status line on the GM! chat page, under the live steps (for example "Checking the tests, then I will fix them"). Use it instead of reply for progress notes.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
    },
    {
      name: 'system',
      description: 'Sessions: set up (or replace) the system around the artifact Carl brought: what it is, the goal, 3 to 6 phases in order (the plan), the 3 to 8 headings of the working sheet (values in their words, may start empty), the skills and files you will use, and what done means. Carl sees it as a board and answers Go or Change it; wait for Go before working.',
      inputSchema: { type: 'object', properties: {
        artifact: { type: 'string' }, goal: { type: 'string' }, phases: { type: 'array', items: { type: 'string' } },
        sheet: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' } }, required: ['name'] } },
        resources: { type: 'array', items: { type: 'string' } }, done_when: { type: 'string' },
        done: { type: 'array', items: { type: 'string' }, description: '2 to 5 concrete, checkable conditions that mean this session is done (each one yes/no, e.g. "His want and his fear are each one sentence in Carl\'s words")' },
        next: { type: 'string', description: 'what this artifact moves on to after this session (the next session\'s starting point)' },
        done_ideas: { type: 'array', items: { type: 'string' }, description: '2 to 4 more done conditions Carl might want, shown as one-tap "+ add" suggestions (sharper or stretch versions, checkable yes or no)' },
      }, required: ['artifact', 'goal', 'phases', 'sheet', 'done'] },
    },
    {
      name: 'sheet',
      description: 'Sessions: write Carl\'s answers into the working sheet (set: heading -> text, in their words, tightened, never invented; a new heading is added), move to phase n (1 = first), and tick done conditions as they are truly met (met: their numbers, 1 = first). Call it after each answer that adds something.',
      inputSchema: { type: 'object', properties: { set: { type: 'object', additionalProperties: { type: 'string' } }, phase: { type: 'number' }, met: { type: 'array', items: { type: 'number' } }, done_ideas: { type: 'array', items: { type: 'string' } } } },
    },
    {
      name: 'finish',
      description: 'Sessions: when every done condition is met and Carl agrees it is done, finish: the sheet is saved as a document in the Goddard Library and shown to them as the output, with "next" (what the artifact moves on to) offered as a new session. Refused while any condition is unmet.',
      inputSchema: { type: 'object', properties: { next: { type: 'string' } }, required: ['next'] },
    },
    {
      name: 'park',
      description: 'Auto sessions: park one question that only Carl can answer (their idea, story, characters, dialogue, look, or a go-live call). It goes on the board under "Yours to decide"; then keep going on everything else.',
      inputSchema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
    },
    {
      name: 'edit_message',
      description: 'Edit a message you sent to the GM! chat page.',
      inputSchema: {
        type: 'object',
        properties: { message_id: { type: 'string' }, text: { type: 'string' } },
        required: ['message_id', 'text'],
      },
    },
    ...(has('dogComputer') && profile().dogComputer?.kind === 'proxmox-vm' ? VM_TOOLS : []),
    ...(HOME ? HOME_TOOLS : []),
  ].map(t => ({ ...t, description: own(t.description) })),
}))

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>
  switch (req.params.name) {
    case 'reply': {
      const id = nextId()
      const choices = Array.isArray(args.choices) ? args.choices.map(c => short(c, 40)).filter(Boolean).slice(0, 4) : undefined
      // in a session Carl always gets suggestions of what to say next (Carl, 2026-10-29): a reply without them is sent back
      if (sessionMode() === 'plan' && !auto.on && (choices?.length ?? 0) < 2)
        return { content: [{ type: 'text', text: 'Not sent. In Plan mode every reply carries 2 to 4 choices: suggestions of what Carl could say next, in their words, boldest honest one first. Send it again with choices.' }], isError: true }
      broadcast({ type: 'msg', id, from: 'assistant', text: String(args.text ?? ''), ts: Date.now(), ...(choices?.length ? { choices } : {}) })
      { const t = String(args.text ?? ''); note({ type: 'said', text: t.slice(0, 800), choices, asks: !!choices?.length || /\?\s*$/.test(t.trim()) }) }
      if (!hooksSeen) setBusy(false)
      last = { text: 'Replied', at: Date.now() }
      return { content: [{ type: 'text', text: `sent (${id})` }] }
    }
    case 'plan': {
      const steps = (Array.isArray(args.steps) ? args.steps : []).map(x => short(x, 60)).filter(Boolean).slice(0, 9)
      if (!steps.length) return { content: [{ type: 'text', text: 'give 3 to 7 steps' }] }
      plan = { steps, now: 0, done: false, at: Date.now(), approved: false }
      // Carl's rule (2026-10-28): a dog waits for his OK on its plan before it builds
      const pid = nextId(), text = 'My plan:\n' + steps.map((x, i) => `${i + 1}. ${x}`).join('\n') + '\nGo?'
      broadcast({ type: 'msg', id: pid, from: 'assistant', text, ts: Date.now(), choices: ['Go', 'Change the plan'] })
      if (!hooksSeen) setBusy(false)
      last = { text: 'Replied', at: Date.now() }
      note({ type: 'plan', steps }); note({ type: 'said', text, choices: ['Go', 'Change the plan'], asks: true })
      return { content: [{ type: 'text', text: `Plan shown to Carl with Go / Change the plan. Stop here and wait: do not take step 1 until their answer arrives. If they say Go, start and mark each step with the step tool. If they asks for changes, post a new plan.` }] }
    }
    case 'step': {
      if (!plan) return { content: [{ type: 'text', text: 'post a plan first' }] }
      if (args.done) plan.done = true
      else { plan.now = Math.max(0, Math.min(plan.steps.length - 1, Math.round(Number(args.n ?? 1)) - 1)); plan.approved = true }
      return { content: [{ type: 'text', text: plan.done ? 'plan done' : `on step ${plan.now + 1}: ${plan.steps[plan.now]}` }] }
    }
    case 'status': {
      const text = short(args.text, 160)
      broadcast({ type: 'step', id: nextId(), text: '» ' + text, ts: Date.now() })
      last = { text, at: Date.now() }
      setBusy(true, text)
      return { content: [{ type: 'text', text: 'shown' }] }
    }
    case 'system': {
      const list = (v: unknown, n: number, len: number) => (Array.isArray(v) ? v : []).map(x => short(x, len)).filter(Boolean).slice(0, n)
      const phases = list(args.phases, 6, 60)
      const sheet = (Array.isArray(args.sheet) ? args.sheet : []).slice(0, 8).map((x: any) => ({ name: short(x?.name, 40), value: String(x?.value ?? '').slice(0, 1200) })).filter(x => x.name)
      if (!phases.length || !sheet.length) return { content: [{ type: 'text', text: 'give phases and sheet headings' }] }
      const done = list(args.done, 5, 140).map(what => ({ what, met: false }))
      if (!done.length) return { content: [{ type: 'text', text: 'give 2 to 5 done conditions, each one checkable yes or no' }] }
      board = { artifact: short(args.artifact, 120), goal: short(args.goal, 160), phases, now: 0, sheet, resources: list(args.resources, 8, 80), done_when: short(args.done_when, 160) || done.map(d => d.what).join('; '), done, done_ideas: list(args.done_ideas, 4, 140), next: short(args.next, 200) || undefined, at: Date.now() }
      saveBoard()
      // the phases are the plan, and the same gate holds: nothing starts before Carl's Go
      plan = { steps: phases, now: 0, done: false, at: Date.now(), approved: false }
      if (auto.on) {
        plan.approved = true
        const text = `Here's the setup for ${board.artifact}.\nGoal: ${board.goal}\n` + phases.map((x, i) => `${i + 1}. ${x}`).join('\n') + `\nDone when:\n` + done.map(d => `- ${d.what}`).join('\n') + `\nAuto is on: I'm running it now and will report at the end.`
        broadcast({ type: 'msg', id: nextId(), from: 'assistant', text, ts: Date.now() })
        last = { text: 'Auto: running', at: Date.now() }
        note({ type: 'plan', steps: phases }); note({ type: 'said', text, asks: false })
        return { content: [{ type: 'text', text: `Setup shown. Auto is on until ${new Date(auto.until).toLocaleTimeString()}: do not wait for Go. Start phase 1 now and work it yourself, per the Auto rules in your role.` }] }
      }
      const pid = nextId(), text = `Here's the setup for ${board.artifact}.\nGoal: ${board.goal}\n` + phases.map((x, i) => `${i + 1}. ${x}`).join('\n') + `\nDone when:\n` + done.map(d => `- ${d.what}`).join('\n') + `\nGo?`
      broadcast({ type: 'msg', id: pid, from: 'assistant', text, ts: Date.now(), choices: ['Go', 'Change it'] })
      if (!hooksSeen) setBusy(false)
      last = { text: 'Replied', at: Date.now() }
      note({ type: 'plan', steps: phases }); note({ type: 'said', text, choices: ['Go', 'Change it'], asks: true })
      return { content: [{ type: 'text', text: 'Setup shown on the board with Go / Change it. Stop and wait for the answer. On Go, start phase 1 with one question.' }] }
    }
    case 'sheet': {
      if (!board) return { content: [{ type: 'text', text: 'set up the system first' }] }
      const set = (args.set && typeof args.set === 'object' ? args.set : {}) as Record<string, unknown>
      for (const [k, v] of Object.entries(set)) {
        const name = short(k, 40); if (!name) continue
        const row = board.sheet.find(r => r.name.toLowerCase() === name.toLowerCase())
        if (row) row.value = String(v ?? '').slice(0, 1200); else if (board.sheet.length < 12) board.sheet.push({ name, value: String(v ?? '').slice(0, 1200) })
      }
      if (Array.isArray(args.done_ideas)) board.done_ideas = args.done_ideas.map(x => short(x, 140)).filter(Boolean).slice(0, 4)
      if (Array.isArray(args.met) && board.done) for (const n of args.met) { const d = board.done[Math.round(Number(n)) - 1]; if (d) d.met = true }
      if (args.phase !== undefined) { board.now = Math.max(0, Math.min(board.phases.length - 1, Math.round(Number(args.phase)) - 1)); if (plan) { plan.now = board.now; plan.approved = true } }
      board.at = Date.now(); saveBoard()
      const open = board.done?.filter(d => !d.met).map(d => d.what) ?? []
      return { content: [{ type: 'text', text: `sheet saved (${board.sheet.filter(r => r.value.trim()).length}/${board.sheet.length} filled), phase ${board.now + 1}: ${board.phases[board.now]}. ${open.length ? `Not done yet: ${open.join('; ')}` : 'Every done condition is met: tell Carl, and on their OK call finish.'}` }] }
    }
    case 'finish': {
      if (!board) return { content: [{ type: 'text', text: 'set up the system first' }] }
      const open = board.done?.filter(d => !d.met) ?? []
      if (open.length) return { content: [{ type: 'text', text: `not done yet: ${open.map(d => d.what).join('; ')}` }] }
      board.next = short(args.next, 200) || board.next
      const r = await fetch(`http://127.0.0.1:${DOOR_PORT}/api/session/save`, { method: 'POST', headers: { cookie: `gm_chat=${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ port: PORT, next: board.next }), signal: AbortSignal.timeout(8000) }).then(r => r.json()).catch(e => ({ ok: false, error: String(e) }))
      if (!r.ok) return { content: [{ type: 'text', text: `couldn't save the sheet: ${r.error}` }], isError: true }
      if (slot) releaseSlot() // done: this session's screen, browser and work folder are cleared and handed back
      auto.on = false
      return { content: [{ type: 'text', text: `Saved at ${r.path}. Carl sees it as the output with a button to carry it into a new session. ${board.yours?.length || autoUntil ? 'Now send the end card with reply: what you made, what you decided and why, and what is parked for them.' : 'Say one line and stop.'}` }] }
    }
    case 'park': {
      if (!board) return { content: [{ type: 'text', text: 'set up the system first' }] }
      const q = short(args.question, 200); if (!q) return { content: [{ type: 'text', text: 'give the question' }] }
      board.yours = [...(board.yours ?? []).filter(x => x !== q), q].slice(-8); board.at = Date.now(); saveBoard()
      broadcast({ type: 'step', id: nextId(), text: `» Parked for you: ${q}`, ts: Date.now() })
      return { content: [{ type: 'text', text: `Parked (${board.yours.length} for Carl). Keep going on everything that doesn't need it.` }] }
    }
    case 'edit_message': {
      broadcast({ type: 'edit', id: String(args.message_id), text: String(args.text ?? '') })
      return { content: [{ type: 'text', text: 'ok' }] }
    }
    case 'vm_status':
    case 'vm_power':
    case 'vm_save':
    case 'vm_undo':
    case 'vm_run':
    case 'web_open': case 'web_look': case 'web_click': case 'web_type': case 'web_scroll':
    case 'web_back': case 'web_record': case 'web_flows': case 'web_flow': case 'web_screen':
      return vmTool(req.params.name, args)
    case 'threads':
    case 'thread_read':
    case 'thread_send':
    case 'task_start':
    case 'task_status':
    case 'task_send':
    case 'slots':
    case 'dog_new':
    case 'plan_save':
    case 'plans':
      if (HOME) return homeTool(req.params.name, args)
    default:
      return { content: [{ type: 'text', text: `unknown: ${req.params.name}` }], isError: true }
  }
})

mcp.setNotificationHandler(
  z.object({
    method: z.literal('notifications/claude/channel/permission_request'),
    params: z.object({
      request_id: z.string(),
      tool_name: z.string(),
      description: z.string(),
      input_preview: z.string().optional(),
    }),
  }),
  async ({ params }) => {
    const ask: Wire = { type: 'ask', ...params }
    openAsks.set(params.request_id, ask)
    note({ type: 'permission', id: params.request_id, tool: params.tool_name, text: params.description.slice(0, 400) })
    broadcast(ask)
  },
)

await mcp.connect(new StdioServerTransport())

// Tell the door this thread is up, and make sure the door itself is running
// (it outlives this thread on purpose: it's the page Carl keeps open).
writeFileSync(SESSION_FILE, JSON.stringify({ port: PORT, name: NAME, server: ON, folder: process.cwd(), pid: process.pid, started: Date.now() }), { mode: 0o600 })
writeFileSync(LINK_FILE, DOOR + '\n', { mode: 0o600 })
fetch(`http://127.0.0.1:${DOOR_PORT}/ping`, { signal: AbortSignal.timeout(1000) }).catch(() => {
  Bun.spawn(['bun', join(import.meta.dir, 'door.ts')], { stdio: ['ignore', 'ignore', 'ignore'], env: process.env, detached: true } as any).unref()
})
// A thread started from the door arrives with Carl's first message.
if (process.env.GM_CHAT_FIRST) history.push({ type: 'msg', id: nextId(), from: 'user', text: process.env.GM_CHAT_FIRST, ts: Date.now() })

// When Claude closes, stdin closes. Exit then, or the page server lives on,
// keeps the port, and the next session's page never takes over.
const quit = () => {
  // only remove the registration if it's ours (another thread may own this port)
  try { if (JSON.parse(readFileSync(SESSION_FILE, 'utf8')).pid === process.pid) unlinkSync(SESSION_FILE) } catch {}
  process.exit(0)
}
process.stdin.on('end', quit)
process.stdin.on('close', quit)
for (const sig of ['SIGTERM', 'SIGHUP', 'SIGINT'] as const) process.on(sig, quit)

// Every ask, answer and permission goes on Carl's history at the door (Carl, 2026-10-28: "proper tracking history of
// requests and needs"). Fire and forget: a missing door never blocks the thread.
function note(ev: Record<string, unknown>) {
  fetch(`http://127.0.0.1:${DOOR_PORT}/api/history`, {
    method: 'POST', headers: { cookie: `gm_chat=${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ...ev, port: PORT, name: NAME, home: HOME }), signal: AbortSignal.timeout(3000),
  }).catch(() => {})
}

// A message from the page (Carl), or from the Home thread passing something on.
// A background dog (claude --bg) doesn't load gm-chat as a channel, so a message can't be pushed to it that way. Instead
// it's typed into the dog's own background session (bgsay.py attaches in a pseudo-terminal, types, detaches). The session
// is the one whose process started this server. (Carl, 2026-10-28: "drop the visible-windows rule".)
const BG = process.env.GM_CHAT_BG === '1'
let bgId: string | null = null
async function typeIntoSession(text: string) {
  if (!bgId) {
    const p = Bun.spawn(['claude', 'agents', '--json'], { stdout: 'pipe', stderr: 'ignore' })
    const list = JSON.parse(await new Response(p.stdout).text() || '[]')
    const rows: { pid?: number; id?: string }[] = Array.isArray(list) ? list : list.sessions ?? []
    bgId = rows.find(r => r.pid === process.ppid)?.id ?? null
  }
  if (!bgId) { broadcast({ type: 'step', id: nextId(), text: '» Couldn\'t find this dog\'s background session to hand it your message', ts: Date.now() }); return }
  Bun.spawn(['python3', join(import.meta.dir, 'bgsay.py'), bgId, text], { stdout: 'ignore', stderr: 'ignore' })
}

// Auto: when the dog ends a turn short of done, send it back to work; at the cap, tell it to stop and report once
function autoNext() {
  if (!auto.on || board?.finished || openAsks.size) return
  if (Date.now() >= auto.until) {
    if (!auto.timeUp) { auto.timeUp = true; auto.on = false; setTimeout(() => deliver(nextId(), "Auto's time is up. Stop working now: save what you have with the sheet tool, then send Carl the end card with reply (what's done, what's left, what's parked for them). No new work.", 'system'), 2000) }
    return
  }
  // stuck on what only Carl can give: two turns in a row with nothing new on the board ends Auto (its end card stands)
  const mark = board?.at ?? 0
  auto.idle = mark === auto.seen ? auto.idle + 1 : 0; auto.seen = mark
  if (auto.idle >= 2 || ++auto.nudges > 40) { auto.on = false; return }
  const open = (board?.done ?? []).filter(d => !d.met).map(d => d.what)
  setTimeout(() => deliver(nextId(), `Auto is on (${Math.max(1, Math.round((auto.until - Date.now()) / 60000))} min left). Keep going without waiting for Carl.${open.length ? ` Not done yet: ${open.join('; ')}.` : ' Every condition is met: call finish, then send the end card.'} Park anything only they can decide.`, 'system'), 3000)
}
setInterval(() => { if (auto.on && Date.now() >= auto.until && !busy.on) autoNext() }, 30_000)

function deliver(id: string, text: string, from: 'carl' | 'home' | 'system' = 'carl'): void {
  if (from === 'carl') history.push({ type: 'msg', id, from: 'user', text, ts: Date.now() })
  // one tap on a suggested done condition (or his own) adds it to the board right away; the dog still hears it
  const add = from === 'carl' && board ? text.match(/^Add to done:\s*(.+)$/s)?.[1]?.trim() : undefined
  if (add && board) {
    board.done = [...(board.done ?? []), { what: short(add, 140), met: false }].slice(0, 8)
    board.done_ideas = (board.done_ideas ?? []).filter(x => x.toLowerCase() !== add.toLowerCase())
    board.at = Date.now(); saveBoard()
  }
  else if (from === 'home') broadcast({ type: 'msg', id, from: 'user', text: `From Home: ${text}`, ts: Date.now() })
  // the door's own task hand-offs are logged by the door as requests (and start a fresh plan); anything else Carl (or
  // Home) says is an answer. A check-in from Goddard OS isn't shown in the chat or logged as an answer.
  if (text.startsWith('New task')) plan = null
  else if (from === 'system') { systemTurn = true /* automatic check-in */ }
  else {
    note({ type: 'answer', from, text: text.slice(0, 600) })
    if (plan && !plan.approved && /^\s*(go|yes|ok|okay|approve|approved|looks good|do it)\b/i.test(text)) plan.approved = true
  }
  // typed text looks like someone at the terminal, so say where it came from and how to answer (a channel message
  // carries that on its own)
  if (BG) {
    const head = from === 'carl' ? '[GM! chat · from Carl on their phone. Answer them with the gm-chat reply tool, not here.]'
      : from === 'system' ? '[Goddard OS · automatic check-in, not from Carl. Anything for them goes through the gm-chat reply tool.]'
      : '[GM! chat · a note from Home. Answer with the gm-chat reply tool.]'
    void typeIntoSession(`${head} ${text}`); setBusy(true, from === 'carl' ? 'Reading your message' : from === 'system' ? 'Checking in on the studio' : 'Reading a note from Home'); return
  }
  void mcp.notification({
    method: 'notifications/claude/channel',
    params: {
      content: text,
      meta: { chat_id: 'web', message_id: id, user: from, ts: new Date().toISOString() },
    },
  })
  setBusy(true, from === 'carl' ? 'Reading your message' : 'Reading a note from Home')
}

// permission prompts from a background session arrive through its PermissionRequest hook (permit.ts), which waits here
const hookAsks = new Map<string, (b: 'allow' | 'deny' | 'timeout') => void>()

function answer(request_id: string, behavior: 'allow' | 'deny'): void {
  if (!openAsks.delete(request_id)) return
  note({ type: 'verdict', id: request_id, allow: behavior === 'allow' })
  const waiting = hookAsks.get(request_id)
  if (waiting) { hookAsks.delete(request_id); waiting(behavior); broadcast({ type: 'asked', request_id, behavior }); return }
  void mcp.notification({
    method: 'notifications/claude/channel/permission',
    params: { request_id, behavior },
  })
  broadcast({ type: 'asked', request_id, behavior })
}

Bun.serve({
  port: PORT,
  hostname: HOST,
  fetch(req, server) {
    const url = new URL(req.url)
    if (url.pathname === '/hook' && req.method === 'POST') {
      if (!isToken(req.headers.get('x-gm-chat'))) return new Response('no', { status: 401 })
      return req.json().then(
        h => { onHook(h ?? {}); return new Response('ok') },
        () => new Response('bad json', { status: 400 }),
      )
    }

    if (url.pathname === '/state') {
      if (!isToken(req.headers.get('x-gm-chat'))) return new Response('no', { status: 401 })
      if (busy.on && hooksSeen && Date.now() - lastHook > STALE_BUSY) setBusy(false)
      return Response.json({ port: PORT, name: NAME, server: ON, folder: process.cwd(), home: HOME, mode: MODE, busy: busy.on, doing: busy.text ?? '', needsYou: openAsks.size > 0 || (!!plan && plan.approved === false && !busy.on), last, plan, board, sessionMode: sessionMode(), auto: auto.on ? { until: auto.until } : undefined, slot: slot || undefined })
    }
    if (url.pathname === '/history') {
      if (!isToken(req.headers.get('x-gm-chat'))) return new Response('no', { status: 401 })
      const n = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 30)))
      const lines = history.flatMap(m =>
        m.type === 'msg' ? [`${m.from === 'user' ? 'Carl' : 'Claude'}: ${m.text}`] : m.type === 'step' ? [`  · ${m.text.replace(/^» /, '')}`] : [])
      return Response.json({ name: NAME, lines: lines.slice(-n) })
    }
    if (url.pathname === '/hook-ask' && req.method === 'POST') {
      if (!isToken(req.headers.get('x-gm-chat'))) return new Response('no', { status: 401 })
      return req.json().catch(() => ({})).then(({ tool, preview, description }: { tool?: string; preview?: string; description?: string }) => new Promise<Response>(done => {
        const request_id = 'h' + nextId()
        const ask: Wire = { type: 'ask', request_id, tool_name: String(tool ?? 'a tool'), description: description ? short(description, 160) : `${NAME === 'Home' ? 'Goddard' : NAME.replace(/^Agent slot · /, '')} wants to use ${tool}`, input_preview: String(preview ?? '').slice(0, 700) }
        openAsks.set(request_id, ask)
        note({ type: 'permission', id: request_id, tool: ask.tool_name, text: `${ask.description}: ${ask.input_preview}`.slice(0, 400) })
        broadcast(ask)
        const timer = setTimeout(() => { if (hookAsks.delete(request_id)) { openAsks.delete(request_id); broadcast({ type: 'asked', request_id, behavior: 'deny' }); done(Response.json({ behavior: 'timeout' })) } }, 20 * 60_000)
        hookAsks.set(request_id, b => { clearTimeout(timer); done(Response.json({ behavior: b })) })
      }))
    }
    // the door saved the board as a document: mark the session finished and show the output
    if (url.pathname === '/finished' && req.method === 'POST') {
      if (!isToken(req.headers.get('x-gm-chat'))) return new Response('no', { status: 401 })
      return req.json().catch(() => ({})).then(({ path, next }: { path?: string; next?: string }) => {
        if (!board || !path) return new Response('no board', { status: 400 })
        board.finished = { at: Date.now(), path, next: next || board.next }; if (board.done) for (const d of board.done) d.met = true
        board.now = board.phases.length; saveBoard()
        if (plan) plan.done = true
        broadcast({ type: 'msg', id: nextId(), from: 'assistant', text: `Done. The sheet is saved as a document:\n${path}${board.finished.next ? `\nNext: ${board.finished.next}` : ''}`, ts: Date.now() })
        last = { text: 'Replied', at: Date.now() }
        return Response.json({ ok: true })
      })
    }
    if (url.pathname === '/say' && req.method === 'POST') {
      if (!isToken(req.headers.get('x-gm-chat'))) return new Response('no', { status: 401 })
      return req.json().catch(() => ({})).then(({ text, from }: { text?: string; from?: string }) => {
        if (!text?.trim()) return new Response('empty', { status: 400 })
        deliver(nextId(), text.trim(), from === 'carl' ? 'carl' : from === 'system' ? 'system' : 'home')
        return Response.json({ ok: true })
      })
    }

    const locked = gate(req, url)
    if (locked) return locked

    if (url.pathname === '/ws') {
      if (server.upgrade(req)) return
      return new Response('upgrade failed', { status: 400 })
    }
    if (url.pathname === '/') {
      return new Response(HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    }
    return new Response('404', { status: 404 })
  },
  websocket: {
    open: ws => {
      clients.add(ws)
      for (const m of history) ws.send(JSON.stringify(m))
      for (const a of openAsks.values()) ws.send(JSON.stringify(a))
      ws.send(JSON.stringify({ type: 'busy', ...busy }))
    },
    close: ws => { clients.delete(ws) },
    message: (_, raw) => {
      try {
        const m = JSON.parse(String(raw)) as
          | { type?: 'say'; id: string; text: string }
          | { type: 'verdict'; request_id: string; behavior: 'allow' | 'deny' }
        if (m.type === 'verdict') {
          if (m.behavior === 'allow' || m.behavior === 'deny') answer(m.request_id, m.behavior)
          return
        }
        if (m.id && m.text?.trim()) deliver(m.id, m.text.trim())
      } catch {}
    },
  },
})

process.stderr.write(`gm-chat: thread "${NAME}" on :${PORT}, door ${DOOR}\n`)

const esc = (t: string) => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

const HTML = `${HEAD}
<title>GM! Claude</title>
<style>
header { position: sticky; top: 0; background: var(--paper); border-bottom: 1.5px dashed var(--line); padding: calc(10px + env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 10px max(16px, env(safe-area-inset-left)); display: flex; justify-content: space-between; align-items: center; z-index: 2 }
.logo { font-family: var(--display); font-size: 26px; letter-spacing: .02em }
.logo b { color: var(--gold); font-weight: 400 }
.lead { display: flex; align-items: center; gap: 12px }
.back { font-family: var(--mono); font-size: 13px; color: var(--ink); text-decoration: none; padding: 10px 0 }
.title { max-width: 720px; margin: 10px auto 0; padding: 0 max(16px, env(safe-area-inset-right)) 0 max(16px, env(safe-area-inset-left)); font-family: var(--mono); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted) }
.pill { font-family: var(--mono); font-size: 11px; letter-spacing: .06em; text-transform: uppercase; padding: 3px 9px; border-radius: 999px; border: 1px solid currentColor }
.pill.on { color: var(--ok) } .pill.off { color: var(--warn) }
#log { max-width: 720px; margin: 0 auto; padding: 16px max(16px, env(safe-area-inset-right)) 140px max(16px, env(safe-area-inset-left)); display: flex; flex-direction: column; gap: 10px }
.me { align-self: flex-end; background: var(--ink); color: var(--paper); border-radius: 16px 16px 3px 16px; padding: 9px 13px; max-width: 85%; white-space: pre-wrap; word-break: break-word }
.cl { align-self: flex-start; background: var(--card); border: 1.5px solid var(--ink); box-shadow: 3px 3px 0 var(--ink); border-radius: 4px; padding: 9px 13px; max-width: 90%; white-space: pre-wrap; word-break: break-word }
.ask { border: 2px solid var(--gold); background: var(--gold-soft); border-radius: 6px; padding: 12px; display: flex; flex-direction: column; gap: 8px; max-width: 100% }
.ask .tag { font-family: var(--mono); font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--warn) }
.ask code { font-family: var(--mono); font-size: 13px; background: var(--card); padding: 6px 8px; border-radius: 3px; display: block; white-space: pre-wrap; word-break: break-all; max-height: 10em; overflow: auto }
.btns { display: grid; grid-template-columns: 1fr 1fr; gap: 8px }
button { font-family: var(--display); font-size: 18px; letter-spacing: .04em; padding: 10px 0; border-radius: 4px; border: 1.5px solid var(--ink); background: var(--card); color: var(--ink); cursor: pointer }
button.yes { background: var(--ink); color: var(--paper) }
button:focus-visible, textarea:focus-visible { outline: 3px solid var(--gold); outline-offset: 2px }
.done { font-family: var(--mono); font-size: 12px; color: var(--muted) }
form { position: fixed; bottom: 0; left: 0; right: 0; background: var(--paper); border-top: 1.5px dashed var(--line); padding: 10px max(16px, env(safe-area-inset-right)) calc(12px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)) }
form div { max-width: 720px; margin: 0 auto; display: flex; gap: 10px; align-items: flex-end }
textarea { flex: 1; font: inherit; border: 1.5px solid var(--line); border-radius: 18px; padding: 9px 14px; background: var(--card); color: var(--ink); resize: none }
form button { width: 76px; background: var(--gold); color: #070707 }
.empty { color: var(--muted); text-align: center; margin-top: 18vh }
.work { align-self: flex-start; max-width: 90%; border-left: 2px solid var(--gold); padding: 2px 0 2px 10px; font-family: var(--mono); font-size: 12.5px; color: var(--muted) }
.work summary { cursor: pointer; list-style: none; letter-spacing: .08em; text-transform: uppercase; font-size: 11px; color: var(--gold) }
.work summary::-webkit-details-marker { display: none }
.work summary::before { content: '▸ ' } .work[open] summary::before { content: '▾ ' }
.work ol { margin: 4px 0 0; padding: 0; list-style: none }
.work li { padding: 1px 0; word-break: break-word }
.work li::before { content: '· '; color: var(--gold) }
.work li.note { color: var(--ink) }
.typing { align-self: flex-start; display: flex; align-items: center; gap: 10px; background: var(--card); border: 1.5px solid var(--ink); box-shadow: 3px 3px 0 var(--ink); border-radius: 4px; padding: 10px 13px; max-width: 90% }
.typing[hidden] { display: none }
.dots { display: flex; gap: 4px; flex: none }
.dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--gold); animation: hop 1.1s infinite ease-in-out }
.dots i:nth-child(2) { animation-delay: .15s } .dots i:nth-child(3) { animation-delay: .3s }
@keyframes hop { 0%, 60%, 100% { transform: translateY(0); opacity: .45 } 30% { transform: translateY(-5px); opacity: 1 } }
@media (prefers-reduced-motion: reduce) { .dots i { animation: none; opacity: .8 } }
.typing span { font-family: var(--mono); font-size: 12.5px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
</style>
<header><div class="lead"><a class="back" id="back" href="/">← Threads</a><div class="logo">GM<b>!</b> Claude</div></div><span id="st" class="pill off">connecting</span></header>
<div class="title">${esc(NAME)} · ${esc(ON)}</div>
<div id="log"><div class="empty" id="empty">Ask Claude anything. It runs on your Mac.</div><div class="typing" id="typing" hidden><div class="dots"><i></i><i></i><i></i></div><span id="doing"></span></div></div>
<form id="form"><div><textarea id="text" rows="1" placeholder="Ask Claude…" autocomplete="off"></textarea><button type="submit">SEND</button></div></form>
<script>
const log = document.getElementById('log'), input = document.getElementById('text'), st = document.getElementById('st')
document.getElementById('back').href = location.protocol + '//' + location.hostname + ':${DOOR_PORT}/'
const typing = document.getElementById('typing'), doing = document.getElementById('doing')
const msgs = {}, asks = {}
let ws, uid = 0, work = null
function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws')
  ws.onopen = () => { st.textContent = 'Mac · online'; st.className = 'pill on'; log.querySelectorAll('[data-id], .work').forEach(n => n.remove()); for (const k in msgs) delete msgs[k]; work = null }
  ws.onclose = () => { st.textContent = 'offline'; st.className = 'pill off'; setTimeout(connect, 2000) }
  ws.onmessage = e => {
    const m = JSON.parse(e.data)
    if (m.type === 'msg') add(m.id, m.from === 'user' ? 'me' : 'cl', m.text)
    if (m.type === 'edit' && msgs[m.id]) msgs[m.id].textContent = m.text
    if (m.type === 'ask') ask(m)
    if (m.type === 'asked') settle(m.request_id, m.behavior)
    if (m.type === 'step') step(m.text)
    if (m.type === 'done') finish()
    if (m.type === 'busy') { typing.hidden = !m.on; doing.textContent = m.text ? m.text + '…' : ''; place(typing) }
  }
}
// Keep the typing bubble last, and follow the newest line.
function place(d) {
  if (d !== typing) log.appendChild(d)
  log.appendChild(typing); scrollTo(0, document.body.scrollHeight)
}
function add(id, cls, text) {
  if (msgs[id]) return
  document.getElementById('empty')?.remove()
  const d = document.createElement('div'); d.className = cls; d.dataset.id = id; d.textContent = text
  msgs[id] = d; work = null; place(d)
}
// Steps for one stretch of work sit in one block; a reply starts a new block.
function step(text) {
  document.getElementById('empty')?.remove()
  if (!work) {
    const d = document.createElement('details'); d.className = 'work'; d.open = true
    d.append(document.createElement('summary'), document.createElement('ol'))
    work = d; place(d)
  }
  const li = document.createElement('li'); li.textContent = text
  if (text.startsWith('» ')) { li.className = 'note'; li.textContent = text.slice(2) }
  const ol = work.querySelector('ol'); ol.appendChild(li)
  work.querySelector('summary').textContent = 'Working · ' + ol.children.length + (ol.children.length === 1 ? ' step' : ' steps')
  place(work)
}
function finish() {
  log.querySelectorAll('details.work[open]').forEach(d => {
    const n = d.querySelector('ol').children.length
    d.querySelector('summary').textContent = '✓ ' + n + (n === 1 ? ' step' : ' steps'); d.open = false
  })
  work = null
}
function ask(m) {
  if (asks[m.request_id]) return
  document.getElementById('empty')?.remove()
  const d = document.createElement('div'); d.className = 'ask'
  const tag = document.createElement('div'); tag.className = 'tag'; tag.textContent = 'Claude wants to use ' + m.tool_name
  const what = document.createElement('div'); what.textContent = m.description
  d.append(tag, what)
  if (m.input_preview) { const c = document.createElement('code'); c.textContent = m.input_preview; d.append(c) }
  const b = document.createElement('div'); b.className = 'btns'
  const yes = document.createElement('button'); yes.className = 'yes'; yes.textContent = 'ALLOW'; yes.type = 'button'
  const no = document.createElement('button'); no.textContent = 'NO'; no.type = 'button'
  yes.onclick = () => ws.send(JSON.stringify({ type: 'verdict', request_id: m.request_id, behavior: 'allow' }))
  no.onclick = () => ws.send(JSON.stringify({ type: 'verdict', request_id: m.request_id, behavior: 'deny' }))
  b.append(yes, no); d.append(b)
  asks[m.request_id] = d; work = null; place(d)
}
function settle(id, behavior) {
  const d = asks[id]; if (!d) return
  const b = d.querySelector('.btns'); if (!b) return
  const done = document.createElement('div'); done.className = 'done'; done.textContent = behavior === 'allow' ? '✓ Allowed' : '✕ Said no'
  b.replaceWith(done)
}
document.getElementById('form').onsubmit = e => {
  e.preventDefault()
  const text = input.value.trim(); if (!text || ws.readyState !== 1) return
  input.value = ''
  const id = 'u' + Date.now() + '-' + (++uid)
  add(id, 'me', text)
  ws.send(JSON.stringify({ id, text }))
}
input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); document.getElementById('form').requestSubmit() } })
connect()
</script>`
