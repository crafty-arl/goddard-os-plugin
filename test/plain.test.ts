// Plain-session tests: what the plugin gives a Claude session the owner opened themselves. Runs the plugin's own tool
// server and hook scripts directly with a stand-in session id, on an empty state folder.
//
//   ./bundle.sh && bun test test/plain.test.ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', 'plugin')
const T = mkdtempSync(join(tmpdir(), 'goddard-plain-'))
const STATE = join(T, 'state'), WORK = join(T, 'work')
const SID = 'aaaabbbb-1111-2222-3333-444455556666'
const env = { ...process.env, GM_CHAT_STATE: STATE, CLAUDE_CODE_SESSION_ID: SID, CLAUDE_PROJECT_DIR: WORK, GM_DOOR_PORT: '8798', GM_CHAT_PORT: undefined, GM_CHAT_NAME: undefined }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const sessions = () => readdirSync(join(STATE, 'sessions')).filter(f => f.endsWith('.json'))

function gate(script: string, event: object) {
  const p = Bun.spawnSync(['sh', join(ROOT, 'bin', 'gate.sh'), script], { env, stdin: Buffer.from(JSON.stringify({ session_id: SID, cwd: WORK, ...event })) })
  return p.stdout.toString().trim()
}
// the tool server over its stdio, the way Claude Code talks to it
function server() {
  const p = Bun.spawn(['sh', join(ROOT, 'bin', 'plain-server.sh')], { env, cwd: WORK, stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' })
  const seen: any[] = []
  void (async () => { let buf = ''; for await (const c of p.stdout) { buf += new TextDecoder().decode(c); let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { seen.push(JSON.parse(l)) } catch {} } } })()
  let id = 0
  const call = async (method: string, params: object = {}) => {
    const my = ++id
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: my, method, params }) + '\n'); p.stdin.flush()
    for (let i = 0; i < 300; i++) { const r = seen.find(m => m.id === my); if (r) return r.result; await sleep(50) }
    throw new Error(`${method} got no answer`)
  }
  const open = async () => { await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } }); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'); p.stdin.flush() }
  return { p, call, open, close: async () => { p.stdin.end(); await p.exited } }
}

beforeAll(() => {
  mkdirSync(STATE, { recursive: true }); mkdirSync(WORK)
  if (!existsSync(join(ROOT, 'door', 'node_modules'))) Bun.spawnSync(['bun', 'install', '--no-summary'], { cwd: join(ROOT, 'door') })
}, 120_000)
afterAll(() => rmSync(T, { recursive: true, force: true }))

describe('the plugin files', () => {
  test('the tool server and hooks are declared, and each script they name exists', () => {
    const mcp = JSON.parse(readFileSync(join(ROOT, '.mcp.json'), 'utf8')), hooks = readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8')
    expect(mcp.mcpServers.goddard.args[0]).toContain('plain-server.sh')
    for (const s of ['lacie-guard.ts', 'ship-gate.ts', 'savepoint.ts']) { expect(hooks).toContain(s); expect(existsSync(join(ROOT, 'door', s))).toBe(true) }
    expect(JSON.parse(hooks).hooks.PermissionRequest).toBeUndefined() // a plain session has a window for its own prompts
  })
  test("the door's sessions turn the plugin off, so nothing runs twice", () => {
    expect(readFileSync(join(ROOT, 'door', 'door.ts'), 'utf8')).toContain("enabledPlugins: { 'goddard-os@goddard-os': false }")
  })
})

describe('the go-live gate', () => {
  const ask = (command: string) => gate('ship-gate.ts', { tool_name: 'Bash', tool_input: { command } })
  test('asks in the session before a push', () => {
    const o = JSON.parse(ask('git push origin main')).hookSpecificOutput
    expect(o.permissionDecision).toBe('ask'); expect(o.permissionDecisionReason).toContain('push code to GitHub')
  })
  test('asks before a deploy and before an outside tool that posts', () => {
    expect(ask('wrangler deploy')).toContain('"ask"')
    expect(gate('ship-gate.ts', { tool_name: 'mcp__social__create_post', tool_input: { text: 'hi' } })).toContain('"ask"')
  })
  test('stays quiet on everyday work', () => {
    expect(ask('git status')).toBe(''); expect(ask('bun test')).toBe('')
    expect(gate('ship-gate.ts', { tool_name: 'mcp__plugin_goddard-os_goddard__thread_send', tool_input: { text: 'send it' } })).toBe('')
  })
  test("the plugin's own dog-computer tools still ask", () => {
    expect(gate('ship-gate.ts', { tool_name: 'mcp__plugin_goddard-os_goddard__vm_run', tool_input: { command: 'git push' } })).toContain('"ask"')
    expect(gate('ship-gate.ts', { tool_name: 'mcp__plugin_goddard-os_goddard__web_click', tool_input: { label: 'Publish' } })).toContain('"ask"')
  })
})

describe('the big-drive guard', () => {
  test('asks before an overwrite on the drive from the profile, and leaves other folders alone', () => {
    const drive = join(T, 'drive'), file = join(drive, 'cut.mp4'); mkdirSync(drive); writeFileSync(file, 'x')
    writeFileSync(join(STATE, 'profile.json'), JSON.stringify({ name: 'Dana', bigDrive: { on: true, path: drive } }))
    expect(gate('lacie-guard.ts', { tool_name: 'Write', tool_input: { file_path: file } })).toContain('"ask"')
    expect(gate('lacie-guard.ts', { tool_name: 'Write', tool_input: { file_path: join(WORK, 'a.txt') } })).toBe('')
    rmSync(join(STATE, 'profile.json'))
  })
})

describe('save points', () => {
  test('saves the repo once before the first change, and leaves the branch alone', () => {
    const repo = join(T, 'repo'), git = (...a: string[]) => Bun.spawnSync(['git', '-C', repo, ...a]).stdout.toString().trim()
    mkdirSync(repo); git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
    writeFileSync(join(repo, 'a.txt'), 'one'); git('add', '.'); git('commit', '-qm', 'one')
    const before = git('rev-parse', 'HEAD')
    writeFileSync(join(repo, 'a.txt'), 'unsaved work')
    const event = { tool_name: 'Edit', tool_input: { file_path: join(repo, 'a.txt') } }
    gate('savepoint.ts', event); gate('savepoint.ts', event)
    const refs = git('for-each-ref', 'refs/goddard/save').split('\n').filter(Boolean)
    expect(refs.length).toBe(1)
    expect(git('show', `${refs[0].split(/\s+/)[2]}:a.txt`)).toBe('unsaved work')
    expect(git('rev-parse', 'HEAD')).toBe(before)
    expect(existsSync(join(STATE, 'savepoints', `${SID.slice(0, 8)}.json`))).toBe(true)
  })
})

describe('the tool server', () => {
  test('offers nothing before Setup', async () => {
    const s = server(); await s.open()
    expect((await s.call('tools/list')).tools).toEqual([])
    await s.close()
  })
  test('stays off Home until a tool is used, then joins, feeds steps, and leaves clean', async () => {
    writeFileSync(join(STATE, 'profile.json'), JSON.stringify({ name: 'Dana' }))
    const s = server(); await s.open()
    const names = (await s.call('tools/list')).tools.map((t: any) => t.name)
    expect(names).toEqual(expect.arrayContaining(['reply', 'plan', 'system', 'sheet']))
    expect(sessions()).toEqual([])
    const plan = await s.call('tools/call', { name: 'plan', arguments: { steps: ['One', 'Two', 'Three'] } })
    expect(plan.content[0].text).toContain('Keep going') // no waiting on a page the person may not be looking at
    expect(sessions().length).toBe(1)
    const port = Number(readFileSync(join(STATE, 'plain', SID), 'utf8'))
    expect(port).toBeGreaterThanOrEqual(8850); expect(port).toBeLessThan(8900) // the app's /t/ only passes thread ports
    const h = { 'x-gm-chat': readFileSync(join(STATE, 'password'), 'utf8').trim(), 'content-type': 'application/json' }
    const state = await (await fetch(`http://127.0.0.1:${port}/state`, { headers: h })).json() as { name: string }
    expect(state.name).toBe('Claude · work')
    // the hook feed reaches this server
    Bun.spawnSync(['sh', join(ROOT, 'bin', 'feed.sh')], { env, stdin: Buffer.from(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/x/y.md' } })) })
    const said = await fetch(`http://127.0.0.1:${port}/say`, { method: 'POST', headers: h, body: JSON.stringify({ text: 'hello?', from: 'carl' }) })
    expect(said.ok).toBe(true)
    const lines = (await (await fetch(`http://127.0.0.1:${port}/history`, { headers: h })).json() as { lines: string[] }).lines.join('\n')
    expect(lines).toContain('can only read messages typed there')
    expect(lines).toContain('y.md')
    await s.close()
    expect(sessions()).toEqual([]); expect(existsSync(join(STATE, 'plain', SID))).toBe(false)
  }, 30_000)
  test('never starts the door by itself', async () => {
    const s = server(); await s.open(); await s.call('tools/list'); await sleep(1500)
    const up = await fetch('http://127.0.0.1:8798/ping', { signal: AbortSignal.timeout(500) }).then(() => true, () => false)
    await s.close(); expect(up).toBe(false)
  })
})
