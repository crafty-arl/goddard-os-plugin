import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { timingSafeEqual } from 'node:crypto'
import { connect as netConnect } from 'node:net'
import { request as httpRequest } from 'node:http'
import { spawn } from 'node:child_process'
import { readSkills } from './skills-source'
import { passkeys } from './passkeys'

// Goddard OS is a front end for Carl's gm-chat front door (Claude Code Channels, port 8787).
// Personal use only: every data route needs the same gm_chat cookie the door hands out with its password link.
const DOOR = process.env.GM_DOOR_URL ?? 'http://127.0.0.1:8787'
const PASSWORD_FILE = join(process.env.GM_CHAT_STATE ?? join(homedir(), '.claude', 'channels', 'gm-chat'), 'password')

// the dogs' own computer (VM 113): its screen comes through this same address, signed in, so the phone can watch it
// anywhere (Carl, 2026-10-29: "no matter what when you open the vm you're showing the visual part")
// its address comes from the owner's profile (profile.json in the state folder)
const PROFILE_FILE = join(process.env.GM_CHAT_STATE ?? join(homedir(), '.claude', 'channels', 'gm-chat'), 'profile.json')
const PROFILE = (() => { try { return JSON.parse(readFileSync(PROFILE_FILE, 'utf8')) } catch { return {} } })()
const DOGBOX = process.env.GM_DOGBOX ?? PROFILE.dogComputer?.vm ?? ''
// the phone's https address (Tailscale), from the profile; with none, only this Mac's own addresses are allowed
const PHONE_HOST: string[] = PROFILE.phone?.host ? [PROFILE.phone.host] : []
const SCREEN_PASSWORD_FILE = join(process.env.GM_CHAT_STATE ?? join(homedir(), '.claude', 'channels', 'gm-chat'), 'dogbox-screen-password')
// /dogview/ is the dog computer's main screen; /dogview/<1-3>/ is one session's own screen (Carl, 2026-10-30)
function dogView(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
  const url = req.url ?? '/dogview/'
  const m = url.match(/^\/dogview\/(?:([1-3])\/)?(.*)$/)
  if (!m) { res.statusCode = 404; res.end(); return }
  const n = m[1] ? Number(m[1]) : 0, base = n ? `/dogview/${n}/` : '/dogview/', rest = m[2]
  // the bare address opens the viewer already connected; watch-only unless ?control (Carl logging in himself)
  if (rest === '' || rest.startsWith('?')) {
    let pw = ''; try { pw = readFileSync(SCREEN_PASSWORD_FILE, 'utf8').trim() } catch {}
    const control = new URLSearchParams(rest.slice(1)).has('control')
    const q = new URLSearchParams({ autoconnect: '1', resize: 'scale', reconnect: '1', reconnect_delay: '2000', path: `${base.slice(1)}websockify`, password: pw, ...(control ? {} : { view_only: '1' }) })
    res.statusCode = 302; res.setHeader('Location', `${base}vnc.html?${q}`); res.setHeader('Cache-Control', 'no-store'); res.end(); return
  }
  const path = '/' + rest
  const up = httpRequest({ host: DOGBOX, port: 6080 + n, path, method: 'GET', timeout: 8000 }, r => {
    res.writeHead(r.statusCode ?? 502, { 'content-type': r.headers['content-type'] ?? 'application/octet-stream', 'cache-control': 'no-store' })
    // the viewer page: noVNC's own side tab is hidden, the app has its own controls around the screen
    if (!path.startsWith('/vnc.html')) { r.pipe(res); return }
    let html = ''; r.setEncoding('utf8'); r.on('data', c => { html += c })
    r.on('end', () => res.end(html.replace('</head>', '<style>#noVNC_control_bar_anchor{display:none!important}</style></head>')))
  })
  up.on('timeout', () => up.destroy()); up.on('error', () => { if (!res.headersSent) { res.statusCode = 502; res.end('The dog computer is off or its screen is starting.') } })
  up.end()
}

// Carl's own typing into the dog computer (the phone keyboard doesn't open inside the screen viewer): the text goes
// over stdin to xdotool on dog-box, never into a command line or a log, and only a few named keys are allowed
const DOG_KEY = join(process.env.GM_CHAT_STATE ?? join(homedir(), '.claude', 'channels', 'gm-chat'), 'dogvm_ed25519')
const KEYS: Record<string, string> = { enter: 'Return', backspace: 'BackSpace', tab: 'Tab', escape: 'Escape', up: 'Up', down: 'Down', left: 'Left', right: 'Right' }
function dogType(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
  let body = ''
  req.on('data', c => { body += c; if (body.length > 8192) req.destroy() })
  req.on('end', () => {
    let b: { text?: string; key?: string; slot?: number } = {}; try { b = JSON.parse(body) } catch {}
    const key = KEYS[String(b.key ?? '')], text = typeof b.text === 'string' ? b.text.slice(0, 2000) : ''
    if (!key && !text) { res.statusCode = 400; res.end('nothing to type'); return }
    const disp = [1, 2, 3].includes(Number(b.slot)) ? `:1${Number(b.slot)}` : ':1'
    const cmd = key ? `DISPLAY=${disp} xdotool key --clearmodifiers ${key}` : `DISPLAY=${disp} xdotool type --clearmodifiers --delay 25 --file -`
    const p = spawn('ssh', ['-i', DOG_KEY, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', `dog@${DOGBOX}`, cmd], { stdio: ['pipe', 'ignore', 'ignore'] })
    p.stdin.end(text)
    p.on('close', code => { res.statusCode = code ? 502 : 200; res.end(code ? "couldn't reach the dog computer" : 'ok') })
  })
}

function password() {
  try { return readFileSync(PASSWORD_FILE, 'utf8').trim() } catch { return '' }
}
function isPassword(given: string) {
  const token = password()
  return given.length === token.length && token.length > 0 && timingSafeEqual(Buffer.from(given), Buffer.from(token))
}
// each device signs in with its own passkey (passkeys.ts); the shared password still works while it's switched on
const auth = passkeys(process.env.GM_CHAT_STATE ?? join(homedir(), '.claude', 'channels', 'gm-chat'), isPassword)
// signed in, then the request goes on to the door and the threads with the Mac's own credential added, so they need
// no change: only this front gate decides who gets in
function signedIn(req: import('node:http').IncomingMessage) {
  if (!auth.signedIn(req)) return false
  const rest = (req.headers.cookie ?? '').split(';').map(p => p.trim()).filter(p => p && !p.startsWith('gm_chat=') && !p.startsWith('gm_dev='))
  req.headers.cookie = [...rest, `gm_chat=${password()}`].join('; ')
  return true
}

// The Locked screen posts the pasted gm-chat link here. A home-screen app keeps its own cookies apart from Safari,
// so it signs in on this origin and gets the same cookie the door's link would set. The password is never logged.
function signIn(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
  const origin = req.headers.origin
  if (origin && new URL(origin).host !== req.headers.host) { res.statusCode = 403; res.end('no'); return }
  let body = ''
  req.on('data', c => { body += c; if (body.length > 4096) req.destroy() })
  req.on('end', () => {
    const pasted = new URLSearchParams(body).get('link')?.trim() ?? ''
    const given = pasted.match(/[?&]p=([^&#\s]+)/)?.[1] ?? pasted
    const ok = auth.passwordOn() && isPassword(given)
    res.statusCode = 303
    res.setHeader('Location', ok ? '/' : '/?signin=bad')
    if (ok) res.setHeader('Set-Cookie', `gm_chat=${password()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`)
    res.end()
  })
}

function goddard(): Plugin {
  const payload = () => JSON.stringify({ readAt: new Date().toISOString(), from: '~/.claude/skills', skills: readSkills() })
  return {
    name: 'goddard-os',
    // dev and the production preview get the same lock, ahead of Vite's own proxy
    configureServer(server) { server.middlewares.use(gate); server.httpServer?.on('upgrade', tunnel) },
    configurePreviewServer(server) { server.middlewares.use(gate); server.httpServer?.on('upgrade', tunnel) },
  }
  // a dog's live connection on this same address (/t/<port>/ws), so it works over the https address too: signed in,
  // gm-chat thread ports only, then the bytes are piped straight through to that thread's /ws
  function tunnel(req: import('node:http').IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) {
    const dw = (req.url ?? '').match(/^\/dogview\/(?:([1-3])\/)?websockify/)
    if (dw) {
      if (!signedIn(req)) { socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); return }
      const vport = 6080 + (dw[1] ? Number(dw[1]) : 0)
      const up = netConnect(vport, DOGBOX, () => {
        const headers = Object.entries(req.headers).filter(([k]) => k !== 'origin' && k !== 'host' && k !== 'cookie').map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
        up.write([`GET /websockify HTTP/1.1`, `host: ${DOGBOX}:${vport}`, ...headers, '', ''].join('\r\n'))
        if (head.length) up.write(head)
        socket.pipe(up).pipe(socket)
      })
      up.on('error', () => socket.destroy()); socket.on('error', () => up.destroy())
      return
    }
    const m = (req.url ?? '').match(/^\/t\/(\d+)\/ws(\?.*)?$/)
    if (!m) return
    const port = Number(m[1])
    if (port <= 8787 || port >= 8900 || !signedIn(req)) { socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); return }
    const up = netConnect(port, '127.0.0.1', () => {
      const headers = Object.entries(req.headers).filter(([k]) => k !== 'origin' && k !== 'host').map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
      up.write([`GET /ws${m[2] ?? ''} HTTP/1.1`, `host: 127.0.0.1:${port}`, ...headers, '', ''].join('\r\n'))
      if (head.length) up.write(head)
      socket.pipe(up).pipe(socket)
    })
    up.on('error', () => socket.destroy()); socket.on('error', () => up.destroy())
  }
  // lock the data routes and refuse cross-site writes
  function gate(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) {
    const url = req.url ?? ''
    if (url === '/signin' && req.method === 'POST') return signIn(req, res)
    // first run on this Mac: the plugin's start command opens /welcome with the password, so a new owner lands
    // signed in on Setup without pasting anything. Only on this Mac's own address; the password never shows.
    if (url.startsWith('/welcome?') && req.method === 'GET' && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host ?? '')) {
      const ok = auth.passwordOn() && isPassword(new URLSearchParams(url.split('?')[1]).get('p') ?? '')
      res.statusCode = 303; res.setHeader('Location', ok ? '/' : '/?signin=bad')
      if (ok) res.setHeader('Set-Cookie', `gm_chat=${password()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`)
      res.end(); return
    }
    if (url.startsWith('/auth/')) { void auth.route(req, res).then(done => { if (!done) next() }); return }
    if (!url.startsWith('/api/skills') && !url.startsWith('/door/') && !url.startsWith('/t/') && !url.startsWith('/dogview/')) return next()
    // only gm-chat thread ports go through /t/ (the door hands those out from 8788 up)
    const tp = url.match(/^\/t\/(\d+)\//)?.[1]
    if (url.startsWith('/t/') && !(tp && +tp > 8787 && +tp < 8900)) { res.statusCode = 404; res.end(); return }
    if (!signedIn(req)) { res.statusCode = 401; res.end('locked'); return }
    const origin = req.headers.origin
    if (req.method !== 'GET' && origin && new URL(origin).host !== req.headers.host) { res.statusCode = 403; res.end('no'); return }
    if (url === '/dogview/type' && req.method === 'POST') return dogType(req, res)
    if (url.startsWith('/dogview/')) return dogView(req, res)
    if (url.startsWith('/api/skills')) { res.setHeader('Content-Type', 'application/json'); res.end(payload()); return }
    next()
  }
}

export default defineConfig({
  plugins: [react(), goddard()],
  server: { proxy: doorProxy() },
  // the build Carl uses day to day, at home and away: `vite build && vite preview` (scripts/boot.ts)
  // the https address Tailscale serves (so the phone gets a secure page: mic, home-screen app)
  preview: { proxy: doorProxy(), allowedHosts: PHONE_HOST },
})

function doorProxy(): Record<string, import('vite').ProxyOptions> {
  return {
    '/door': {
      target: DOOR,
      rewrite: p => p.replace(/^\/door/, ''),
      configure: proxy => {
        // the door checks Origin against its own host; the check above already did that for this host
        proxy.on('proxyReq', req => req.removeHeader('origin'))
      },
    },
  }
}
