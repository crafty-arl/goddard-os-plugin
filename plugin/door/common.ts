/**
 * Shared by the front door (door.ts) and each thread's page (server.ts):
 * the one password, the cookie, the session registry and the GM! look.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir, networkInterfaces } from 'os'
import { join } from 'path'
import { randomBytes, timingSafeEqual } from 'crypto'

export const DOOR_PORT = Number(process.env.GM_DOOR_PORT ?? 8787)
// Only this Mac can reach the door and the threads (Carl, 2026-10-30: "only the app's sign-in counts"). Goddard OS
// sits in front on the same Mac with passkey sign-in; set GM_CHAT_HOST=0.0.0.0 to open them to the home network again.
export const HOST = process.env.GM_CHAT_HOST ?? '127.0.0.1'
export const STATE_DIR = process.env.GM_CHAT_STATE ?? join(homedir(), '.claude', 'channels', 'gm-chat')
// One file per running thread, named <port>.json, so the door can list them.
export const SESSIONS_DIR = join(STATE_DIR, 'sessions')
const TOKEN_FILE = join(STATE_DIR, 'password')
const COOKIE = 'gm_chat'

mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 })
if (!existsSync(TOKEN_FILE)) {
  writeFileSync(TOKEN_FILE, randomBytes(18).toString('base64url'), { mode: 0o600 })
}
export const TOKEN = readFileSync(TOKEN_FILE, 'utf8').trim()

export function lanAddress(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal && a.address.startsWith('192.168.')) return a.address
    }
  }
  return 'localhost'
}

export function isToken(given: string | null | undefined): boolean {
  if (!given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(TOKEN)
  return a.length === b.length && timingSafeEqual(a, b)
}

function cookieToken(req: Request): string | undefined {
  const raw = req.headers.get('cookie') ?? ''
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === COOKIE) return v.join('=')
  }
  return undefined
}

// The password check every page runs first. Returns a response to send when
// the request is the login link or is locked out; undefined when it may go on.
// Cookies ignore the port, so one login covers the door and every thread.
export function gate(req: Request, url: URL): Response | undefined {
  if (url.pathname === '/' && isToken(url.searchParams.get('p'))) {
    // Trade the link's password for a cookie, then drop it from the address bar.
    return new Response(null, {
      status: 303,
      headers: {
        location: '/',
        'set-cookie': `${COOKIE}=${TOKEN}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`,
      },
    })
  }
  if (!isToken(cookieToken(req))) {
    return new Response(LOCKED, { status: 401, headers: { 'content-type': 'text/html; charset=utf-8' } })
  }
  return undefined
}

export const HEAD = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap">
<style>
:root { --paper:#F1EEE7; --card:#FBF9F4; --ink:#070707; --muted:#5d574c; --line:#d9d2c3; --gold:#BD8430; --gold-soft:#f3e4cb; --warn:#b5541f; --ok:#2f7d4f;
  --display:"Anton",Impact,"Arial Narrow",sans-serif; --body:"Inter",system-ui,-apple-system,sans-serif; --mono:"Geist Mono",ui-monospace,Menlo,monospace }
@media (prefers-color-scheme: dark) { :root { --paper:#121110; --card:#1c1a17; --ink:#F1EEE7; --muted:#a59d8f; --line:#34302a; --gold:#d79b45; --gold-soft:#3a2c17; --warn:#e08a55; --ok:#5fbf86 } }
* { box-sizing: border-box }
html, body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.5 var(--body) }
</style>`

const LOCKED = `${HEAD}
<title>GM! Claude</title>
<div style="max-width:420px;margin:15vh auto;padding:0 20px">
  <div style="font-family:var(--display);font-size:40px">GM<span style="color:var(--gold)">!</span> Claude</div>
  <p style="color:var(--muted)">Locked. Open the link from the Mac (it has the password in it).</p>
</div>`
