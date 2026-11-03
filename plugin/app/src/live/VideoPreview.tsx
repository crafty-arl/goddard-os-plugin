// The paper robot preview (Carl, 2026-11-02: "preview my videos before I render them"): the sketch plays live on the
// owner's own stage (the rig's tablestage.html player, served read-only by the door), every scene back to back, before
// anything renders. The sound is one track in this page, started by the tap that opened the preview (browsers and
// iPhones let a tapped sound keep playing), and it is the clock: the stage follows it. The player is driven from out
// here (seek, pause), so the rig itself is never edited. Two frames take turns: one plays, the other has the next
// scene loaded and waiting, so the cut is clean.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fileUrl } from './outputs'

type Scene = { n: number; host: string; dur: number; scene: string; phone: string; audio: string; silent: string[] }
type Manifest = { id: string; title: string; total: number; scenes: Scene[]; audio: string; new_voices: number; note: string }

const phoneSized = () => matchMedia('(pointer: coarse)').matches || innerWidth < 700
// no audio here: the frames are silent pictures, the page's own track is the sound
const src = (s: Scene, at = 0) => `/door/rig/rig/tablestage.html?play=1&scene=../${phoneSized() ? s.phone : s.scene}#t=${at.toFixed(2)}`
// a tiny silent sound, played on the opening tap so the track is allowed to play once the real mix arrives
const SILENCE = 'data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
// the player's own pieces, found by the ids it gives them
const el = (f: HTMLIFrameElement | null, id: string) => f?.contentDocument?.getElementById(id) as HTMLElement | null
const timeOf = (f: HTMLIFrameElement | null) => parseFloat(f?.contentWindow?.location.hash.slice(3) ?? '') || 0
const ready = (f: HTMLIFrameElement | null) => !!el(f, 'sc')
function setPlaying(f: HTMLIFrameElement | null, on: boolean) { const pp = el(f, 'pp'); if (pp && (pp.textContent === 'pause') !== on) pp.click() }
function seekTo(f: HTMLIFrameElement | null, t: number, dur: number) {
  const sc = el(f, 'sc') as HTMLInputElement | null, w = f?.contentWindow as (Window & typeof globalThis) | null
  if (!sc || !w) return
  sc.value = String(Math.round(t / dur * 1000)); sc.dispatchEvent(new w.Event('input'))
}
// the preview shows the picture and the caption line; the player's own controls give way to ours
function tidy(f: HTMLIFrameElement | null) {
  const d = f?.contentDocument; if (!d || d.getElementById('gos-tidy')) return
  const st = d.createElement('style'); st.id = 'gos-tidy'
  st.textContent = '#pp,#sc,#tm{display:none!important} body{background:#0B0A08!important} canvas{height:calc(100vh - 92px)!important} #cap{font-size:13px!important;min-height:0!important}'
  d.head.appendChild(st)
}

export function VideoPreview({ plan, onClose, onExport, onChange }: { plan: string; onClose: () => void; onExport: () => void; onChange: () => void }) {
  const [m, setM] = useState<Manifest | null>(null)
  const [err, setErr] = useState('')
  const [now, setNow] = useState(0)       // seconds into the whole sketch
  const [paused, setPaused] = useState(false)
  const [loading, setLoading] = useState(true)
  const [firstFrame, setFirstFrame] = useState<number | null>(null)
  const [mute, setMute] = useState(false)  // the browser held the sound back: the picture keeps time on its own
  const [active, setActive] = useState(0)
  const frames = [useRef<HTMLIFrameElement>(null), useRef<HTMLIFrameElement>(null)]
  const au = useRef<HTMLAudioElement>(null)
  // k: the scene on screen; base: the wall clock's zero when there is no sound to follow
  const st = useRef({ active: 0, k: 0, t0: performance.now(), shown: false, paused: false, base: 0, at: 0 })

  // inside the tap that opened the preview: wake the track up so it may play later
  useLayoutEffect(() => { const a = au.current; if (a) { a.src = SILENCE; a.play().catch(() => {}) } }, [])
  useEffect(() => {
    fetch('/door/api/robot/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan }) })
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setM(j) }).catch(e => setErr((e as Error).message))
  }, [plan])
  const startOf = (k: number) => m ? m.scenes.slice(0, k).reduce((a, s) => a + s.dur, 0) : 0
  const sceneAt = (g: number) => { let k = 0; while (m && k < m.scenes.length - 1 && g >= startOf(k + 1)) k++; return k }
  // where the sketch is: the track's time while it plays, else the wall clock (or where it was left)
  const clock = () => { const a = au.current, s = st.current
    if (!s.shown) return 0
    if (s.paused) return s.at
    return a && !a.paused && a.src.includes('preview.wav') ? a.currentTime : performance.now() / 1000 - s.base }

  // load scene k (from `at`) into the frame that plays, and the scene after it into the other
  const cue = (k: number, at = 0) => {
    if (!m) return
    const s = st.current, a = frames[s.active].current, b = frames[1 - s.active].current
    s.k = k; setLoading(true)
    if (a) a.src = src(m.scenes[k], at)
    if (b && m.scenes[k + 1]) b.src = src(m.scenes[k + 1])
  }
  useEffect(() => {
    if (!m) return
    const a = au.current
    if (a) { a.src = fileUrl(m.audio, Date.now()); a.load() }
    cue(0)
  }, [m]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!m) return
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const s = st.current, g = Math.min(clock(), m.total), k = sceneAt(g)
      if (k !== s.k) {
        // the cut: the waiting frame takes over when it holds the next scene, else the scene is loaded fresh
        const a = frames[s.active].current, b = frames[1 - s.active].current
        setPlaying(a, false)
        if (k === s.k + 1 && ready(b)) {
          s.active = 1 - s.active; setActive(s.active); s.k = k
          if (a && m.scenes[k + 1]) a.src = src(m.scenes[k + 1])
        } else cue(k, g - startOf(k))
      }
      const a = frames[s.active].current, b = frames[1 - s.active].current, local = g - startOf(s.k)
      if (b && ready(b)) { tidy(b); setPlaying(b, false) }   // the next scene waits, loaded and still
      if (!ready(a)) return
      tidy(a)
      // the first picture is up: the sound starts with it
      if (!s.shown) { s.shown = true; setFirstFrame(performance.now() - s.t0); s.base = performance.now() / 1000
        const t = au.current; if (t) { t.currentTime = 0; t.play().catch(() => setMute(true)) } }
      setLoading(false)
      // the stage follows the clock: it plays along, and is put back whenever it drifts
      setPlaying(a, !s.paused && g < m.total)
      if (Math.abs(timeOf(a) - local) > 0.15) seekTo(a, local, m.scenes[s.k].dur)
      setNow(g)
      if (g >= m.total && !s.paused) { s.paused = true; s.at = m.total; setPaused(true) }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [m]) // eslint-disable-line react-hooks/exhaustive-deps

  const scrub = (g: number) => {
    if (!m) return
    const s = st.current, a = au.current
    g = Math.max(0, Math.min(m.total - 0.02, g)); s.at = g; s.base = performance.now() / 1000 - g
    if (a && a.src.includes('preview.wav')) a.currentTime = g
    setNow(g)
  }
  const toggle = () => {
    if (!m) return
    const s = st.current, a = au.current
    if (s.paused) {
      if (s.at >= m.total - 0.05) s.at = 0
      s.paused = false; setPaused(false); scrub(s.at)
      if (a && a.src.includes('preview.wav')) a.play().then(() => setMute(false), () => setMute(true))
    } else { s.at = clock(); s.paused = true; setPaused(true); a?.pause() }
  }
  const silent = m?.scenes.flatMap(s => s.silent) ?? []

  return (
    <section className="vp" role="dialog" aria-label="Preview">
      <audio ref={au} preload="auto" />
      <header className="vp-top">
        <button className="calm-quiet" onClick={onClose}>← Back</button>
        <b>Preview</b>
        <span className="vp-live">{err ? '' : loading ? 'LOADING' : paused ? 'PAUSED' : '● LIVE'}</span>
      </header>
      {err ? <p className="vp-err">{err}</p> : <>
        <div className="vp-stage" onClick={toggle}>
          {frames.map((r, i) => <iframe key={i} ref={r} title={`Scene player ${i + 1}`} className={active === i ? 'on' : ''} />)}
          {!m && <span className="vp-wait">Building the scenes…</span>}
          {paused && m && <span className="vp-play" aria-hidden="true">▶</span>}
        </div>
        <div className="vp-prog">
          <input type="range" min={0} max={1000} value={m ? Math.round(now / m.total * 1000) : 0} aria-label="Scrub"
            onChange={e => m && scrub(Number(e.target.value) / 1000 * m.total)} />
          <div className="vp-chips">
            {(m?.scenes ?? []).map((s, k) => {
              const a = startOf(k), cls = now >= a + s.dur - 0.01 ? 'done' : now >= a ? 'now' : ''
              return <button key={s.n} className={cls} onClick={() => scrub(a + 0.01)}>S{s.n} {s.host.toUpperCase()}</button>
            })}
          </div>
          {m && <span className="vp-time">{now.toFixed(1)} / {m.total.toFixed(1)} s{firstFrame !== null ? ` · ready in ${(firstFrame / 1000).toFixed(1)} s` : ''}</span>}
        </div>
        {mute && <p className="vp-note">The browser held the sound back. Tap the picture twice to play it with sound.</p>}
        {silent.length > 0 && <p className="vp-note">{silent.length} line{silent.length === 1 ? ' has' : 's have'} no voice yet and play{silent.length === 1 ? 's' : ''} silent. Voicing {silent.length === 1 ? 'it' : 'them'} costs a few cents, only on your OK.</p>}
        <div className="vp-btns">
          <button className="vp-change" onClick={onChange}>✎ Change a beat</button>
          <button className="vp-go" onClick={onExport} disabled={!m}>Looks right, export</button>
        </div>
        <div className="vp-out"><span>MP4</span><div><b>{m ? `${m.id}_short.mp4` : 'The video'}</b><small>exports only after you approve the preview{m ? ` · ${m.note}` : ''}</small></div></div>
      </>}
    </section>
  )
}
