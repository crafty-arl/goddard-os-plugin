// Animate (Carl, 2026-11-03: "I don't have control over the video"): the owner poses the robots himself, on his own
// painted stage. Tap a part of a robot to pick it, drag to bend it (inside the rig's own joint limits), key the pose on
// that robot's lane, and key the camera on its lane. The stage is the rig's tablestage.html player; a two-line hook in
// it (window.STAGE) lets this screen write the keyed tracks straight into the live scene, and the same tracks are saved
// to anim.json beside the spec, which robot.py pastes into the render. So the export plays exactly what was keyed.
import { useEffect, useRef, useState } from 'react'
import { fileUrl } from './outputs'

type Scene = { n: number; host: string; dur: number; scene: string; phone: string; audio: string; silent: string[] }
type Manifest = { id: string; total: number; scenes: Scene[] }
// a pose: the stage's own channels. arm = [raise, out, elbow], chest = [lean, twist, roll], head = [pitch, yaw, roll]
type Pose = { armL: number[]; armR: number[]; chest: number[]; head: number[] }
type Part = keyof Pose
type Key = { t: number; pose: Pose }
type CamKey = { t: number; shot: Shot; orbit: number; zoom: number }
type Shot = 'wide' | 'med' | 'close'
type SceneKeys = { robots: Record<string, Key[]>; camera: CamKey[] }
type Track = [number, unknown, string?][]
type Stage = { SC: any; robots: any[]; cam: any; THREE: any; renderer: any }

const PARTS: Record<Part, { name: string; dials: [string, number, number][] }> = {
  // [label, min, max] in the stage's units; the arms and the body follow the rig's skeleton.json limits
  armL: { name: 'left arm', dials: [['Raise', -60, 180], ['Out', -10, 150], ['Elbow', -150, 0]] },
  armR: { name: 'right arm', dials: [['Raise', -60, 180], ['Out', -10, 150], ['Elbow', -150, 0]] },
  chest: { name: 'body', dials: [['Lean', -30, 40], ['Twist', -30, 30], ['Tilt', -20, 20]] },
  head: { name: 'head', dials: [['Nod', -30, 40], ['Turn', -70, 70], ['Tilt', -25, 25]] },
}
const BONE: Record<string, Part> = { shoulder_L: 'armL', elbow_L: 'armL', wrist_L: 'armL', shoulder_R: 'armR', elbow_R: 'armR', wrist_R: 'armR',
  head: 'head', neck: 'head', face: 'head', antenna: 'head', ear_L: 'head', ear_R: 'head', windows: 'head' }
// the camera, framed on the robot's head the way the rig's own director frames it (distance, height, aim, lens)
const SHOT: Record<Shot, { d: number; y: number; look: number[]; zoom: number }> = {
  wide: { d: 62, y: -1.5, look: [6, -7, -1], zoom: 52 }, med: { d: 44, y: -1.5, look: [0, -4, -1], zoom: 45 }, close: { d: 34, y: -0.7, look: [0, -1.1, -1.5], zoom: 34 } }
const shotOf = (zoom: number): Shot => zoom >= 49 ? 'wide' : zoom >= 40 ? 'med' : 'close'

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const ease = (k: number) => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2
// the stage's own track reader, so a pose here is read exactly as the stage reads it
function track(tr: Track | undefined, t: number): any {
  if (!tr || !tr.length) return undefined
  if (t <= tr[0][0]) return tr[0][1]
  for (let i = 1; i < tr.length; i++) if (t <= tr[i][0]) {
    const [t0, v0] = tr[i - 1] as [number, any], [t1, v1] = tr[i] as [number, any], e = tr[i][2] ?? 'io'
    const k0 = (t - t0) / Math.max(1e-6, t1 - t0), k = e === 'io' ? ease(k0) : e === 'out' ? 1 - (1 - k0) * (1 - k0) : e === 'in' ? k0 * k0 : k0
    return Array.isArray(v0) ? v0.map((x: number, j: number) => x + (v1[j] - x) * k) : v0 + (v1 - v0) * k
  }
  return tr[tr.length - 1][1]
}
// what the scene had before any keys (the action library's own motion), as a pose at time t
function basePose(anim: any, t: number): Pose {
  return { armL: (track(anim.armL, t) ?? [0, 8, -10]).map(Math.round), armR: (track(anim.armR, t) ?? [0, 8, -10]).map(Math.round),
    chest: [track(anim.lean, t) ?? 0, track(anim.twist, t) ?? 0, track(anim.roll, t) ?? 0].map(Math.round),
    head: [track(anim.headPitch, t) ?? 0, track(anim.headYaw, t) ?? 0, track(anim.headRoll, t) ?? 0].map(Math.round) }
}
function poseAt(keys: Key[], t: number): Pose | null {
  if (!keys.length) return null
  const K = [...keys].sort((a, b) => a.t - b.t)
  if (t <= K[0].t) return K[0].pose
  if (t >= K[K.length - 1].t) return K[K.length - 1].pose
  const i = K.findIndex(k => k.t >= t), a = K[i - 1], b = K[i], e = ease((t - a.t) / (b.t - a.t))
  const mix = (p: number[], q: number[]) => p.map((v, j) => v + (q[j] - v) * e)
  return { armL: mix(a.pose.armL, b.pose.armL), armR: mix(a.pose.armR, b.pose.armR), chest: mix(a.pose.chest, b.pose.chest), head: mix(a.pose.head, b.pose.head) }
}
// a robot's keys as the stage's tracks (every key holds the whole pose, eased in and out)
function robotTracks(keys: Key[]): Record<string, Track> {
  const K = [...keys].sort((a, b) => a.t - b.t), tr = (f: (p: Pose) => unknown) => K.map((k, i) => [k.t, f(k.pose), ...(i ? ['io'] : [])] as [number, unknown, string?])
  return { armL: tr(p => p.armL), armR: tr(p => p.armR), lean: tr(p => p.chest[0]), twist: tr(p => p.chest[1]), roll: tr(p => p.chest[2]),
    headPitch: tr(p => p.head[0]), headYaw: tr(p => p.head[1]), headRoll: tr(p => p.head[2]) }
}
function camFrame(head: number[], k: { orbit: number; zoom: number; shot: Shot }) {
  const s = SHOT[k.shot], a = k.orbit * Math.PI / 180
  return { pos: [head[0] + Math.sin(a) * s.d, head[1] + s.y, head[2] + Math.cos(a) * s.d].map(v => +v.toFixed(2)), look: [head[0] + s.look[0], head[1] + s.look[1], head[2] + s.look[2]].map(v => +v.toFixed(2)), fov: k.zoom }
}
function camTracks(keys: CamKey[], head: number[]) {
  const K = [...keys].sort((a, b) => a.t - b.t), f = K.map(k => camFrame(head, k))
  return { camera: { pos: K.map((k, i) => [k.t, f[i].pos, ...(i ? ['io'] : [])]), look: K.map((k, i) => [k.t, f[i].look, ...(i ? ['io'] : [])]), fov: K.map((k, i) => [k.t, f[i].fov, ...(i ? ['io'] : [])]) },
    focus: [[0, head], [600, head]] }
}

export function Animate({ plan, onClose, onExport, onAsk }: { plan: string; onClose: () => void; onExport: () => void; onAsk: () => void }) {
  const [m, setM] = useState<Manifest | null>(null)
  const [err, setErr] = useState('')
  const [k, setK] = useState(0)                            // the scene being animated
  const [all, setAll] = useState<Record<string, SceneKeys>>({})
  const [who, setWho] = useState('')
  const [part, setPart] = useState<Part | null>(null)
  const [live, setLive] = useState<Partial<Pose>>({})      // edits not keyed yet
  const [cam, setCam] = useState<{ orbit: number; zoom: number } | null>(null)
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)
  const [saved, setSaved] = useState<'saved' | 'saving' | ''>('')
  const frame = useRef<HTMLIFrameElement>(null), au = useRef<HTMLAudioElement>(null)
  const base = useRef<{ anim: Record<string, any>; camera: any; focus: any; head: number[] } | null>(null)
  const sc = m?.scenes[k], sid = sc ? sc.scene.split('/').slice(-2, -1)[0] : '', dur = sc?.dur ?? 1
  const keys: SceneKeys = all[sid] ?? { robots: {}, camera: [] }
  const dir = plan.replace(/\/plan\.md$/, '')

  // the scenes (the same build the preview uses) and any keys saved before
  useEffect(() => {
    fetch('/door/api/robot/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan }) })
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setM(j) }).catch(e => setErr((e as Error).message))
    fetch(fileUrl(dir + '/anim.json', Date.now())).then(r => r.ok ? r.json() : null).then(j => j?.scenes && setAll(Object.fromEntries(Object.entries(j.scenes).map(([s, v]: [string, any]) => [s, v.keys ?? { robots: {}, camera: [] }]))), () => {})
  }, [plan]) // eslint-disable-line react-hooks/exhaustive-deps
  const phone = () => matchMedia('(pointer: coarse)').matches || innerWidth < 700
  useEffect(() => { if (sc && frame.current) { setReady(false); base.current = null; frame.current.src = `/door/rig/rig/tablestage.html?play=1&scene=../${phone() ? sc.phone : sc.scene}#t=0.00` } }, [sc?.scene]) // eslint-disable-line react-hooks/exhaustive-deps

  const stage = (): Stage | null => (frame.current?.contentWindow as any)?.STAGE ?? null
  const el = (id: string) => frame.current?.contentDocument?.getElementById(id) as HTMLElement | null
  // hold the player still at t (this screen keeps the time), with its own controls out of the way
  const hold = (time: number) => {
    const pp = el('pp'), s = el('sc') as HTMLInputElement | null, w = frame.current?.contentWindow as any
    if (!pp || !s || !w) return
    if (pp.textContent === 'pause') pp.click()
    s.value = String(Math.round(time / dur * 1000)); s.dispatchEvent(new w.Event('input'))
  }
  // write every robot's keyed tracks and the keyed camera into the live scene (what the export will get, too)
  const push = (ks: SceneKeys) => {
    const S = stage(), B = base.current
    if (!S || !B) return
    for (const c of S.SC.cast) {
      const kk = ks.robots[c.robot] ?? []
      c.anim = JSON.parse(JSON.stringify(B.anim[c.robot] ?? {}))
      if (kk.length) { Object.assign(c.anim, robotTracks(kk)); for (const x of ['handL', 'handR', 'handLFrom', 'handRFrom', 'handLUntil', 'handRUntil', 'handLPole', 'handRPole', 'flail', 'twitch']) delete c.anim[x] }
    }
    if (ks.camera.length) { const c = camTracks(ks.camera, B.head); S.SC.camera = c.camera; S.SC.focus = c.focus; delete S.SC.camShake; delete S.SC.camSway }
    else { S.SC.camera = JSON.parse(JSON.stringify(B.camera)); S.SC.focus = B.focus }
  }
  // the stage loaded: note what it had before any keys, then show the keys
  useEffect(() => {
    if (!sc) return
    const iv = window.setInterval(() => {
      const S = stage(); if (!S || !el('sc') || base.current) return
      // the player reloads itself when its scene file changes (the live stage rebuilds it on every saved key): here it
      // always sees the file it loaded, and this screen writes the changes in itself
      const fw = frame.current!.contentWindow as any, orig = fw.fetch.bind(fw), mine = new URLSearchParams(fw.location.search).get('scene'), first = orig(mine).then((r: Response) => r.text())
      fw.fetch = (u: RequestInfo, o?: RequestInit) => String(u) === mine ? first.then((x: string) => new fw.Response(x)) : orig(u, o)
      const doc = frame.current!.contentDocument!, st = doc.createElement('style')
      st.textContent = '#pp,#sc,#tm{display:none!important} body{background:#0B0A08!important} canvas{height:calc(100vh - 56px)!important} #cap{font-size:12px!important;min-height:0!important}'
      doc.head.appendChild(st)
      hold(0); (window as any).requestAnimationFrame(() => {
        const R = S.robots[0], hv = new S.THREE.Vector3(); (R.nodes.head || R.nodes.face || R.nodes.chest).getWorldPosition(hv)
        base.current = { anim: Object.fromEntries(S.SC.cast.map((c: any) => [c.robot, JSON.parse(JSON.stringify(c.anim || {}))])), camera: JSON.parse(JSON.stringify(S.SC.camera)), focus: S.SC.focus, head: [hv.x, hv.y, hv.z].map(v => +v.toFixed(2)) }
        setWho(w => w || S.SC.cast[0].robot); push(all[sid] ?? { robots: {}, camera: [] }); setReady(true); hold(t)
      })
    }, 200)
    return () => clearInterval(iv)
  }, [sc?.scene]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready) push(keys) }, [all, ready]) // eslint-disable-line react-hooks/exhaustive-deps

  // the pose on screen right now for the picked robot: keyed (or the scene's own), plus edits not keyed yet
  const shown = (): Pose | null => {
    const B = base.current; if (!B || !who) return null
    return { ...(poseAt(keys.robots[who] ?? [], t) ?? basePose(B.anim[who] ?? {}, t)), ...live }
  }
  // edits show at once: the picked robot's channels hold the edited pose at this moment
  useEffect(() => {
    const S = stage(); if (!ready || !S) return
    if (!Object.keys(live).length && !cam) { push(keys); hold(t); return }
    push(keys)
    const p = shown(); if (p) { const c = S.SC.cast.find((x: any) => x.robot === who); const tr = robotTracks([{ t: 0, pose: p }])
      Object.assign(c.anim, tr); for (const x of ['handL', 'handR', 'flail', 'twitch']) delete c.anim[x] }
    if (cam) { const B = base.current!, c = camTracks([{ t: 0, shot: shotOf(cam.zoom), ...cam }], B.head); S.SC.camera = c.camera; S.SC.focus = c.focus }
    hold(t)
  }, [live, cam]) // eslint-disable-line react-hooks/exhaustive-deps

  // time: the voice track is the clock while playing
  useEffect(() => {
    if (!playing) return
    let raf = 0; const a = au.current, t0 = performance.now() / 1000 - t
    if (a && sc) { if (!a.src.endsWith(sc.audio)) a.src = `/door/rig/${sc.audio}`; a.currentTime = t; a.play().catch(() => {}) }
    const tick = () => { const now = a && !a.paused ? a.currentTime : performance.now() / 1000 - t0
      if (now >= dur) { setPlaying(false); setT(dur); hold(dur); return }
      setT(now); hold(now); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); a?.pause() }
  }, [playing]) // eslint-disable-line react-hooks/exhaustive-deps
  const seek = (time: number) => { setPlaying(false); setLive({}); setCam(null); const near = [...(keys.robots[who] ?? []), ...keys.camera].find(x => Math.abs(x.t - time) < 0.12); const nt = near ? near.t : clamp(time, 0, dur); setT(nt); hold(nt) }

  // keys
  const save = (next: Record<string, SceneKeys>) => {
    setAll(next); setSaved('saving')
    const B = base.current, anim = { scenes: Object.fromEntries(Object.entries(next).map(([s, ks]) => [s, {
      keys: ks, cast: Object.fromEntries(Object.entries(ks.robots).filter(([, v]) => v.length).map(([r, v]) => [r, robotTracks(v)])),
      ...(ks.camera.length && B ? camTracks(ks.camera, B.head) : {}) }])) }
    fetch('/door/api/robot/anim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan, anim }) })
      .then(r => setSaved(r.ok ? 'saved' : ''), () => setSaved(''))
  }
  const put = <T extends { t: number }>(list: T[], item: T) => [...list.filter(x => Math.abs(x.t - item.t) >= 0.05), item].sort((a, b) => a.t - b.t)
  const keyPose = () => { const p = shown(); if (!p) return; const r = (v: number[]) => v.map(Math.round)
    const kk = put(keys.robots[who] ?? [], { t: +t.toFixed(2), pose: { armL: r(p.armL), armR: r(p.armR), chest: r(p.chest), head: r(p.head) } })
    setLive({}); save({ ...all, [sid]: { ...keys, robots: { ...keys.robots, [who]: kk } } }) }
  const holdPose = () => { const K = [...(keys.robots[who] ?? [])].sort((a, b) => a.t - b.t), prev = K.filter(x => x.t <= t + 0.01).pop(); if (!prev) return
    const nt = +Math.min(dur, t + 0.8).toFixed(2); save({ ...all, [sid]: { ...keys, robots: { ...keys.robots, [who]: put(K, { t: nt, pose: prev.pose }) } } }); setT(nt); hold(nt) }
  const delKey = () => { save({ ...all, [sid]: { robots: { ...keys.robots, [who]: (keys.robots[who] ?? []).filter(x => Math.abs(x.t - t) >= 0.08) }, camera: keys.camera.filter(x => Math.abs(x.t - t) >= 0.08) } }); setLive({}) }
  const camNow = (): { orbit: number; zoom: number } => cam ?? (() => { const K = [...keys.camera].sort((a, b) => a.t - b.t); if (!K.length) return { orbit: 0, zoom: 45 }
    const p = K.filter(x => x.t <= t).pop() ?? K[0], q = K.find(x => x.t > t) ?? p, e = p === q ? 0 : ease((t - p.t) / (q.t - p.t)); return { orbit: p.orbit + (q.orbit - p.orbit) * e, zoom: p.zoom + (q.zoom - p.zoom) * e } })()
  const keyCam = () => { const c = camNow(); save({ ...all, [sid]: { ...keys, camera: put(keys.camera, { t: +t.toFixed(2), shot: shotOf(c.zoom), orbit: Math.round(c.orbit), zoom: Math.round(c.zoom) }) } }); setCam(null) }

  // tap a part on the robot to pick it, drag to bend it
  const drag = useRef<{ x: number; y: number; base: Pose; part: Part } | null>(null), orbitDrag = useRef<{ x: number; o: number } | null>(null)
  const pick = (e: React.PointerEvent) => {
    const S = stage(), f = frame.current; if (!S || !f) return null
    const cv = f.contentDocument!.querySelector('canvas')!, fr = f.getBoundingClientRect(), r = cv.getBoundingClientRect()
    const x = ((e.clientX - fr.left - r.left) / r.width) * 2 - 1, y = -((e.clientY - fr.top - r.top) / r.height) * 2 + 1
    if (Math.abs(x) > 1 || Math.abs(y) > 1) return null
    // a finger is wide: the nearest joint within reach wins (arms are thin), then the exact hit
    const px = (e.clientX - fr.left - r.left), py = (e.clientY - fr.top - r.top), JOINTS: [string, Part][] = [['wrist_L', 'armL'], ['elbow_L', 'armL'], ['wrist_R', 'armR'], ['elbow_R', 'armR'], ['head', 'head'], ['face', 'head'], ['chest', 'chest']]
    let best: { robot: string; part: Part; d: number } | null = null
    for (const R of S.robots) for (const [b, p] of JOINTS) {
      const n = R.nodes[b]; if (!n) continue
      const v = new S.THREE.Vector3(); (b === 'chest' || b === 'head' ? (n.children.find((c: any) => c.isMesh) ?? n) : n).getWorldPosition(v); v.project(S.cam)
      const d = Math.hypot((v.x + 1) / 2 * r.width - px, (1 - v.y) / 2 * r.height - py)
      if (d < 44 && (!best || d < best.d)) best = { robot: R.spec.robot, part: p, d }
    }
    if (best) return { robot: best.robot, part: best.part }
    const ray = new S.THREE.Raycaster(); ray.setFromCamera(new S.THREE.Vector2(x, y), S.cam)
    for (const R of S.robots) {
      const hit = ray.intersectObject(R.group, true)[0]; if (!hit) continue
      const names = new Map(Object.entries(R.nodes).map(([n, o]) => [o, n])); let o = hit.object
      while (o && !names.has(o)) o = o.parent
      return { robot: R.spec.robot as string, part: (BONE[names.get(o) as string] ?? 'chest') as Part }
    }
    return null
  }
  const down = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId); setPlaying(false)
    const h = pick(e)
    if (h) { if (h.robot !== who) { setWho(h.robot); setLive({}) }
      setPart(h.part); const p = h.robot === who ? shown() : { ...(poseAt(keys.robots[h.robot] ?? [], t) ?? basePose(base.current!.anim[h.robot] ?? {}, t)) }
      if (p) drag.current = { x: e.clientX, y: e.clientY, base: p, part: h.part } }
    else orbitDrag.current = { x: e.clientX, o: camNow().orbit }
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (d) { const v = [...d.base[d.part]], dx = e.clientX - d.x, dy = e.clientY - d.y, L = PARTS[d.part].dials
      if (d.part === 'armL' || d.part === 'armR') { v[0] = clamp(d.base[d.part][0] - dy * 0.8, L[0][1], L[0][2]); v[1] = clamp(d.base[d.part][1] + (d.part === 'armL' ? dx : -dx) * 0.6, L[1][1], L[1][2]) }
      else { v[0] = clamp(d.base[d.part][0] + dy * 0.4, L[0][1], L[0][2]); v[1] = clamp(d.base[d.part][1] + dx * 0.5, L[1][1], L[1][2]) }
      setLive(l => ({ ...l, [d.part]: v.map(Math.round) })) }
    else if (orbitDrag.current) setCam({ zoom: camNow().zoom, orbit: clamp(orbitDrag.current.o + (e.clientX - orbitDrag.current.x) * 0.3, -35, 35) })
  }
  const up = () => { drag.current = null; orbitDrag.current = null }
  const dial = (i: number, v: number) => { if (!part) return; const p = shown(); if (!p) return; const nv = [...p[part]]; nv[i] = v; setLive(l => ({ ...l, [part]: nv })) }

  const pose = shown(), c = camNow(), lines = (stage()?.SC?.captions?.lines ?? []) as { at: number; end: number; who: string; text: string }[]
  const pct = (x: number) => `${(x / dur) * 100}%`
  const lane = (list: { t: number }[]) => <>{Array.from({ length: Math.floor(dur) + 1 }, (_, s) => <span key={'s' + s} className="tick" style={{ left: pct(s) }} />)}
    {list.map(x => <span key={x.t} className={'key' + (Math.abs(x.t - t) < 0.05 ? ' cur' : '')} style={{ left: pct(x.t) }} />)}<span className="ph" style={{ left: pct(t) }} /></>
  const laneDown = (e: React.PointerEvent<HTMLDivElement>) => { const r = e.currentTarget.getBoundingClientRect(), go = (x: number) => seek((x - r.left) / r.width * dur)
    go(e.clientX); const mv = (ev: PointerEvent) => go(ev.clientX), u = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', u) }
    addEventListener('pointermove', mv); addEventListener('pointerup', u) }
  const cast = (stage()?.SC?.cast ?? []).map((x: any) => x.robot as string)

  return (
    <section className="an" role="dialog" aria-label="Animate">
      <audio ref={au} preload="auto" />
      <header className="an-nav"><button className="calm-quiet" onClick={onClose}>← Back</button><b>Animate</b><span>{saved === 'saving' ? 'SAVING' : saved === 'saved' ? 'SAVED' : 'YOU POSE'}</span></header>
      {err ? <p className="vp-err">{err}</p> : <>
        {(m?.scenes.length ?? 0) > 1 && <div className="an-chips">{m!.scenes.map((s, i) => <button key={s.n} className={i === k ? 'on' : ''} onClick={() => { setK(i); setT(0); setLive({}); setCam(null); setPart(null) }}>S{s.n} {s.host}</button>)}</div>}
        <div className="an-cast">{cast.map((r: string) => <button key={r} className={r === who ? 'on' : ''} onClick={() => { setWho(r); setLive({}); setPart(null) }}>{r}</button>)}</div>
        <div className="an-stage">
          <iframe ref={frame} title="Your stage" />
          <div className="an-touch" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
          {!ready && <span className="vp-wait">{m ? 'Setting up your stage…' : 'Building the scene…'}</span>}
          <span className="an-sel">{part ? `${who} · ${PARTS[part].name}` : 'tap a part'}</span>
          <span className="an-camtag">CAMERA · {shotOf(c.zoom).toUpperCase()}</span>
          <span className="an-hint">tap a part · drag to bend · drag empty space to orbit</span>
        </div>
        <div className="an-track">
          <div className="an-row"><button className="an-play" onClick={() => setPlaying(p => !p)} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
            <span className="an-time">{t.toFixed(2)} s</span>
            <div className="an-btns"><button className="k" onClick={keyPose} disabled={!ready}>◆ Key pose</button><button onClick={holdPose}>Hold</button><button onClick={delKey}>Delete key</button></div></div>
          {cast.map((r: string) => <div key={r} className="an-row"><span className="an-lbl">{r.toUpperCase()}</span><div className="an-lane" onPointerDown={laneDown}>{lane(keys.robots[r] ?? [])}</div></div>)}
          <div className="an-row"><span className="an-lbl">CAMERA</span><div className="an-lane" onPointerDown={laneDown}>{lane(keys.camera)}</div></div>
          <div className="an-row"><span className="an-lbl">VOICE</span><div className="an-lane voice" onPointerDown={laneDown}>
            {lines.map((l, i) => <span key={i} className={'clip' + (sc?.silent.includes(l.text) ? ' silent' : '')} style={{ left: pct(l.at), width: pct(Math.max(0.2, l.end - l.at)) }} title={l.text}>{l.text}</span>)}
            <span className="ph" style={{ left: pct(t) }} /></div></div>
        </div>
        <div className="an-panel">
          <span className="an-lbl2"><span>{part ? PARTS[part].name.toUpperCase() : 'JOINT'}</span><em>{part ? 'limits from your rig' : 'pick a part on the robot'}</em></span>
          {(part ? PARTS[part].dials : PARTS.armL.dials).map(([label, lo, hi], i) => (
            <label key={label} className="an-sl"><span>{part ? label : '—'}</span><input type="range" min={lo} max={hi} step={1} disabled={!part || !pose} value={part && pose ? pose[part][i] : 0} onChange={e => dial(i, +e.target.value)} /><output>{part && pose ? Math.round(pose[part][i]) : 0}°</output></label>))}
        </div>
        <div className="an-panel">
          <span className="an-lbl2"><span>CAMERA</span><em>keys on the camera lane</em></span>
          <div className="an-chips">{(['wide', 'med', 'close'] as Shot[]).map(s => <button key={s} className={shotOf(c.zoom) === s ? 'on' : ''} onClick={() => setCam({ orbit: c.orbit, zoom: SHOT[s].zoom })}>{s}</button>)}</div>
          <label className="an-sl"><span>Orbit</span><input type="range" min={-35} max={35} step={1} value={Math.round(c.orbit)} onChange={e => setCam({ zoom: c.zoom, orbit: +e.target.value })} /><output>{Math.round(c.orbit)}°</output></label>
          <label className="an-sl"><span>Zoom</span><input type="range" min={20} max={62} step={1} value={Math.round(c.zoom)} onChange={e => setCam({ orbit: c.orbit, zoom: +e.target.value })} /><output>{Math.round(c.zoom)}</output></label>
          <div className="an-btns"><button className="k" onClick={keyCam} disabled={!ready}>◆ Key camera</button></div>
        </div>
        <div className="an-foot"><button onClick={onAsk}>Ask the dog</button><button className="go" onClick={onExport} disabled={saved === 'saving'}>Looks right, export</button></div>
        <p className="an-note">Your rig's own joints and limits on your painted set. What you key here is exactly what exports.</p>
      </>}
    </section>
  )
}
