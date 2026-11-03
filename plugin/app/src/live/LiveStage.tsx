// The live stage (Carl, 2026-11-03: "when I am making the video the changes should happen in front of me in real time"):
// pinned at the top of a robot video chat, it plays the sketch on the owner's own stage and keeps watching the sketch's
// folder. Any change (his keys, a spec the dog edited for him, a Grok line he picked) is rebuilt (robot.py preview, about
// a second) and swapped into the running scene in place, at the same moment of the playhead; a change the running scene
// can't take in place (a new length, a new prop, another robot) reloads it at that moment. A small note says what changed.
import { useEffect, useRef, useState } from 'react'
import { fileUrl } from './outputs'

type Scene = { n: number; host: string; dur: number; scene: string; phone: string; audio: string; silent: string[] }
type Manifest = { id: string; total: number; scenes: Scene[] }
type Beat = { say?: string; act?: string; shot?: string; light?: string; hold?: number; pause?: number }

const phoneSized = () => matchMedia('(pointer: coarse)').matches || innerWidth < 700
const sceneFile = (s: Scene) => phoneSized() ? s.phone : s.scene

// what changed between two specs, in the owner's words ("beat 3: hold 2.5 → 4 s")
export function specChanges(a: { beats?: Beat[]; scenes?: { beats?: Beat[] }[] } | null, b: typeof a): string[] {
  const flat = (s: typeof a) => s?.scenes ? s.scenes.flatMap(x => x.beats ?? []) : s?.beats ?? []
  const A = flat(a), B = flat(b), out: string[] = []
  if (A.length !== B.length) out.push(`${B.length} beats (was ${A.length})`)
  B.forEach((x, i) => {
    const y = A[i]; if (!y) return
    if ((x.say ?? '') !== (y.say ?? '')) out.push(`beat ${i + 1}: new line`)
    for (const k of ['hold', 'pause'] as const) if ((x[k] ?? null) !== (y[k] ?? null)) out.push(`beat ${i + 1}: ${k} ${y[k] ?? '–'} → ${x[k] ?? '–'} s`)
    for (const k of ['act', 'shot', 'light'] as const) if ((x[k] ?? null) !== (y[k] ?? null)) out.push(`beat ${i + 1}: ${k} ${y[k] ?? '–'} → ${x[k] ?? '–'}`)
  })
  return out
}

// swap a rebuilt scene into the running stage in place; false when it has to be reloaded instead
function hotApply(win: any, next: any): boolean {
  const S = win?.STAGE; if (!S) return false
  const SC = S.SC, same = SC.set === next.set && SC.room3d === next.room3d && Math.abs(SC.duration - next.duration) < 0.005
    && JSON.stringify(SC.cast.map((c: any) => [c.robot, c.posture, c.props])) === JSON.stringify(next.cast.map((c: any) => [c.robot, c.posture, c.props]))
    && JSON.stringify((SC.objects ?? []).map((o: any) => o.id)) === JSON.stringify((next.objects ?? []).map((o: any) => o.id))
  if (!same) return false
  SC.cast.forEach((c: any, i: number) => { c.anim = next.cast[i].anim })
  for (const [k, v] of Object.entries(next)) {
    if (k === 'cast' || k === 'objects') continue
    const cur = SC[k]
    // the stage holds some of these objects by reference (the light, the captions): change their contents, not the object
    if (cur && v && typeof cur === 'object' && typeof v === 'object' && !Array.isArray(cur)) { for (const x of Object.keys(cur)) delete cur[x]; Object.assign(cur, v) }
    else SC[k] = v
  }
  return true
}

export function LiveStage({ plan }: { plan: string }) {
  const [m, setM] = useState<Manifest | null>(null)
  const [k, setK] = useState(0)
  const [t, setT] = useState(0)                    // seconds into the scene on screen
  const [playing, setPlaying] = useState(false)
  const [note, setNote] = useState('')
  const [open, setOpen] = useState(true)
  const frame = useRef<HTMLIFrameElement>(null), au = useRef<HTMLAudioElement>(null)
  const seen = useRef<{ spec: number; anim: number; lines: number } | null>(null), spec = useRef<any>(null), busy = useRef(false)
  const tRef = useRef(0); tRef.current = t
  const dir = plan.replace(/\/plan\.md$/, ''), sc = m?.scenes[k]

  const build = () => fetch('/door/api/robot/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan }) })
    .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error); return j as Manifest })
  const readSpec = () => fetch(fileUrl(dir + '/spec.json', Date.now())).then(r => r.ok ? r.json() : null, () => null)
  useEffect(() => { build().then(setM, e => setNote(String(e.message ?? e))); readSpec().then(s => { spec.current = s }) }, [plan]) // eslint-disable-line react-hooks/exhaustive-deps

  const el = (id: string) => frame.current?.contentDocument?.getElementById(id) as HTMLElement | null
  const hold = (time: number) => { const pp = el('pp'), s = el('sc') as HTMLInputElement | null, w = frame.current?.contentWindow as any
    if (!pp || !s || !w || !sc) return; if (pp.textContent === 'pause') pp.click(); s.value = String(Math.round(time / sc.dur * 1000)); s.dispatchEvent(new w.Event('input')) }
  const load = (at: number) => { if (frame.current && sc) frame.current.src = `/door/rig/rig/tablestage.html?play=1&scene=../${sceneFile(sc)}&v=${Date.now()}#t=${at.toFixed(2)}` }
  useEffect(() => { if (sc) { load(0); setT(0) } }, [sc?.scene]) // eslint-disable-line react-hooks/exhaustive-deps
  // the player's own controls give way to ours, and it holds still at our time
  useEffect(() => { const iv = window.setInterval(() => { const d = frame.current?.contentDocument; if (!d || !el('sc')) return
    const fw = frame.current!.contentWindow as any
    if (fw && !fw.__frozen) { fw.__frozen = true; const orig = fw.fetch.bind(fw), mine = new URLSearchParams(fw.location.search).get('scene'), first = orig(mine).then((r: Response) => r.text())
      // the stage's own player checks its scene file each second and reloads on a change; it now always sees the file it
      // loaded, and changes come in through hotApply instead (or a reload this screen asks for)
      fw.fetch = (u: RequestInfo, o?: RequestInit) => String(u) === mine ? first.then((t: string) => new fw.Response(t)) : orig(u, o) }
    if (!d.getElementById('gos-tidy')) { const s = d.createElement('style'); s.id = 'gos-tidy'; s.textContent = '#pp,#sc,#tm{display:none!important} body{background:#0B0A08!important} canvas{height:calc(100vh - 44px)!important} #cap{font-size:12px!important;min-height:0!important}'; d.head.appendChild(s) }
    if (!playing) hold(tRef.current) }, 250); return () => clearInterval(iv) }, [playing, sc?.scene]) // eslint-disable-line react-hooks/exhaustive-deps

  // play: the scene's voices are the clock; the next scene follows
  useEffect(() => {
    if (!playing || !sc) return
    let raf = 0; const a = au.current, t0 = performance.now() / 1000 - t
    if (a) { a.src = `/door/rig/${sc.audio}?v=${seen.current?.spec ?? 0}-${seen.current?.anim ?? 0}`; a.currentTime = t; a.play().catch(() => {}) }
    const tick = () => { const now = a && !a.paused ? a.currentTime : performance.now() / 1000 - t0
      if (now >= sc.dur) { if (m && k + 1 < m.scenes.length) { setK(k + 1); setT(0) } else { setT(sc.dur); setPlaying(false) } return }
      setT(now); hold(now); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); a?.pause() }
  }, [playing, sc?.scene]) // eslint-disable-line react-hooks/exhaustive-deps

  // watch the sketch's folder: a change is rebuilt and swapped in where the playhead is
  useEffect(() => {
    let stop = false
    const iv = window.setInterval(async () => {
      if (busy.current || !m) return
      const w = await fetch(`/door/api/robot/watch?plan=${encodeURIComponent(plan)}`).then(r => r.ok ? r.json() : null, () => null)
      if (!w || stop) return
      const before = seen.current; seen.current = w
      if (!before || (w.spec === before.spec && w.anim === before.anim)) return
      busy.current = true
      try {
        const what: string[] = []
        if (w.spec !== before.spec) { const s = await readSpec(); if (JSON.stringify(s) !== JSON.stringify(spec.current)) { what.push(...specChanges(spec.current, s)); if (!what.length) what.push('the spec') } spec.current = s }
        if (w.anim !== before.anim) what.push('your keys')
        if (!what.length) return
        const nm = await build(); if (stop) return
        setM(nm); const ns = nm.scenes[Math.min(k, nm.scenes.length - 1)]
        const next = await fetch(`/door/rig/${sceneFile(ns)}`, { cache: 'no-store' }).then(r => r.json())
        const at = Math.min(tRef.current, ns.dur)
        if (!hotApply(frame.current?.contentWindow, next)) { if (frame.current) frame.current.src = `/door/rig/rig/tablestage.html?play=1&scene=../${sceneFile(ns)}&v=${Date.now()}#t=${at.toFixed(2)}`; what.push('(reloaded at the same moment)') }
        if (au.current && playing) { const ct = au.current.currentTime; au.current.src = `/door/rig/${ns.audio}?v=${w.spec}-${w.anim}`; au.current.currentTime = ct; au.current.play().catch(() => {}) }
        setT(at); setNote('updated: ' + what.slice(0, 3).join(' · ') + (what.length > 3 ? ` +${what.length - 3}` : ''))
        window.setTimeout(() => setNote(n => n.startsWith('updated') ? '' : n), 4000)
      } catch (e) { setNote(String((e as Error).message)) } finally { busy.current = false }
    }, 1000)
    return () => { stop = true; clearInterval(iv) }
  }, [m, k, playing]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return <button className="ls-show" onClick={() => setOpen(true)}>▶ Show the live stage</button>
  const start = m ? m.scenes.slice(0, k).reduce((a, s) => a + s.dur, 0) : 0
  return (
    <section className="ls" aria-label="Live stage">
      <audio ref={au} preload="auto" />
      <div className="ls-stage"><iframe ref={frame} title="Live stage" />{!m && <span className="vp-wait">Setting up your stage…</span>}{note && <span className="ls-note" role="status">{note}</span>}</div>
      <div className="ls-bar">
        <button className="ls-play" onClick={() => setPlaying(p => !p)} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
        <input type="range" min={0} max={1000} aria-label="Scrub" value={m ? Math.round((start + t) / m.total * 1000) : 0}
          onChange={e => { if (!m) return; setPlaying(false); let g = +e.target.value / 1000 * m.total, j = 0; while (j < m.scenes.length - 1 && g >= m.scenes[j].dur) { g -= m.scenes[j].dur; j++ } if (j !== k) setK(j); setT(g) }} />
        <span className="ls-time">{(start + t).toFixed(1)}s</span>
        <button className="ls-hide" onClick={() => setOpen(false)} aria-label="Hide the live stage">⌄</button>
      </div>
      {(m?.scenes.length ?? 0) > 1 && <div className="an-chips">{m!.scenes.map((s, i) => <button key={s.n} className={i === k ? 'on' : ''} onClick={() => { setPlaying(false); setK(i); setT(0) }}>S{s.n} {s.host}</button>)}</div>}
    </section>
  )
}
