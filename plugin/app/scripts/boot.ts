#!/usr/bin/env bun
// Brings Goddard OS back after the Mac starts: the gm-chat door, the app server, and the standing agent slots.
// Each dog is its own background session with its own role, and Home is the main chat over them (Carl, 2026-10-28).
// No windows and no yes to answer.
//
//   bun scripts/boot.ts            # door + app + Scribbles, Fetch, Bloodhound and Home if they're missing
//   bun scripts/boot.ts --no-slots # door + app only
import { existsSync, readFileSync, openSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const HOME = homedir()
const GM_CHAT_DIR = process.env.GM_CHAT_DIR ?? join(HOME, 'gm-chat-test', 'tools', 'gm-chat')
const APP_DIR = join(import.meta.dir, '..')
// ports: 8787 for the door and 5173 for the app unless GM_DOOR_PORT / GODDARD_APP_PORT say otherwise
const DOOR_PORT = process.env.GM_DOOR_PORT ?? '8787', APP_PORT = process.env.GODDARD_APP_PORT ?? '5173'
const DOOR = `http://127.0.0.1:${DOOR_PORT}`
const LOG = join(HOME, 'Library', 'Logs', 'goddard-os.log')

const say = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const token = () => readFileSync(join(HOME, '.claude', 'channels', 'gm-chat', 'password'), 'utf8').trim()
const up = (url: string) => fetch(url, { signal: AbortSignal.timeout(1500) }).then(r => r.ok, () => false)
// something answering on the port isn't enough: another app may have it (5173 is every Vite app's default)
const isDoor = () => fetch(`${DOOR}/ping`, { signal: AbortSignal.timeout(1500) }).then(r => r.text(), () => '').then(t => t.trim() === 'gm-door')
const isApp = () => fetch(`http://127.0.0.1:${APP_PORT}/auth/state`, { signal: AbortSignal.timeout(1500) }).then(r => r.json(), () => ({})).then(j => 'passwordSignIn' in j)
const detach = (cmd: string[], cwd: string) => {
  const out = openSync(LOG, 'a')
  Bun.spawn(cmd, { cwd, stdio: ['ignore', out, out] }).unref()
}



if (!(await isDoor())) {
  if (await up(`${DOOR}/ping`)) { say(`port ${DOOR_PORT} is taken by another app; set GM_DOOR_PORT to a free one`); process.exit(1) }
  if (!existsSync(join(GM_CHAT_DIR, 'door.ts'))) { say(`gm-chat not found at ${GM_CHAT_DIR}`); process.exit(1) }
  say('starting the gm-chat door'); detach(['bun', 'door.ts'], GM_CHAT_DIR)
  for (let i = 0; i < 20 && !(await isDoor()); i++) await sleep(500)
}
if (!(await isApp())) {
  if (await up(`http://127.0.0.1:${APP_PORT}/`)) { say(`port ${APP_PORT} is taken by another app; set GODDARD_APP_PORT to a free one`); process.exit(1) }
  say(`starting Goddard OS on :${APP_PORT}`)
  detach(['zsh', '-c', `npx vite build && GM_DOOR_URL=${DOOR} exec npx vite preview --host --port ${APP_PORT} --strictPort`], APP_DIR)
}

if (!process.argv.includes('--no-slots')) {
  // every dog is its own session with its own role; the door wakes Scribbles, Fetch and Bloodhound if they're missing,
  // all in the background. Dogs Carl added himself are his to wake again from the pack.
  const headers = { cookie: `gm_chat=${token()}`, 'content-type': 'application/json' }
  const r = await fetch(`${DOOR}/api/dogs/ensure`, { method: 'POST', headers }).then(r => r.json(), () => ({ ok: false, error: 'no answer' }))
  say(r.ok ? (r.woke.length ? `woke ${r.woke.join(', ')}` : 'all core dogs are up') : `could not wake the dogs: ${r.error}`)
  const lists = await fetch(`${DOOR}/api/list`, { headers }).then(r => r.json(), () => ({}))
  if (!lists.threads?.some((t: { home?: boolean }) => t.home)) {
    const h = await fetch(`${DOOR}/api/home`, { method: 'POST', headers }).then(r => r.json(), () => ({ ok: false }))
    say(h.ok ? 'started Home (the main chat) in the background' : `could not start Home: ${h.error ?? 'no answer'}`)
  }
}
say('done')
