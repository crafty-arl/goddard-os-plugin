// Retakes the README screenshots and the demo GIF from a throwaway demo install.
//
//   bun install && bun run screenshots
//
// What it does, in order:
//   1. Starts the bundled door and app on spare ports (8797 and 5183) with an empty, temporary state folder, so it never
//      touches a real install. Claude is replaced by a stand-in that starts nothing.
//   2. Signs a headless phone-sized browser in and walks Setup as a made-up owner ("Dana", "Lakefront Lab"),
//      screenshotting each step.
//   3. Adds two stand-in chats (a plan waiting for Go, and a Just talk chat) to show Home and the mode switch.
//   4. Writes the PNGs to docs/screens/ and builds docs/demo.gif with ffmpeg, then stops everything and deletes the
//      temporary folder.
//
// Needs: Bun, Node, ffmpeg, and a Chromium for Playwright (`bunx playwright install chromium`, or set CHROME_PATH).
import { chromium, type Page } from 'playwright-core'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..'), PLUGIN = join(ROOT, 'plugin'), SCREENS = join(ROOT, 'docs', 'screens')
const DOOR_PORT = 8797, APP = 'http://localhost:5183', PASSWORD = 'demo-only-password'
const T = mkdtempSync(join(tmpdir(), 'goddard-shots-')), STATE = join(T, 'state'), RAW = join(T, 'raw')
const procs: ReturnType<typeof Bun.spawn>[] = [], servers: ReturnType<typeof Bun.serve>[] = []
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const up = (url: string) => fetch(url).then(() => true, () => false)
async function waitFor(url: string) { for (let i = 0; i < 120 && !(await up(url)); i++) await sleep(500) }

function cleanup() { for (const s of servers) s.stop(true); for (const p of procs) p.kill(); rmSync(T, { recursive: true, force: true }) }
process.on('exit', cleanup)

// 1. the demo install
for (const d of [STATE, RAW, SCREENS, join(STATE, 'sessions')]) mkdirSync(d, { recursive: true })
writeFileSync(join(STATE, 'password'), PASSWORD, { mode: 0o600 })
writeFileSync(join(T, 'claude'), '#!/bin/sh\n[ "$1" = agents ] && echo "[]"\nexit 0\n'); chmodSync(join(T, 'claude'), 0o755)
for (const dir of ['door', 'app']) Bun.spawnSync(['bun', 'install', '--no-summary'], { cwd: join(PLUGIN, dir) })
Bun.spawnSync(['npx', 'vite', 'build'], { cwd: join(PLUGIN, 'app') })
procs.push(Bun.spawn(['bun', 'door.ts'], { cwd: join(PLUGIN, 'door'), stdout: 'ignore', stderr: 'ignore',
  env: { ...process.env, GM_CHAT_STATE: STATE, GM_DOOR_PORT: String(DOOR_PORT), GM_CLAUDE: join(T, 'claude'), GM_NO_WATCHDOG: '1' } }))
procs.push(Bun.spawn(['npx', 'vite', 'preview', '--port', '5183', '--strictPort'], { cwd: join(PLUGIN, 'app'), stdout: 'ignore', stderr: 'ignore',
  env: { ...process.env, GM_CHAT_STATE: STATE, GM_DOOR_URL: `http://127.0.0.1:${DOOR_PORT}` } }))
await waitFor(`http://127.0.0.1:${DOOR_PORT}/ping`); await waitFor(APP)

// 2. walk Setup as a new owner
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
const page: Page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark', isMobile: true, hasTouch: true })).newPage()
const shot = async (name: string) => { await page.waitForTimeout(800); await page.screenshot({ path: join(RAW, `${name}.png`) }); console.log('✓', name) }
const tap = (name: string) => page.getByRole('button', { name, exact: true }).first().click()

await page.goto(`${APP}/welcome?p=${PASSWORD}`)
await page.getByText('Step 1 of 6').waitFor({ timeout: 20_000 })
const fields = page.locator('.setup-field input')
await fields.nth(0).fill('Dana'); await fields.nth(1).fill('chief'); await fields.nth(2).fill('Lakefront Lab')
await tap('Test this Mac'); await page.getByText('Claude Code and Bun').waitFor()
await shot('1-setup-you')
await tap('Next'); await page.getByRole('radio', { name: /From anywhere/ }).click()
await page.locator('.setup-field input').first().fill('dana-box.example.ts.net')
await shot('2-setup-phone')
await tap('Next'); await shot('3-setup-dogs')
await tap('Next'); await page.getByRole('radio', { name: /A browser on this Mac/ }).click(); await tap('Test it'); await page.getByText('Each dog gets its own').waitFor()
await shot('4-setup-dog-computer')
await tap('Next'); await shot('5-setup-pings')
await tap('Next'); await shot('6-setup-more')
await tap('Save setup'); await page.waitForTimeout(1500)
await shot('7-home')
await page.getByText('Start a session').click(); await page.getByRole('radio', { name: 'Just talk' }).waitFor()
await shot('8-new-session-plan')
await page.getByRole('radio', { name: 'Just talk' }).click(); await shot('9-new-session-talk')

// 3. two stand-in chats: what a running chat's page tells the door
function standIn(port: number, state: Record<string, unknown>) {
  servers.push(Bun.serve({ port, hostname: '127.0.0.1', fetch: req => {
    const u = new URL(req.url)
    if (u.pathname === '/state') return Response.json({ port, server: 'Mac', folder: T, doing: '', busy: false, last: { text: 'ok', at: Date.now() }, ...state })
    if (u.pathname === '/say') return new Response('ok')
    return new Response('no', { status: 404 })
  } }))
  writeFileSync(join(STATE, 'sessions', `${port}.json`), JSON.stringify({ port, name: state.name, pid: process.pid }))
}
standIn(8892, { name: 'Session · Launch post', needsYou: true, sessionMode: 'plan', last: { text: 'Here is the plan for the launch post: five steps, drafts only. Go?', at: Date.now() },
  plan: { approved: false, steps: ["Read the event page and last year's post", 'Draft three hooks in your voice', 'Write the post and the first comment', 'Check every link and tag', 'Hand it to you as a draft'] } })
standIn(8893, { name: 'Session · Weekend ideas', needsYou: false, sessionMode: 'talk' })
await page.goto(APP); await page.waitForTimeout(2500)
await shot('10-home-needs-you')
await page.getByText('Weekend ideas').first().click(); await page.waitForTimeout(1500)
await page.locator('.sess-modebar-now').click(); await shot('11-switch-mode')
await browser.close()

// 4. the README images and the demo GIF
const ff = (args: string[]) => { const r = Bun.spawnSync(['ffmpeg', '-loglevel', 'error', '-y', ...args]); if (r.exitCode) throw new Error(r.stderr.toString()) }
const names = ['1-setup-you', '2-setup-phone', '3-setup-dogs', '4-setup-dog-computer', '5-setup-pings', '6-setup-more', '7-home', '9-new-session-talk', '10-home-needs-you', '11-switch-mode']
for (const n of names) ff(['-i', join(RAW, `${n}.png`), '-vf', 'scale=585:-1', join(SCREENS, `${n}.png`)])
const order = ['1-setup-you', '2-setup-phone', '4-setup-dog-computer', '5-setup-pings', '7-home', '10-home-needs-you', '9-new-session-talk', '11-switch-mode']
writeFileSync(join(RAW, 'list.txt'), [...order.flatMap(n => [`file '${join(RAW, n)}.png'`, 'duration 2.2']), `file '${join(RAW, order.at(-1)!)}.png'`].join('\n'))
ff(['-f', 'concat', '-safe', '0', '-i', join(RAW, 'list.txt'), '-vf', 'scale=360:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer', '-loop', '0', join(ROOT, 'docs', 'demo.gif')])
console.log(`done: ${names.length} screenshots in docs/screens, and docs/demo.gif`)
process.exit(0)
