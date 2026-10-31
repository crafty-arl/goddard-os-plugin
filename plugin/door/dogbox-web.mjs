// dog-box browser driver for the gm-chat dogs. Talks to the Chromium on screen :1 over its local debugging port.
// Usage: node web.mjs <open|look|click|type|scroll|back|rec-start|rec-stop|flows|flow> '<json args>'
// Rules kept here, not just in the prompt: dogs never type into password fields, and a click must name the
// label it sees, which has to match the element, so the ship gate on the Mac judges the real button.
import { chromium } from 'playwright-core'
import { readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync, appendFileSync } from 'node:fs'
import { spawn } from 'node:child_process'

// each session has its own screen (slot): its browser, picture, recording and tab live in its own folder; trained
// workflows are shared by all
const HOME = '/home/dog/web', SLOT = process.env.GM_SLOT_DIR ?? HOME
const SHOT = SLOT === HOME ? `${HOME}/shots/last.png` : `${SLOT}/last.png`, FLOWS = `${HOME}/flows`, REC = `${SLOT}/rec.json`, TAB = `${SLOT}/dog-tab`
const [cmd, raw] = process.argv.slice(2)
const a = raw ? JSON.parse(raw) : {}
const WHO = String(a.who ?? 'Goddard').slice(0, 24)
const say = (o) => { console.log(typeof o === 'string' ? o : JSON.stringify(o, null, 1)); }
const fail = (m) => { console.log(m); process.exit(2) }
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
const flowName = (n) => /^[A-Za-z0-9 _-]{1,60}$/.test(String(n ?? '')) ? String(n).trim().replace(/\s+/g, '-').toLowerCase() : fail('flow names are letters, numbers, spaces, - and _')

async function page() {
  const b = await chromium.connectOverCDP(process.env.GM_CDP ?? 'http://127.0.0.1:9222')
  const ctx = b.contexts()[0]
  // the dogs drive their own tab and leave Carl's alone (Carl and a dog fought over his LinkedIn tab, 2026-10-30): the dog
  // tab is remembered by its CDP id; if it's gone, a fresh one opens
  const pages = ctx.pages().filter(p => !p.url().startsWith('devtools://'))
  let mine = ''; try { mine = readFileSync(TAB, 'utf8').trim() } catch {}
  let p
  for (const pg of pages) { const s = await ctx.newCDPSession(pg).catch(() => null); const info = s && await s.send('Target.getTargetInfo').catch(() => null); await s?.detach().catch(() => {}); if (info?.targetInfo?.targetId === mine) { p = pg; break } }
  if (!p) {
    // a blank or nap tab nobody's using can be the dog's; otherwise a new one
    p = pages.find(pg => /^(about:blank|file:\/\/\/home\/dog\/web\/idle\.html)/.test(pg.url())) ?? await ctx.newPage()
    const s = await ctx.newCDPSession(p); const info = await s.send('Target.getTargetInfo'); await s.detach().catch(() => {})
    writeFileSync(TAB, info.targetInfo.targetId)
  }
  await p.bringToFront().catch(() => {})
  return { b, ctx, p }
}

// numbers every visible thing a person could click or type into, and returns them with their labels
const MARK = () => {
  const out = []
  const sel = 'a[href],button,input,textarea,select,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[contenteditable=true],summary,label[for]'
  document.querySelectorAll('[data-gm-n]').forEach(e => e.removeAttribute('data-gm-n'))
  let n = 0
  for (const e of document.querySelectorAll(sel)) {
    const r = e.getBoundingClientRect()
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight || getComputedStyle(e).visibility === 'hidden') continue
    const kind = e.tagName === 'INPUT' ? `input:${e.type}` : e.tagName.toLowerCase()
    const label = (e.getAttribute('aria-label') || e.innerText || e.value || e.placeholder || e.title || e.name || e.getAttribute('alt') || '').replace(/\s+/g, ' ').trim().slice(0, 80)
    e.setAttribute('data-gm-n', String(++n))
    out.push({ n, kind, label })
    if (n >= 80) break
  }
  return out
}
// a visible pointer that glides to whatever the dog is about to touch, so Carl can watch it in the live view
// (Carl, 2026-10-29: "we should be seeing the magic mouse move around on the VM"). Playwright clicks don't move the
// screen's real cursor, so the page draws one; the real mouse also travels there so hover effects show.
const CURSOR = (who) => {
  // the gold dot (Carl's pick): ink-ringed, soft gold glow
  if (!document.getElementById('__gmcur')) {
    const c = document.createElement('div'); c.id = '__gmcur'
    Object.assign(c.style, { position: 'fixed', left: (window.__gmx ?? innerWidth / 2) + 'px', top: (window.__gmy ?? innerHeight / 2) + 'px', zIndex: 2147483647,
      width: '18px', height: '18px', margin: '-9px 0 0 -9px', borderRadius: '50%', background: '#BD8430', border: '3px solid #070707', boxSizing: 'border-box',
      boxShadow: '0 0 0 3px rgba(189,132,48,.35), 0 3px 8px rgba(0,0,0,.45)', pointerEvents: 'none',
      transition: 'left .7s cubic-bezier(.3,.7,.2,1), top .7s cubic-bezier(.3,.7,.2,1)' })
    const ring = document.createElement('i')
    Object.assign(ring.style, { position: 'absolute', left: '-14px', top: '-14px', width: '40px', height: '40px', borderRadius: '50%', boxSizing: 'border-box',
      border: '3px solid #BD8430', opacity: 0, transform: 'scale(.4)', transition: 'all .35s ease-out' })
    c.appendChild(ring); document.documentElement.appendChild(c)
  }
  // the paper-cut tag (Carl's pick): who is driving and where, top left, out of the way of clicks
  let t = document.getElementById('__gmtag')
  if (!t) {
    t = document.createElement('div'); t.id = '__gmtag'
    Object.assign(t.style, { position: 'fixed', left: '14px', top: '10px', zIndex: 2147483646, pointerEvents: 'none', background: '#F1EEE7', color: '#070707',
      padding: '7px 14px 6px', font: '400 15px/1 Anton, Impact, sans-serif', letterSpacing: '.04em', textTransform: 'uppercase', transform: 'rotate(-1.5deg)',
      filter: 'drop-shadow(4px 5px 0 #9C7448)', clipPath: 'polygon(0 6%, 12% 0, 40% 5%, 70% 0, 100% 4%, 98% 50%, 100% 96%, 72% 100%, 44% 95%, 15% 100%, 0 94%, 2% 50%)' })
    document.documentElement.appendChild(t)
  }
  t.textContent = ''
  const dot = document.createElement('span'); Object.assign(dot.style, { display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#BD8430', marginRight: '8px', verticalAlign: '2px' })
  const host = document.createElement('span'); host.textContent = ' · ' + location.host.replace(/^www\./, ''); Object.assign(host.style, { color: '#9C7448' })
  t.append(dot, String(who || 'Goddard'), host)
}
async function glide(p, el, press) {
  await el.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => {})
  const box = await el.boundingBox(); if (!box) return
  const x = box.x + Math.min(box.width / 2, 40), y = box.y + box.height / 2
  await p.evaluate(CURSOR, WHO).catch(() => {})
  await p.evaluate(([x, y]) => { const c = document.getElementById('__gmcur'); window.__gmx = x; window.__gmy = y; c.style.left = x + 'px'; c.style.top = y + 'px' }, [x, y]).catch(() => {})
  await p.mouse.move(x, y, { steps: 20 })
  await p.waitForTimeout(750)
  if (press) await p.evaluate(() => { const r = document.querySelector('#__gmcur i'); r.style.opacity = 1; r.style.transform = 'scale(1.4)'
    setTimeout(() => { r.style.opacity = 0; r.style.transform = 'scale(.4)' }, 350) }).catch(() => {})
  await p.waitForTimeout(press ? 300 : 100)
}
const labelOf = (e) => (e.getAttribute('aria-label') || e.innerText || e.value || e.placeholder || e.title || e.name || e.getAttribute('alt') || '').replace(/\s+/g, ' ').trim()

const { b, ctx, p } = await page()
try {
  switch (cmd) {
    case 'open': {
      const url = String(a.url ?? '')
      if (!/^https?:\/\//i.test(url)) fail('give a full http(s) address')
      // sites Carl blocks for the dogs (Chromium policy URLBlocklist, e.g. claude.ai) come back as a plain no
      try { await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }) }
      catch (e) { if (/ERR_BLOCKED_BY_ADMINISTRATOR/.test(String(e))) fail(`blocked: Carl doesn't allow the dogs on ${new URL(url).host}. Don't try another way in; tell him if the job needs it.`); throw e }
      await p.waitForLoadState('networkidle', { timeout: 6_000 }).catch(() => {})
      await p.evaluate(CURSOR, WHO).catch(() => {})
      say(`opened ${p.url()} — "${await p.title()}". Call look to see it.`); break
    }
    case 'look': {
      await p.evaluate(CURSOR, WHO).catch(() => {})
      const items = await p.evaluate(MARK)
      await p.screenshot({ path: SHOT })
      const text = (await p.evaluate(() => document.body?.innerText ?? '')).replace(/\n{3,}/g, '\n\n').slice(0, Number(a.chars ?? 3000))
      say({ url: p.url(), title: await p.title(), things_to_click_or_type: items, text }); break
    }
    case 'click': {
      const el = p.locator(`[data-gm-n="${Number(a.n)}"]`)
      if (!(await el.count())) fail('that number is gone; call look again')
      const real = await el.evaluate(labelOf)
      const said = norm(a.label)
      // exact match, so a dog can't name half a button ("now" for "Post now") and slip past the gate
      if (!said || said !== norm(real.slice(0, 80)))
        fail(`not clicked: item ${a.n} says "${real.slice(0, 80)}", not "${a.label}". Pass its real label.`)
      await glide(p, el, true)
      await el.click({ timeout: 10_000 })
      await p.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {})
      say(`clicked "${real.slice(0, 80)}". Now on ${p.url()}. Call look to see what changed.`); break
    }
    case 'type': {
      const el = p.locator(`[data-gm-n="${Number(a.n)}"]`)
      if (!(await el.count())) fail('that number is gone; call look again')
      const kind = await el.evaluate(e => (e.getAttribute('type') || '').toLowerCase() + ' ' + (e.getAttribute('autocomplete') || '').toLowerCase())
      if (/password|one-time-code|cc-/.test(kind)) fail('not typed: dogs never type passwords, codes or card numbers. Ask Carl to do this part himself in the live view.')
      await glide(p, el, true)
      await el.fill('', { timeout: 10_000 }).catch(() => {})
      await el.pressSequentially(String(a.text ?? ''), { delay: 35, timeout: 30_000 }).catch(() => el.fill(String(a.text ?? ''), { timeout: 10_000 }))
      say(`typed into item ${a.n}. Nothing was submitted; click the button to send it.`); break
    }
    // back to the resting screen: Goddard asleep on a paper card
    case 'rest': await p.goto('file:///home/dog/web/idle.html').catch(() => {}); say('resting screen is up'); break
    case 'scroll': {
      // scrolled in small steps with the gold dot in the middle, so Carl sees the page move instead of a jump
      const dy = Number(a.dy ?? 700), n = 14
      const [x, y] = await p.evaluate(() => [Math.round(innerWidth / 2), Math.round(innerHeight / 2)]).catch(() => [360, 700])
      await p.evaluate(CURSOR, WHO).catch(() => {})
      await p.evaluate(([x, y]) => { const c = document.getElementById('__gmcur'); if (c) { window.__gmx = x; window.__gmy = y; c.style.left = x + 'px'; c.style.top = y + 'px' } }, [x, y]).catch(() => {})
      await p.mouse.move(x, y, { steps: 10 }); await p.waitForTimeout(500)
      for (let i = 0; i < n; i++) { await p.mouse.wheel(0, dy / n); await p.waitForTimeout(45) }
      await p.waitForTimeout(300)
      say('scrolled. Call look.'); break
    }
    case 'back': await p.goBack({ timeout: 15_000 }).catch(() => {}); say(`back on ${p.url()}`); break

    // --- training: Carl does it once in the live view, the steps are written down, dogs replay them with the tools above ---
    case 'rec-start': {
      const name = flowName(a.name)
      if (existsSync(REC)) fail('already recording; stop it first')
      const child = spawn(process.execPath, [new URL(import.meta.url).pathname, 'rec-run', JSON.stringify({ name })], { detached: true, stdio: 'ignore' })
      child.unref()
      writeFileSync(REC, JSON.stringify({ name, pid: child.pid, at: Date.now() }))
      say(`recording "${name}". Carl does the task in the live view now; say rec-stop when he's done.`); break
    }
    case 'rec-run': {
      const name = flowName(a.name), file = `${FLOWS}/${name}.jsonl`
      writeFileSync(file, '')
      const put = (s) => appendFileSync(file, JSON.stringify({ ...s, at: Date.now() }) + '\n')
      put({ do: 'open', url: p.url() })
      await ctx.exposeBinding('__gmrec', (_src, s) => put(s)).catch(() => {})
      const spy = () => {
        if (window.__gmspy) return; window.__gmspy = 1
        const lab = (e) => (e.getAttribute('aria-label') || e.innerText || e.value || e.placeholder || e.title || e.name || '').replace(/\s+/g, ' ').trim().slice(0, 80)
        addEventListener('click', ev => { const e = ev.target.closest('a,button,input,select,textarea,[role],summary,label') || ev.target; window.__gmrec?.({ do: 'click', label: lab(e), kind: e.tagName.toLowerCase() }) }, true)
        addEventListener('change', ev => { const e = ev.target; if (!e.matches?.('input,textarea,select')) return
          const secret = /password/i.test(e.type) || /one-time-code|cc-/i.test(e.autocomplete || '')
          const field = (e.getAttribute('aria-label') || e.placeholder || e.name || e.id || e.type || '').slice(0, 60)
          window.__gmrec?.({ do: 'type', field, text: secret ? '[Carl types this himself]' : String(e.value).slice(0, 200) }) }, true)
      }
      await ctx.addInitScript(spy)
      for (const pg of ctx.pages()) await pg.evaluate(spy).catch(() => {})
      ctx.on('page', pg => pg.on('framenavigated', f => { if (f === pg.mainFrame()) put({ do: 'open', url: f.url() }) }))
      for (const pg of ctx.pages()) pg.on('framenavigated', f => { if (f === pg.mainFrame()) put({ do: 'open', url: f.url() }) })
      await new Promise(() => {}) // runs until rec-stop
    }
    case 'rec-stop': {
      if (!existsSync(REC)) fail('not recording')
      const r = JSON.parse(readFileSync(REC, 'utf8'))
      try { process.kill(r.pid) } catch {}
      unlinkSync(REC)
      const steps = readFileSync(`${FLOWS}/${r.name}.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
        .filter((s, i, all) => !(s.do === 'open' && all[i - 1]?.do === 'open' && all[i - 1].url === s.url))
      writeFileSync(`${FLOWS}/${r.name}.json`, JSON.stringify({ name: r.name, recorded: new Date(r.at).toISOString(), steps }, null, 1))
      unlinkSync(`${FLOWS}/${r.name}.jsonl`)
      say(`saved workflow "${r.name}" with ${steps.length} steps.`); break
    }
    case 'flows': say(readdirSync(FLOWS).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')).join('\n') || 'no workflows yet'); break
    case 'flow': {
      const f = `${FLOWS}/${flowName(a.name)}.json`
      if (!existsSync(f)) fail('no workflow by that name; call flows')
      const w = JSON.parse(readFileSync(f, 'utf8'))
      say(`Workflow "${w.name}" (recorded ${w.recorded.slice(0, 10)}). Replay it with web_open / web_look / web_click / web_type, matching each step by its label, not its position. If a page changed, find the closest match and say what differed.\n` +
        w.steps.map((s, i) => `${i + 1}. ${s.do === 'open' ? `open ${s.url}` : s.do === 'click' ? `click "${s.label}"` : `type into "${s.field}": ${s.text}`}`).join('\n')); break
    }
    default: fail('commands: rest, open, look, click, type, scroll, back, rec-start, rec-stop, flows, flow')
  }
} finally {
  if (cmd !== 'rec-run') await b.close().catch(() => {}) // closes the connection, not the browser
}
