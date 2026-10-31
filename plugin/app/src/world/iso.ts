// 2.5D diamond view of the colony tile map, drawn on a canvas. Same maths as gm-iso at 45 degrees:
// a tile (x, y) has its top corner at (ox + (x - y) * z, oy + (x + y) * z / 2).
import { MAP_SIZE, PLACES, TREES, tileAt, type Place } from '../data/world'

const N = MAP_SIZE
const TILE_COLOR = { grass: '#8FA37A', grass2: '#7F9668', path: '#CFB487', water: '#7FA7B5' } as const

export interface Geo { z: number; ox: number; oy: number; width: number; height: number }

export function geo(width: number, height: number): Geo {
  const pad = 12
  // fit the diamond in the width, leave room above for the tallest block and below for the slab
  const z = Math.max(8, Math.min((width - pad * 2) / (2 * N), (height - pad * 2) / (N + 2.2)))
  const ox = width / 2
  const oy = (height - N * z) / 2 + z * 0.8
  return { z, ox, oy, width, height }
}

export const toScreen = (g: Geo, x: number, y: number): [number, number] =>
  [g.ox + (x - y) * g.z, g.oy + (x + y) * g.z / 2]

export function fromScreen(g: Geo, sx: number, sy: number): [number, number] {
  const a = (sx - g.ox) / g.z, b = (sy - g.oy) / (g.z / 2)
  return [(a + b) / 2, (b - a) / 2]
}

function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16)
  const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(v * k))))
  return `rgb(${c.join(',')})`
}

function poly(ctx: CanvasRenderingContext2D, pts: [number, number][], fill: string) {
  ctx.beginPath()
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
}

export interface Actor { id: string; at: [number, number]; color: string; label?: string; ring?: boolean; dim?: boolean; nap?: boolean }

export interface Scene {
  actors: Actor[]
  goddardAt: [number, number]
  walked?: [number, number][]
  next?: [number, number][]
  hot?: string // place id highlighted gold
  picking?: boolean
  bark?: boolean
  t: number // seconds, for idle motion
}

export interface LabelBox { id: string; x: number; y: number; w: number; h: number }

export function draw(ctx: CanvasRenderingContext2D, g: Geo, s: Scene): LabelBox[] {
  const { z, width: W, height: H } = g
  ctx.clearRect(0, 0, W, H)

  // depth layers: sky, far ridge, mid ridge (they drift a touch for parallax)
  const sky = ctx.createLinearGradient(0, 0, 0, H)
  sky.addColorStop(0, '#241D14'); sky.addColorStop(0.55, '#3A2E1E'); sky.addColorStop(1, '#4A3A24')
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H)
  const drift = Math.sin(s.t / 6) * 4
  ridge(ctx, W, H, 0.22, 0.12, '#2E2619', drift * 0.4, 1)
  ridge(ctx, W, H, 0.34, 0.08, '#3D3221', drift, 2)

  // slab edge (cardboard thickness)
  const d = z * 0.6
  const [lx, ly] = toScreen(g, 0, N), [bx, by] = toScreen(g, N, N), [rx, ry] = toScreen(g, N, 0)
  poly(ctx, [[lx, ly], [bx, by], [bx, by + d], [lx, ly + d]], '#A8875A')
  poly(ctx, [[rx, ry], [bx, by], [bx, by + d], [rx, ry + d]], '#8C6F48')

  // flat ground
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const t = tileAt(x, y)
    poly(ctx, [toScreen(g, x, y), toScreen(g, x + 1, y), toScreen(g, x + 1, y + 1), toScreen(g, x, y + 1)], TILE_COLOR[t])
  }
  if (s.picking) {
    ctx.save(); ctx.globalAlpha = 0.25 + 0.15 * Math.sin(s.t * 4)
    for (const p of PLACES) for (const [x, y] of p.cells)
      poly(ctx, [toScreen(g, x - .3, y - .3), toScreen(g, x + 1.3, y - .3), toScreen(g, x + 1.3, y + 1.3), toScreen(g, x - .3, y + 1.3)], '#F1EEE7')
    ctx.restore()
  }

  // planned and walked paths sit on the ground
  if (s.next?.length) dashed(ctx, g, s.next, '#F1EEE7', Math.max(1.5, z * .1), [2, 6])
  if (s.walked?.length) dashed(ctx, g, s.walked, '#BD8430', Math.max(2, z * .14), [6, 5])

  // blocks, trees, actors and Goddard far to near
  type Thing = { depth: number; draw: () => void }
  const things: Thing[] = []
  for (const p of PLACES) for (const [x, y] of p.cells)
    things.push({ depth: x + y + 1, draw: () => block(ctx, g, x, y, p, p.id === s.hot) })
  for (const [x, y] of TREES) things.push({ depth: x + y + 1, draw: () => tree(ctx, g, x, y) })
  for (const a of s.actors) things.push({ depth: a.at[0] + a.at[1] + 1.01, draw: () => actor(ctx, g, a, s.t) })
  things.push({ depth: s.goddardAt[0] + s.goddardAt[1] + 1.02, draw: () => goddard(ctx, g, s.goddardAt, s.bark ? s.t : null) })
  things.sort((a, b) => a.depth - b.depth).forEach(t => t.draw())

  // near layer
  ctx.fillStyle = 'rgba(28,23,15,.92)'
  ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(0, H - 22)
  ctx.quadraticCurveTo(W * .12, H - 36, W * .25, H - 20)
  ctx.quadraticCurveTo(W * .5, H - 6, W * .62, H - 26)
  ctx.quadraticCurveTo(W * .82, H - 40, W, H - 16); ctx.lineTo(W, H); ctx.fill()

  return labels(ctx, g, s.hot)
}

function ridge(ctx: CanvasRenderingContext2D, W: number, H: number, top: number, amp: number, fill: string, dx: number, seed: number) {
  ctx.beginPath(); ctx.moveTo(0, H * .8)
  for (let i = 0; i <= 8; i++) {
    const x = (i / 8) * W + dx
    const y = H * top + Math.sin(i * 1.7 + seed) * H * amp * 0.5 + Math.cos(i * .9 + seed * 2) * H * amp * .3
    ctx.lineTo(x, y)
  }
  ctx.lineTo(W, H * .8); ctx.closePath(); ctx.fillStyle = fill; ctx.fill()
}

function dashed(ctx: CanvasRenderingContext2D, g: Geo, tiles: [number, number][], color: string, w: number, dash: number[]) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.setLineDash(dash.map(v => v * g.z / 18)); ctx.beginPath()
  tiles.forEach(([x, y], i) => { const [sx, sy] = toScreen(g, x + .5, y + .5); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy) })
  ctx.stroke(); ctx.restore()
}

function block(ctx: CanvasRenderingContext2D, g: Geo, x: number, y: number, p: Place, hot: boolean) {
  const h = p.height * g.z, up = ([a, b]: [number, number]): [number, number] => [a, b - h]
  const L = toScreen(g, x, y + 1), B = toScreen(g, x + 1, y + 1), R = toScreen(g, x + 1, y), T = toScreen(g, x, y)
  poly(ctx, [L, B, up(B), up(L)], shade(p.color, .78))
  poly(ctx, [B, R, up(R), up(B)], shade(p.color, .62))
  poly(ctx, [up(T), up(R), up(B), up(L)], p.color)
  if (hot) {
    ctx.save(); ctx.strokeStyle = '#F1EEE7'; ctx.lineWidth = 2
    ctx.beginPath(); [up(T), up(R), up(B), up(L)].forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b))); ctx.closePath(); ctx.stroke(); ctx.restore()
  }
}

function tree(ctx: CanvasRenderingContext2D, g: Geo, x: number, y: number) {
  const [cx, cy] = toScreen(g, x + .5, y + .5), z = g.z
  ctx.fillStyle = '#6B4E31'; ctx.fillRect(cx - z * .1, cy - z * .5, z * .2, z * .5)
  ctx.fillStyle = '#5E7A4E'; ctx.beginPath(); ctx.arc(cx, cy - z * .55, z * .42, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.beginPath(); ctx.arc(cx - z * .12, cy - z * .68, z * .18, 0, Math.PI * 2); ctx.fill()
}

function actor(ctx: CanvasRenderingContext2D, g: Geo, a: Actor, t: number) {
  const [cx, cy] = toScreen(g, a.at[0] + .5, a.at[1] + .5), k = g.z / 18
  const bob = a.nap ? 0 : Math.sin(t * 3 + a.at[0]) * 1.2 * k
  ctx.save(); if (a.dim) ctx.globalAlpha = .55
  ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.ellipse(cx, cy, 8 * k, 3 * k, 0, 0, Math.PI * 2); ctx.fill()
  if (a.ring) { ctx.strokeStyle = '#BD8430'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(cx, cy, 15 * k, 7 * k, 0, 0, Math.PI * 2); ctx.stroke() }
  ctx.lineWidth = 1.5 * k; ctx.strokeStyle = '#070707'
  ctx.fillStyle = a.color; roundRect(ctx, cx - 5 * k, cy - 14 * k + bob, 10 * k, 12 * k, 4 * k); ctx.fill(); ctx.stroke()
  ctx.fillStyle = '#F1EEE7'; ctx.beginPath(); ctx.arc(cx, cy - 18 * k + bob, 5 * k, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  if (a.nap) {
    // sleeping: a little drifting "z z" over the head
    ctx.fillStyle = '#F1EEE7'; ctx.font = `700 ${8 * k}px "Geist Mono", monospace`; ctx.textAlign = 'center'
    const up = (t * 6) % 8
    ctx.globalAlpha = (a.dim ? .55 : 1) * (1 - up / 10); ctx.fillText('z', cx + 7 * k, cy - 26 * k - up * k)
    ctx.globalAlpha = a.dim ? .55 : 1; ctx.fillText('z', cx + 11 * k, cy - 31 * k - up * k * .5)
  }
  if (a.label) {
    ctx.fillStyle = a.color; ctx.beginPath(); ctx.arc(cx + 12 * k, cy - 6 * k, 7 * k, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#070707'; ctx.font = `700 ${9 * k}px "Geist Mono", monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(a.label, cx + 12 * k, cy - 5.5 * k)
  }
  ctx.restore()
}

// Goddard as the real PiDog head: silver box, two round sensor eyes, camera nose, LED bar mouth
function goddard(ctx: CanvasRenderingContext2D, g: Geo, at: [number, number], barkT: number | null) {
  const [cx, cy] = toScreen(g, at[0] + .5, at[1] + .5), s = g.z * 1.3
  const x = cx - s / 2, y = cy - s * .95
  if (barkT !== null) {
    ctx.save(); ctx.strokeStyle = '#F1EEE7'; ctx.lineWidth = 2; ctx.setLineDash([3, 3])
    const r = s * (.75 + .08 * Math.sin(barkT * 6)); ctx.beginPath(); ctx.ellipse(cx, y + s * .41, r, r * .85, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore()
  }
  headShape(ctx, x, y, s)
}

export function headShape(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  const h = s * .82
  const grad = ctx.createLinearGradient(0, y, 0, y + h)
  grad.addColorStop(0, '#ECEEF1'); grad.addColorStop(1, '#A3A9B1')
  ctx.fillStyle = grad; ctx.strokeStyle = '#5F656D'; ctx.lineWidth = Math.max(1, s / 40)
  roundRect(ctx, x, y, s, h, s * .18); ctx.fill(); ctx.stroke()
  const e = s * .27
  for (const ex of [x + s * .12, x + s * .61]) {
    ctx.fillStyle = '#16191E'; ctx.strokeStyle = '#7D8996'; ctx.beginPath(); ctx.arc(ex + e / 2, y + s * .14 + e / 2, e / 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#E8F1F7'; ctx.beginPath(); ctx.arc(ex + e * .66, y + s * .14 + e * .3, e * .11, 0, Math.PI * 2); ctx.fill()
  }
  ctx.fillStyle = '#070707'; ctx.beginPath(); ctx.arc(x + s / 2, y + s * .51, s * .065, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#3B6E8F'; ctx.beginPath(); ctx.arc(x + s / 2, y + s * .51, s * .028, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#16191E'; roundRect(ctx, x + s * .2, y + s * .63, s * .6, s * .1, s * .04); ctx.fill()
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i < 4 ? '#BD8430' : '#5A4220'
    ctx.fillRect(x + s * .22 + i * s * .113, y + s * .65, s * .095, s * .06)
  }
}

function labels(ctx: CanvasRenderingContext2D, g: Geo, hot?: string): LabelBox[] {
  const k = Math.min(1.5, Math.max(.8, g.z / 18)), boxes: LabelBox[] = []
  ctx.font = `600 ${9 * k}px "Geist Mono", monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  for (const p of PLACES) {
    const cx = p.cells.reduce((a, c) => a + c[0], 0) / p.cells.length + .5
    const cy = p.cells.reduce((a, c) => a + c[1], 0) / p.cells.length + .5
    const [sx, sy0] = toScreen(g, cx, cy), sy = sy0 - p.height * g.z - 14 * k
    const w = ctx.measureText(p.label).width + 14 * k, h = 17 * k
    ctx.fillStyle = p.id === hot ? '#BD8430' : '#F1EEE7'; ctx.strokeStyle = '#070707'; ctx.lineWidth = 1.5
    roundRect(ctx, sx - w / 2, sy - h / 2, w, h, h / 2); ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#070707'; ctx.fillText(p.label, sx, sy + .5)
    boxes.push({ id: p.id, x: sx - w / 2, y: sy - h / 2, w, h })
  }
  return boxes
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r)
}

// which place did a tap land on: a label first, then the place's own tiles (with a little slack)
export function hitPlace(g: Geo, boxes: LabelBox[], sx: number, sy: number): string | null {
  const b = boxes.find(b => sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h)
  if (b) return b.id
  const [tx, ty] = fromScreen(g, sx, sy)
  for (const p of PLACES) for (const [x, y] of p.cells) {
    // a raised block is drawn above its tile, so also test one tile up-screen
    const lift = p.height
    if (tx >= x - .3 - lift * .5 && tx <= x + 1.3 && ty >= y - .3 - lift * .5 && ty <= y + 1.3) return p.id
  }
  return null
}
