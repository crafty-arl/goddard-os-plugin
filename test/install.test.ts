// Install tests: a new owner's first run, from the bundled plugin, on spare ports with an empty state folder.
// Claude Code is replaced by a stand-in (GM_CLAUDE) that records each call and starts nothing, so no test ever starts
// a real session or touches the sessions already running on this Mac.
//
//   ./bundle.sh && bun test test/
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', 'plugin')
const DOOR_PORT = 8797, APP_PORT = 5183, APP2_PORT = 5184
const DOOR = `http://127.0.0.1:${DOOR_PORT}`, APP = `http://localhost:${APP_PORT}`
const T = mkdtempSync(join(tmpdir(), 'goddard-install-'))
const STATE = join(T, 'state'), NOTES = join(T, 'notes'), BIN = join(T, 'bin'), CALLS = join(T, 'claude-calls.log')
const procs: ReturnType<typeof Bun.spawn>[] = []
let jar = '' // the app's sign-in cookie after /welcome

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const password = () => readFileSync(join(STATE, 'password'), 'utf8').trim()
const calls = () => existsSync(CALLS) ? readFileSync(CALLS, 'utf8') : ''
const app = (path: string, init: RequestInit = {}) =>
  fetch(APP + path, { redirect: 'manual', ...init, headers: { ...(jar ? { cookie: jar } : {}), ...(init.headers ?? {}) } })
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } })
async function waitFor(url: string, ms = 60_000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(300)) if (await fetch(url).then(() => true, () => false)) return
  throw new Error(`${url} never came up`)
}
function startApp(port: number) {
  const p = Bun.spawn(['npx', 'vite', 'preview', '--port', String(port), '--strictPort'], {
    cwd: join(ROOT, 'app'), env: { ...process.env, GM_CHAT_STATE: STATE, GM_DOOR_URL: DOOR }, stdout: 'ignore', stderr: 'ignore' })
  procs.push(p); return waitFor(`http://localhost:${port}/`)
}
// runs the plugin's start script with only the given stand-in tools on the PATH (plus the system's own /usr/bin:/bin)
function startScript(tools: string[]) {
  const dir = mkdtempSync(join(T, 'path-'))
  for (const t of tools) { writeFileSync(join(dir, t), '#!/bin/sh\nexit 0\n'); chmodSync(join(dir, t), 0o755) }
  const p = Bun.spawnSync(['/bin/bash', join(ROOT, 'bin', 'goddard.sh'), 'start'], { env: { HOME: T, PATH: `${dir}:/usr/bin:/bin` } })
  return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() }
}

beforeAll(async () => {
  for (const d of [STATE, NOTES, BIN]) mkdirSync(d, { recursive: true })
  // the Claude stand-in: lists no background sessions, and "starts" one by printing an id
  writeFileSync(join(BIN, 'claude'), `#!/bin/sh\necho "$@" >> '${CALLS}'\n[ "$1" = agents ] && { echo '[]'; exit 0; }\necho fake-session-1\n`)
  chmodSync(join(BIN, 'claude'), 0o755)
  for (const dir of ['door', 'app']) if (!existsSync(join(ROOT, dir, 'node_modules'))) Bun.spawnSync(['bun', 'install', '--no-summary'], { cwd: join(ROOT, dir) })
  if (!existsSync(join(ROOT, 'app', 'dist'))) Bun.spawnSync(['npx', 'vite', 'build'], { cwd: join(ROOT, 'app') })
  procs.push(Bun.spawn(['bun', 'door.ts'], { cwd: join(ROOT, 'door'), stdout: 'ignore', stderr: 'ignore',
    env: { ...process.env, GM_CHAT_STATE: STATE, GM_DOOR_PORT: String(DOOR_PORT), GM_CLAUDE: join(BIN, 'claude'), GM_WATCHDOG_MS: '1500' } }))
  await waitFor(`${DOOR}/ping`)
  await startApp(APP_PORT)
}, 180_000)

afterAll(() => { for (const p of procs) p.kill(); rmSync(T, { recursive: true, force: true }) })

describe('the start script checks what this Mac has', () => {
  test('no Claude Code: says so and stops', () => {
    const r = startScript([])
    expect(r.code).toBe(1); expect(r.out).toContain("Claude Code isn't on the PATH")
  })
  test('no Bun: names the install line', () => {
    const r = startScript(['claude'])
    expect(r.code).toBe(1); expect(r.out).toContain('Bun is missing'); expect(r.out).toContain('bun.sh/install')
  })
  test('no Node: says so', () => {
    const r = startScript(['claude', 'bun'])
    expect(r.code).toBe(1); expect(r.out).toContain('Node is missing')
  })
  test('the output never carries the password', () => {
    for (const tools of [[], ['claude'], ['claude', 'bun']]) expect(startScript(tools).out).not.toContain(password())
  })
})

describe('first open, before Setup', () => {
  test('the door is only on this Mac, not the home network', async () => {
    const lan = Object.values(require('node:os').networkInterfaces()).flat().find((a: any) => a?.family === 'IPv4' && !a.internal) as any
    if (!lan) return
    expect(await fetch(`http://${lan.address}:${DOOR_PORT}/ping`, { signal: AbortSignal.timeout(2000) }).then(() => 'open', () => 'closed')).toBe('closed')
  })
  test('the app is locked without sign-in', async () => {
    expect((await app('/door/api/profile')).status).toBe(401)
  })
  test('a wrong password on /welcome is turned away, with no cookie', async () => {
    const r = await app('/welcome?p=wrong')
    expect(r.headers.get('location')).toContain('signin=bad'); expect(r.headers.get('set-cookie')).toBeNull()
  })
  test('/welcome from another address is ignored, even with the right password', async () => {
    const r = await app(`/welcome?p=${password()}`, { headers: { host: 'evil.example' } })
    expect(r.headers.get('set-cookie') ?? '').not.toContain('gm_chat=')
  })
  test('the right password on /welcome signs this Mac in and goes home', async () => {
    const r = await app(`/welcome?p=${password()}`)
    expect(r.status).toBe(303); expect(r.headers.get('location')).toBe('/')
    const c = r.headers.get('set-cookie') ?? ''
    expect(c).toContain('HttpOnly'); expect(c).toContain('SameSite=Strict')
    jar = c.split(';')[0]
  })
  test('there is no profile yet, so the app opens Setup', async () => {
    const j = await (await app('/door/api/profile')).json()
    expect(j.exists).toBe(false); expect(j.profile.owner.name).toBe('Owner')
  })
  test('passkeys: none yet, and adding one needs a secure page and sign-in', async () => {
    const s = await (await app('/auth/state')).json()
    expect(s.secure).toBe(true); expect(s.devices).toBe(0); expect(s.passwordSignIn).toBe(true)
    expect((await fetch(APP + '/auth/register/options', { method: 'POST' })).status).toBe(401)
  })
  test('the password link cannot be turned off without a passkey', async () => {
    expect((await post('/auth/password', { on: false })).status).toBe(400)
  })
  test('the evening card is empty, not broken', async () => {
    const d = await (await app('/door/api/digest')).json()
    expect(d).toMatchObject({ done: [], needs: [], lost: 0, next: null })
  })
  test('nothing has started a Claude session', async () => {
    await sleep(4000) // two watchdog rounds
    expect(calls()).not.toContain('--bg')
  })
})

describe('Setup tests', () => {
  const t = async (part: string, value: Record<string, unknown> = {}) => (await post('/door/api/profile/test', { part, value })).json()
  test('this Mac: Claude Code and Bun found', async () => { expect((await t('mac')).ok).toBe(true) })
  test('a notes folder that exists passes', async () => { expect((await t('memory', { path: NOTES })).ok).toBe(true) })
  test('a notes folder that is missing fails, and names it', async () => {
    const r = await t('memory', { path: '~/no-such-folder-here' }); expect(r.ok).toBe(false); expect(r.said).toContain('no-such-folder-here')
  })
  test('a big drive that is not plugged in fails kindly', async () => {
    const r = await t('bigDrive', { path: '/Volumes/NoSuchDrive' }); expect(r.ok).toBe(false); expect(r.said).toContain('plugged in')
  })
  test('a browser on this Mac as the dog computer passes', async () => { expect((await t('dogComputer', { kind: 'this-mac' })).ok).toBe(true) })
  test('a server address in the wrong shape is caught before SSH', async () => {
    const r = await t('dogComputer', { kind: 'proxmox-vm', host: 'not an address' }); expect(r.ok).toBe(false); expect(r.said).toContain('user@address')
  })
  test('a helper that does not answer fails within a few seconds', async () => {
    const at = Date.now(); const r = await t('helper', { bus: 'http://127.0.0.1:9' })
    expect(r.ok).toBe(false); expect(Date.now() - at).toBeLessThan(6000)
  })
  test('pings with no phone signed up says how to fix it', async () => {
    const r = await t('pings'); expect(r.ok).toBe(false); expect(r.said).toContain('Open this app on your phone')
  })
  test('an unknown step answers instead of crashing', async () => { expect((await t('nope')).ok).toBe(false) })
})

describe('saving Setup', () => {
  test('a blank name is refused', async () => {
    expect((await post('/door/api/profile', { owner: { name: '   ', call: 'chief' } })).status).toBe(400)
  })
  test('another site cannot save it', async () => {
    const r = await post('/door/api/profile', { owner: { name: 'Mallory', call: 'x' } }, { origin: 'https://evil.example' })
    expect(r.status).toBe(403)
  })
  test('a new owner saves it; the name is trimmed and capped', async () => {
    const r = await post('/door/api/profile', {
      owner: { name: '  Dana Rivers-Okafor of the Lakefront Builders Collective  ', call: 'chief', studio: 'Lakefront Lab' },
      memory: { on: true, path: NOTES }, dogComputer: { on: false, kind: 'this-mac', slots: 3 },
      pings: { on: true, quiet: [22, 8], perHour: 1 }, phone: { reach: 'tailscale', host: 'dana-box.example.ts.net' },
    })
    const j = await r.json()
    expect(j.ok).toBe(true); expect(j.profile.owner.name.length).toBeLessThanOrEqual(40); expect(j.profile.owner.name.startsWith('Dana')).toBe(true)
  })
  test('the profile file is private to this user', () => {
    expect(statSync(join(STATE, 'profile.json')).mode & 0o077).toBe(0)
    expect(statSync(join(STATE, 'password')).mode & 0o077).toBe(0)
  })
  test('the app now opens Home, not Setup', async () => {
    expect((await (await app('/door/api/profile')).json()).exists).toBe(true)
  })
  test('after Setup, Goddard (Home) starts on its own, in the notes folder', async () => {
    for (let i = 0; i < 20 && !calls().includes('--bg'); i++) await sleep(500)
    expect(calls()).toContain('--bg')
    const script = readdirSync(join(STATE, 'launch')).filter(f => f.endsWith('.command')).map(f => readFileSync(join(STATE, 'launch', f), 'utf8')).join('\n')
    expect(script).toContain(`cd '${NOTES}'`)
  })
  test("the delete guard watches the owner's own drive", () => {
    const hooks = readdirSync(join(STATE, 'launch')).filter(f => f.endsWith('-hooks.json')).map(f => readFileSync(join(STATE, 'launch', f), 'utf8')).join('\n')
    expect(hooks).toContain('GODDARD_LACIE=')
  })
  test('what the dogs read uses the new owner, not Carl', async () => {
    const launched = readdirSync(join(STATE, 'launch')).map(f => readFileSync(join(STATE, 'launch', f), 'utf8')).join('\n')
    expect(launched).not.toMatch(/\bCarl\b/); expect(launched).not.toContain('gm-mind'); expect(launched).not.toMatch(/192\.168\.\d+\.\d+/)
  })
  test('the phone address from Setup is allowed, any other is refused', async () => {
    await startApp(APP2_PORT) // the app reads the address when it starts
    const at = (host: string) => fetch(`http://localhost:${APP2_PORT}/`, { headers: { host } }).then(r => r.status)
    expect(await at('dana-box.example.ts.net')).toBe(200)
    expect(await at('evil.example')).toBe(403)
  })
  test('a broken profile file falls back instead of taking the door down', async () => {
    writeFileSync(join(STATE, 'profile.json'), '{ not json')
    await sleep(10_500) // the door reads the file again after 10 seconds
    expect((await app('/door/api/profile')).status).toBe(200)
    expect((await fetch(`${DOOR}/ping`)).ok).toBe(true)
  }, 20_000)
})

describe('what ships in the plugin', () => {
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.name === 'node_modules' || e.name === 'dist' ? [] : e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)])
  const all = files(ROOT)
  test('no personal state: passwords, profiles, passkeys, keys or .env files', () => {
    const bad = all.filter(f => /(^|\/)(password|profile\.json|devices\.json|auth\.json|link\.txt|\.env[^/]*|.*_ed25519.*|.*\.pem|\.mcp\.json)$/.test(f))
    expect(bad).toEqual([])
  })
  // what's private to the Mac running the tests: its home folder, and the phone address in its own profile
  const mine = [require('node:os').homedir() + '/', (() => { try { return JSON.parse(readFileSync(join(require('node:os').homedir(), '.claude', 'channels', 'gm-chat', 'profile.json'), 'utf8')).phone?.host ?? '' } catch { return '' } })()].filter(Boolean)
  test('no paths to this Mac and no private network names', () => {
    const hits = all.filter(f => /\.(ts|tsx|js|mjs|json|md|sh|html|css)$/.test(f))
      .filter(f => mine.some(m => readFileSync(f, 'utf8').includes(m))).map(f => f.slice(ROOT.length + 1))
    expect(hits).toEqual([])
  })
  test('the paper robot add-on ships, and its rig is off until the owner turns it on', async () => {
    for (const f of ['skills/paper-robot/SKILL.md', 'skills/paper-robot/robot.py', 'commands/video.md']) expect(existsSync(join(ROOT, f))).toBe(true)
    expect((await (await app('/door/api/profile')).json()).profile.rig?.on ?? false).toBe(false)
  })
  test('the plugin passes Claude Code\'s own check', () => {
    const r = Bun.spawnSync(['claude', 'plugin', 'validate', ROOT])
    expect(r.stdout.toString() + r.stderr.toString()).toContain('Validation passed')
  })
})

describe('the owner swap', () => {
  const ownWith = (prof: unknown, text: string) => {
    const dir = mkdtempSync(join(T, 'own-')); writeFileSync(join(dir, 'profile.json'), JSON.stringify(prof))
    const p = Bun.spawnSync(['bun', '-e', `import { own } from './profile.ts'; process.stdout.write(own(${JSON.stringify(text)}))`], { cwd: join(ROOT, 'door'), env: { ...process.env, GM_CHAT_STATE: dir } })
    return p.stdout.toString()
  }
  const home = () => readFileSync(join(ROOT, 'door', 'home.md'), 'utf8')
  test("Carl's own setup reads exactly as written", () => {
    const bus = 'http://10.1.2.3:7790'
    expect(ownWith({ owner: { name: 'Carl', call: 'boss', studio: 'GM! Carl' }, helper: { on: true, name: 'Goddard', bus } }, home()))
      .toBe(home().replace(/\{\{helper\.bus\}\}/g, bus).replace(/\{\{helper\.ssh\}\}/g, 'root@10.1.2.3'))
  })
  test('with a helper on, its parts stay and point at their own address', () => {
    const t = ownWith({ owner: { name: 'Dana', call: 'chief' }, helper: { on: true, name: 'Hal', bus: 'http://10.0.0.5:7790' } }, home())
    expect(t).toContain('http://10.0.0.5:7790'); expect(t).toContain('root@10.0.0.5'); expect(t).not.toContain('<!--'); expect(t).not.toContain('{{')
  })
  test('with no helper, no Hermes, bus or Carl-only dogs, and no empty gaps in lists', () => {
    const t = ownWith({ owner: { name: 'Dana', call: 'chief' } }, home())
    expect(t).not.toMatch(/Hermes|GM! Bus|Scribbles|<!--|\bCarl\b/); expect(t).not.toMatch(/\n1\..*\n\n3\./)
  })
  test('no studio name: uses "<name>\'s studio"', () => {
    expect(ownWith({ owner: { name: 'Dana', call: 'chief' } }, 'the GM! Carl studio')).toBe("the Dana's studio")
  })
})

describe('session modes: Plan it, Just talk, Just do it', () => {
  // starting a session waits for the dog to check in, which the stand-in never does: send it, then read what was launched
  const startIn = async (mode: string | undefined, words: string) => {
    void post('/door/api/session/start', { artifact: words, ...(mode ? { mode } : {}) }, {}).catch(() => {})
    for (let i = 0; i < 40; i++) {
      const hit = readdirSync(join(STATE, 'launch')).filter(f => f.endsWith('.command')).map(f => readFileSync(join(STATE, 'launch', f), 'utf8')).find(t => t.includes(words))
      if (hit) return hit
      await sleep(250)
    }
    throw new Error(`no launch for "${words}"`)
  }
  const modeOnFile = (title: string) => readFileSync(join(STATE, 'boards', `Session-${title.replace(/[^\w-]+/g, '-')}.mode`), 'utf8').trim()
  test('Just talk starts with the talk instructions and no scoping pass', async () => {
    const before = calls().split('\n').filter(l => l.startsWith('-p')).length
    const t = await startIn('talk', 'zebra chat about tea')
    expect(t).toContain('talk.md'); expect(t).toContain('New chat (Just talk)')
    expect(calls().split('\n').filter(l => l.startsWith('-p')).length).toBe(before)
    expect(modeOnFile('zebra chat about tea')).toBe('talk')
  }, 15_000)
  test('Just do it starts with the do instructions and no plan to approve', async () => {
    const t = await startIn('do', 'yak resize the frames')
    expect(t).toContain('do.md'); expect(t).toContain('New job (Just do it)'); expect(t).not.toContain('wait for their Go')
  }, 40_000)
  test('Plan it is the default and keeps the full plan flow', async () => {
    const t = await startIn(undefined, 'quokka comic pages')
    expect(t).toContain('session.md'); expect(t).toContain('set up the system with the system tool')
  }, 40_000)
  test('an unknown mode falls back to Plan it', async () => {
    expect(await startIn('chaos', 'ibis unknown mode')).toContain('session.md')
  }, 40_000)
  test('Auto only applies to Plan it', async () => {
    const t = await startIn('talk', 'auto newt quick chat')
    expect(t).not.toContain('GM_CHAT_AUTO_UNTIL=\'1'); expect(t).not.toContain('Auto is on')
  }, 15_000)

  // a stand-in for a running session's page: answers /state and records what the door says to it
  test('switching a running chat sends it the new mode\'s instructions and sticks', async () => {
    const said: { text: string; from: string }[] = [], port = 8891, name = 'Session · Switch test'
    const page = Bun.serve({ port, hostname: '127.0.0.1', fetch: async req => {
      const u = new URL(req.url)
      if (u.pathname === '/state') return Response.json({ port, name, server: 'Mac', folder: T, busy: false, doing: '', needsYou: false, last: { text: '', at: Date.now() } })
      if (u.pathname === '/say') { said.push(await req.json()); return new Response('ok') }
      return new Response('no', { status: 404 })
    } })
    writeFileSync(join(STATE, 'sessions', `${port}.json`), JSON.stringify({ port, name, pid: process.pid }))
    try {
      const sw = (mode: string) => post('/door/api/session/mode', { port, mode }).then(r => r.json())
      expect((await sw('nope')).ok).toBe(false)
      expect((await sw('talk')).ok).toBe(true)
      expect(modeOnFile('Switch test')).toBe('talk')
      expect(said[0].from).toBe('system'); expect(said[0].text).toContain('from Plan it to Just talk'); expect(said[0].text).toContain('Just talk session')
      expect((await sw('do')).ok).toBe(true); expect(said[1].text).toContain('Just do it session')
      expect((await sw('do')).ok).toBe(true); expect(said.length).toBe(2) // same mode again: nothing sent
      expect(said.some(s => /\bCarl\b/.test(s.text))).toBe(false) // the new owner's name, not Carl's
    } finally { page.stop(true); rmSync(join(STATE, 'sessions', `${port}.json`), { force: true }) }
  })
  test('another site cannot switch a chat', async () => {
    expect((await post('/door/api/session/mode', { port: 8891, mode: 'talk' }, { origin: 'https://evil.example' })).status).toBe(403)
  })
})

test('no home network addresses in the instructions the dogs read', () => {
  for (const f of ['home.md', 'session.md', 'talk.md', 'do.md']) expect(readFileSync(join(ROOT, 'door', f), 'utf8')).not.toMatch(/\b(192\.168|10\.\d+\.\d+|100\.\d+\.\d+)\.\d+/)
})

test("Pick up never shows another owner's goal suggestions", async () => {
  writeFileSync(join(STATE, 'profile.json'), JSON.stringify({ owner: { name: 'Dana', call: 'chief' }, memory: { on: true, path: NOTES } }))
  await sleep(10_500) // the door reads the profile again after 10 seconds
  const ideas = (await (await app('/door/api/session/ideas')).json()).ideas ?? []
  expect(ideas.filter((i: { from: string }) => i.from === 'goals')).toEqual([])
}, 20_000)

describe('the dog computer: a browser on this Mac', () => {
  const mcpFor = async (words: string) => {
    void post('/door/api/session/start', { artifact: words, mode: 'talk' }).catch(() => {})
    for (let i = 0; i < 40; i++) {
      const cmd = readdirSync(join(STATE, 'launch')).filter(f => f.endsWith('.command')).find(f => readFileSync(join(STATE, 'launch', f), 'utf8').includes(words))
      if (cmd) return JSON.parse(readFileSync(join(STATE, 'launch', cmd.replace('.command', '-mcp.json')), 'utf8')).mcpServers
      await sleep(250)
    }
    throw new Error('no launch')
  }
  const setComputer = async (dogComputer: unknown) => {
    writeFileSync(join(STATE, 'profile.json'), JSON.stringify({ owner: { name: 'Dana', call: 'chief' }, memory: { on: true, path: NOTES }, dogComputer }))
    await sleep(10_500) // the door reads the profile again after 10 seconds
  }
  test('with it on, each dog gets its own isolated browser', async () => {
    await setComputer({ on: true, kind: 'this-mac', slots: 3 })
    const s = await mcpFor('heron browse something')
    expect(s.browser.command).toBe('npx'); expect(s.browser.args).toContain('--isolated'); expect(s.browser.args.join(' ')).toMatch(/@playwright\/mcp@\d/)
    expect(s['gm-chat']).toBeTruthy()
  }, 30_000)
  test('with it off, no browser is added', async () => {
    await setComputer({ on: false, kind: 'this-mac', slots: 3 })
    expect((await mcpFor('egret no browser')).browser).toBeUndefined()
  }, 30_000)
  test('Setup\'s test says what is true about Chrome on this Mac', async () => {
    const r = await (await post('/door/api/profile/test', { part: 'dogComputer', value: { kind: 'this-mac' } })).json()
    expect(r.said).toMatch(existsSync('/Applications/Google Chrome.app') ? /own Chrome window/ : /isn't installed/)
  })
})
