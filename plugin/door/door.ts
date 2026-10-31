#!/usr/bin/env bun
/**
 * gm-door: the GM! Claude front door. Lists every running gm-chat thread,
 * shows which of Carl's servers answer, and starts a new thread by opening
 * a real Claude Code window on the Mac (Terminal), never a hidden one.
 *
 * Started by the first gm-chat thread if it isn't running, and keeps going
 * after that thread closes. Settings: ~/.claude/channels/gm-chat/door.json.
 */

import { appendFileSync, chmodSync, mkdtempSync, copyFileSync, existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync, mkdirSync, realpathSync, statSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { basename, join, resolve } from 'path'
import { DOOR_PORT, HEAD, HOST, SESSIONS_DIR, STATE_DIR, TOKEN, gate, isToken, lanAddress } from './common'
import { profile, has, own, ownFile, mindDir, saveProfile, PROFILE_FILE, type Profile } from './profile'
import webpush from 'web-push'

const CONFIG_FILE = join(STATE_DIR, 'door.json')
const LAUNCH_DIR = join(STATE_DIR, 'launch')
// named dogs (Carl, 2026-10-28: "give the dog a complete system instructions role"): each one's role, as Carl approved it
const DOGS_DIR = join(STATE_DIR, 'dogs')
const dogSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'dog'

// the Claude sessions running in the background, as `claude agents` lists them
type BgSession = { id: string; name?: string; pid?: number; status?: string; startedAt?: number; sessionId?: string }
// the Claude Code command; tests set GM_CLAUDE to a stand-in that records each call and starts nothing
// resolved once to a full path, so a login shell's PATH can't swap in a different (older) claude for the dogs
const CLAUDE = process.env.GM_CLAUDE ?? Bun.which('claude') ?? 'claude'
async function bgSessions(): Promise<BgSession[]> {
  try {
    const all = JSON.parse(await new Response(Bun.spawn([CLAUDE, 'agents', '--json'], { stderr: 'ignore' }).stdout).text() || '[]') as (BgSession & { kind?: string })[]
    return all.filter(a => a.kind === 'background' && a.id && a.status && a.status !== 'stopped')
  } catch { return [] }
}
const stopBg = (id: string) => Bun.spawn([CLAUDE, 'stop', id], { stdout: 'ignore', stderr: 'ignore' }).exited
// stop the Claude session behind one gm-chat thread: its background session, or its window's process
async function stopThread(port: number) {
  const reg = JSON.parse(readFileSync(join(SESSIONS_DIR, `${port}.json`), 'utf8')) as { pid: number }
  const ppid = Number((await new Response(Bun.spawn(['ps', '-o', 'ppid=', '-p', String(reg.pid)]).stdout).text()).trim())
  const bgId = (await bgSessions()).find(a => a.pid === ppid)?.id
  if (bgId) await stopBg(bgId)
  else if (ppid > 1) process.kill(ppid, 'SIGTERM')
}

// what the door knows about a dog beyond its role: its name, its skill (if it has one) and Carl's line about its job
type DogMeta = { name: string; skill?: string; job?: string; session?: string }
const dogMeta = (name: string): DogMeta | null => { try { return JSON.parse(readFileSync(join(DOGS_DIR, dogSlug(name) + '.json'), 'utf8')) } catch { return null } }
const dogOf = (t: Thread) => t.name.match(/^Agent slot · (.+)$/)?.[1]?.trim() ?? null

// Carl's standing dogs, one session each with its skill as its role (Carl, 2026-10-28: "each session is a custom dog
// we just need one main chat that coordinates them")
const CORE_DOGS: { name: string; skill: string; job: string }[] = [
  { name: 'Scribbles', skill: 'gm-scribbles', job: 'the copywriter: writes each channel\'s copy in Carl\'s voice as drafts for their one tap' },
  { name: 'Fetch', skill: 'gm-fetch', job: 'the campaign strategist: brings Carl one campaign card to approve before Scribbles writes' },
  { name: 'Bloodhound', skill: 'gm-bloodhound', job: 'the Standup growth dog: makes The Standup from Carl\'s bits and runs one real A/B test per round' },
]
function coreRole(d: { name: string; skill: string; job: string }) {
  return [`# ${d.name}`, '', '## Who you are', `You are ${d.name}, a dog in Goddard's pack at the GM! Carl studio: ${d.job}.`, '',
    '## Your job', `Every job you get is a ${d.skill} job. Load the ${d.skill} skill with the Skill tool first and follow it exactly. It is your rulebook.`, '',
    '## How you work', '- Before step 1, post a plan of 3 to 7 steps with the gm-chat plan tool, then wait for Carl\'s Go.', '- Mark each step with the step tool as you start it.',
    '- Drafts first. Finals only after Carl\'s OK.', '- Report with the gm-chat reply tool. Keep it short.', '',
    '## Never', '- Nothing paid, public or live without Carl\'s clear OK.', '- Never message anyone but Carl.', '- Never invent facts, people, prices or dates.',
    '- Keep GM! work apart from Carl\'s day job.', '- No secrets in files.', '',
    '## Hand off', '- A job that belongs to another dog in the pack: say so, and Goddard (the main chat) passes it on.', ''].join('\n')
}
async function ensureCoreDogs(): Promise<string[]> {
  const have = new Set((await threads()).map(dogOf).filter(Boolean))
  const cfg = config(), server = cfg.servers[0]?.name ?? 'Mac mini', folder = cfg.folders.includes(mindDir()) ? mindDir() : cfg.folders[0]
  const woke: string[] = []
  for (const d of CORE_DOGS) {
    if (have.has(d.name)) continue
    await start(SLOT_BRIEF, server, folder, { bg: true, name: `${SLOT} · ${d.name}`, mode: 'creative', role: coreRole(d), skill: d.skill, job: d.job })
    woke.push(d.name)
  }
  return woke
}
// Watchdog (Carl, 2026-10-28: "build it", after the dogs stopped on their own and two Goddards ran at once): every two
// minutes, wake any dog that has a role on file but no running session (with that same role), start Goddard if it's
// gone, and stop doubles: two sessions under one name keep only the newest. A session that never checked in is stopped
// before its replacement starts. Nothing here is visible to Carl except the log.
const waking = new Map<string, number>() // name -> when we last started it
async function watchdog() {
  // nothing wakes until Setup is saved, so a new install never starts a session on its own (GM_NO_WATCHDOG=1 turns it off for tests)
  if (!existsSync(PROFILE_FILE) || process.env.GM_NO_WATCHDOG) return
  const list = await threads(), bg = await bgSessions()
  const regOf = (port: number) => { try { return JSON.parse(readFileSync(join(SESSIONS_DIR, `${port}.json`), 'utf8')) as { started?: number } } catch { return {} } }
  // doubles
  const groups = new Map<string, Thread[]>()
  for (const t of list) { const k = t.home ? 'Home' : dogOf(t); if (k) groups.set(k, [...(groups.get(k) ?? []), t]) }
  for (const [name, ts] of groups) if (ts.length > 1) {
    const keep = ts.sort((a, b) => (regOf(b.port).started ?? 0) - (regOf(a.port).started ?? 0))[0]
    for (const t of ts) if (t !== keep && !t.busy) { await stopThread(t.port).catch(() => {}); log(`watchdog: stopped a second ${name} on :${t.port}`) }
  }
  // remember each dog's conversation, so a dog the watchdog wakes again picks up its own thread (Carl, 2026-10-29:
  // "don't lose thread")
  for (const a of bg) {
    const dog = a.name?.match(/^Agent slot · (.+)$/)?.[1]; if (!dog || !a.sessionId) continue
    const f = join(DOGS_DIR, dogSlug(dog) + '.json')
    try { const m = JSON.parse(readFileSync(f, 'utf8')); if (m.session !== a.sessionId) writeFileSync(f, JSON.stringify({ ...m, session: a.sessionId }) + '\n', { mode: 0o600 }) } catch {}
  }
  // and each session's, next to its board, so a session from Hop into reopens its own conversation (Carl, 2026-10-29:
  // "when i click on my previous threads it wont open back up")
  for (const a of bg) {
    if (!a.name?.startsWith('Session · ') || !a.sessionId) continue
    const f = join(STATE_DIR, 'boards', boardSlug(a.name) + '.session')
    try { if (!existsSync(f) || readFileSync(f, 'utf8').trim() !== a.sessionId) writeFileSync(f, a.sessionId + '\n', { mode: 0o600 }) } catch {}
  }
  const recently = (n: string) => Date.now() - (waking.get(n) ?? 0) < 3 * 60_000
  const unregistered = (sessionName: string) => bg.filter(a => a.name === sessionName && (a.startedAt ?? 0) < Date.now() - 3 * 60_000)
  // Goddard
  if (!groups.has('Home') && !recently('Home')) {
    for (const a of unregistered('Home')) await stopBg(a.id)
    waking.set('Home', Date.now())
    await startHome(true).then(() => log('watchdog: Goddard was down, started it'), e => log(`watchdog: couldn't start Goddard: ${(e as Error).message}`))
  }
  // dogs with a role on file
  let files: string[] = []
  try { files = readdirSync(DOGS_DIR).filter(f => f.endsWith('.json')) } catch {}
  const cfg = config(), server = cfg.servers[0]?.name ?? 'Mac mini', folder = cfg.folders.includes(mindDir()) ? mindDir() : cfg.folders[0]
  for (const f of files) {
    const meta = (() => { try { return JSON.parse(readFileSync(join(DOGS_DIR, f), 'utf8')) as DogMeta } catch { return null } })()
    if (!meta?.name || groups.has(meta.name) || recently(meta.name)) continue
    let role = ''
    try { role = readFileSync(join(DOGS_DIR, f.replace(/\.json$/, '.md')), 'utf8') } catch {}
    const core = CORE_DOGS.find(d => d.name === meta.name)
    if (!role && core) role = coreRole(core)
    if (!role) continue
    for (const a of unregistered(`${SLOT} · ${meta.name}`)) await stopBg(a.id)
    waking.set(meta.name, Date.now())
    const resume = meta.session && existsSync(join(homedir(), '.claude', 'projects', home(folder).replace(/[/.]/g, '-'), `${meta.session}.jsonl`)) ? meta.session : undefined
    await start(resume ? 'Goddard OS woke you again. Same conversation, same role. Do not reply now; wait quietly for your next task.' : SLOT_BRIEF, server, folder,
      { bg: true, name: `${SLOT} · ${meta.name}`, mode: 'creative', role, skill: meta.skill, job: meta.job, resume })
      .then(() => log(`watchdog: ${meta.name} was down, woke it`), e => log(`watchdog: couldn't wake ${meta.name}: ${(e as Error).message}`))
  }
}
// first look 30 seconds after start, then every two minutes (tests shorten both with GM_WATCHDOG_MS)
const WD_MS = Number(process.env.GM_WATCHDOG_MS ?? 0)
setTimeout(() => { watchdog().catch(() => {}); setInterval(() => { watchdog().catch(() => {}) }, WD_MS || 2 * 60_000) }, WD_MS || 30_000)

// one setup step's "Test it": a plain yes or no, and what was checked, in words
async function testPart(part: string, v: Record<string, string>): Promise<{ ok: boolean; said: string }> {
  const run = async (cmd: string[], ms: number) => { try { const p = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' }); const t = setTimeout(() => p.kill(), ms); const out = await new Response(p.stdout).text(); clearTimeout(t); return { code: await p.exited, out: out.trim() } } catch (e) { return { code: 1, out: (e as Error).message } } }
  if (part === 'mac') {
    const missing = [CLAUDE, 'bun'].filter(x => !Bun.which(x)).map(x => x === CLAUDE ? 'claude' : x)
    return missing.length ? { ok: false, said: `Not found on this Mac: ${missing.join(', ')}` } : { ok: true, said: 'Claude Code and Bun are both here.' }
  }
  if (part === 'memory' || part === 'bigDrive') {
    const path = home(String(v.path ?? ''))
    return existsSync(path) ? { ok: true, said: `Found ${v.path}.` } : { ok: false, said: `${v.path || 'That folder'} isn't on this Mac${part === 'bigDrive' ? ' right now (is the drive plugged in?)' : ''}.` }
  }
  if (part === 'dogComputer') {
    if (v.kind === 'this-mac') return { ok: true, said: 'The dogs will use a browser on this Mac.' }
    if (!/^[\w.-]+@[\w.-]+$/.test(String(v.host ?? ''))) return { ok: false, said: 'The host should look like user@address.' }
    const r = await run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', String(v.host), 'test -x /root/dogbox.sh && /root/dogbox.sh status || echo reachable'], 20_000)
    return r.code === 0 ? { ok: true, said: `Reached ${v.host}: ${r.out.split('\n')[0].slice(0, 120)}` } : { ok: false, said: `Couldn't reach ${v.host} over SSH with this Mac's key.` }
  }
  if (part === 'helper') {
    try { await fetch(String(v.bus), { signal: AbortSignal.timeout(4000) }); return { ok: true, said: `The helper answered at ${v.bus}.` } }
    catch { return { ok: false, said: `Nothing answered at ${v.bus || 'that address'}.` } }
  }
  if (part === 'pings') {
    const n = pushState().subs.length
    return n ? { ok: true, said: `${n} phone${n === 1 ? ' is' : 's are'} signed up for pings.` } : { ok: false, said: 'No phone is signed up yet. Open this app on your phone and turn pings on there.' }
  }
  return { ok: false, said: 'Nothing to test for that step.' }
}

const SLOT_BRIEF = 'Agent slot. You are a standing agent for Goddard OS. Do not reply now; wait quietly. Tasks will arrive as messages.'

// Goddard drafts a dog's role from Carl's name and one line about its job; Carl reads and edits it before the dog wakes
async function draftRole(name: string, job: string): Promise<string> {
  const ask = [
    `Write the system instructions for a new agent dog in Carl's GM! Carl studio. Its name is "${name}". Carl says its job is: "${job}".`,
    'It runs as a background Claude Code agent on Carl\'s Mac mini, takes jobs from Carl through Goddard OS, and answers with the gm-chat reply tool.',
    'Use these sections, in plain, short sentences a person can check at a glance:',
    `# ${name}`, '## Who you are (one or two lines: a dog in Goddard\'s pack, what it is for)', '## Your job (what it does, built only from Carl\'s words above; do not add duties they did not mention)',
    '## How you work (always: post a 3 to 7 step plan with the gm-chat plan tool and wait for Carl\'s Go before step 1; mark steps as you go; drafts first, finals after their OK; report with the gm-chat reply tool)',
    '## Never (nothing paid, public or live without Carl\'s clear OK; never message anyone but Carl; never invent facts, people, prices or dates; keep GM! work apart from their day job; no secrets in files)',
    '## Hand off (when a job belongs to Scribbles the copywriter, Fetch the strategist or Bloodhound the Standup growth dog, say so instead of doing it)',
    'Do not invent a backstory, catchphrases or personality details beyond being a loyal, quick dog. Output only the markdown, nothing before or after it.',
  ].join('\n')
  const p = Bun.spawn([CLAUDE, '-p', '--model', 'sonnet', '--disallowedTools', 'Bash', 'Edit', 'Write', 'Agent', '--', ask], { cwd: home(mindDir()), stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => p.kill(), 150_000)
  const out = await new Response(p.stdout).text(); clearTimeout(timer)
  if ((await p.exited) !== 0 || !out.trim()) throw new Error("couldn't draft the role this time")
  return out.trim().replace(/^```(?:markdown)?\n|\n```$/g, '').slice(0, 8000)
}
// the back-end scoping pass on a session's first message (Carl, 2026-10-29: "my first prompt should go through a back end
// prompt to ensure my prompt is properly scoped"). It tightens what he said; it never adds ideas of its own.
type Scope = { title: string; thing: string; outcome: string; done_looks_like: string[]; not_now: string[]; unclear: string }
async function scopeFirst(text: string): Promise<Scope | null> {
  const ask = [
    'You scope the first message of a working session for Carl (GM! Carl studio). Read their message and return ONLY a JSON object:',
    '{"title": "2 to 5 words naming the work, from their words, max 30 characters",',
    ' "thing": "what they brought or are working on, in their words, one sentence",',
    ' "outcome": "what they want out of this session, in their words, one sentence; empty if they did not say",',
    ' "done_looks_like": ["1 to 3 checkable signs this session is done, only ones their message supports"],',
    ' "not_now": ["0 to 2 nearby things this session should NOT expand into, only when their message makes the edge clear"],',
    ' "unclear": "the single most important question if the scope is unclear, else empty"}',
    'Rules: never add ideas, story, characters, features or art direction they did not give. Keep file paths and links exactly. If the message is one line, keep the scope small. No text outside the JSON.',
    '', 'Their message:', text.slice(0, 6000),
  ].join('\n')
  try {
    const p = Bun.spawn([CLAUDE, '-p', '--model', 'haiku', '--disallowedTools', 'Bash', 'Edit', 'Write', 'Agent', 'WebFetch', 'WebSearch', '--', ask], { cwd: home(mindDir()), stdout: 'pipe', stderr: 'ignore' })
    const timer = setTimeout(() => p.kill(), 60_000)
    const out = await new Response(p.stdout).text(); clearTimeout(timer)
    const j = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)) as Scope
    const list = (v: unknown, n: number) => (Array.isArray(v) ? v : []).map(x => String(x).trim()).filter(Boolean).slice(0, n)
    return { title: String(j.title ?? '').trim(), thing: String(j.thing ?? '').trim(), outcome: String(j.outcome ?? '').trim(), done_looks_like: list(j.done_looks_like, 3), not_now: list(j.not_now, 2), unclear: String(j.unclear ?? '').trim() }
  } catch { return null }
}

const HERE = import.meta.dir
mkdirSync(LAUNCH_DIR, { recursive: true, mode: 0o700 })

type Box = { name: string; ssh?: string }
type Config = { servers: Box[]; folders: string[]; home: { folder: string } }

// First run writes the defaults; Carl edits the file to change the lists.
// A new install starts with this Mac, the dog computer's host when it has one, and its memory folder; the setup (or
// the owner) adds the rest. An install that already has door.json keeps its own lists.
const DEFAULTS: Config = {
  servers: [{ name: 'Mac mini' }, ...(profile().dogComputer?.on && profile().dogComputer?.host ? [{ name: 'Dog computer host', ssh: profile().dogComputer!.host! }] : [])],
  folders: [profile().memory?.on ? profile().memory!.path : '~'],
  // The Home thread: Carl's one always-open conversation, with Goddard on hand.
  home: { folder: profile().memory?.on ? profile().memory!.path : '~' },
}
if (!existsSync(CONFIG_FILE)) writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULTS, null, 2) + '\n', { mode: 0o600 })
const config = (): Config => {
  try { return { ...DEFAULTS, ...JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) } } catch { return DEFAULTS }
}

const home = (p: string) => p.replace(/^~(?=\/|$)/, homedir())
const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

// --- threads -------------------------------------------------------------

type Thread = { port: number; home?: boolean; name: string; server: string; folder: string; mode?: Mode; busy: boolean; doing: string; needsYou: boolean; last: { text: string; at: number } }

const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }

async function threads(): Promise<Thread[]> {
  const out: Thread[] = []
  for (const f of readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'))) {
    const file = join(SESSIONS_DIR, f)
    let reg: { port: number; pid: number }
    try { reg = JSON.parse(readFileSync(file, 'utf8')) } catch { continue }
    if (!alive(reg.pid)) { try { unlinkSync(file) } catch {} continue }
    try {
      const r = await fetch(`http://127.0.0.1:${reg.port}/state`, { headers: { 'x-gm-chat': TOKEN }, signal: AbortSignal.timeout(1500) })
      if (r.ok) out.push(await r.json())
    } catch {}
  }
  // Needs you first, then working, then the most recent.
  const rank = (t: Thread) => (t.home ? -1 : t.needsYou ? 0 : t.busy ? 1 : 2)
  return out.sort((a, b) => rank(a) - rank(b) || b.last.at - a.last.at)
}

// --- servers -------------------------------------------------------------

const seen = new Map<string, { up: boolean; at: number }>()

function sshUp(target: string): Promise<boolean> {
  const host = target.split('@').pop()!
  return new Promise(done => {
    const timer = setTimeout(() => done(false), 1500)
    Bun.connect({
      hostname: host,
      port: 22,
      socket: {
        open(s) { clearTimeout(timer); s.end(); done(true) },
        data() {},
        error() { clearTimeout(timer); done(false) },
        connectError() { clearTimeout(timer); done(false) },
      },
    }).catch(() => { clearTimeout(timer); done(false) })
  })
}

async function servers() {
  return Promise.all(config().servers.map(async b => {
    if (!b.ssh) return { name: b.name, up: true }
    const hit = seen.get(b.ssh)
    if (hit && Date.now() - hit.at < 15000) return { name: b.name, up: hit.up }
    const up = await sshUp(b.ssh)
    seen.set(b.ssh, { up, at: Date.now() })
    return { name: b.name, up }
  }))
}

// --- new thread ----------------------------------------------------------

// A new window only takes its port once Carl has said yes in it, so hold each port we hand out
// for a while; otherwise several windows opened together all get the same one.
const handedOut = new Map<number, number>()
const HOLD_MS = 20 * 60 * 1000

async function freePort(): Promise<number> {
  const taken = new Set(readdirSync(SESSIONS_DIR).map(f => Number(f.split('.')[0])))
  for (let p = DOOR_PORT + 1; p < DOOR_PORT + 60; p++) {
    if (taken.has(p) || Date.now() - (handedOut.get(p) ?? 0) < HOLD_MS) continue
    try { Bun.serve({ port: p, hostname: HOST, fetch: () => new Response() }).stop(true); handedOut.set(p, Date.now()); return p } catch {}
  }
  throw new Error('no free port')
}

type Launch = { dir: string; name: string; env: Record<string, string>; args: string[]; bg?: boolean }

// Writes a .command file and opens it, so Terminal shows a normal Claude
// window Carl can see, answer and close on the Mac.
// the same file name the thread's server gives its board (server.ts boardFile)
const boardSlug = (name: string) => name.replace(/[^\w-]+/g, '-').slice(0, 60)
// each session keeps the mode it started in (Carl, 2026-10-30): plan, talk or do, in a file next to its board
type SessionMode = 'plan' | 'talk' | 'do'
const MODE_ROLE: Record<SessionMode, string> = { plan: 'session.md', talk: 'talk.md', do: 'do.md' }
const MODE_NAME: Record<SessionMode, string> = { plan: 'Plan it', talk: 'Just talk', do: 'Just do it' }
const asMode = (m: unknown): SessionMode | null => m === 'plan' || m === 'talk' || m === 'do' ? m : null
const modeFile = (name: string) => join(STATE_DIR, 'boards', boardSlug(name) + '.mode')
const modeOf = (name: string): SessionMode => { try { return asMode(readFileSync(modeFile(name), 'utf8').trim()) ?? 'plan' } catch { return 'plan' } }
const setMode = (name: string, m: SessionMode) => { mkdirSync(join(STATE_DIR, 'boards'), { recursive: true }); writeFileSync(modeFile(name), m + '\n', { mode: 0o600 }) }
const modeRole = (m: SessionMode) => join(HERE, MODE_ROLE[m])
// a session's conversation: the id the watchdog wrote down, else the transcript whose system tool set up this board
function sessionIdFor(name: string, board: SessionBoard, folder: string): string | undefined {
  const dir = join(homedir(), '.claude', 'projects', home(folder).replace(/[/.]/g, '-'))
  const ok = (id: string) => /^[0-9a-f-]{36}$/.test(id) && existsSync(join(dir, `${id}.jsonl`))
  try { const id = readFileSync(join(STATE_DIR, 'boards', boardSlug(name) + '.session'), 'utf8').trim(); if (ok(id)) return id } catch {}
  const needle = JSON.stringify(board.artifact).slice(1, -1).slice(0, 80)
  try {
    const hits = readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => join(dir, f)).filter(f => Date.now() - statSync(f).mtimeMs < 30 * 86400_000)
      .filter(f => { const t = readFileSync(f, 'utf8'); return t.includes('New session. Here is what Carl brought') && t.includes('mcp__gm-chat__system') && t.includes(needle) })
      .sort((x, y) => statSync(y).mtimeMs - statSync(x).mtimeMs)
    const id = hits[0] && basename(hits[0], '.jsonl')
    if (id && ok(id)) { writeFileSync(join(STATE_DIR, 'boards', boardSlug(name) + '.session'), id + '\n', { mode: 0o600 }); return id }
  } catch {}
}

async function launch(port: number, { dir, name, env, args, bg }: Launch, resume?: { id: string }): Promise<string> {
  // every key set every time: a background session can start from a pre-warmed process that still carries another
  // dog's environment, so a key left out could leak in from it (Home once showed a slot's first message)
  const all = { GM_CHAT_FIRST: '', GM_CHAT_AUTO_UNTIL: '', GM_CHAT_MODE: '', GM_CHAT_HOME: '', GM_CHAT_BG: '', GM_CHAT_PORT: String(port), GM_CHAT_NAME: name, ...env, ...(bg ? { GM_CHAT_BG: '1' } : {}) }
  const mcp = join(LAUNCH_DIR, `${port}-mcp.json`)
  writeFileSync(mcp, JSON.stringify({ mcpServers: { 'gm-chat': { command: 'bun', args: [join(HERE, 'server.ts')], env: all } } }, null, 2), { mode: 0o600 })
  // one hooks file per dog, with its port written in: a background session can run in a pre-warmed process whose
  // environment belongs to another dog, so GM_CHAT_PORT can't be trusted there (Home's steps once went to Scribbles)
  const hooks = join(LAUNCH_DIR, `${port}-hooks.json`)
  const hook = { hooks: [{ type: 'command', command: `GM_CHAT_PORT=${port} sh ${sh(join(HERE, 'hook.sh'))}` }] }
  const guard = { hooks: [{ type: 'command', command: `GODDARD_LACIE=${sh(LACIE)} bun ${sh(join(HERE, 'lacie-guard.ts'))}` }] } // the owner's own drive, from their profile
  // a background dog has no window for permission prompts: they go to Carl's page as Allow / No instead
  const permit = { hooks: [{ type: 'command', timeout: 1300, command: `GM_CHAT_PORT=${port} GM_CHAT_NAME=${sh(name)} bun ${sh(join(HERE, 'permit.ts'))}` }] }
  // Go-live gate and save points (Carl, 2026-10-29): live actions stop for his card; repos get a save point first
  const ship = { hooks: [{ type: 'command', timeout: 1300, command: `GM_CHAT_PORT=${port} GM_CHAT_NAME=${sh(name)} bun ${sh(join(HERE, 'ship-gate.ts'))}` }] }
  const save = { hooks: [{ type: 'command', timeout: 40, command: `GM_CHAT_PORT=${port} GM_CHAT_NAME=${sh(name)} bun ${sh(join(HERE, 'savepoint.ts'))}` }] }
  const gates = name === 'Home' ? [] : [{ matcher: 'Bash|mcp__.*', ...ship }, { matcher: 'Write|Edit|MultiEdit|NotebookEdit|Bash', ...save }]
  writeFileSync(hooks, JSON.stringify({ hooks: { UserPromptSubmit: [hook], PreToolUse: [{ matcher: '*', ...hook }, { matcher: 'Write|Edit|MultiEdit|NotebookEdit|Bash', ...guard }, ...gates], PostToolUse: [{ matcher: 'Write|Edit|MultiEdit|NotebookEdit|Artifact', ...hook }], Stop: [hook], ...(bg ? { PermissionRequest: [{ matcher: '*', ...permit }] } : {}) } }, null, 2), { mode: 0o600 })

  // every thread can read and write Carl's LaCie drive; deleting or overwriting there asks him first (lacie-guard.ts)
  const lacie = existsSync(LACIE) ? ['--add-dir', LACIE] : []
  // Carl's call (2026-10-27): every thread runs in auto mode, so dogs don't stop for routine yes/no; its own safety check
  // still blocks risky steps, and the LaCie guard still asks him about deletes and overwrites
  // a background dog loads gm-chat as a plain tool server (no development-channel prompt to answer); its messages are
  // typed into its session instead (server.ts, GM_CHAT_BG)
  // the owner's name goes into every prompt and instructions file (profile.ts own)
  const owned = args.map((a, i) => args[i - 1] === '--append-system-prompt-file' ? ownFile(a, LAUNCH_DIR) : own(a))
  const claude = [CLAUDE, ...(bg ? [] : ['--dangerously-load-development-channels', 'server:gm-chat']), '--mcp-config', mcp, '--settings', hooks, '--permission-mode', process.env.GM_PERMISSION_MODE ?? 'auto', ...lacie, ...(bg ? ['--bg'] : []), '-n', name, ...owned].map(sh).join(' ')
  const script = join(LAUNCH_DIR, `${port}.command`)
  writeFileSync(script, [
    '#!/bin/zsh -l',
    `# GM! thread "${name.replace(/\n/g, ' ')}" on port ${port}, started from the front door.`,
    `cd ${sh(dir)} || exit 1`,
    // each dog is its own session, not one nested inside whatever Claude Code session started Goddard OS
    'unset CLAUDECODE',
    ...Object.entries(all).map(([k, v]) => `export ${k}=${sh(v)}`),
    // resume: Home's own conversation by its id, never "the newest one in the folder" (--continue would
    // pick up any other Claude session that ran in ~/gm-mind). First start creates it with that id.
    resume
      ? `if ls "$HOME/.claude/projects/$(pwd | sed 's#[/.]#-#g')"/${resume.id}.jsonl >/dev/null 2>&1; then exec ${claude} --resume ${sh(resume.id)}; else exec ${claude} --session-id ${sh(resume.id)}; fi`
      : `exec ${claude}`,
    '',
  ].join('\n'), { mode: 0o700 })
  chmodSync(script, 0o700)

  // background (Carl 2026-10-27, trying one): `claude --bg` with the same setup, no Terminal window; it prints the
  // session id that `claude agents`, `attach`, `logs`, `stop` and `--resume <id> --bg` take
  if (bg) {
    const p = Bun.spawn(['/bin/zsh', '-l', script], { stdio: ['ignore', 'pipe', 'pipe'] })
    const [out, err] = [await new Response(p.stdout).text(), await new Response(p.stderr).text()]
    if ((await p.exited) !== 0) throw new Error(`couldn't start in the background: ${(err || out).trim().slice(0, 300)}`)
    return (out + err).trim()
  }
  const opener = process.env.GM_DOOR_OPEN ?? 'open'
  const p = Bun.spawn([opener, script], { stdio: ['ignore', 'ignore', 'pipe'] })
  if ((await p.exited) !== 0) throw new Error(`couldn't open Terminal: ${await new Response(p.stderr).text()}`)
  return ''
}

async function start(what: string, serverName: string, folder: string, opts: { bg?: boolean; name?: string; mode?: Mode; role?: string; roleFile?: string; skill?: string; job?: string; resume?: string; env?: Record<string, string> } = {}): Promise<string> {
  const cfg = config()
  const box = cfg.servers.find(b => b.name === serverName)
  if (!box) throw new Error('unknown server')
  if (!cfg.folders.includes(folder)) throw new Error('unknown folder')
  const dir = home(folder)
  if (!existsSync(dir)) throw new Error(`${folder} isn't on the Mac`)
  const name = (opts.name ?? what).replace(/\s+/g, ' ').trim().slice(0, 48)
  const prompt = box.ssh
    ? `${what}\n\n(Carl sent this from the GM! chat page. This thread works on ${box.name}: reach it with ssh ${box.ssh}. Answer them with the gm-chat reply tool.)`
    : `${what}\n\n(Carl sent this from the GM! chat page. Answer them with the gm-chat reply tool.)`
  // standing agent slots live long and take many tasks: let Claude Code compact them early, on its own
  // (a "/compact" sent through the channel only arrives as chat text, so it can't be triggered from here)
  const slotEnv = name.startsWith('Agent slot') ? { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: process.env.GM_SLOT_COMPACT_PCT ?? '40' } : {}
  // a Creative or Best slot runs that lane's model, with Haiku when it's overloaded (Carl's router picks, 2026-10-27)
  const lane = opts.mode && opts.mode !== 'cheap' ? opts.mode : undefined
  const model = lane ? ['--model', MODELS[lane], '--fallback-model', 'haiku'] : []
  // a named dog carries the role Carl approved, as its own system instructions
  let role: string[] = []
  if (opts.role?.trim()) {
    mkdirSync(DOGS_DIR, { recursive: true })
    const file = join(DOGS_DIR, dogSlug(name.replace(/^Agent slot · /, '')) + '.md')
    writeFileSync(file, opts.role.trim().slice(0, 8000) + '\n', { mode: 0o600 })
    const dog = name.replace(/^Agent slot · /, '')
    const keep = (() => { try { return JSON.parse(readFileSync(file.replace(/\.md$/, '.json'), 'utf8')).session as string | undefined } catch { return undefined } })()
    writeFileSync(file.replace(/\.md$/, '.json'), JSON.stringify({ name: dog, ...(opts.skill ? { skill: opts.skill } : {}), ...(opts.job ? { job: opts.job.slice(0, 400) } : {}), ...(keep ? { session: keep } : {}) }) + '\n', { mode: 0o600 })
    role = ['--append-system-prompt-file', file]
  } else if (opts.roleFile) role = ['--append-system-prompt-file', opts.roleFile]
  const out = await launch(await freePort(), { dir, name, env: { GM_CHAT_SERVER: box.name, GM_CHAT_FIRST: what, ...slotEnv, ...(lane ? { GM_CHAT_MODE: lane } : {}), ...(opts.env ?? {}) }, args: [...model, ...role, prompt], bg: opts.bg }, opts.resume ? { id: opts.resume } : undefined)
  return opts.bg ? `${name} (background ${out.match(/backgrounded · (\w+)/)?.[1] ?? 'session'})` : name
}

// Home keeps one conversation of its own, remembered by id in the state folder.
function homeSessionId(): string {
  const file = join(STATE_DIR, 'home-session')
  if (!existsSync(file)) writeFileSync(file, crypto.randomUUID() + '\n', { mode: 0o600 })
  return readFileSync(file, 'utf8').trim()
}

// Home picks up its own last conversation when there is one.
async function startHome(bg = true): Promise<string> {
  if ((await threads()).some(t => t.home)) throw new Error('Home is already open')
  // only one Goddard: a background Home that never checked in is stopped before a new one starts
  for (const a of await bgSessions()) if (a.name === 'Home') await stopBg(a.id)
  const dir = home(config().home.folder)
  if (!existsSync(dir)) throw new Error(`${config().home.folder} isn't on the Mac`)
  await launch(await freePort(), {
    dir, name: 'Home', env: { GM_CHAT_HOME: '1', GM_CHAT_SERVER: 'Mac mini' },
    // no built-in helpers for Home: its helpers are the visible agent slots (task_start), so Carl can see and steer them
    // Home runs in the background too (no window, no yes to answer), picking up its own conversation
    // and no web: research is a dog's job, so Home hands it over instead of doing it (Carl, 2026-10-28)
    args: ['--append-system-prompt-file', join(HERE, 'home.md'), '--disallowedTools', 'Agent', 'Task', 'WebSearch', 'WebFetch',
      ...(bg ? ['Goddard OS restarted you. Your instructions may have changed; follow them from now on. Do not reply now; wait for Carl.'] : [])],
    bg,
  }, { id: homeSessionId() })
  return 'Home'
}


// --- tasks: one shared board for Goddard OS and Home --------------------------
// A task is one skill + brief given to one agent slot. Goddard OS and Home both start them here,
// so the board, the colony and Talk all see the same list.

type Task = {
  id: string; skill: string; brief: string; parent?: string; by: 'carl' | 'home'
  port: number | null; status: 'queued' | 'active' | 'done' | 'lost'; at: number; doneAt?: number
  result?: string // the agent's last answer, kept so the task stays readable after the slot moves on
  want?: number   // a particular slot asked for (it waits for that one)
  dog?: string    // the dog that took it, so the job follows that dog when it restarts on a new port
  mode?: Mode     // the router lane picked for it, and why (shown on the task card)
  why?: string
  ran?: string    // what it actually ran on, when that differs from the lane ("Best: no Creative slot open")
  thread?: string // a Cheap task's thread on the GM! Bus
}
// --- the one next move (Carl, 2026-10-28: the flow feels off) --------------------------------------------------
// After the dogs (Goddard OS checks those first: one that needs Carl, then one that's back), this is the next real dated
// thing: an approved campaign whose posts aren't written yet, else the nearest dated step in goals.md. Real data only.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
function dateIn(text: string): Date | null {
  const m = text.match(/\b(?:mon|tue|wed|thu|fri|sat|sun)\w*,?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+(\d{1,2})\b/i)
    ?? text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+(\d{1,2})\b/i)
  if (!m) return null
  const now = new Date(), d = new Date(now.getFullYear(), MONTHS.indexOf(m[1].toLowerCase()), Number(m[2]), 23, 59)
  return d
}
const daysTo = (d: Date) => Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(new Date().toDateString()).getTime()) / 864e5)
const inDays = (n: number) => n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`
function nextMove() {
  const tasks = loadTasks()
  // an approved Fetch plan with a key date still ahead, and no Scribbles run for it yet
  try {
    const dir = join(LIBRARY_DIR, 'campaigns')
    const plans = existsSync(dir) ? readdirSync(dir).map(n => join(dir, n, 'plan.md')).filter(existsSync) : []
    const open = plans.map(path => {
      const text = readFileSync(path, 'utf8')
      const key = text.split('\n').find(l => /key date/i.test(l)) ?? ''
      const when = dateIn(key) ?? dateIn(text)
      const title = (text.match(/^#\s*Campaign:\s*(.+)$/m)?.[1] ?? 'campaign').trim()
      return { path, text, when, title }
    }).filter(p => /approved by carl/i.test(p.text) && p.when && daysTo(p.when) >= 0)
      .filter(p => !tasks.some(t => t.skill === 'gm-scribbles' && t.brief.includes(p.path)))
      .sort((a, b) => a.when!.getTime() - b.when!.getTime())
    if (open[0]) {
      const p = open[0], n = daysTo(p.when!)
      return { kind: 'campaign', title: `Write the posts for ${p.title}`, why: `${p.title.split(',')[0]} is ${inDays(n)}. Fetch's plan is approved; the posts aren't written yet.`,
        action: { label: 'Start Scribbles', skill: 'gm-scribbles', brief: `Write for the approved plan at ${p.path}` } }
    }
  } catch {}
  // else the nearest dated step in Carl's goals
  try {
    const goals = readFileSync(join(home(mindDir()), 'memory', 'goals.md'), 'utf8')
    const steps = goals.split('\n').filter(l => /^- \[ \]/.test(l)).map(l => ({ text: l.replace(/^- \[ \]\s*/, ''), when: dateIn(l) }))
      .filter(x => x.when && daysTo(x.when) >= 0).sort((a, b) => a.when!.getTime() - b.when!.getTime())
    if (steps[0]) {
      const x = steps[0], n = daysTo(x.when!)
      return { kind: 'goal', title: x.text.split('·')[0].trim(), why: `${x.text.replace(/\s*·\s*/g, ' · ')}: ${inDays(n)}, and nothing is planned for it yet.`,
        action: { label: 'Ask Fetch for a plan', skill: 'gm-fetch', brief: `Plan a campaign for: ${x.text}` } }
    }
  } catch {}
  return { kind: 'clear', title: 'All clear', why: 'Nothing needs you, and nothing dated is coming up.', action: null }
}

// --- chats: Carl's conversations with Goddard, as separate threads over the one Home session ---------------
// A thread is a stretch of time (from..to). The newest has no end and is the open one. Clearing a thread drops it from
// the list; the words stay in Home's own memory, they just stop showing (Carl, 2026-10-28: "multiple threads... clear chats").
type Chat = { id: string; from: number; to?: number; title?: string }
const CHATS_FILE = join(STATE_DIR, 'chats.json')
const loadChats = (): Chat[] => { try { return JSON.parse(readFileSync(CHATS_FILE, 'utf8')) } catch { return [{ id: 'first', from: 0 }] } }
const saveChats = (c: Chat[]) => writeFileSync(CHATS_FILE, JSON.stringify(c.slice(-100), null, 1) + '\n', { mode: 0o600 })
const newChat = (chats: Chat[]): Chat[] => {
  const now = Date.now(), open = chats.find(c => !c.to)
  if (open) open.to = now
  return [...chats, { id: now.toString(36), from: now }]
}

const TASKS_FILE = join(STATE_DIR, 'tasks.json')
// one append-only line per thing that happened to a request: asked, handed to a dog, the dog needing Carl, his answer,
// done or lost. Goddard OS reads it as Carl's history (newest first).
const HISTORY_FILE = join(STATE_DIR, 'history.jsonl')
function logEvent(e: Record<string, unknown>) {
  ensureHistory()
  try {
    const port = typeof e.port === 'number' ? e.port : undefined
    const t = port ? loadTasks().filter(x => x.port === port && x.status === 'active').pop() : undefined
    appendFileSync(HISTORY_FILE, JSON.stringify({ at: Date.now(), ...(t ? { task: t.id, skill: t.skill } : {}), ...e }) + '\n', { mode: 0o600 })
  } catch {}
}
// first use: start the history from the task list already kept, so it isn't empty (real timestamps only)
function ensureHistory() { try {
  if (!existsSync(HISTORY_FILE)) {
    const lines: string[] = []
    for (const t of loadTasks()) {
      lines.push(JSON.stringify({ at: t.at, type: 'request', task: t.id, skill: t.skill, by: t.by, text: t.brief, mode: t.mode, backfill: true }))
      if (t.status === 'done' && t.doneAt) lines.push(JSON.stringify({ at: t.doneAt, type: 'done', task: t.id, skill: t.skill, took: t.doneAt - t.at, backfill: true }))
      if (t.status === 'lost') lines.push(JSON.stringify({ at: t.at, type: 'lost', task: t.id, skill: t.skill, backfill: true }))
    }
    lines.sort((a, b) => JSON.parse(a).at - JSON.parse(b).at)
    writeFileSync(HISTORY_FILE, lines.join('\n') + (lines.length ? '\n' : ''), { mode: 0o600 })
  }
} catch {} }
function readHistory(limit: number) {
  ensureHistory()
  try { return tailLines(HISTORY_FILE, 600_000).slice(-limit).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean).reverse() } catch { return [] }
}
const SLOT = 'Agent slot'

// --- router: Cheap (Hermes, free), Creative (Claude Sonnet), Best (Claude Opus); Auto picks one --------------
// Carl's picks 2026-10-27: Creative on Sonnet, Haiku as the fallback, Cheap runs without asking (it's free).
type Mode = 'cheap' | 'creative' | 'best'
const MODES: Mode[] = ['cheap', 'creative', 'best']
const MODELS: Record<'creative' | 'best', string> = { creative: 'sonnet', best: 'opus' }
// Cheap only for jobs Hermes can do without the Mac's files; Best for the long builds and renders
const CHEAP_SKILLS = ['ask-goddard']
const BEST_SKILLS = /^(gm-technews-episode|gm-long-form|gm-motion-episode|gm-music-video|gm-parallax-layers|gm-25d-map|hyperframes|general-video|higgsfield-websites|deep-research|reverse-engineer)/
function route(skill: string, asked?: string): { mode: Mode; why: string } {
  if (MODES.includes(asked as Mode)) return { mode: asked as Mode, why: 'you picked it' }
  if (CHEAP_SKILLS.includes(skill) && has('helper')) return { mode: 'cheap', why: 'a question for Hermes, free' }
  if (BEST_SKILLS.test(skill)) return { mode: 'best', why: 'a long build or render' }
  return { mode: 'creative', why: 'writing and planning in your voice' }
}
const busUrl = () => process.env.GM_BUS ?? profile().helper?.bus ?? ''
const BUS_TOKEN_FILE = join(homedir(), '.gm-bus-token')
// a Cheap task goes to Hermes through the GM! Bus, the same way ask-goddard does; his answer is the result
async function runCheap(id: string) {
  const update = (f: (t: Task) => void) => { const all = loadTasks(), t = all.find(x => x.id === id); if (t) { f(t); saveTasks(all) } }
  const t = loadTasks().find(x => x.id === id)!
  try {
    const r = await fetch(`${busUrl()}/ask`, {
      method: 'POST', signal: AbortSignal.timeout(240_000),
      headers: { 'content-type': 'application/json', 'x-gm-bus': readFileSync(BUS_TOKEN_FILE, 'utf8').trim() },
      body: JSON.stringify({ q: `TASK from Carl via Goddard OS: ${t.brief}\nDrafts and summaries only: no spending, no posting, no messaging anyone.`, from: 'claude-mac', deep: true }),
    })
    if (!r.ok) throw new Error(`bus said ${r.status}`)
    const j = await r.json() as { answer?: string; thread?: string }
    update(x => { x.status = 'done'; x.doneAt = Date.now(); x.result = (j.answer ?? '').slice(0, 4000); x.thread = j.thread })
    log(`cheap task ${id} done on Hermes (thread ${j.thread ?? '?'})`)
  } catch (e) {
    update(x => { x.status = 'lost'; x.result = `Hermes didn't answer: ${(e as Error).message}` })
    log(`cheap task ${id} lost: ${(e as Error).message}`)
  }
}
const loadTasks = (): Task[] => { try { return JSON.parse(readFileSync(TASKS_FILE, 'utf8')) } catch { return [] } }
const saveTasks = (t: Task[]) => writeFileSync(TASKS_FILE, JSON.stringify(t.slice(-200), null, 1) + '\n', { mode: 0o600 })

// only skills that are really installed in Claude Code on this Mac
function skillExists(name: string): boolean {
  const walk = (dir: string, depth: number): boolean => {
    if (depth > 3 || !existsSync(dir)) return false
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const sub = join(dir, e.name), md = join(sub, 'SKILL.md')
      // linked skills (ask-goddard, gm-comic-workbench live in ~/gm-mind/skills) count too
      if (e.name.startsWith('.') || !(e.isDirectory() || (e.isSymbolicLink() && existsSync(md)))) continue
      if (existsSync(md)) {
        const fm = readFileSync(md, 'utf8').match(/^---\n[\s\S]*?\nname:\s*["']?([^"'\n]+)/)
        if ((fm?.[1]?.trim() ?? e.name) === name || e.name === name) return true
      } else if (walk(sub, depth + 1)) return true
    }
    return false
  }
  return walk(join(homedir(), '.claude', 'skills'), 0)
}

function taskText(t: Task) {
  return `New task${t.parent ? ` (part of the job "${t.parent}", coordinated by Goddard)` : ''} from Goddard OS. ` +
    `Drop anything from your last task and start clean. Use the ${t.skill} skill: ${t.brief}\n` +
    `Before you take any step, post your plan with the gm-chat plan tool (3 to 7 short steps) and wait for Carl's Go; then mark each step with the step tool as you start it. ` +
    `When you're done, say where Carl can see what you made: the full file path of each file, or the full https link. ` +
    `Come back with the gm-chat reply tool when you need Carl or are done. ` +
    `When you need Carl, end your message with one short question on its own line, and pass 2 or 3 choices with the one you recommend first (it becomes their big button). Keep the facts above it to 3 short lines. Save every artifact, page or draft as a local file first (it shows live in Goddard OS as you work), and name its full path in your reply. ` +
    (has('bigDrive') ? (profile().owner.name === 'Carl' ? `Carl's LaCie drive is at /Volumes/LaCie (their project folders live there, e.g. GM OS, ComfyUI, standup-frames, glesolas-board-web); ` : `Carl's big drive is at ${LACIE}; `) + 'you may read it and create new files and folders on it, but deleting or overwriting an existing file there asks them first. ' : '') + `Never post or send anything publicly.`
}

async function say(port: number, text: string, from: 'carl' | 'home' | 'system') {
  const r = await fetch(`http://127.0.0.1:${port}/say`, {
    method: 'POST', headers: { 'x-gm-chat': TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify({ text: own(text), from }), signal: AbortSignal.timeout(3000),
  })
  if (!r.ok) throw new Error(`agent on :${port} said ${r.status}`)
}

async function lastAnswer(port: number): Promise<string | undefined> {
  const r = await fetch(`http://127.0.0.1:${port}/history?limit=60`, { headers: { 'x-gm-chat': TOKEN }, signal: AbortSignal.timeout(3000) })
  if (!r.ok) return undefined
  const lines: string[] = (await r.json()).lines
  // the answer is usually the agent's last long message, not the "thanks" after Looks good
  const said = lines.filter(l => l.startsWith('Claude: ')).slice(-3).map(l => l.slice(8))
  return said.sort((a, b) => b.length - a.length)[0]?.slice(0, 4000)
}

// Work only goes to agent slots this door started and can reach: registered in the session registry, process alive,
// /state answered just now, on the Mac and in one of Carl's folders. Visiting Claude Code sessions, Remote Control
// sessions and Claude project threads aren't in the registry, so they can never be picked.
// Agent numbers match Goddard OS: every thread but Home, sorted by port, counted from 1.
type Slot = { agent: number; port: number; mode: Mode; free: boolean; busy: boolean; needsYou: boolean; dog?: string; skill?: string; job?: string }
function slotsOf(list: Thread[], tasks: Task[]): Slot[] {
  const folders = config().folders.map(home)
  const holding = new Set(tasks.filter(t => t.status === 'active').map(t => t.port))
  const numbered = list.filter(t => !t.home).sort((a, b) => a.port - b.port)
  return numbered.flatMap((t, i) => t.name.startsWith(SLOT) && t.server === 'Mac mini' && folders.includes(t.folder)
    ? [{ agent: i + 1, port: t.port, mode: t.mode ?? 'best', busy: t.busy, needsYou: t.needsYou, free: !t.busy && !t.needsYou && !holding.has(t.port),
        ...(dogOf(t) ? { dog: dogOf(t)!, ...(() => { const m = dogMeta(dogOf(t)!); return m ? { skill: m.skill, job: m.job } : {} })() } : {}) }]
    : [])
}
const log = (m: string) => console.log(`[${new Date().toISOString()}] door: ${m}`)

// hand queued tasks to free slots, oldest first; mark tasks whose slot closed as lost
let assigning = false
const gone = new Map<string, number>() // task id -> when its dog was first seen missing
async function assign(live?: Thread[]) {
  if (assigning) return
  assigning = true
  try {
    const list = live ?? await threads()
    const tasks = loadTasks()
    let changed = false
    const alivePorts = new Set(list.map(t => t.port))
    const allSlots = slotsOf(list, tasks)
    // a dog's session ends now and then (an idle one about every hour) and the watchdog wakes it again on its own
    // conversation, on a new port. Its open job follows it there; only a dog gone for 10 minutes loses its job.
    for (const t of tasks) {
      if (t.status !== 'active' || !t.port || alivePorts.has(t.port)) { gone.delete(t.id); continue }
      const dog = t.dog ?? allSlots.find(x => x.skill === t.skill)?.dog
      const back = dog ? allSlots.find(x => x.dog === dog) : undefined
      if (back) {
        t.port = back.port; t.dog = dog; changed = true; gone.delete(t.id)
        log(`task ${t.id}: ${dog} woke again on :${back.port}, the job went with it`)
        say(back.port, 'Goddard OS: your session restarted while this job was still open. Pick it back up where it was. If your plan was waiting for Carl\'s Go, post the same plan again with the plan tool and wait for their Go; if you were mid-work, carry on.', 'system').catch(e => log(`task ${t.id}: couldn't tell ${dog}: ${(e as Error).message}`))
        continue
      }
      if (!gone.has(t.id)) { gone.set(t.id, Date.now()); log(`task ${t.id}: its dog is down, waiting for it to wake`) }
      else if (Date.now() - gone.get(t.id)! > 10 * 60_000) { t.status = 'lost'; changed = true; gone.delete(t.id); logEvent({ type: 'lost', task: t.id, skill: t.skill }) }
    }
    const free = allSlots.filter(s => s.free)
    for (const t of tasks.filter(t => t.status === 'queued')) {
      if (t.mode === 'cheap') {
        t.status = 'active'; changed = true
        log(`dispatch task ${t.id} (${t.skill}) asked by ${t.by} -> Hermes (cheap)`)
        runCheap(t.id).catch(() => {})
        continue
      }
      // a job whose skill has its own dog waits for that dog (even if it was asked before the dog woke)
      if (t.want && !allSlots.some(x => x.port === t.want)) delete t.want // its dog went away: find its owner again
      const owner = !t.want ? allSlots.find(x => x.skill === t.skill) : undefined
      if (owner) t.want = owner.port
      // the lane's own slot first; any free slot after that, saying so on the card
      let i = t.want ? free.findIndex(f => f.port === t.want) : free.findIndex(f => f.mode === (t.mode ?? 'best'))
      if (i < 0 && !t.want && free.length) { i = 0; t.ran = `${free[0].mode === 'best' ? 'Best' : 'Creative'}: no ${t.mode === 'best' ? 'Best' : 'Creative'} slot open` }
      if (i < 0) continue
      const slot = free.splice(i, 1)[0]
      if (!slot) break
      try {
        await say(slot.port, taskText(t), t.by); t.port = slot.port; t.status = 'active'; if (slot.dog) t.dog = slot.dog; changed = true
        log(`dispatch task ${t.id} (${t.skill}, ${t.mode ?? 'best'}${t.ran ? `, ran ${t.ran}` : ''}) asked by ${t.by} -> Agent ${slot.agent} :${slot.port}`)
        logEvent({ type: 'dispatch', task: t.id, skill: t.skill, agent: slot.agent, port: slot.port })
      } catch (e) { log(`dispatch task ${t.id} to Agent ${slot.agent} :${slot.port} failed: ${(e as Error).message}`) }
    }
    if (changed) saveTasks(tasks)
  } finally { assigning = false }
}
setInterval(() => { assign().catch(() => {}) }, 5000)

// --- Goddard as Carl's always-on partner (Carl, 2026-10-28: "how can we create the equivalent" of ChatGPT dots, with
// "check-ins through app push notifications") --------------------------------------------------------------------
// Push: the Goddard OS home-screen app subscribes; the door sends a notification when a dog or Goddard needs Carl or
// comes back with work. Never between 11 PM and 7 AM. Keys and subscriptions stay in the state folder.
const PUSH_FILE = join(STATE_DIR, 'push.json')
type PushState = { vapid: { publicKey: string; privateKey: string }; subs: webpush.PushSubscription[] }
function pushState(): PushState {
  try { return JSON.parse(readFileSync(PUSH_FILE, 'utf8')) } catch {}
  const st = { vapid: webpush.generateVAPIDKeys(), subs: [] }
  writeFileSync(PUSH_FILE, JSON.stringify(st, null, 1), { mode: 0o600 })
  return st
}
const savePush = (st: PushState) => writeFileSync(PUSH_FILE, JSON.stringify(st, null, 1), { mode: 0o600 })
const quietHours = () => { const [from, to] = profile().pings?.quiet ?? [23, 7], h = new Date().getHours(); return from > to ? h >= from || h < to : h >= from && h < to }
// Gentle pings (Carl, 2026-10-28: "everything is yelling at me"): at most one an hour. Whatever comes up in between
// waits and goes out as one digest ("2 things ready when you are"). A dog blocked on a permission breaks through.
let lastPush = 0, held: string[] = [], flushTimer: ReturnType<typeof setTimeout> | null = null
async function gentle(who: string, title: string, body: string, tag: string) {
  if (quietHours() || !has('pings')) return
  if (Date.now() - lastPush >= 60 * 60_000) return notify(title, body, tag)
  if (!held.includes(who)) held.push(who)
  if (!flushTimer) flushTimer = setTimeout(() => {
    flushTimer = null
    const names = held; held = []
    if (names.length) void notify(names.length === 1 ? `${names[0]} is ready when you are` : `${names.length} things ready when you are`, names.join(', '), 'digest')
  }, lastPush + 60 * 60_000 - Date.now())
}
async function notify(title: string, body: string, tag: string, force = false) {
  if (quietHours() && !force) return
  lastPush = Date.now()
  const st = pushState()
  if (!st.subs.length) return
  webpush.setVapidDetails('mailto:goddard@gmcarl.xyz', st.vapid.publicKey, st.vapid.privateKey)
  const gone = new Set<string>()
  await Promise.all(st.subs.map(sub => webpush.sendNotification(sub, JSON.stringify({ title, body: body.slice(0, 180), tag, url: '/' }), { TTL: 3600 })
    .catch((e: { statusCode?: number }) => { if (e.statusCode === 404 || e.statusCode === 410) gone.add(sub.endpoint) })))
  if (gone.size) { st.subs = st.subs.filter(x => !gone.has(x.endpoint)); savePush(st) }
  log(`push: ${title}`)
}

// watch every thread: a ping when one starts needing Carl, or comes back from a job with something to look at
const watched = new Map<number, { needs: boolean; busy: boolean }>()
async function watch() {
  const list = await threads(), tasks = loadTasks()
  for (const t of list) {
    const was = watched.get(t.port); watched.set(t.port, { needs: t.needsYou, busy: t.busy })
    if (!was) continue
    const who = t.home ? 'Goddard' : dogOf(t) ?? 'A dog'
    if (t.needsYou && !was.needs) {
      const said = (await lastAnswer(t.port).catch(() => undefined)) ?? 'Waiting on you.'
      await gentle(who, `${who} has a question`, said.split('\n').filter(Boolean).slice(-1)[0] ?? said, `needs-${t.port}`)
    } else if (was.busy && !t.busy && !t.needsYou && !t.home && t.last.text === 'Replied' && tasks.some(x => x.status === 'active' && x.port === t.port && t.last.at > x.at)) {
      const said = (await lastAnswer(t.port).catch(() => undefined)) ?? 'Back with it.'
      await gentle(who, `${who} is back with it`, said.split('\n').filter(Boolean)[0] ?? said, `back-${t.port}`)
    }
  }
}
setInterval(() => { watch().catch(() => {}) }, 5000)

// Heartbeat: every 30 minutes, 7 AM to 11 PM, Goddard (Home) checks what it owns and moves it along through the dogs
const OWNS_FILE = join(STATE_DIR, 'goddard-owns.md')
const OWNS_START = [
  '# What Goddard owns', '', 'Carl edits this list. Goddard checks it every 30 minutes, 7 AM to 11 PM.', '',
  '- Content stays drafted 3 days ahead on the publish calendar (Scribbles).',
  '- There is always a next campaign card waiting for Carl (Fetch).',
  '- The next Standup episode keeps moving (Bloodhound).',
  '- The next Season Zero night is promoted on time.',
  '- Nothing waits on Carl for more than a day without a reminder.', '',
].join('\n')
type Plan = { id: string; goal: string; by: string; owner: string; next: string; milestones: { date: string; what: string; done: boolean }[]; remember: string[]; status: 'active' | 'done' | 'paused'; at: number; updated: number }
const PLANS_FILE = join(STATE_DIR, 'plans.json')
// a session's board, as the session server keeps it
type SessionBoard = { artifact: string; goal: string; phases: string[]; now: number; sheet: { name: string; value: string }[]; resources: string[]; done_when: string; done?: { what: string; met: boolean }[]; next?: string; finished?: { at: number; path: string; next?: string }; at: number }
function writeSessionDoc(title: string, b: SessionBoard, next: string): string {
  refreshLibraryDir()
  const day = new Date().toLocaleDateString('en-CA'), dir = join(LIBRARY_DIR, 'sessions')
  mkdirSync(dir, { recursive: true })
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'session'
  const path = join(dir, `${day}-${slug}.md`)
  const done = b.done?.length ? b.done.map(d => `- [${d.met ? 'x' : ' '}] ${d.what}`).join('\n') : `- ${b.done_when}`
  const md = [`# ${title}`, '', `*Session, ${day}. Brought: ${b.artifact}*`, '', `**Goal:** ${b.goal}`, '', '## Done when', done, '',
    ...b.sheet.flatMap(r => [`## ${r.name}`, r.value.trim() || '_Not yet_', '']),
    '## Phases', ...b.phases.map((p, i) => `${i + 1}. ${p}${i < b.now ? ' ✓' : ''}`), '',
    ...((next || b.next) ? ['## Next', next || b.next || '', ''] : []),
    ...(b.resources.length ? ['## Used', b.resources.join(' · '), ''] : [])].join('\n')
  writeFileSync(path, md)
  const lib = loadLibrary().filter(e => e.path !== path)
  lib.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), title: `${title} (session)`, type: 'doc', dog: null, task: null,
    taskTitle: `Session: ${title}`, at: Date.now(), source: 'session', path, copied: true })
  writeFileSync(LIBRARY_INDEX, JSON.stringify(lib, null, 1) + '\n')
  logEvent({ type: 'upload', text: `Session sheet: ${title}`, path })
  log(`session doc saved: ${path}`)
  return path
}

let cronCache: { at: number; data: { jobs: unknown[]; reached_proxmox: boolean } } | null = null

// Carl's own recipes: a job he liked, saved so it runs again with one tap (Carl, 2026-10-28: "Save as recipe")
type Recipe = { id: string; title: string; skill: string; brief: string; at: number }
const RECIPES_FILE = join(STATE_DIR, 'recipes.json')
const loadRecipes = (): Recipe[] => { try { return JSON.parse(readFileSync(RECIPES_FILE, 'utf8')) } catch { return [] } }
const saveRecipes = (r: Recipe[]) => writeFileSync(RECIPES_FILE, JSON.stringify(r, null, 1), { mode: 0o600 })
const loadPlans = (): Plan[] => { try { return JSON.parse(readFileSync(PLANS_FILE, 'utf8')) } catch { return [] } }
const owns = () => existsSync(OWNS_FILE) ? readFileSync(OWNS_FILE, 'utf8') : OWNS_START
let lastBeat = 0, lastSunday = ''
async function heartbeat() {
  const h = new Date().getHours()
  if (h < 7 || h >= 23 || Date.now() - lastBeat < 30 * 60_000) return
  const homeT = (await threads()).find(t => t.home)
  if (!homeT || homeT.busy || homeT.needsYou) return
  lastBeat = Date.now()
  if (!existsSync(OWNS_FILE)) writeFileSync(OWNS_FILE, OWNS_START, { mode: 0o600 })
  const now = new Date(), day = now.toISOString().slice(0, 10)
  const soon = new Date(now.getTime() + 2 * 86400_000).toISOString().slice(0, 10)
  const due = loadPlans().filter(p => p.status === 'active').flatMap(p => p.milestones.filter(m => !m.done && m.date <= soon).map(m => `"${p.goal}": ${m.what} (${m.date}${m.date < day ? ', overdue' : ''})`))
  // Sunday evening: the one weekly look-back instead of a normal check-in
  if (now.getDay() === 0 && now.getHours() >= 18 && lastSunday !== day) {
    lastSunday = day
    await say(homeT.port, [
      'Weekly look-back (Sunday evening). Read the board, the history of the last 7 days (task_status), your plans (plans tool) and', OWNS_FILE + '.',
      'Send Carl ONE reply in this shape: "Review: your week" then three short parts, Moved (what got done), Slipped (what didn\'t, without blame), Next week (at most 3 things, with days),',
      'and end with the question "Keep next week like this?" and choices ["Keep it", "Move things"]. Update plans with plan_save if milestones were done or dates moved. Start no jobs.',
    ].join(' '), 'system').catch(e => log(`look-back: ${(e as Error).message}`))
    log('weekly look-back sent to Goddard'); return
  }
  await say(homeT.port, [
    `Check-in (${now.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}). Your standing responsibilities are in ${OWNS_FILE}.`,
    due.length ? `Plan milestones due in the next 2 days: ${due.join('; ')}.` : 'No plan milestones are due in the next 2 days.',
    'Look at the board (slots, task_status) and the mind as needed. For each responsibility, decide whether a next step is due now.',
    'If one is, hand it to the right dog with task_start (its plan waits for Carl\'s Go). At most one new job per check-in, and never one a dog already has open.',
    'Then, only if there is something new for Carl, send ONE reply: start it with "Review:" (something made for them to look at) or "Decide:" (a question, with choices).',
    'If nothing is new, do not reply at all. Never spend, post, send or schedule anything.',
  ].join(' '), 'system').catch(e => log(`heartbeat: ${(e as Error).message}`))
  log('heartbeat sent to Goddard')
}
setInterval(() => { heartbeat().catch(() => {}) }, 60_000)

// The evening card (Carl, 2026-10-30): at 6 PM, what got done today (with what it made), what needs Carl, and one next
// step. One ping, only when there's something on it; Home shows the same card until midnight.
const DIGEST_DAY = join(STATE_DIR, 'digest-day')
async function digest() {
  const start = new Date().setHours(0, 0, 0, 0), all = loadTasks()
  const firstSentence = (t: string) => { const x = t.replace(/^.*?skill:\s*/i, '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s/).find(w => w.split(' ').length > 2) ?? t; return x.length > 70 ? x.slice(0, 69).replace(/\s+\S*$/, '') + '…' : x.replace(/[.!?]$/, '') }
  const proof = (t = '') => t.match(/https?:\/\/[^\s)<>"'`]+/)?.[0]?.replace(/[.,;:!?]+$/, '') ?? t.match(/(?:~|\/Users\/[^/\s]+)\/[^\s`'"<>()]+\.[A-Za-z0-9]{2,4}\b/)?.[0]
  const done = all.filter(t => t.status === 'done' && (t.doneAt ?? 0) >= start)
    .map(t => ({ who: CORE_DOGS.find(d => d.skill === t.skill)?.name ?? t.skill.replace(/^gm-/, ''), what: firstSentence(t.brief), proof: proof(t.result) }))
  let boards: { title: string; b: SessionBoard }[] = []
  try { boards = readdirSync(join(STATE_DIR, 'boards')).filter(f => f.endsWith('.json')).map(f => ({ title: f.replace(/^Session-/, '').replace(/\.json$/, '').replace(/-/g, ' '), b: JSON.parse(readFileSync(join(STATE_DIR, 'boards', f), 'utf8')) as SessionBoard })) } catch {}
  for (const { title, b } of boards) if (b.finished && b.finished.at >= start && !/\btest\b/i.test(title)) done.push({ who: 'Session', what: title, proof: b.finished.path })
  const list = await threads()
  const needs = list.filter(t => t.needsYou).map(t => t.home ? 'Goddard' : t.name.replace(/^(Session|Agent slot) · /, ''))
  const running = new Set(list.map(t => t.name))
  const open = boards.filter(x => !x.b.finished && !running.has(`Session · ${x.title}`) && !/\btest\b/i.test(x.title) && x.title.length > 3).sort((a, b) => b.b.at - a.b.at)[0]
  return { at: Date.now(), hour: profile().pings?.digest ?? 18, done, needs, lost: all.filter(t => t.status === 'lost' && t.at >= start).length, next: open ? { title: open.title, why: `${(open.b.done ?? []).filter(d => !d.met).length} done conditions still open` } : null }
}
async function eveningCard() {
  const now = new Date(), day = now.toDateString(), hour = profile().pings?.digest ?? 18
  if (now.getHours() < hour) return
  try { if (readFileSync(DIGEST_DAY, 'utf8').trim() === day) return } catch {}
  writeFileSync(DIGEST_DAY, day + '\n')
  const d = await digest()
  if (!d.done.length && !d.needs.length) return log('evening card: nothing on it, no ping')
  await notify('Your day', [`${d.done.length} done`, d.needs.length ? `${d.needs.length} need${d.needs.length === 1 ? 's' : ''} you` : '', d.next ? `Next: ${d.next.title}` : ''].filter(Boolean).join(' · '), 'evening')
  log(`evening card: ${d.done.length} done, ${d.needs.length} need Carl`)
}
setInterval(() => { eveningCard().catch(e => log(`evening card: ${(e as Error).message}`)) }, 60_000)

// --- outputs: files agents made, shown read-only in Goddard OS ---------------
// Only from an allow-list of folders (gm-mind, goddard-os, Desktop and the door's work folders), resolved through
// symlinks so "../" or a link can't reach anything else.
const OUTPUT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8',
  json: 'application/json', csv: 'text/csv; charset=utf-8', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav',
}
function outputRoots(): string[] {
  const roots = [...new Set([mindDir(), '~/goddard-os', '~/Desktop']), LIBRARY_DIR, LOCAL_LIBRARY, ...(existsSync(LACIE) ? [LACIE] : []), ...config().folders]
  return [...new Set(roots.map(home).filter(existsSync).map(r => realpathSync(r)))]
}
function readOutput(raw: string): Response {
  const want = resolve(home(raw.trim())), roots = outputRoots()
  const inside = (p: string) => roots.some(r => p === r || p.startsWith(r + '/'))
  // check the folder before looking at the file, so nothing outside the shared folders is even probed
  if (!raw.trim() || !inside(want)) return new Response('not in a shared folder', { status: 403 })
  if (!existsSync(want)) return new Response('not found', { status: 404 })
  const real = realpathSync(want)
  if (!inside(real)) return new Response('not in a shared folder', { status: 403 })
  const st = statSync(real)
  if (!st.isFile()) return new Response('not a file', { status: 400 })
  if (st.size > 40 * 1024 * 1024) return new Response('too big to show', { status: 413 })
  const type = OUTPUT_TYPES[real.split('.').pop()!.toLowerCase()]
  if (!type) return new Response('not a type Goddard OS shows', { status: 415 })
  const headers: Record<string, string> = { 'content-type': type, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' }
  // pages and SVGs render sandboxed: no access back to Goddard OS or the door
  if (type.startsWith('text/html') || type === 'image/svg+xml') headers['content-security-policy'] = 'sandbox allow-scripts allow-popups'
  return new Response(Bun.file(real), { headers })
}


// --- the Library: every output an agent makes, kept ---------------------------
// Files are COPIED into ~/GoddardLibrary/<date>-<task>/ so later edits don't change them (over 200 MB: indexed by path
// only). Links are kept as entries. index.json lists everything, newest last. Not in any git repo.
// The Library lives on Carl's LaCie drive. If the drive is unplugged, new outputs go to ~/GoddardLibrary and move
// over (files and index) the next time the LaCie is back.
// the big drive, from the owner's profile; with none, a folder that never exists keeps every check below false
const LACIE = process.env.GODDARD_LACIE ?? (profile().bigDrive?.on ? profile().bigDrive!.path : '/nonexistent-big-drive')
const LOCAL_LIBRARY = join(homedir(), 'GoddardLibrary')
const lacieUp = () => !process.env.GODDARD_LIBRARY && existsSync(join(LACIE, 'GoddardLibrary'))
const libDir = () => process.env.GODDARD_LIBRARY ?? (lacieUp() ? join(LACIE, 'GoddardLibrary') : LOCAL_LIBRARY)
// kept as names for the code below: they follow the drive being there or not
let LIBRARY_DIR = libDir()
let LIBRARY_INDEX = join(LIBRARY_DIR, 'index.json')
function refreshLibraryDir() { LIBRARY_DIR = libDir(); LIBRARY_INDEX = join(LIBRARY_DIR, 'index.json') }

// while the LaCie was away, entries landed in ~/GoddardLibrary with pending: true; move them over when it's back
function syncToLacie() {
  if (!lacieUp()) return
  const localIndex = join(LOCAL_LIBRARY, 'index.json')
  let local: (LibEntry & { pending?: boolean })[] = []
  try { local = JSON.parse(readFileSync(localIndex, 'utf8')) } catch { return }
  const pending = local.filter(e => e.pending)
  if (!pending.length) return
  const lacieDir = join(LACIE, 'GoddardLibrary'), lacieIndex = join(lacieDir, 'index.json')
  let remote: LibEntry[] = []
  try { remote = JSON.parse(readFileSync(lacieIndex, 'utf8')) } catch {}
  for (const e of pending) {
    if (e.path && e.path.startsWith(LOCAL_LIBRARY + '/') && existsSync(e.path)) {
      const dest = lacieDir + e.path.slice(LOCAL_LIBRARY.length)
      mkdirSync(dest.slice(0, dest.lastIndexOf('/')), { recursive: true })
      copyFileSync(e.path, dest); e.path = dest
    }
    delete e.pending; remote.push(e)
  }
  writeFileSync(lacieIndex, JSON.stringify(remote, null, 1) + '\n')
  writeFileSync(localIndex, JSON.stringify(local.filter(e => !pending.includes(e)), null, 1) + '\n')   // the files stay on the Mac too
}
const BIG = 200 * 1024 * 1024
type LibEntry = {
  id: string; title: string; type: 'page' | 'image' | 'doc' | 'video' | 'audio' | 'link'
  dog: number | 'home' | null; task: string | null; taskTitle: string; job?: string; skill?: string
  at: number; source: string; path?: string; copied: boolean; note?: string
  live?: boolean; versions?: number; share?: string // tracked as the dog works: newest copy, how many saves, its claude.ai link
}
const LIB_TYPE: Record<string, LibEntry['type']> = {
  html: 'page', htm: 'page', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image',
  md: 'doc', txt: 'doc', pdf: 'doc', json: 'doc', csv: 'doc', mp4: 'video', webm: 'video', mov: 'video', mp3: 'audio', wav: 'audio',
}
const loadLibrary = (): LibEntry[] => { try { return JSON.parse(readFileSync(LIBRARY_INDEX, 'utf8')) } catch { return [] } }
const slug = (s: string) => s.toLowerCase().replace(/^(drafts? only)[^.]*\.\s*/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'task'

function findOutputs(text: string): { kind: 'file' | 'link'; ref: string }[] {
  const out: { kind: 'file' | 'link'; ref: string }[] = []
  for (const m of text.matchAll(/https?:\/\/[^\s)<>"'`]+/g)) out.push({ kind: 'link', ref: m[0].replace(/[.,;:!?]+$/, '') })
  for (const m of text.matchAll(/(?:~|\/Users\/[^/\s]+)\/[^\s`'"<>()]+\.([A-Za-z0-9]{2,4})\b/g)) if (LIB_TYPE[m[1].toLowerCase()]) out.push({ kind: 'file', ref: m[0] })
  return out
}

// entries written while the LaCie is away are marked so they move over later
function markPending(lib: (LibEntry & { pending?: boolean })[]) {
  if (LIBRARY_DIR !== LOCAL_LIBRARY || process.env.GODDARD_LIBRARY) return
  for (const e of lib) if (e.path?.startsWith(LOCAL_LIBRARY + '/') || !e.path) e.pending = e.pending ?? true
}

// add what's new in these lines to the Library; returns how many entries were added
function collect(lines: string[], who: { dog: LibEntry['dog']; task: Task | null }): number {
  refreshLibraryDir()
  const lib = loadLibrary(), have = new Set(lib.map(e => `${e.task ?? who.dog}|${e.source}`)), roots = outputRoots()
  let added = 0
  for (const line of lines) {
    if (!line.startsWith('Claude: ')) continue
    for (const o of findOutputs(line.slice(8))) {
      const key = `${who.task?.id ?? who.dog}|${o.ref}`
      if (have.has(key)) continue
      have.add(key)
      const t = who.task, base = { dog: who.dog, task: t?.id ?? null, taskTitle: t?.brief ?? 'Goddard', job: t?.parent, skill: t?.skill, at: Date.now() }
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
      if (o.kind === 'link') {
        const host = new URL(o.ref).host
        lib.push({ id, ...base, title: host.endsWith('claude.ai') ? 'Claude artifact' : host.includes('substack.com') ? 'Substack draft' : host, type: 'link', source: o.ref, copied: false }); added++
        continue
      }
      const src = home(o.ref)
      if (!existsSync(src)) continue
      const real = realpathSync(src)
      if (!roots.some(r => real === r || real.startsWith(r + '/')) || real.startsWith(realpathSync(LIBRARY_DIR) + '/')) continue   // only shared folders, never the Library itself
      const st = statSync(real); if (!st.isFile()) continue
      const name = real.split('/').pop()!, type = LIB_TYPE[name.split('.').pop()!.toLowerCase()]
      if (st.size > BIG) { lib.push({ id, ...base, title: name, type, source: real, path: real, copied: false, note: 'Over 200 MB: kept where it is, not copied' }); added++; continue }
      const day = new Date().toISOString().slice(0, 10), dir = join(LIBRARY_DIR, `${day}-${slug(t?.brief ?? 'goddard')}`)
      mkdirSync(dir, { recursive: true })
      let dest = join(dir, name), n = 1
      while (existsSync(dest)) dest = join(dir, name.replace(/(\.[^.]+)$/, `-${++n}$1`))
      copyFileSync(real, dest)
      lib.push({ id, ...base, title: name, type, source: real, path: dest, copied: true }); added++
    }
  }
  if (added) { markPending(lib); mkdirSync(LIBRARY_DIR, { recursive: true }); writeFileSync(LIBRARY_INDEX, JSON.stringify(lib, null, 1) + '\n') }
  return added
}

async function history(port: number): Promise<string[]> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/history?limit=100`, { headers: { 'x-gm-chat': TOKEN }, signal: AbortSignal.timeout(3000) })
    return r.ok ? (await r.json()).lines : []
  } catch { return [] }
}

// a slot keeps one long conversation: only what came after this task's own start message belongs to it
function sinceTask(lines: string[], t: Task): string[] {
  const mark = t.brief.slice(0, 40)
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].includes('New task') && lines[i].includes(mark)) return lines.slice(i + 1)
  return []
}

// a dog wrote, edited or published a file (PostToolUse hook via its thread server): keep the newest copy, live
function track(b: { port?: number; home?: boolean; tool?: string; files?: string[]; url?: string }) {
  refreshLibraryDir()
  const task = b.home ? null : loadTasks().filter(t => t.status === 'active' && t.port === b.port).pop() ?? null
  const dog: LibEntry['dog'] = b.home ? 'home' : b.port ?? null
  const lib = loadLibrary(), roots = outputRoots(), now = Date.now()
  let changed = false
  for (const f of b.files ?? []) {
    const src = home(String(f)); if (!existsSync(src)) continue
    const real = realpathSync(src)
    if (!roots.some(r => real === r || real.startsWith(r + '/')) || real.startsWith(realpathSync(LIBRARY_DIR) + '/')) continue
    const name = real.split('/').pop()!, type = LIB_TYPE[name.split('.').pop()!.toLowerCase()]
    if (!type || !statSync(real).isFile()) continue
    let e = lib.find(x => x.source === real && x.task === (task?.id ?? null) && x.live !== undefined)
    if (!e) {
      const day = new Date().toISOString().slice(0, 10), dir = join(LIBRARY_DIR, `${day}-${slug(task?.brief ?? 'goddard')}`)
      mkdirSync(dir, { recursive: true })
      let dest = join(dir, name), n = 1
      while (existsSync(dest)) dest = join(dir, name.replace(/(\.[^.]+)$/, `-${++n}$1`))
      e = { id: now.toString(36) + Math.random().toString(36).slice(2, 6), title: name, type, dog, task: task?.id ?? null, taskTitle: task?.brief ?? 'Goddard',
        job: task?.parent, skill: task?.skill, at: now, source: real, path: dest, copied: true, live: true, versions: 0 }
      lib.push(e)
    }
    if (statSync(real).size > BIG) { e.copied = false; e.path = real; e.note = 'Over 200 MB: kept where it is, not copied' }
    else copyFileSync(real, e.path!)   // the newest version replaces the copy, so the preview shows the latest
    e.at = now; e.versions = (e.versions ?? 0) + 1; e.live = true
    if (b.url) e.share = b.url
    changed = true
  }
  if (b.url && !(b.files ?? []).length) {   // a publish with no local file we could read: keep the link
    if (!lib.some(x => x.source === b.url)) { lib.push({ id: now.toString(36), title: 'Claude artifact', type: 'link', dog, task: task?.id ?? null, taskTitle: task?.brief ?? 'Goddard', job: task?.parent, skill: task?.skill, at: now, source: b.url, copied: false }); changed = true }
  }
  if (changed) { markPending(lib); mkdirSync(LIBRARY_DIR, { recursive: true }); writeFileSync(LIBRARY_INDEX, JSON.stringify(lib, null, 1) + '\n') }
}

// every 15 s: whatever running tasks and Goddard have said goes through the Library
let collecting = false
async function collectAll() {
  if (collecting) return; collecting = true
  try {
    refreshLibraryDir(); syncToLacie()
    mkdirSync(LIBRARY_DIR, { recursive: true })
    const live = await threads()
    for (const t of loadTasks().filter(t => t.status === 'active' && t.port)) collect(sinceTask(await history(t.port!), t), { dog: t.port, task: t })
    const h = live.find(t => t.home); if (h) collect(await history(h.port), { dog: 'home', task: null })
  } catch {} finally { collecting = false }
}
setInterval(() => { collectAll() }, 15000)
// backfill once at start: finished tasks' kept answers
try { mkdirSync(LIBRARY_DIR, { recursive: true }); for (const t of loadTasks().filter(t => t.result)) collect(['Claude: ' + t.result], { dog: t.port, task: t }) } catch {}

// --- every other Claude Code session on this Mac, read-only ---------------------
// From `claude agents --json` (interactive and background sessions Claude Code registers), plus the last few steps
// and its latest words from that session's own transcript. Nothing here can type into or steer those sessions.
type OtherSession = { id: string; name: string; cwd: string; kind: string; status: string; startedAt: number; steps: string[]; last: string; at: number }
let sessionsCache: { at: number; list: OtherSession[] } = { at: 0, list: [] }
function tailLines(file: string, maxBytes = 400_000): string[] {
  try {
    const st = statSync(file)
    return readFileSync(file, 'utf8').slice(Math.max(0, st.size - maxBytes)).split('\n')
  } catch { return [] }
}
function sessionTail(cwd: string, id: string): { steps: string[]; last: string; at: number } {
  const file = join(homedir(), '.claude', 'projects', cwd.replace(/[/.]/g, '-'), `${id}.jsonl`)
  const steps: string[] = []; let last = '', at = 0
  for (const line of tailLines(file)) {
    let d: any; try { d = JSON.parse(line) } catch { continue }
    const c = d?.message?.content
    if (d.type === 'assistant' && Array.isArray(c)) {
      for (const x of c) {
        if (x.type === 'tool_use') steps.push(x.input?.description ? String(x.input.description) : `${x.name}${x.input?.file_path ? ' ' + String(x.input.file_path).split('/').pop() : ''}`)
        if (x.type === 'text' && x.text?.trim()) last = String(x.text).trim()
      }
      if (d.timestamp) at = Date.parse(d.timestamp) || at
    }
  }
  return { steps: steps.slice(-6).map(t => t.slice(0, 120)), last: last.slice(0, 600), at }
}
async function otherSessions(): Promise<OtherSession[]> {
  if (Date.now() - sessionsCache.at < 8000) return sessionsCache.list
  try {
    const p = Bun.spawn([CLAUDE, 'agents', '--json'], { stdout: 'pipe', stderr: 'ignore' })
    const raw = JSON.parse(await new Response(p.stdout).text() || '[]') as any[]
    sessionsCache = { at: Date.now(), list: raw.map(x => ({ id: String(x.sessionId ?? x.id), name: String(x.name ?? 'Claude session'), cwd: String(x.cwd ?? ''), kind: String(x.kind ?? ''), status: String(x.status ?? ''), startedAt: Number(x.startedAt ?? 0), ...sessionTail(String(x.cwd ?? ''), String(x.sessionId ?? x.id)) })) }
  } catch { sessionsCache = { at: Date.now(), list: sessionsCache.list } }
  return sessionsCache.list
}

// --- web -----------------------------------------------------------------

Bun.serve({
  port: DOOR_PORT,
  hostname: HOST,
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === '/ping') return new Response('gm-door')
    const locked = gate(req, url)
    if (locked) return locked
    if (url.pathname === '/') return new Response(HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    if (url.pathname === '/api/list') {
      const cfg = config()
      const [t, s] = await Promise.all([threads(), servers()])
      await assign(t)
      return Response.json({ threads: t, servers: s, folders: cfg.folders, tasks: loadTasks() })
    }
    if (url.pathname === '/api/tasks' && req.method === 'GET') return Response.json({ tasks: loadTasks() })
    if (url.pathname === '/api/chats' && req.method === 'GET') return Response.json({ chats: loadChats() })
    if (url.pathname === '/api/next' && req.method === 'GET') return Response.json(nextMove())
    // a file Carl attaches from his phone or desk: saved into the Goddard Library under uploads/<day>/, listed in the
    // Library, and handed back as a path the dog can open (Carl, 2026-10-28: "allow for file upload")
    if (url.pathname === '/api/upload' && req.method === 'POST') {
      if (req.headers.get('origin') && new URL(req.headers.get('origin')!).host !== url.host) return new Response('no', { status: 403 })
      try {
        const form = await req.formData()
        const out: { name: string; path: string }[] = []
        refreshLibraryDir()
        const day = new Date().toLocaleDateString('en-CA'), dir = join(LIBRARY_DIR, 'uploads', day)
        mkdirSync(dir, { recursive: true })
        for (const f of form.getAll('file')) {
          if (!(f instanceof File)) continue
          if (f.size > 100 * 1024 * 1024) throw new Error(`${f.name} is over 100 MB`)
          const safe = (f.name || 'file').normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-').replace(/^\.+/, '').slice(0, 80) || 'file'
          let dest = join(dir, safe), n = 1
          while (existsSync(dest)) dest = join(dir, safe.replace(/(\.[^.]*)?$/, `-${++n}$1`))
          await Bun.write(dest, f)
          const ext = (dest.split('.').pop() ?? '').toLowerCase()
          const lib = loadLibrary()
          lib.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), title: f.name || safe, type: LIB_TYPE[ext] ?? 'doc', dog: null, task: null,
            taskTitle: 'Uploaded by Carl', at: Date.now(), source: 'upload', path: dest, copied: true })
          writeFileSync(LIBRARY_INDEX, JSON.stringify(lib, null, 1) + '\n')
          logEvent({ type: 'upload', text: f.name || safe, path: dest })
          out.push({ name: f.name || safe, path: dest })
        }
        if (!out.length) throw new Error('no file came through')
        return Response.json({ ok: true, files: out })
      } catch (e) {
        return Response.json({ ok: false, error: (e as Error).message }, { status: 400 })
      }
    }
    // a voice note: saved with the uploads, then turned into text on the Mac with Whisper (local, free), so Carl can talk
    // to a dog instead of typing (Carl, 2026-10-28: "add voice recording")
    if (url.pathname === '/api/voice' && req.method === 'POST') {
      if (req.headers.get('origin') && new URL(req.headers.get('origin')!).host !== url.host) return new Response('no', { status: 403 })
      try {
        const form = await req.formData(), f = form.get('file')
        if (!(f instanceof File)) throw new Error('no recording came through')
        if (f.size > 50 * 1024 * 1024) throw new Error('recording is over 50 MB')
        refreshLibraryDir()
        const day = new Date().toLocaleDateString('en-CA'), dir = join(LIBRARY_DIR, 'uploads', day)
        mkdirSync(dir, { recursive: true })
        const ext = ((f.name || '').split('.').pop() || (f.type.includes('mp4') ? 'm4a' : 'webm')).replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'webm'
        const dest = join(dir, `voice-${Date.now().toString(36)}.${ext}`)
        await Bun.write(dest, f)
        const out = mkdtempSync(join(tmpdir(), 'voice-'))
        const p = Bun.spawn(['whisper', dest, '--model', 'turbo', '--language', 'en', '--output_format', 'txt', '--output_dir', out, '--fp16', 'False'], { stdout: 'ignore', stderr: 'pipe' })
        const code = await Promise.race([p.exited, new Promise<number>(r => setTimeout(() => { p.kill(); r(-1) }, 180_000))])
        const txt = code === 0 ? readdirSync(out).filter(n => n.endsWith('.txt')).map(n => readFileSync(join(out, n), 'utf8')).join(' ').replace(/\s+/g, ' ').trim() : ''
        logEvent({ type: 'upload', text: 'voice note', path: dest })
        return Response.json({ ok: true, path: dest, text: txt, transcribed: code === 0 })
      } catch (e) {
        return Response.json({ ok: false, error: (e as Error).message }, { status: 400 })
      }
    }
    // dog-box browser screenshots a thread sent to its page (server.ts web_look)
    if (url.pathname === '/api/shot' && req.method === 'GET') {
      const f = url.searchParams.get('f') ?? ''
      if (!/^\d+-\d+\.png$/.test(f) || !existsSync(join(STATE_DIR, 'shots', f))) return new Response('gone', { status: 404 })
      return new Response(Bun.file(join(STATE_DIR, 'shots', f)), { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=86400' } })
    }
    if (url.pathname === '/api/history' && req.method === 'GET') return Response.json({ events: readHistory(Math.min(2000, Number(url.searchParams.get('limit') ?? 600))) })
    if (url.pathname === '/api/history' && req.method === 'POST') {
      const b = await req.json().catch(() => null) as Record<string, unknown> | null
      if (b && typeof b.type === 'string' && ['said', 'answer', 'permission', 'verdict', 'plan'].includes(b.type)) logEvent(b)
      return Response.json({ ok: true })
    }
    if (url.pathname.startsWith('/api/chats/') && req.method === 'POST') {
      if (req.headers.get('origin') && new URL(req.headers.get('origin')!).host !== url.host) return new Response('no', { status: 403 })
      const b = await req.json().catch(() => ({})) as { id?: string; title?: string }
      let chats = loadChats()
      if (url.pathname === '/api/chats/new') chats = newChat(chats)
      else if (url.pathname === '/api/chats/clear') {
        const c = chats.find(x => x.id === b.id)
        if (!c) return Response.json({ ok: false, error: 'no such chat' }, { status: 400 })
        chats = chats.filter(x => x.id !== b.id)
        if (!c.to) chats = newChat(chats)            // clearing the open one starts a fresh one
      } else if (url.pathname === '/api/chats/clear-old') chats = chats.filter(x => !x.to)
      else if (url.pathname === '/api/chats/title') { const c = chats.find(x => x.id === b.id); if (c) c.title = String(b.title ?? '').slice(0, 60) }
      else return new Response('404', { status: 404 })
      if (!chats.length) chats = [{ id: Date.now().toString(36), from: Date.now() }]
      saveChats(chats)
      return Response.json({ ok: true, chats })
    }
    if (url.pathname === '/api/slots' && req.method === 'GET') return Response.json({ slots: slotsOf(await threads(), loadTasks()) })
    if (url.pathname === '/api/file' && req.method === 'GET') return readOutput(url.searchParams.get('path') ?? '')
    if (url.pathname === '/api/sessions' && req.method === 'GET') return Response.json({ sessions: await otherSessions() })
    if (url.pathname === '/api/track' && req.method === 'POST') { try { track(await req.json()) } catch {} return Response.json({ ok: true }) }
    if (url.pathname === '/api/library' && req.method === 'GET') { refreshLibraryDir(); return Response.json({ dir: LIBRARY_DIR, lacie: lacieUp() || !!process.env.GODDARD_LIBRARY, entries: loadLibrary().slice().reverse() }) }
    if (url.pathname.startsWith('/api/tasks') && req.method === 'POST') {
      if (req.headers.get('origin') && new URL(req.headers.get('origin')!).host !== url.host) return new Response('no', { status: 403 })
      try {
        const b = await req.json() as { id?: string; skill?: string; brief?: string; parent?: string; by?: string; port?: number; mode?: string }
        const tasks = loadTasks()
        if (url.pathname === '/api/tasks/done') {
          const t = tasks.find(t => t.id === b.id)
          if (!t) throw new Error('no such task')
          t.status = 'done'; t.doneAt = Date.now()
          logEvent({ type: 'done', task: t.id, skill: t.skill, port: undefined, took: t.doneAt - t.at })
          { const lib = loadLibrary(); let ch = false; for (const e of lib) if (e.task === t.id && e.live) { e.live = false; ch = true } if (ch) writeFileSync(LIBRARY_INDEX, JSON.stringify(lib, null, 1) + '\n') }
          if (t.port) { t.result = await lastAnswer(t.port).catch(() => undefined); collect(sinceTask(await history(t.port), t), { dog: t.port, task: t }) }
          saveTasks(tasks)
          return Response.json({ ok: true, task: t })
        }
        const skill = String(b.skill ?? '').trim(), brief = String(b.brief ?? '').trim()
        if (!brief) throw new Error('say what it is for')
        if (!skillExists(skill)) throw new Error(`${skill || 'that'} isn't an installed skill`)
        // a named slot must be one of ours and reachable right now; otherwise refuse instead of queueing for it
        if (b.port) {
          const live = await threads()
          const slot = slotsOf(live, tasks).find(s => s.port === Number(b.port))
          if (!slot) {
            const port = Number(b.port), there = live.find(t => t.port === port)
            const n = live.filter(t => !t.home).sort((a, c) => a.port - c.port).findIndex(t => t.port === port)
            const who = there?.home ? 'Home' : n >= 0 ? `Agent ${n + 1}` : `:${port}`
            const why = there ? `${who} isn't an agent slot, so it can't take tasks` : `${who} isn't reachable`
            log(`refused task for ${who} asked by ${b.by === 'home' ? 'home' : 'carl'}: ${why}`)
            logEvent({ type: 'refused', skill, text: why })
            throw new Error(why)
          }
        }
        // the dog whose skill this is takes it, waiting in its own line if it's busy (never whoever's free)
        if (!b.port) { const owner = slotsOf(await threads(), tasks).find(x => x.skill === skill); if (owner) b.port = owner.port }
        const t: Task = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), skill, brief: brief.slice(0, 600),
          parent: b.parent ? String(b.parent).slice(0, 80) : undefined, by: b.by === 'home' ? 'home' : 'carl',
          port: null, status: 'queued', at: Date.now(), ...(b.port ? { want: Number(b.port) } : {}),
          ...(b.port ? { mode: undefined, why: 'you picked the agent' } : route(skill, b.mode)),
        }
        saveTasks([...tasks, t])
        logEvent({ type: 'request', task: t.id, skill: t.skill, by: t.by, text: t.brief, mode: t.mode })
        await assign()
        const after = loadTasks().find(x => x.id === t.id)!
        if (after.status === 'queued') log(`queued task ${t.id} (${t.skill}) asked by ${t.by}: no free slot${t.want ? ` (waiting for :${t.want})` : ''}`)
        return Response.json({ ok: true, task: after, ...(after.status === 'queued' ? { note: 'no free slot, queued' } : {}) })
      } catch (e) {
        return Response.json({ ok: false, error: (e as Error).message }, { status: 400 })
      }
    }
    if (url.pathname === '/api/new' && req.method === 'POST') {
      // Same-origin only: the cookie is SameSite=Strict, and this checks the form came from this page.
      if (req.headers.get('origin') && new URL(req.headers.get('origin')!).host !== url.host) return new Response('no', { status: 403 })
      try {
        const b = await req.json() as { what?: string; server?: string; folder?: string; bg?: boolean; name?: string; mode?: string; role?: string; job?: string }
        const what = String(b.what ?? '').trim()
        if (!what) throw new Error('say what it is for')
        const name = await start(what, String(b.server), String(b.folder), { bg: !!b.bg, name: b.name ? String(b.name) : undefined, mode: MODES.includes(b.mode as Mode) ? b.mode as Mode : undefined, role: b.role ? String(b.role) : undefined, job: b.job ? String(b.job) : undefined })
        return Response.json({ ok: true, name })
      } catch (e) {
        return Response.json({ ok: false, error: (e as Error).message }, { status: 400 })
      }
    }
    // remove a dog (Carl, 2026-10-28: "I need an x to remove dogs"): stop its Claude session, background or window,
    // send its job back to the queue, and drop its role file. Home can't be removed this way.
    if (url.pathname === '/api/dogs/remove' && req.method === 'POST') {
      if (req.headers.get('origin') && new URL(req.headers.get('origin')!).host !== url.host) return new Response('no', { status: 403 })
      try {
        const b = await req.json() as { port?: number }
        const port = Number(b.port)
        const th = (await threads()).find(t => t.port === port)
        if (!th || th.home || !th.name.startsWith('Agent slot')) throw new Error("that isn't one of the dogs")
        await stopThread(port)
        const tasks = loadTasks(); let back = 0
        for (const t of tasks) if (t.status === 'active' && t.port === port) { t.status = 'queued'; t.port = null; delete t.want; back++ }
        if (back) saveTasks(tasks)
        const named = th.name.match(/^Agent slot · (.+)$/)?.[1]
        if (named) for (const ext of ['.md', '.json']) try { unlinkSync(join(DOGS_DIR, dogSlug(named) + ext)) } catch {}
        log(`removed dog ${named ?? `:${port}`}${back ? `, ${back} job(s) back in the queue` : ''}`)
        return Response.json({ ok: true, requeued: back })
      } catch (e) {
        return Response.json({ ok: false, error: (e as Error).message }, { status: 400 })
      }
    }
    // restart the dogs on the same conversation (Carl, 2026-10-29: "Restart the dogs but don't lose thread"): each one
    // is stopped and started again resuming its own Claude session, so it keeps everything it was told, and picks up
    // new hooks (the Go-live gate, save points). Only idle dogs with no job in hand; a busy one is left alone.
    if (url.pathname === '/api/dogs/restart' && req.method === 'POST') {
      if (req.headers.get('origin') && new URL(req.headers.get('origin')!).host !== url.host) return new Response('no', { status: 403 })
      const done: string[] = [], skipped: string[] = []
      const list = await threads(), bg = await bgSessions(), tasks = loadTasks()
      const cfg = config(), server = cfg.servers[0]?.name ?? 'Mac mini', folder = cfg.folders.includes(mindDir()) ? mindDir() : cfg.folders[0]
      for (const t of list) {
        const dog = dogOf(t); if (!dog) continue
        const a = bg.find(x => x.name === t.name)
        if (t.busy || tasks.some(x => x.status === 'active' && x.port === t.port) || !a?.sessionId) { skipped.push(dog); continue }
        const roleFile = join(DOGS_DIR, dogSlug(dog) + '.md'), meta = dogMeta(dog)
        if (!existsSync(roleFile)) { skipped.push(dog); continue }
        waking.set(dog, Date.now())
        await stopThread(t.port).catch(() => {})
        for (let i = 0; i < 20 && (await bgSessions()).some(x => x.id === a.id); i++) await Bun.sleep(500)
        try {
          await start('Goddard OS restarted you to switch on the Go-live gate and save points. Same conversation, same role. Do not reply now; wait quietly for your next task.', server, folder,
            { bg: true, name: t.name, mode: 'creative', roleFile, resume: a.sessionId, ...(meta?.skill ? { skill: meta.skill } : {}) })
          done.push(dog); log(`restarted ${dog} on its own conversation ${a.sessionId.slice(0, 8)}`)
        } catch (e) { skipped.push(`${dog} (${(e as Error).message.slice(0, 60)})`) }
      }
      return Response.json({ ok: true, restarted: done, skipped })
    }
    if (url.pathname === '/api/dogs/ensure' && req.method === 'POST') {
      try { return Response.json({ ok: true, woke: await ensureCoreDogs() }) } catch (e) { return Response.json({ ok: false, error: (e as Error).message }, { status: 400 }) }
    }
    // Goddard makes a dog on Carl's yes (Carl, 2026-10-28: "if I don't have a dog ... suggest the creation of a new dog
    // and a new persona, and then we auto-generate that dog"): draft its role, wake it, wait until it answers
    if (url.pathname === '/api/dogs/create' && req.method === 'POST') {
      try {
        const b = await req.json() as { name?: string; job?: string }
        const name = String(b.name ?? '').replace(/[^\p{L}\p{N} '-]/gu, '').trim().slice(0, 24), job = String(b.job ?? '').trim().slice(0, 400)
        if (!name || !job) throw new Error('give it a name and a job')
        if ((await threads()).some(t => dogOf(t)?.toLowerCase() === name.toLowerCase())) throw new Error(`there's already a dog called ${name}`)
        const role = await draftRole(name, job)
        const cfg = config(), server = cfg.servers[0]?.name ?? 'Mac mini', folder = cfg.folders.includes(mindDir()) ? mindDir() : cfg.folders[0]
        await start(SLOT_BRIEF, server, folder, { bg: true, name: `${SLOT} · ${name}`, mode: 'creative', role, job })
        logEvent({ type: 'request', by: 'home', text: `New dog: ${name}. ${job}` })
        for (let i = 0; i < 60; i++) {
          const slot = slotsOf(await threads(), loadTasks()).find(x => x.dog === name)
          if (slot) { log(`made dog ${name} as Agent ${slot.agent}`); return Response.json({ ok: true, name, agent: slot.agent, port: slot.port }) }
          await Bun.sleep(1000)
        }
        throw new Error(`${name} started but hasn't checked in yet`)
      } catch (e) {
        return Response.json({ ok: false, error: (e as Error).message }, { status: 400 })
      }
    }
    if (url.pathname === '/api/push/key') return Response.json({ key: pushState().vapid.publicKey })
    if (url.pathname === '/api/push/subscribe' && req.method === 'POST') {
      try {
        const b = await req.json() as { sub?: webpush.PushSubscription }
        if (!b.sub?.endpoint || !/^https:\/\//.test(b.sub.endpoint)) throw new Error('no subscription')
        const st = pushState(); st.subs = [...st.subs.filter(x => x.endpoint !== b.sub!.endpoint), b.sub].slice(-6); savePush(st)
        return Response.json({ ok: true })
      } catch (e) { return Response.json({ ok: false, error: (e as Error).message }, { status: 400 }) }
    }
    // a dog blocked on a permission can't wait for the hourly digest (permit.ts calls this)
    if (url.pathname === '/api/push/urgent' && req.method === 'POST') {
      const b = await req.json().catch(() => ({})) as { who?: string; text?: string }
      await notify(`${String(b.who ?? 'A dog')} needs your OK`, String(b.text ?? '').slice(0, 160), 'perm')
      return Response.json({ ok: true })
    }
    if (url.pathname === '/api/push/test' && req.method === 'POST') {
      await notify('Goddard', 'Check-ins are on, boss. I\'ll ping you when a dog needs you or comes back.', 'test', true)
      return Response.json({ ok: true })
    }
    // long-running plans (Carl, 2026-10-28: "time based action plans over a long time"): Goddard saves them once Carl
    // says they look right; the Plans screen shows them; check-ins act on what's due
    // the setup screen (2026-10-30): read the owner's profile, save it, and test one part before turning it on
    if (url.pathname === '/api/profile' && req.method === 'GET') return Response.json({ profile: profile(), exists: existsSync(PROFILE_FILE) })
    if (url.pathname === '/api/profile' && req.method === 'POST') {
      const b = await req.json().catch(() => null) as Partial<Profile> | null
      if (!b?.owner?.name?.trim()) return Response.json({ error: 'A name is needed' }, { status: 400 })
      saveProfile({ ...profile(), ...b, owner: { ...profile().owner, ...b.owner, name: b.owner.name.trim().slice(0, 40) } })
      // the door's folders were written at its first start, before Setup: a notes folder chosen now becomes Home's folder
      const cfg = config(), mem = profile().memory
      if (mem?.on && mem.path && cfg.home.folder === '~')
        writeFileSync(CONFIG_FILE, JSON.stringify({ ...cfg, home: { folder: mem.path }, folders: [...new Set([mem.path, ...cfg.folders.filter(f => f !== '~')])] }, null, 2) + '\n', { mode: 0o600 })
      logEvent({ type: 'request', by: 'carl', text: 'Setup saved' })
      return Response.json({ ok: true, profile: profile() })
    }
    if (url.pathname === '/api/profile/test' && req.method === 'POST') {
      const b = await req.json().catch(() => ({})) as { part?: string; value?: Record<string, string> }
      return Response.json(await testPart(String(b.part ?? ''), b.value ?? {}))
    }
    if (url.pathname === '/api/digest' && req.method === 'GET') return Response.json(await digest())
    if (url.pathname === '/api/plans' && req.method === 'GET') return Response.json({ plans: loadPlans() })
    if (url.pathname === '/api/plans' && req.method === 'POST') {
      try {
        const b = await req.json() as Partial<Plan>
        const plans = loadPlans(), at = Date.now()
        const old = b.id ? plans.find(x => x.id === b.id) : undefined
        const date = (d: unknown) => { const v = String(d ?? '').slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`dates are YYYY-MM-DD (got "${v}")`); return v }
        const plan: Plan = {
          id: old?.id ?? at.toString(36), goal: String(b.goal ?? old?.goal ?? '').slice(0, 120), by: date(b.by ?? old?.by),
          owner: String(b.owner ?? old?.owner ?? '').slice(0, 30), next: String(b.next ?? old?.next ?? '').slice(0, 160),
          milestones: (Array.isArray(b.milestones) ? b.milestones : old?.milestones ?? []).slice(0, 8).map(m => ({ date: date(m.date), what: String(m.what ?? '').slice(0, 100), done: !!m.done })),
          remember: (Array.isArray(b.remember) ? b.remember : old?.remember ?? []).slice(0, 8).map(r => String(r).slice(0, 160)),
          status: b.status ?? old?.status ?? 'active', at: old?.at ?? at, updated: at,
        }
        if (!plan.goal || !plan.milestones.length) throw new Error('a plan needs a goal and milestones')
        writeFileSync(PLANS_FILE, JSON.stringify([...plans.filter(x => x.id !== plan.id), plan], null, 1), { mode: 0o600 })
        log(`plan saved: ${plan.goal}`)
        return Response.json({ ok: true, plan })
      } catch (e) { return Response.json({ ok: false, error: (e as Error).message }, { status: 400 }) }
    }
    // a session (Carl, 2026-10-28): someone brings an artifact, and a dog builds the system and the plan around it, then
    // works it with them one question at a time (session.md). Not a pack dog: no role file, so the watchdog leaves it be.
    if (url.pathname === '/api/session/start' && req.method === 'POST') {
      if (req.headers.get('origin') && new URL(req.headers.get('origin')!).host !== url.host) return new Response('no', { status: 403 })
      try {
        const b = await req.json() as { artifact?: string; want?: string; title?: string; auto?: boolean; mode?: string }
        const mode = asMode(b.mode) ?? 'plan'
        let artifact = String(b.artifact ?? '').trim().slice(0, 4000)
        const want = String(b.want ?? '').trim().slice(0, 600)
        // Auto: the toggle, or a first message that starts with "auto" (Carl, 2026-10-29; 45-minute cap)
        const auto = mode === 'plan' && (!!b.auto || /^\s*auto\b/i.test(artifact))
        if (auto) artifact = artifact.replace(/^\s*auto\b[\s:,.-]*/i, '').trim() || artifact
        if (!artifact) throw new Error('bring something: a file, a link or a note')
        // a plain chat needs no scoping pass; a plan or a job does
        const scope = mode === 'talk' ? null : await scopeFirst(want ? `${artifact}\n\n${want}` : artifact)
        let title = String(b.title ?? '').replace(/[^\p{L}\p{N} '.-]/gu, '').trim().slice(0, 30)
          || (scope?.title ?? '').replace(/[^\p{L}\p{N} '.-]/gu, '').trim().slice(0, 30)
          || artifact.replace(/https?:\/\/\S+|📎/g, '').replace(/[^\p{L}\p{N} '.-]/gu, ' ').trim().split(/\s+/).slice(0, 4).join(' ').slice(0, 30) || 'New session'
        const names = new Set((await threads()).map(t => t.name))
        if (names.has(`Session · ${title}`)) title = `${title} ${Date.now().toString(36).slice(-3)}`
        const cfg = config(), server = cfg.servers[0]?.name ?? 'Mac mini', folder = cfg.folders.includes(mindDir()) ? mindDir() : cfg.folders[0]
        const brief = scope ? [
          'Scoped brief (a back-end pass tightened their message; their words above win wherever they differ):',
          `- Working on: ${scope.thing}`, scope.outcome ? `- They want: ${scope.outcome}` : '- They did not say what they want yet.',
          ...(scope.done_looks_like.length ? ['- Done looks like:', ...scope.done_looks_like.map(d => `  - ${d}`)] : []),
          ...(scope.not_now.length ? [`- Not part of this session unless they say so: ${scope.not_now.join('; ')}`] : []),
          scope.unclear ? `- Still unclear, ask this first: ${scope.unclear}` : '',
        ].filter(Boolean).join('\n') : 'No scoped brief this time: scope it yourself from their words.'
        const kickoff = mode === 'plan' ? null : mode === 'talk'
          ? `New chat (Just talk).\nCarl's words:\n${artifact}${want ? `\n${want}` : ''}\n---\nAnswer them with the reply tool. No plan, no sheet.`
          : `New job (Just do it).\nCarl's words:\n${artifact}${want ? `\n${want}` : ''}\n---\n${brief}\nRestate the job in one line with the status tool and start at once. No plan to approve.`
        const what = kickoff ?? `New session.\nCarl's words:\n${artifact}${want ? `\n${want}` : ''}\n---\n${brief}\n${auto ? '\nAuto is on (45 minutes): run this session end to end yourself, per the Auto rules in your role. Do not wait for their Go or their answers; park what only they can decide.\n' : ''}\nLook at what they brought properly. Keep the session inside this scope: use "Done looks like" for the done conditions where it fits, and if something is still unclear ask that one question first. Then set up the system with the system tool and wait for their Go.`
        const name = `Session · ${title}`
        setMode(name, mode)
        await start(what, server, folder, { bg: true, name, mode: 'creative', roleFile: modeRole(mode), ...(auto ? { env: { GM_CHAT_AUTO_UNTIL: String(Date.now() + 45 * 60_000) } } : {}) })
        logEvent({ type: 'request', by: 'carl', text: `Session (${MODE_NAME[mode]}): ${title}` })
        for (let i = 0; i < 60; i++) {
          const th = (await threads()).find(t => t.name === name)
          if (th) return Response.json({ ok: true, port: th.port, name })
          await Bun.sleep(1000)
        }
        throw new Error('the session started but has not checked in yet')
      } catch (e) { return Response.json({ ok: false, error: (e as Error).message }, { status: 400 }) }
    }
    // the session's output (Carl, 2026-10-28: "there is no output to see the final artifact"): the board written out as
    // a real document in the Goddard Library, so it can be opened, kept, and brought into the next session
    // switch a running session's mode: the new mode's instructions go to it now, and it relaunches with them next time
    if (url.pathname === '/api/session/mode' && req.method === 'POST') {
      if (req.headers.get('origin') && new URL(req.headers.get('origin')!).host !== url.host) return new Response('no', { status: 403 })
      try {
        const b = await req.json().catch(() => ({})) as { port?: number; mode?: string }
        const mode = asMode(b.mode); if (!mode) throw new Error('pick Plan it, Just talk or Just do it')
        const th = (await threads()).find(t => t.port === Number(b.port))
        if (!th || !th.name.startsWith('Session · ')) throw new Error("that isn't a session")
        const was = modeOf(th.name)
        if (was === mode) return Response.json({ ok: true, mode })
        setMode(th.name, mode)
        const role = ownFile(modeRole(mode), LAUNCH_DIR)
        await say(th.port, [
          `Carl switched this chat from ${MODE_NAME[was]} to ${MODE_NAME[mode]}. From now on, follow these instructions instead of the ${MODE_NAME[was]} ones (they replace them; the conversation so far stays):`,
          '', readFileSync(role, 'utf8'), '',
          mode === 'plan' ? 'Start now: set up the system with the system tool from what this chat already covered, and wait for their Go.'
            : mode === 'do' ? 'Start now: restate the job in one line with the status tool and carry on with the work.'
            : 'Reply in one line that you\'re in Just talk now, then carry on the conversation.',
        ].join('\n'), 'system')
        logEvent({ type: 'request', by: 'carl', text: `Switched ${th.name.replace(/^Session · /, '')} to ${MODE_NAME[mode]}` })
        return Response.json({ ok: true, mode })
      } catch (e) { return Response.json({ ok: false, error: (e as Error).message }, { status: 400 }) }
    }
    if (url.pathname === '/api/session/save' && req.method === 'POST') {
      if (req.headers.get('origin') && new URL(req.headers.get('origin')!).host !== url.host) return new Response('no', { status: 403 })
      try {
        const b = await req.json().catch(() => ({})) as { port?: number; next?: string }
        const th = (await threads()).find(t => t.port === Number(b.port))
        if (!th || !th.name.startsWith('Session · ')) throw new Error("that isn't a session")
        if (!th.board) throw new Error('this session has no system yet')
        const path = writeSessionDoc(th.name.replace(/^Session · /, ''), th.board, String(b.next ?? '').slice(0, 300))
        fetch(`http://127.0.0.1:${th.port}/finished`, { method: 'POST', headers: { 'x-gm-chat': TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ path, next: b.next ?? '' }), signal: AbortSignal.timeout(3000) }).catch(() => {})
        return Response.json({ ok: true, path })
      } catch (e) { return Response.json({ ok: false, error: (e as Error).message }, { status: 400 }) }
    }
    // sessions worth hopping into (Carl, 2026-10-29: "have suggestions for sessions to hop into"), only from real things:
    // what a finished session said comes next, a session that stopped before done, a recent upload, his goal tasks
    // reopen an unfinished session: same name (so its board comes back), same conversation when it can be found
    if (url.pathname === '/api/session/reopen' && req.method === 'POST') {
      if (req.headers.get('origin') && new URL(req.headers.get('origin')!).host !== url.host) return new Response('no', { status: 403 })
      try {
        const b = await req.json() as { title?: string }
        const name = `Session · ${String(b.title ?? '').trim()}`
        const live = (await threads()).find(t => t.name === name)
        if (live) return Response.json({ ok: true, port: live.port, name, resumed: true })
        const mode = modeOf(name)
        let board: SessionBoard | null = null
        try { board = JSON.parse(readFileSync(join(STATE_DIR, 'boards', boardSlug(name) + '.json'), 'utf8')) } catch { if (mode === 'plan') throw new Error("that session's board isn't on file") }
        const cfg = config(), server = cfg.servers[0]?.name ?? 'Mac mini', folder = cfg.folders.includes(mindDir()) ? mindDir() : cfg.folders[0]
        const id = board ? sessionIdFor(name, board, folder) : (() => { try { return readFileSync(join(STATE_DIR, 'boards', boardSlug(name) + '.session'), 'utf8').trim() || undefined } catch { return undefined } })()
        if (!board && !id) throw new Error("that chat's conversation isn't on file")
        const open = (board?.done ?? []).filter(d => !d.met).map(d => d.what)
        const what = !board ? `Carl reopened this ${MODE_NAME[mode]} chat from Home. Same conversation. gm-chat is connected again: use the reply tool now (load it with ToolSearch if it is deferred). In one reply: one line on where it stands, then what's next.`
          : id
          ? 'Carl reopened this session from Home. Same conversation, and your board is loaded. gm-chat is connected again: if it dropped earlier, that was the old page closing, so use the reply tool now (load it with ToolSearch if it is deferred). In one reply: one line on where it stands, then the next question, with choices.'
          : `Carl reopened this session from Home. Your board is loaded (it is the system you set up): ${board.artifact}. Goal: ${board.goal}. Phase ${Math.min(board.now + 1, board.phases.length)} of ${board.phases.length}: ${board.phases[Math.min(board.now, board.phases.length - 1)]}. Sheet so far:\n${board.sheet.filter(r => r.value.trim()).map(r => `- ${r.name}: ${r.value}`).join('\n')}\nNot done yet: ${open.join('; ') || 'nothing'}.\nDo not set the system up again. In one reply: one line on where it stands, then the next question, with choices.`
        await start(what, server, folder, { bg: true, name, mode: 'creative', roleFile: modeRole(mode), ...(id ? { resume: id } : {}) })
        logEvent({ type: 'request', by: 'carl', text: `Reopened session: ${b.title}` })
        for (let i = 0; i < 60; i++) {
          const th = (await threads()).find(t => t.name === name)
          if (th) return Response.json({ ok: true, port: th.port, name, resumed: !!id })
          await Bun.sleep(1000)
        }
        throw new Error('the session started but has not checked in yet')
      } catch (e) { return Response.json({ ok: false, error: (e as Error).message }, { status: 400 }) }
    }
    if (url.pathname === '/api/session/ideas' && req.method === 'GET') {
      type Idea = { title: string; why: string; brought: string; want: string; from: string; reopen?: string }
      const ideas: Idea[] = [], running = new Set((await threads()).map(t => t.name))
      let files: string[] = []
      try { files = readdirSync(join(STATE_DIR, 'boards')).filter(f => f.endsWith('.json')) } catch {}
      const boards = files.map(f => { try { const b = JSON.parse(readFileSync(join(STATE_DIR, 'boards', f), 'utf8')) as SessionBoard; return { f, b, title: f.replace(/^Session-/, '').replace(/\.json$/, '').replace(/-/g, ' ') } } catch { return null } })
        .filter(Boolean).sort((a, b) => b!.b.at - a!.b.at) as { f: string; b: SessionBoard; title: string }[]
      for (const { b, title } of boards) {
        if (running.has(`Session · ${title}`)) continue
        // carried on already: a later session picked this one's sheet up (Continue in a new session)
        const stem = (t: string) => t.toLowerCase().split(' ').slice(0, 3).join(' ')
        if (boards.some(o => o.b.at > b.at && (stem(o.title) === stem(title) || o.b.artifact.includes(title.slice(0, 18))))) continue
        const next = b.finished?.next || b.next
        if (b.finished && next) ideas.push({ title: `Next for ${title}`, why: next, brought: `📎 ${title} (session sheet): ${b.finished.path}`, want: next, from: 'carry-on' })
        else if (!b.finished) { const left = (b.done ?? []).filter(d => !d.met).length; ideas.push({ title: `Finish ${title}`, why: left ? `${left} done condition${left === 1 ? '' : 's'} still open` : `stopped at phase ${Math.min(b.now + 1, b.phases.length)} of ${b.phases.length}`, brought: `${b.artifact}\nGoal: ${b.goal}\nSheet so far:\n${b.sheet.filter(r => r.value.trim()).map(r => `- ${r.name}: ${r.value}`).join('\n')}`.slice(0, 3500), want: `Pick it up where we left off and get it to done`, from: 'unfinished', reopen: title }) }
      }
      const used = boards.map(x => x.b.artifact + ' ' + x.b.sheet.map(r => r.value).join(' ')).join(' ')
      for (const e of loadLibrary().filter(e => e.source === 'upload' && Date.now() - e.at < 3 * 86400_000 && e.path && !used.includes(basename(e.path))).sort((a, b) => b.at - a.at).slice(0, 2))
        ideas.push({ title: e.title.startsWith('voice') ? 'Your voice note' : e.title, why: `you added it ${new Date(e.at).toLocaleDateString('en-US', { weekday: 'long' })}, not worked yet`, brought: `📎 ${e.title}: ${e.path}`, want: '', from: 'upload' })
      // goal suggestions from the owner's own task file, when their profile names one (memory.goals)
      const goals = has('memory') ? profile().memory?.goals : undefined
      if (goals) try {
        const ts = JSON.parse(readFileSync(home(goals), 'utf8')) as { tasks?: { task: string; why: string }[] }
        for (const t of (ts.tasks ?? []).slice(0, 2)) ideas.push({ title: t.task, why: t.why, brought: t.task, want: t.why, from: 'goals' })
      } catch {}
      return Response.json({ ok: true, ideas: ideas.slice(0, 6) })
    }
    // save points (savepoint.ts) and undo (undo.ts): every repo a session changed has its before-picture
    if (url.pathname === '/api/session/saves' && req.method === 'GET') {
      let saves: { root: string; commit: string; at: number }[] = []
      try { saves = JSON.parse(readFileSync(join(STATE_DIR, 'savepoints', `${Number(url.searchParams.get('port'))}.json`), 'utf8')) } catch {}
      return Response.json({ ok: true, saves: saves.map(x => ({ ...x, repo: basename(x.root) })) })
    }
    if (url.pathname === '/api/session/undo' && req.method === 'POST') {
      if (req.headers.get('origin') && new URL(req.headers.get('origin')!).host !== url.host) return new Response('no', { status: 403 })
      const b = await req.json().catch(() => ({})) as { port?: number; commit?: string }
      let saves: { root: string; commit: string }[] = []
      try { saves = JSON.parse(readFileSync(join(STATE_DIR, 'savepoints', `${Number(b.port)}.json`), 'utf8')) } catch {}
      const sp = saves.find(x => x.commit === b.commit)
      if (!sp) return Response.json({ ok: false, error: "that save point isn't on file" }, { status: 400 })
      const p = Bun.spawn(['bun', join(HERE, 'undo.ts'), sp.root, sp.commit], { stdout: 'pipe', stderr: 'ignore' })
      const r = JSON.parse((await new Response(p.stdout).text()).trim() || '{"ok":false,"error":"undo said nothing"}')
      logEvent({ type: 'request', by: 'carl', text: `Undo ${basename(sp.root)} to the save point: ${r.ok ? `${r.restored} files back, ${r.removed} new files removed` : r.error}` })
      log(`undo ${sp.root} -> ${sp.commit.slice(0, 8)}: ${JSON.stringify(r)}`)
      return Response.json(r, { status: r.ok ? 200 : 400 })
    }
    if (url.pathname === '/api/session/end' && req.method === 'POST') {
      if (req.headers.get('origin') && new URL(req.headers.get('origin')!).host !== url.host) return new Response('no', { status: 403 })
      const b = await req.json().catch(() => ({})) as { port?: number }
      const th = (await threads()).find(t => t.port === Number(b.port))
      if (!th || !th.name.startsWith('Session · ')) return Response.json({ ok: false, error: "that isn't a session" }, { status: 400 })
      // ending always leaves the output behind
      let path: string | undefined
      if (th.board) path = (th.board as SessionBoard).finished?.path ?? writeSessionDoc(th.name.replace(/^Session · /, ''), th.board as SessionBoard, '')
      await stopThread(th.port); log(`ended ${th.name}`)
      return Response.json({ ok: true, path })
    }
    // every scheduled job across the Mac, the Proxmox box and Hermes (Carl, 2026-10-29: "track all cron jobs made"),
    // from the gm-crons scanner; cached for two minutes so the page stays quick
    if (url.pathname === '/api/crons' && req.method === 'GET') {
      if (!cronCache || Date.now() - cronCache.at > 120_000 || url.searchParams.has('fresh')) {
        const p = Bun.spawn(['python3', home(mindDir() + '/skills/gm-crons/crons.py'), '--json'], { stdout: 'pipe', stderr: 'ignore' })
        const out = await new Response(p.stdout).text()
        try { cronCache = { at: Date.now(), data: JSON.parse(out) } } catch { return Response.json({ ok: false, error: "couldn't read the schedules" }, { status: 500 }) }
      }
      return Response.json({ ok: true, at: cronCache.at, ...cronCache.data })
    }
    if (url.pathname === '/api/recipes' && req.method === 'GET') return Response.json({ recipes: loadRecipes() })
    if (url.pathname === '/api/recipes' && req.method === 'POST') {
      const b = await req.json().catch(() => ({})) as Partial<Recipe> & { remove?: string }
      const all = loadRecipes()
      if (b.remove) { saveRecipes(all.filter(r => r.id !== b.remove)); return Response.json({ ok: true }) }
      const title = String(b.title ?? '').trim().slice(0, 40), skill = String(b.skill ?? '').trim(), brief = String(b.brief ?? '').trim().slice(0, 4000)
      if (!title || !skill || !brief) return Response.json({ ok: false, error: 'a recipe needs a name, a skill and a brief' }, { status: 400 })
      const r: Recipe = { id: Date.now().toString(36), title, skill, brief, at: Date.now() }
      saveRecipes([...all, r].slice(-12)); log(`recipe saved: ${title}`)
      return Response.json({ ok: true, recipe: r })
    }
    if (url.pathname === '/api/owns' && req.method === 'GET') return Response.json({ text: owns() })
    if (url.pathname === '/api/owns' && req.method === 'POST') {
      const b = await req.json().catch(() => ({})) as { text?: string }
      if (typeof b.text !== 'string' || !b.text.trim()) return Response.json({ ok: false, error: 'empty' }, { status: 400 })
      writeFileSync(OWNS_FILE, b.text.slice(0, 6000), { mode: 0o600 })
      return Response.json({ ok: true })
    }
    if (url.pathname === '/api/dogs/draft' && req.method === 'POST') {
      if (req.headers.get('origin') && new URL(req.headers.get('origin')!).host !== url.host) return new Response('no', { status: 403 })
      try {
        const b = await req.json() as { name?: string; job?: string }
        const name = String(b.name ?? '').trim().slice(0, 24), job = String(b.job ?? '').trim().slice(0, 400)
        if (!name || !job) throw new Error('give it a name and a job')
        return Response.json({ ok: true, role: await draftRole(name, job) })
      } catch (e) {
        return Response.json({ ok: false, error: (e as Error).message }, { status: 400 })
      }
    }
    if (url.pathname === '/api/home' && req.method === 'POST') {
      if (req.headers.get('origin') && new URL(req.headers.get('origin')!).host !== url.host) return new Response('no', { status: 403 })
      try {
        return Response.json({ ok: true, name: await startHome() })
      } catch (e) {
        return Response.json({ ok: false, error: (e as Error).message }, { status: 400 })
      }
    }
    return new Response('404', { status: 404 })
  },
})

writeFileSync(join(STATE_DIR, 'link.txt'), `http://${lanAddress()}:${DOOR_PORT}/?p=${TOKEN}\n`, { mode: 0o600 })
process.stderr.write(`gm-door: http://${lanAddress()}:${DOOR_PORT}/\n`)

const HTML = `${HEAD}
<title>GM! Claude</title>
<style>
header { position: sticky; top: 0; background: var(--paper); border-bottom: 1.5px dashed var(--line); padding: calc(10px + env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 10px max(16px, env(safe-area-inset-left)); display: flex; justify-content: space-between; align-items: center; z-index: 2; gap: 12px }
.logo { font-family: var(--display); font-size: 26px; letter-spacing: .02em }
.logo b { color: var(--gold); font-weight: 400 }
.pill { font-family: var(--mono); font-size: 11px; letter-spacing: .06em; text-transform: uppercase; padding: 3px 9px; border-radius: 999px; border: 1px solid currentColor }
.pill.on { color: var(--ok) } .pill.off { color: var(--warn) }
main { max-width: 720px; margin: 0 auto; padding: 16px max(16px, env(safe-area-inset-right)) 120px max(16px, env(safe-area-inset-left)); display: flex; flex-direction: column; gap: 12px }
.label { font-family: var(--mono); font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); margin-top: 6px }
.t { display: block; text-decoration: none; color: var(--ink); background: var(--card); border: 1.5px solid var(--ink); box-shadow: 3px 3px 0 var(--ink); border-radius: 4px; padding: 12px 14px }
.t.need { background: var(--gold-soft); border: 2px solid var(--gold); box-shadow: none }
.t.home { background: var(--ink); color: var(--paper); box-shadow: 3px 3px 0 var(--gold) }
.t.home .sub { color: var(--line) } .t.home .tag.done { color: var(--gold) }
.t.home .name { font-family: var(--display); font-weight: 400; font-size: 22px; letter-spacing: .03em }
.homeoff { display: flex; justify-content: space-between; align-items: center; gap: 12px; border: 2px dashed var(--ink); border-radius: 4px; padding: 12px 14px }
.homeoff b { font-family: var(--display); font-weight: 400; font-size: 22px; letter-spacing: .03em; display: block }
.homeoff span { font-size: 14px; color: var(--muted) }
.homeoff button { font-family: var(--display); font-size: 17px; letter-spacing: .04em; padding: 10px 14px; border-radius: 4px; border: 1.5px solid var(--ink); background: var(--ink); color: var(--paper); cursor: pointer; flex: none }
.t .top { display: flex; justify-content: space-between; align-items: center; gap: 10px }
.t .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.t .sub { font-family: var(--mono); font-size: 12.5px; color: var(--muted); margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.tag { font-family: var(--mono); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; flex: none }
.tag.need { color: var(--warn) } .tag.done { color: var(--ok) }
.dots { display: flex; gap: 4px; flex: none }
.dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--gold); animation: hop 1.1s infinite ease-in-out }
.dots i:nth-child(2) { animation-delay: .15s } .dots i:nth-child(3) { animation-delay: .3s }
@keyframes hop { 0%, 60%, 100% { transform: translateY(0); opacity: .45 } 30% { transform: translateY(-5px); opacity: 1 } }
@media (prefers-reduced-motion: reduce) { .dots i { animation: none; opacity: .8 } }
.none { color: var(--muted); padding: 8px 0 }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px }
.box { border: 1.5px solid var(--line); border-radius: 4px; padding: 8px 10px; font-size: 14px }
.box .d { color: var(--ok) } .box.down { color: var(--muted) } .box.down .d { color: var(--warn) }
.bar { position: fixed; bottom: 0; left: 0; right: 0; background: var(--paper); border-top: 1.5px dashed var(--line); padding: 12px max(16px, env(safe-area-inset-right)) calc(14px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)) }
.bar > * { max-width: 720px; margin: 0 auto; display: block; width: 100% }
.big { font-family: var(--display); font-size: 20px; letter-spacing: .04em; padding: 12px 0; border-radius: 4px; border: 1.5px solid var(--ink); background: var(--gold); color: #070707; cursor: pointer; width: 100% }
.big:disabled { opacity: .5 }
button:focus-visible, textarea:focus-visible, a:focus-visible { outline: 3px solid var(--gold); outline-offset: 2px }
#new[hidden], #home[hidden] { display: none }
.back { font-family: var(--mono); font-size: 13px; color: var(--ink); background: none; border: 0; padding: 10px 0; cursor: pointer; text-align: left }
textarea { font: inherit; border: 1.5px solid var(--ink); border-radius: 4px; padding: 10px 12px; background: var(--card); color: var(--ink); resize: none; width: 100% }
.pick { font: inherit; font-size: 15px; text-align: left; min-height: 48px; padding: 8px 10px; border: 1.5px solid var(--line); border-radius: 4px; background: var(--card); color: var(--ink); cursor: pointer }
.pick[aria-pressed="true"] { background: var(--ink); color: var(--paper); border: 2px solid var(--ink); font-weight: 600 }
.pick:disabled { background: transparent; border-style: dashed; color: var(--muted) }
.chips { display: flex; flex-wrap: wrap; gap: 8px }
.chips .pick { font-family: var(--mono); font-size: 13px; min-height: 44px; border-radius: 999px; padding: 6px 12px }
.note { font-size: 14px; color: var(--muted); border-top: 1.5px dashed var(--line); padding-top: 12px }
.err { color: var(--warn); font-size: 14px }
.toast { background: var(--gold-soft); border: 2px solid var(--gold); border-radius: 4px; padding: 10px 12px; font-size: 14px }
</style>
<header><div class="logo">GM<b>!</b> Claude</div><span id="st" class="pill off">connecting</span></header>

<main id="home">
  <div id="toast"></div>
  <div id="home-slot"></div>
  <div class="label" id="count">Your threads</div>
  <div id="threads"></div>
  <div class="label">Your servers</div>
  <div class="grid" id="servers"></div>
</main>

<main id="new" hidden>
  <button class="back" type="button" id="cancel">← Back</button>
  <div style="font-family:var(--display);font-size:28px">New thread</div>
  <label class="label" for="what">1 · What's it for?</label>
  <textarea id="what" rows="3" placeholder="Clean up old Hermes backups"></textarea>
  <div class="label">2 · Which server?</div>
  <div class="grid" id="pickServer"></div>
  <div class="label">3 · Which folder on the Mac?</div>
  <div class="chips" id="pickFolder"></div>
  <div class="note" id="explain">A new Claude window opens on the Mac. It shows up on your thread list.</div>
  <div class="err" id="err"></div>
</main>

<div class="bar"><button class="big" type="button" id="go">+ NEW THREAD</button></div>

<script>
const $ = id => document.getElementById(id)
let data = { threads: [], servers: [], folders: [] }, mode = 'home', pick = { server: null, folder: null }, starting = false

function ago(at) {
  const s = Math.round((Date.now() - at) / 1000)
  return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : Math.round(s / 3600) + ' h ago'
}
function el(tag, cls, text) { const d = document.createElement(tag); if (cls) d.className = cls; if (text != null) d.textContent = text; return d }

function card(t) {
    const a = el('a', 't' + (t.home ? ' home' : t.needsYou ? ' need' : ''))
    a.href = location.protocol + '//' + location.hostname + ':' + t.port + '/'
    const top = el('div', 'top'); top.append(el('div', 'name', t.name))
    if (t.needsYou) top.append(el('span', 'tag need', 'Needs you'))
    else if (t.busy) { const d = el('span', 'dots'); d.setAttribute('aria-label', 'Working'); d.append(el('i'), el('i'), el('i')); top.append(d) }
    else if (t.last.text.startsWith('✓') || t.last.text === 'Replied') top.append(el('span', 'tag done', 'Done'))
    const what = t.needsYou ? 'waiting on your ALLOW / NO' : t.busy ? (t.doing || 'Working') + '…' : (t.last.text || 'Ready') + ' · ' + ago(t.last.at)
    a.append(top, el('div', 'sub', (t.home ? 'You + Goddard' : t.server) + ' · ' + what))
    return a
}

function drawHome() {
  const homeT = data.threads.find(t => t.home), rest = data.threads.filter(t => !t.home)
  const slot = $('home-slot'); slot.replaceChildren()
  if (homeT) slot.append(card(homeT))
  else {
    const d = el('div', 'homeoff'), txt = el('div')
    txt.append(el('b', '', 'Home'), el('span', '', 'Your always-open chat with Goddard on hand.'))
    const b = el('button', '', 'START HOME'); b.type = 'button'; b.onclick = startHome
    d.append(txt, b); slot.append(d)
  }
  const list = $('threads'); list.replaceChildren()
  $('count').textContent = 'Your threads · ' + (rest.length ? rest.length + ' running' : 'none yet')
  if (!rest.length) list.append(el('div', 'none', 'Tap NEW THREAD to start one.'))
  for (const t of rest) list.append(card(t))
  const grid = $('servers'); grid.replaceChildren()
  for (const s of data.servers) {
    const b = el('div', 'box' + (s.up ? '' : ' down')); b.append(el('span', 'd', '● '), s.name + (s.up ? '' : ' · off')); grid.append(b)
  }
}

function drawNew() {
  const sv = $('pickServer'); sv.replaceChildren()
  for (const s of data.servers) {
    const b = el('button', 'pick', (pick.server === s.name ? '✓ ' : '') + s.name + (s.up ? '' : ' · off'))
    b.type = 'button'; b.disabled = !s.up; b.setAttribute('aria-pressed', pick.server === s.name)
    b.onclick = () => { pick.server = s.name; drawNew() }
    sv.append(b)
  }
  const fl = $('pickFolder'); fl.replaceChildren()
  for (const f of data.folders) {
    const b = el('button', 'pick', f); b.type = 'button'; b.setAttribute('aria-pressed', pick.folder === f)
    b.onclick = () => { pick.folder = f; drawNew() }
    fl.append(b)
  }
  $('explain').textContent = pick.server && pick.server !== 'Mac mini'
    ? 'A new Claude window opens on the Mac and reaches ' + pick.server + ' over SSH. It shows up on your thread list.'
    : 'A new Claude window opens on the Mac. It shows up on your thread list.'
  $('go').textContent = 'START IT'
  $('go').disabled = starting || !$('what').value.trim() || !pick.server || !pick.folder
}

function show(m) {
  mode = m; $('home').hidden = m !== 'home'; $('new').hidden = m !== 'new'; $('err').textContent = ''
  if (m === 'home') { $('go').textContent = '+ NEW THREAD'; $('go').disabled = false; drawHome() }
  else { pick.server = pick.server || data.servers[0]?.name; pick.folder = pick.folder || data.folders[0]; drawNew(); $('what').focus() }
  scrollTo(0, 0)
}

async function poll() {
  try {
    const r = await fetch('/api/list'); if (!r.ok) throw 0
    data = await r.json(); $('st').textContent = 'Mac · online'; $('st').className = 'pill on'
    if (mode === 'home') drawHome()
  } catch { $('st').textContent = 'offline'; $('st').className = 'pill off' }
}

$('go').onclick = async () => {
  if (mode === 'home') return show('new')
  starting = true; drawNew(); $('go').textContent = 'OPENING ON THE MAC…'
  try {
    const r = await fetch('/api/new', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ what: $('what').value, server: pick.server, folder: pick.folder }) })
    const j = await r.json(); if (!j.ok) throw new Error(j.error)
    $('what').value = ''
    $('toast').replaceChildren(el('div', 'toast', 'Opening "' + j.name + '" on the Mac. If the window asks a question, answer it there once. It shows up here in a few seconds.'))
    show('home')
  } catch (e) { $('err').textContent = e.message || 'Something went wrong.' }
  starting = false; if (mode === 'new') drawNew()
}
async function startHome() {
  try {
    const r = await fetch('/api/home', { method: 'POST' }); const j = await r.json(); if (!j.ok) throw new Error(j.error)
    $('toast').replaceChildren(el('div', 'toast', 'Opening Home on the Mac. Tap 1 in the window once. It shows up here in a few seconds.'))
  } catch (e) { $('toast').replaceChildren(el('div', 'toast', e.message || 'Something went wrong.')) }
}
$('cancel').onclick = () => show('home')
$('what').oninput = drawNew
poll(); setInterval(poll, 2500)
</script>`
