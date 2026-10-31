// GoddardOS · the town. Ported from GM!OS on the Odin (gm-os-android assets/ui/town.js at commit 09a4130, Carl 2026-10-25:
// "Build it GoddardOS"): the same 12x12 iso town, painted plate, buildings, road routing and PiDog sprites, as a plain module so
// the web app and a later Android launcher share it. Data comes from outside (setDogs); this file only draws and moves.
// Every place is a real part of Goddard: Workshop = Claude working, Library = reading and research, Studio = images and video,
// Think Tower = plans, Post Office = report-backs, Your door = waiting on you, Kennel = naps. Names stay plain until Carl names them.

import { mountArtGL } from './artgl'

const NS = 'http://www.w3.org/2000/svg'
const N = 12, TW = 60, TH = 30, OX = 450, OY = 70
const el = (t: string, a: Record<string, string | number>) => {
  const e = document.createElementNS(NS, t)
  for (const k in a) e.setAttribute(k, String(a[k]))
  return e
}
// the view turns all the way round the middle of the town (Carl, 2026-10-27: "rotate the map to be 360"); ROT is in radians
const C = (N - 1) / 2
let ROT = 0
// top-down (Carl, 2026-10-27: "i need a top down view as well"): straight down, TOP_S map units per tile, centred where
// the angled town is centred; turning there is just spinning the one painting, so it turns smoothly all the way round
let TOP = false
const TOP_S = 36, TCX = 450, TCY = 235
const iso = (i: number, j: number): [number, number] => {
  const c = Math.cos(ROT), s = Math.sin(ROT), a = i - C, b = j - C, ri = a * c - b * s + C, rj = a * s + b * c + C
  if (TOP) return [TCX + (ri - C) * TOP_S, TCY + (rj - C) * TOP_S]
  return [OX + (ri - rj) * TW / 2, OY + (ri + rj) * TH / 2]
}

export type Place = 'bus' | 'radio' | 'think' | 'workshop' | 'library' | 'studio' | 'post' | 'kennel' | 'door'
interface Building { i: number; j: number; h: number; c: string; n: string; w?: number; door?: [number, number]; label?: SVGTextElement }

export const PLACES: Record<Place, Building> = {
  bus: { i: 3, j: 3, h: 46, c: '#8a5a3a', n: 'Bus Station' },
  radio: { i: 2, j: 9, h: 96, c: '#5a6f8f', n: 'Radio Tower', w: 0.6 },
  think: { i: 7, j: 3, h: 84, c: '#7b4d6e', n: 'Think Tower', w: 0.8 },
  workshop: { i: 10, j: 4, h: 40, c: '#a86a2c', n: 'Workshop' },
  library: { i: 9, j: 9, h: 56, c: '#4f7a6a', n: 'Library' },
  studio: { i: 3, j: 11, h: 36, c: '#9a4f45', n: 'Studio' },
  post: { i: 11, j: 7, h: 30, c: '#6e6a8a', n: 'Post Office' },
  kennel: { i: 0, j: 4, h: 22, c: '#5f5a4c', n: 'Kennel' },
  door: { i: 11, j: 11, h: 28, c: '#BD8430', n: 'Dish Rack' },
}
export const ABOUT: Record<Place, string> = {
  bus: 'Goddard, the one log', radio: 'his ears', think: 'plans', workshop: 'Claude at work', library: 'reading, research',
  studio: 'images and video', post: 'reports back to you', kennel: 'naps', door: 'finished work lands here',
}

const roads: Record<string, 1> = {}
const line = (pts: [number, number][]) => {
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1]; let i = a[0], j = a[1]; roads[i + ',' + j] = 1
    while (i !== b[0] || j !== b[1]) { if (i !== b[0]) i += Math.sign(b[0] - i); else j += Math.sign(b[1] - j); roads[i + ',' + j] = 1 }
  }
}
;([[[5, 0], [5, 11]], [[0, 6], [11, 6]], [[5, 2], [11, 2]], [[9, 2], [9, 6]], [[2, 8], [5, 8]], [[5, 10], [11, 10]], [[7, 6], [7, 4]], [[9, 6], [9, 8]], [[3, 4], [5, 4]], [[3, 10], [5, 10]], [[10, 6], [10, 5]], [[11, 6], [11, 8]], [[0, 4], [0, 6]], [[11, 10], [11, 11]]] as [number, number][][]).forEach(line)
// each place's door: the nearest road tile
for (const k in PLACES) {
  const b = PLACES[k as Place]; let best: [number, number] | undefined, bd = 1e9
  for (const key in roads) { const [i, j] = key.split(',').map(Number), d = Math.abs(i - b.i) + Math.abs(j - b.j); if (d && d < bd) { bd = d; best = [i, j] } }
  b.door = best
}
const route = (a: Place, z: Place) => routeTiles(PLACES[a].door!, PLACES[z].door!)
function routeTiles(s: [number, number], t: [number, number]): [number, number][] {   // BFS along the roads between two road tiles
  const key = (p: [number, number]) => p[0] + ',' + p[1]
  const prev: Record<string, [number, number] | null> = { [key(s)]: null }, q: [number, number][] = [s]
  while (q.length) {
    const p = q.shift()!; if (key(p) === key(t)) break
    for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n: [number, number] = [p[0] + d[0], p[1] + d[1]], k = key(n); if (roads[k] && !(k in prev)) { prev[k] = p; q.push(n) } }
  }
  const out: [number, number][] = []; let c: [number, number] | null = t
  while (c) { out.unshift(c); c = prev[key(c)] ?? null }
  return out.length ? out : [s]
}
function walker(path: [number, number][]) {   // a route of tiles -> a position at distance t (in tiles)
  const seg: number[] = []; let L = 0
  for (let k = 0; k < path.length - 1; k++) { const l = Math.hypot(path[k + 1][0] - path[k][0], path[k + 1][1] - path[k][1]); seg.push(l); L += l }
  return {
    L, at(t: number): [number, number] {
      t = Math.max(0, Math.min(L, t))
      for (let k = 0; k < seg.length; k++) {
        if (t <= seg[k]) { const f = seg[k] ? t / seg[k] : 0, A = path[k], Bp = path[k + 1]; return iso(A[0] + (Bp[0] - A[0]) * f, A[1] + (Bp[1] - A[1]) * f) }
        t -= seg[k]
      }
      const z = path[path.length - 1]; return iso(z[0], z[1])
    },
  }
}

// the road tile nearest a point on the map (where a dog is standing right now)
function nearestRoad(x: number, y: number): [number, number] {
  const [fi, fj] = toTile(x, y)
  let best: [number, number] = [5, 6], bd = 1e9
  for (const key in roads) { const [i, j] = key.split(',').map(Number), d = (i - fi) ** 2 + (j - fj) ** 2; if (d < bd) { bd = d; best = [i, j] } }
  return best
}

// map point -> fractional tile coordinates (inverse of iso)
function toTile(x: number, y: number): [number, number] {
  const a = (x - OX) / (TW / 2), b = (y - OY) / (TH / 2), c = Math.cos(ROT), s = Math.sin(ROT)
  const ri = TOP ? (x - TCX) / TOP_S : (a + b) / 2 - C, rj = TOP ? (y - TCY) / TOP_S : (b - a) / 2 - C
  return [ri * c + rj * s + C, -ri * s + rj * c + C]
}
// road tiles nearest a place's door, in walking order: dogs that stop at the same place each take one, on the road
function seatsNear(door: [number, number], n: number): [number, number][] {
  const key = (p: [number, number]) => p[0] + ',' + p[1], seen = new Set([key(door)]), out: [number, number][] = [door], q = [door]
  while (q.length && out.length < n) {
    const p = q.shift()!
    for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const t: [number, number] = [p[0] + d[0], p[1] + d[1]]; if (roads[key(t)] && !seen.has(key(t))) { seen.add(key(t)); out.push(t); q.push(t) } }
  }
  while (out.length < n) out.push(door)
  return out
}

// the outline around a set of points (Andrew's monotone chain), for cutting a building out of the painting
function convexHull(pts: [number, number][]): [number, number][] {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo: [number, number][] = [], hi: [number, number][] = []
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q) }
  for (const q of p.slice().reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q) }
  return lo.slice(0, -1).concat(hi.slice(0, -1))
}

// the painted town (Higgsfield plate, empty streets) under the live map, measured on the Odin
const PLATE = { k: 2.239, x: 880, y: 769, w: 2752, h: 1536 }
// painted plates by view angle, each with the map box it covers ([x, y, w, h] in map units). The turned ones were painted
// by Nano Banana Pro over the real tile map rendered at that angle and box, so they line up with the grid (2026-10-27).
const PLATES: { deg: number; file: string; box: [number, number, number, number] }[] = [
  { deg: 0, file: 'town-plate.jpg', box: [+(450 - PLATE.x / PLATE.k).toFixed(1), +(235 - PLATE.y / PLATE.k).toFixed(1), +(PLATE.w / PLATE.k).toFixed(1), +(PLATE.h / PLATE.k).toFixed(1)] },
  ...[45, 90, 135, 180, 225, 270, 315].map(deg => ({ deg, file: `town-plate-${deg}.jpg`, box: [10, -60, 880, 495] as [number, number, number, number] })),
]
// the straight-down painting, over the top-down map box; it spins with the view
const TOP_PLATE = { file: 'town-plate-top.jpg', box: [50, 10, 800, 450] as [number, number, number, number] }

// Carl's PiDog as sprites cut from character sheet v2: 4-frame trot, sit, sleep, carry; mirrored when walking left
function dogSprite(layer: SVGGElement, base: string, color: string, label: string) {
  const W = 24, H = 22.5, root = el('g', { class: 'tw-dog' }) as SVGGElement, sc = el('g', {}) as SVGGElement
  root.appendChild(el('ellipse', { cx: 0, cy: 0, rx: 10, ry: 3.2, fill: '#000', opacity: 0.4 }))
  const ring = el('ellipse', { cx: 0, cy: 0, rx: 14, ry: 5, fill: 'none', stroke: '#F2B52A', 'stroke-width': 2, opacity: 0 }); root.appendChild(ring)
  const frames = ['walk1', 'walk2', 'walk3', 'walk4', 'sit', 'sleep', 'carry']
  const imgs: Record<string, SVGElement> = {}
  frames.forEach(f => { imgs[f] = el('image', { href: `${base}dog/${f}.png`, x: -W / 2, y: -H, width: W, height: H, visibility: 'hidden' }); sc.appendChild(imgs[f]) })
  sc.appendChild(el('rect', { x: -4, y: -H - 3.5, width: 8, height: 2.6, rx: 1.2, fill: color, stroke: '#070707', 'stroke-width': 0.5 }))
  root.appendChild(sc)
  const tag = el('g', {}); tag.appendChild(el('circle', { cx: 11, cy: -H + 2, r: 4.6, fill: color, stroke: '#070707', 'stroke-width': 0.8 }))
  const tt = el('text', { x: 11, y: -H + 4.6, 'text-anchor': 'middle', 'font-family': 'Geist Mono, monospace', 'font-size': 6.5, 'font-weight': 700, fill: '#070707' }); tt.textContent = label
  tag.appendChild(tt); root.appendChild(tag)
  const zz = el('text', { x: 6, y: -H - 4, 'font-family': 'Geist Mono, monospace', 'font-size': 7, fill: '#F1EEE7', opacity: 0 }); zz.textContent = 'z z'; root.appendChild(zz)
  layer.appendChild(root)
  let face = 1, lastX: number | null = null, lastY = 0, moving = 0, dist = 0, frame = '', rest: 'sit' | 'sleep' | 'carry' = 'sit'
  const show = (f: string) => { if (f !== frame) { if (imgs[frame]) imgs[frame].setAttribute('visibility', 'hidden'); frame = f; imgs[f].setAttribute('visibility', 'visible') } }
  return {
    g: root,
    sel(on: boolean) { ring.setAttribute('opacity', on ? '1' : '0') },
    rest(m: 'sit' | 'sleep' | 'carry') { rest = m; zz.setAttribute('opacity', m === 'sleep' ? '0.9' : '0') },
    reset() { lastX = null },
    at(x: number, y: number, dt: number) {
      if (lastX !== null) {
        const dx = x - lastX, dy = y - lastY, d = Math.hypot(dx, dy)
        if (d > 0.01) { if (Math.abs(dx) > 0.05) face = dx > 0 ? 1 : -1; dist += d; moving = Math.min(1, moving + dt * 6) } else moving = Math.max(0, moving - dt * 4)
      }
      lastX = x; lastY = y
      show(moving > 0.3 ? `walk${1 + (Math.floor(dist / 4.5) % 4)}` : rest)
      root.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)})`)
      sc.setAttribute('transform', `scale(${face},1)`)
    },
    get moving() { return moving > 0.02 },
  }
}

export interface TownDog {
  key: string
  label: string       // the number on its tag
  color: string
  title: string
  step: string
  // where its work takes it, in order; a busy dog trots between them, an idle one sits at the last
  places: Place[]
  busy: boolean
  napping?: boolean
  visitor?: boolean  // another Claude Code session on the Mac: shown, never steered
}

export interface TownOpts {
  assets?: string // where town-plate.jpg and dog/ live
  art?: HTMLCanvasElement // a canvas under the map: the paintings drawn at any angle (artgl.ts); without it, plates swap
  onPickDog?: (key: string | null) => void
  onTapPlace?: (p: Place) => void
}

type Live = TownDog & {
  leg: number; t: number; w: ReturnType<typeof walker> | null; g: ReturnType<typeof dogSprite> | null; x: number; y: number
  want: string          // the places it was last sent to; only a real change re-routes it
  approach: boolean     // walking from where it stood to its new first place
  seat: [number, number] // the road tile it stops on at its last place, so dogs sharing a place don't stack
  path: [number, number][] // the tiles it is walking right now; the drawn route starts with exactly these
  arrived: boolean      // an idle dog that reached its seat stays put
  toSeat?: boolean      // this approach ends on its seat (a seat change), not at a door
}

export function mountTown(svg: SVGSVGElement, opts: TownOpts = {}) {
  const base = opts.assets ?? '/town/'
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  svg.innerHTML = ''
  ROT = 0
  // the painted plate only fits the straight-on view; turned, the real tile map and buildings show instead
  const plate = el('image', { preserveAspectRatio: 'none' })
  svg.appendChild(plate)
  let plateShown = -1
  let art: ReturnType<typeof mountArtGL> = null
  const artOn = () => !!art && art.ready(ROT)
  const grid = el('g', {}) as SVGGElement; svg.appendChild(grid)
  const under = el('g', {}) as SVGGElement; svg.appendChild(under)
  const routeLayer = el('g', {}) as SVGGElement; under.appendChild(routeLayer)
  const ring = el('ellipse', { fill: 'rgba(242,181,42,.12)', stroke: '#F2B52A', 'stroke-width': 2.5, opacity: 0 }); under.appendChild(ring)
  const defs = el('defs', {}) as SVGDefsElement; svg.appendChild(defs)
  const bld = el('g', {}) as SVGGElement; svg.appendChild(bld)   // buildings and dogs together, drawn back to front
  const labels = el('g', {}) as SVGGElement   // building names, always on top (added after the scene)
  const topClip = el('rect', { rx: 6 })
  let occ: Record<number, { g: number; file: string; x: number; y: number; w: number; h: number }[]> | null = null
  fetch(base + 'occ/index.json').then(r => (r.ok ? r.json() : null)).then(j => { if (j && alive) { occ = j; drawStatic() } }).catch(() => {})
  const poly = (pts: [number, number][]) => pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')
  function drawStatic() {
    const pi = TOP ? -2 : PLATES.findIndex(p => Math.abs(Math.atan2(Math.sin(ROT - p.deg * Math.PI / 180), Math.cos(ROT - p.deg * Math.PI / 180))) < 0.02)
    const straight = pi >= 0 || TOP
    if (pi !== plateShown && straight) { const p = TOP ? TOP_PLATE : PLATES[pi]; plate.setAttribute('href', base + p.file); plate.setAttribute('x', String(p.box[0])); plate.setAttribute('y', String(p.box[1])); plate.setAttribute('width', String(p.box[2])); plate.setAttribute('height', String(p.box[3])) }
    if (TOP) {
      plate.setAttribute('transform', `rotate(${(ROT * 180 / Math.PI).toFixed(2)} ${TCX} ${TCY})`)
      // only the board itself, so spinning never shows the painting's own background as a tilted box
      // (the clip is in the image's own, unrotated space, so it is the board square plus its stone edge)
      const m = 0.7, x0 = TCX + (-.5 - m - C) * TOP_S, y0 = TCY + (-.5 - m - C) * TOP_S, w = (N + 2 * m) * TOP_S
      topClip.setAttribute('x', String(x0)); topClip.setAttribute('y', String(y0)); topClip.setAttribute('width', String(w)); topClip.setAttribute('height', String(w))
      plate.setAttribute('clip-path', 'url(#town-topclip)')
    } else { plate.removeAttribute('transform'); plate.removeAttribute('clip-path') }
    plateShown = pi
    // art only (Carl, 2026-10-27: "there should be no graphics"): the painting for this angle, plus its depth layers.
    // The tile grid and the building boxes stay in the data (walking, taps) but are never drawn.
    plate.setAttribute('opacity', straight ? '1' : '0')
    grid.setAttribute('opacity', '0')
    bld.querySelectorAll('[data-place],[data-band]').forEach(g => g.remove()); labels.innerHTML = ''
    const deg = pi >= 0 ? PLATES[pi].deg : null
    // each depth layer is the painted stuff that stands up (walls, lamps, trees) whose feet are at screen depth g;
    // it is drawn after every dog standing behind it, so the art itself hides the dog
    for (const band of (!TOP && deg !== null && occ?.[deg]) || []) {
      bld.appendChild(el('image', { 'data-band': 1, 'data-depth': String(band.g), href: base + band.file, x: band.x, y: band.y, width: band.w, height: band.h, preserveAspectRatio: 'none', 'pointer-events': 'none' }))
    }
    ;(Object.keys(PLACES) as Place[]).forEach(k => {
      const b = PLACES[k], w = (b.w || 1) * 0.45, h = TOP ? 0 : b.h
      // an invisible box for taps; depth is only for the sort
      const grp = el('g', { 'data-place': k, 'data-depth': iso(b.i, b.j)[1].toFixed(1), 'fill-opacity': 0, style: 'cursor:pointer' })
      const foot: [number, number][] = [iso(b.i - w, b.j - w), iso(b.i + w, b.j - w), iso(b.i + w, b.j + w), iso(b.i - w, b.j + w)]
      const up = (p: [number, number]): [number, number] => [p[0], p[1] - h]
      grp.appendChild(el('polygon', { points: poly(convexHull([...foot, ...foot.map(up)])), fill: '#000' }))
      bld.appendChild(grp)
      const top = iso(b.i, b.j)
      const t = el('text', { 'data-place': k, x: top[0], y: TOP ? top[1] + 3 : top[1] - h * 0.55 - TH / 2 - 8, 'text-anchor': 'middle', 'font-family': 'Geist Mono, monospace', 'font-size': 10, fill: '#F1EEE7', stroke: '#070707', 'stroke-width': 3, 'paint-order': 'stroke', style: 'cursor:pointer' }) as SVGTextElement
      t.textContent = b.n; labels.appendChild(t); b.label = t
    })
  }
  drawStatic()
  svg.appendChild(labels)
  // the paintings at any angle, on the GPU; the SVG plate then stays hidden in 3D and is only the fallback
  art = opts.art ? mountArtGL(opts.art, base, PLATES.map(p => ({ deg: p.deg, file: p.file, mesh: `occ/mesh-${p.deg}.bin` }))) : null
  // everything that turns sits in one group, so a turn can blur and slide it as one
  const view = el('g', {}) as SVGGElement; svg.insertBefore(view, plate)
  ;[plate, grid, under, bld, labels].forEach(n => view.appendChild(n))
  const mblur = el('filter', { id: 'town-mblur', x: '-15%', y: '-5%', width: '130%', height: '110%' })
  const tc = el('clipPath', { id: 'town-topclip', clipPathUnits: 'userSpaceOnUse' }); tc.appendChild(topClip); defs.appendChild(tc)
  const blurNode = el('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: '0 0' }); mblur.appendChild(blurNode); defs.appendChild(mblur)
  const dogLayer = bld

  const dogs = new Map<string, Live>()
  // a phone shows the town closer up; the Odin and desk see all of it
  const baseS = () => { const r = svg.getBoundingClientRect(); const a = r.width && r.height ? r.width / r.height : 2; return a < 0.8 ? 1.2 : a < 1.4 ? 1.15 : 1 }
  let cam = { x: 450, y: 250, s: baseS() }, tgt: { x: number; y: number; s: number } | null = null
  let picked: string | null = null, bsel: Place | null = null, raf = 0, last = 0, alive = true

  function lights() {
    const busy: Partial<Record<Place, 1>> = {}
    for (const d of dogs.values()) if (d.busy) d.places.forEach(p => { busy[p] = 1 })
    for (const d of dogs.values()) if (d.places.includes('door')) busy.door = 1
    for (const k in PLACES) PLACES[k as Place].label?.setAttribute('fill', busy[k as Place] ? '#F2B52A' : '#F1EEE7')
  }

  function camera() {
    const r = svg.getBoundingClientRect(), aspect = r.width && r.height ? r.width / r.height : 900 / 520
    // fit the view to the screen's shape: phones get a taller slice of the town, the Odin a wider one
    const vw = (aspect >= 900 / 520 ? 520 * aspect : 900) / cam.s, vh = vw / aspect
    svg.setAttribute('viewBox', `${(cam.x - vw / 2).toFixed(1)} ${(cam.y - vh / 2).toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}`)
  }

  // where this dog's walk goes from the current leg on: the tiles it walks, then the legs still to come
  function legTiles(d: Live, leg: number): [number, number][] {
    const a = d.places[leg], z = d.places[Math.min(d.places.length - 1, leg + 1)]
    const last = !d.busy && leg + 1 >= d.places.length - 1
    if (a === z) return last || !d.busy ? routeTiles(PLACES[a].door!, d.seat) : [PLACES[a].door!, PLACES[a].door!]
    return last ? routeTiles(PLACES[a].door!, d.seat) : route(a, z)
  }
  function drawRoute(d: Live | undefined) {
    routeLayer.innerHTML = ''
    if (!d) return
    const tiles: [number, number][] = [...d.path]
    for (let n = d.leg + (d.approach ? 0 : 1); n < d.places.length - 1; n++) tiles.push(...legTiles(d, n))
    if (tiles.length < 2) return
    const ps = tiles.map(q => iso(q[0], q[1])).map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')
    routeLayer.appendChild(el('polyline', { points: ps, fill: 'none', stroke: '#000', opacity: 0.4, 'stroke-width': 9, 'stroke-linejoin': 'round' }))
    routeLayer.appendChild(el('polyline', { points: ps, fill: 'none', stroke: '#BD8430', 'stroke-width': 5, 'stroke-linejoin': 'round', opacity: 0.95 }))
  }

  function step(dt: number) {
    let moving = false
    for (const d of dogs.values()) {
      if (!d.g) { d.g = dogSprite(dogLayer, base, d.color, d.label) }
      d.g.rest(d.napping ? 'sleep' : d.busy ? 'carry' : 'sit')
      d.g.sel(picked === d.key)
      if (!d.w) { d.path = d.arrived ? [d.seat, d.seat] : legTiles(d, d.leg); d.w = walker(d.path); d.t = 0; if (picked === d.key) drawRoute(d) }
      // walk the current path to its end, then the next leg: busy dogs trot back and forth, idle ones stop on their seat
      const walking = !reduce && d.w.L > 0 && d.t < d.w.L
      if (walking) {
        d.t += dt * 1.1
        if (d.t >= d.w.L) {
          d.w = null
          if (d.approach) { d.approach = false; if (d.toSeat) { d.toSeat = false; d.arrived = true } continue }
          if (d.busy && d.places.length > 1) { d.leg++; if (d.leg >= d.places.length - 1) { d.leg = 0; d.places = d.places.slice().reverse() } continue }
          if (d.leg + 1 >= d.places.length - 1) { d.arrived = true; d.leg = d.places.length - 1; continue }
          d.leg++; continue
        }
      }
      // always exactly on its path: the walk ends on its own road tile, so there's nothing to ease
      const p = d.w.at(walking ? d.t : d.w.L)
      d.g.at(p[0], p[1] + 2, dt); d.x = p[0]; d.y = p[1]
      if (walking || d.g.moving) moving = true
    }
    // back to front: a dog's depth is its feet, a building's is its footprint centre
    for (const d of dogs.values()) d.g?.g.setAttribute('data-depth', d.y.toFixed(1))
    const scene = [...bld.children] as SVGElement[], depth = (e: SVGElement) => +(e.getAttribute('data-depth') ?? 0)
    const sorted = scene.slice().sort((a, b) => depth(a) - depth(b))
    if (sorted.some((e, n) => e !== scene[n])) sorted.forEach(e => bld.appendChild(e))
    const pd = picked ? dogs.get(picked) : undefined
    if (pd) { tgt = null; const k = Math.min(1, dt * 2.5); cam.x += (pd.x - cam.x) * k; cam.y += (pd.y - 20 - cam.y) * k; cam.s += (2.1 - cam.s) * k; moving = true }
    else if (tgt) { const k = Math.min(1, dt * 1.6); cam.x += (tgt.x - cam.x) * k; cam.y += (tgt.y - cam.y) * k; cam.s += (tgt.s - cam.s) * k; if (Math.hypot(tgt.x - cam.x, tgt.y - cam.y) < 0.5 && Math.abs(tgt.s - cam.s) < 0.01) tgt = null; moving = true }
    camera()
    if (art && opts.art) {
      // resting on a painted angle (or top-down): the original painting itself, pixel for pixel.
      // between angles: the GPU turns the paintings, so the art never drops out
      const resting = TOP || plateShown >= 0
      const gpu = !resting && artOn()
      opts.art.style.visibility = gpu ? 'visible' : 'hidden'
      if (gpu) { const vb = svg.viewBox.baseVal; art.draw(ROT, [vb.x, vb.y, vb.width, vb.height]) }
      const want = resting || !gpu ? '1' : '0'
      if (plate.getAttribute('opacity') !== want) plate.setAttribute('opacity', want)
    }
    return moving
  }

  function tick(ts: number) {
    raf = 0; if (!alive) return
    const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0; last = ts
    step(dt)
    raf = requestAnimationFrame(tick)   // ~60 fps on the phone and desk; the launcher can cap it later
  }
  raf = requestAnimationFrame(tick)
  const ro = new ResizeObserver(() => { if (!picked && !bsel && !tgt) cam.s = baseS(); camera() }); ro.observe(svg)

  // after a turn, ease to the nearest 45° so a painted view (where there is one) can show
  let settling = 0
  // dir > 0 / < 0 keeps going to the next 45° that way (a nudge always lands somewhere new); 0 goes to the nearest
  function settle(dir = 0) {
    cancelAnimationFrame(settling)
    const q = ROT / (Math.PI / 4), goal = (dir > 0 ? Math.floor(q + 1e-6) + 1 : dir < 0 ? Math.ceil(q - 1e-6) - 1 : Math.round(q)) * (Math.PI / 4)
    if (Math.abs(goal - ROT) > 0.001) fadeTo(goal)
  }
  // the view only ever rests on a painted angle: a quick dip, the next painting, and back up
  // a turn is a quick sideways motion blur: the town smears and slides the way you're turning, the next painting
  // swaps in at the blurriest moment, and it slides back in sharp (Carl, 2026-10-27: "add motion blur to the rotation")
  let turning = 0
  function fadeTo(goal: number, dir = Math.sign(Math.atan2(Math.sin(goal - ROT), Math.cos(goal - ROT))) || 1) {
    cancelAnimationFrame(turning)
    const T = reduce ? 1 : 300, t0 = performance.now(); let swapped = false
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / T)
      if (!swapped && t >= 0.5) { rotateTo(goal); swapped = true }
      const k = t < 0.5 ? t * 2 : (1 - t) * 2                  // 0 -> 1 -> 0
      const e = k * k * (3 - 2 * k)                               // smoothstep
      blurNode.setAttribute('stdDeviation', `${(e * 16).toFixed(2)} ${(e * 1.5).toFixed(2)}`)
      view.setAttribute('transform', `translate(${(-dir * (t < 0.5 ? 1 : -1) * e * 26).toFixed(1)} 0)`)
      view.setAttribute('opacity', (1 - e * 0.25).toFixed(3))
      if (t < 1) turning = requestAnimationFrame(frame)
      else { view.removeAttribute('filter'); view.removeAttribute('transform'); view.setAttribute('opacity', '1') }
    }
    view.setAttribute('filter', 'url(#town-mblur)')
    turning = requestAnimationFrame(frame)
  }
  function stepTurn(dir: 1 | -1) {
    if (TOP) { spinTo(ROT + dir * Math.PI / 4); return }
    const q = Math.round(ROT / (Math.PI / 4))
    if (art) spinTo((q + dir) * Math.PI / 4); else fadeTo((q + dir) * Math.PI / 4, dir)
  }
  const smooth = () => TOP || !!art
  // top-down turns are a smooth spin of the one painting
  function spinTo(goal: number) {
    cancelAnimationFrame(turning)
    const from = ROT, t0 = performance.now(), T = reduce ? 1 : 320
    const frame = (now: number) => { const t = Math.min(1, (now - t0) / T), e = t * t * (3 - 2 * t); rotateTo(from + (goal - from) * e); if (t < 1) turning = requestAnimationFrame(frame) }
    turning = requestAnimationFrame(frame)
  }
  // flip between the angled town and top-down, with the same whip as a turn
  function setTop(on: boolean) {
    if (on === TOP) return
    cancelAnimationFrame(turning)
    const T = reduce ? 1 : 320, t0 = performance.now(); let swapped = false
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / T)
      if (!swapped && t >= 0.5) { TOP = on; if (!on) ROT = Math.round(ROT / (Math.PI / 4)) * (Math.PI / 4); rotateTo(ROT); for (const d of dogs.values()) { d.w = null; d.g?.reset() } swapped = true }
      const k = t < 0.5 ? t * 2 : (1 - t) * 2, e = k * k * (3 - 2 * k)
      blurNode.setAttribute('stdDeviation', `${(e * 3).toFixed(2)} ${(e * 14).toFixed(2)}`)
      view.setAttribute('opacity', (1 - e * 0.3).toFixed(3))
      if (t < 1) turning = requestAnimationFrame(frame)
      else { view.removeAttribute('filter'); view.setAttribute('opacity', '1') }
    }
    view.setAttribute('filter', 'url(#town-mblur)')
    turning = requestAnimationFrame(frame)
  }
  // turn the town to any angle: buildings, roads, routes and dogs all follow
  function rotateTo(r: number) {
    ROT = ((r % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    if (ROT > 2 * Math.PI - 0.02 || ROT < 0.02) ROT = 0
    drawStatic(); lights(); for (const d of dogs.values()) d.g?.reset()
    drawRoute(picked ? dogs.get(picked) : undefined); ring.setAttribute('opacity', '0')
    if (bsel) { const b = PLACES[bsel], p = iso(b.i, b.j); tgt = { x: p[0], y: p[1] - b.h * 0.3, s: cam.s } }
  }

  // drag to pan, two fingers to turn and zoom, tap a dog or a building
  const touches = new Map<number, [number, number]>()
  let twist: { a: number; d: number; r: number; s: number } | null = null
  const pair = () => { const [p, q] = [...touches.values()]; return { a: Math.atan2(q[1] - p[1], q[0] - p[0]), d: Math.hypot(q[0] - p[0], q[1] - p[1]) } }
  let p0: [number, number] | null = null, c0: [number, number] = [0, 0], dragged = false
  const down = (e: PointerEvent) => {
    touches.set(e.pointerId, [e.clientX, e.clientY])
    if (touches.size === 2 && !gest) { const g = pair(); twist = { ...g, r: ROT, s: cam.s }; p0 = null; return }
    p0 = [e.clientX, e.clientY]; c0 = [cam.x, cam.y]; dragged = false
  }
  const move = (e: PointerEvent) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, [e.clientX, e.clientY])
    if (gest) return
    if (twist && touches.size === 2) {
      const g = pair()
      const turned = Math.atan2(Math.sin(g.a - twist.a), Math.cos(g.a - twist.a))
      if (smooth()) { rotateTo(ROT + turned); twist.a = g.a }
      else if (Math.abs(turned) > Math.PI / 8) { stepTurn(turned > 0 ? 1 : -1); twist.a = g.a }
      cam.s = Math.max(0.6, Math.min(4, twist.s * g.d / Math.max(1, twist.d))); tgt = null; camera(); return
    }
    if (!p0) return
    const r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal, k = vb.width / r.width, dx = e.clientX - p0[0], dy = e.clientY - p0[1]
    if (Math.abs(dx) + Math.abs(dy) > 6) dragged = true
    if (dragged) { if (picked) { picked = null; opts.onPickDog?.(null) } tgt = null; cam.x = c0[0] - dx * k; cam.y = c0[1] - dy * k; camera() }
  }
  const up = (e: PointerEvent) => {
    touches.delete(e.pointerId)
    if (twist) { if (touches.size < 2) { endTwist(); twist = null } p0 = null; return }
    if (p0 && !dragged) {
      const t = e.target as Element
      const g = t.closest?.('.tw-dog'); if (g) { const d = [...dogs.values()].find(x => x.g?.g === g); if (d) api.pick(d.key); p0 = null; return }
      const b = t.closest?.('[data-place]') as SVGGElement | null; if (b) { api.goTo(b.dataset.place as Place); opts.onTapPlace?.(b.dataset.place as Place) }
    }
    p0 = null
  }
  // trackpad and mouse: pinch or ctrl+wheel zooms, shift+wheel turns
  let wheelTurn = 0
  const wheel = (e: WheelEvent) => {
    e.preventDefault()
    if (e.shiftKey) { wheelTurn += e.deltaY || e.deltaX; if (Math.abs(wheelTurn) > 120) { stepTurn(wheelTurn > 0 ? 1 : -1); wheelTurn = 0 } }
    else { cam.s = Math.max(0.6, Math.min(4, cam.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)))); tgt = null; camera() }
  }
  const cancel = (e: PointerEvent) => { touches.delete(e.pointerId); if (touches.size < 2 && twist) { endTwist(); twist = null } }
  // a twist of more than ~10° goes on to the next painted angle that way; a smaller one springs back
  // after a free twist in 3D, ease to the nearest painting so dogs can hide behind its walls again
  function endTwist() { if (!TOP && art) spinTo(Math.round(ROT / (Math.PI / 4)) * (Math.PI / 4)) }
  // iPhone Safari sends its own two-finger gesture events (rotation in degrees, scale); use them so the twist always works
  let gest: { r: number; s: number } | null = null
  const gStart = (e: Event) => { e.preventDefault(); touches.clear(); twist = null; p0 = null; gest = { r: 0, s: cam.s } }
  const gChange = (e: Event) => {
    e.preventDefault(); if (!gest) return
    const g = e as unknown as { rotation: number; scale: number }
    if (smooth()) { rotateTo(ROT + (g.rotation - gest.r) * Math.PI / 180); gest.r = g.rotation }
    else if (Math.abs(g.rotation - gest.r) > 22.5) { stepTurn(g.rotation > gest.r ? 1 : -1); gest.r = g.rotation }
    cam.s = Math.max(0.6, Math.min(4, gest.s * g.scale)); tgt = null; camera()
  }
  const gEnd = (e: Event) => { e.preventDefault(); gest = null; endTwist() }
  svg.addEventListener('pointerdown', down); svg.addEventListener('pointermove', move); svg.addEventListener('pointerup', up)
  svg.addEventListener('pointercancel', cancel); svg.addEventListener('wheel', wheel, { passive: false })
  svg.addEventListener('gesturestart', gStart); svg.addEventListener('gesturechange', gChange); svg.addEventListener('gestureend', gEnd)
  svg.style.touchAction = 'none'

  const api = {
    setDogs(list: TownDog[]) {
      const live = new Set(list.map(d => d.key))
      for (const n of list) {
        const want = String(n.places)
        const d = dogs.get(n.key)
        if (!d) { dogs.set(n.key, { ...n, leg: 0, t: 0, w: null, g: null, x: 0, y: 0, want, approach: false, seat: PLACES[n.places[n.places.length - 1]].door!, path: [], arrived: false }); continue }
        Object.assign(d, { title: n.title, step: n.step, busy: n.busy, napping: n.napping, color: n.color, label: n.label })
        if (want === d.want) continue   // same work as before: keep walking, don't restart
        d.want = want
        // new work: from exactly where it stands (it is always on a road), along the roads to the first new place
        d.places = n.places.slice(); d.leg = 0; d.t = 0; d.arrived = false; d.toSeat = false
        if (d.g) {
          const here = toTile(d.x, d.y), start = nearestRoad(d.x, d.y)
          const tiles = routeTiles(start, PLACES[n.places[0]].door!)
          d.path = Math.hypot(here[0] - start[0], here[1] - start[1]) > 0.02 ? [here, ...tiles] : tiles
          d.w = walker(d.path); d.approach = d.w.L > 0
          if (!d.approach) d.w = null
        } else d.w = null
      }
      for (const [k, d] of dogs) if (!live.has(k)) { d.g?.g.remove(); dogs.delete(k) }
      // seats: dogs that stop at the same place each get their own road tile next to its door
      const byPlace = new Map<Place, Live[]>()
      for (const d of dogs.values()) if (!d.busy) { const end = d.places[d.places.length - 1]; byPlace.set(end, [...(byPlace.get(end) ?? []), d]) }
      for (const [place, group] of byPlace) {
        group.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }))
        const seats = seatsNear(PLACES[place].door!, group.length)
        group.forEach((d, n) => {
          const s0 = seats[n]
          if (d.seat[0] !== s0[0] || d.seat[1] !== s0[1]) {
            d.seat = s0
            // already sitting somewhere else: walk along the road from there to the new seat
            if (d.arrived && d.g) { const here = toTile(d.x, d.y), from = nearestRoad(d.x, d.y); d.path = [here, ...routeTiles(from, s0)]; d.w = walker(d.path); d.t = 0; d.arrived = false; d.approach = true; d.toSeat = true; d.places = [d.places[d.places.length - 1]]; d.leg = 0 }
            else if (!d.approach) d.w = null
          }   // re-plan the last hop to its new seat
        })
      }
      lights(); drawRoute(picked ? dogs.get(picked) : undefined)
    },
    pick(key: string | null) {
      picked = key && dogs.has(key) ? key : null
      ring.setAttribute('opacity', '0')
      drawRoute(picked ? dogs.get(picked) : undefined)
      opts.onPickDog?.(picked)
    },
    pickNext(dir: 1 | -1) {
      const ds = [...dogs.values()].sort((a, b) => (+b.busy - +a.busy) || a.label.localeCompare(b.label, undefined, { numeric: true }))
      if (!ds.length) return
      const i = ds.findIndex(d => d.key === picked)
      api.pick(ds[(i + dir + ds.length) % ds.length].key)
    },
    goTo(k: Place) {
      bsel = k; picked = null; drawRoute(undefined); opts.onPickDog?.(null)
      const b = PLACES[k], p = iso(b.i, b.j)
      tgt = { x: p[0], y: p[1] - b.h * 0.3, s: Math.max(cam.s, 1.7) }
      ring.setAttribute('cx', String(p[0])); ring.setAttribute('cy', String(p[1] + 4)); ring.setAttribute('rx', String(34 * (b.w || 1))); ring.setAttribute('ry', String(17 * (b.w || 1))); ring.setAttribute('opacity', '1')
    },
    // the nearest building in that screen direction (D-pad walks the town)
    nextBuilding(dir: 'up' | 'down' | 'left' | 'right') {
      const from = bsel ?? 'bus', a = iso(PLACES[from].i, PLACES[from].j), v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir]
      if (!bsel) return api.goTo('bus')
      let best: Place | null = null, bs = 1e9
      for (const k in PLACES) {
        if (k === from) continue
        const p = iso(PLACES[k as Place].i, PLACES[k as Place].j), dx = p[0] - a[0], dy = p[1] - a[1], along = dx * v[0] + dy * v[1]
        if (along <= 4) continue
        const across = Math.abs(dx * v[1] - dy * v[0]), sc = along + across * 1.6
        if (sc < bs) { bs = sc; best = k as Place }
      }
      if (best) api.goTo(best)
    },
    overview() { picked = null; bsel = null; ring.setAttribute('opacity', '0'); drawRoute(undefined); tgt = { x: 450, y: 250, s: baseS() } },
    // turning and zooming the view
    get rotation() { return ROT },
    rotate(by: number) { rotateTo(ROT + by) },
    settle(dir = 0) { settle(dir) },
    step(dir: 1 | -1) { stepTurn(dir) },
    get top() { return TOP },
    setTop(on: boolean) { setTop(on) },
    resetView() { rotateTo(0); api.overview() },
    zoom(f: number) { cam.s = Math.max(0.6, Math.min(4, cam.s * f)); tgt = null; camera() },
    get building() { return bsel },
    get picked() { return picked },
    // where a dog or building sits on screen, for a card floating beside it
    screenPoint(key: string | null): [number, number] | null {
      const m = svg.getScreenCTM(); if (!m) return null
      let x: number, y: number
      if (key && dogs.has(key)) { const d = dogs.get(key)!; x = d.x + 26; y = d.y - 30 }
      else if (bsel) { const b = PLACES[bsel], p = iso(b.i, b.j); x = p[0]; y = p[1] - b.h * 0.6 - 36 }
      else return null
      const pt = svg.createSVGPoint(); pt.x = x; pt.y = y
      const sp = pt.matrixTransform(m), r = svg.getBoundingClientRect()
      return [sp.x - r.left, sp.y - r.top]
    },
    // for checks: each dog's position and the polyline it should be on
    debug() { return [...dogs.values()].map(d => ({ key: d.key, x: d.x, y: d.y, route: d.path.map(q => iso(q[0], q[1])) })) },
    // advance the town by one frame without waiting for the screen (for checks)
    stepFor(dt: number) { step(dt) },
    destroy() { alive = false; art?.destroy(); cancelAnimationFrame(raf); ro.disconnect(); svg.removeEventListener('pointerdown', down); svg.removeEventListener('pointermove', move); svg.removeEventListener('pointerup', up); svg.removeEventListener('pointercancel', cancel); svg.removeEventListener('wheel', wheel); svg.removeEventListener('gesturestart', gStart); svg.removeEventListener('gesturechange', gChange); svg.removeEventListener('gestureend', gEnd) },
  }
  camera()
  return api
}

export type Town = ReturnType<typeof mountTown>
