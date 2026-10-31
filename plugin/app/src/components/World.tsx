import { useEffect, useRef } from 'react'
import { draw, geo, hitPlace, type Actor, type LabelBox, type Geo } from '../world/iso'

export interface WorldAgent { id: string; color: string; label: string; target: [number, number]; ring?: boolean; dim?: boolean; nap?: boolean }
export interface WorldScene {
  agents: WorldAgent[]
  goddardAt: [number, number]
  walked?: [number, number][]
  next?: [number, number][]
  hot?: string
  picking?: boolean
  bark?: boolean
}

interface Props { scene: WorldScene; onPlace?: (id: string) => void; chip?: string; chipHot?: boolean }

// Draws the colony every frame; agents glide toward their target tiles.
export function World({ scene, onPlace, chip, chipHot }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const pos = useRef<Record<string, [number, number]>>({})
  const boxes = useRef<LabelBox[]>([])
  const g = useRef<Geo | null>(null)
  const sceneRef = useRef(scene)
  sceneRef.current = scene

  useEffect(() => {
    const el = canvas.current!, box = wrap.current!
    const ctx = el.getContext('2d')!
    let raf = 0
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const resize = () => {
      const r = box.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1)
      el.width = Math.round(r.width * dpr); el.height = Math.round(r.height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.current = geo(r.width, r.height)
    }
    const ro = new ResizeObserver(resize); ro.observe(box); resize()
    const t0 = performance.now()
    const frame = (now: number) => {
      const sc = sceneRef.current, t = reduce ? 0 : (now - t0) / 1000
      const actors: Actor[] = sc.agents.map(a => {
        const cur = pos.current[a.id] ?? a.target, k = reduce ? 1 : 0.04
        const at: [number, number] = [cur[0] + (a.target[0] - cur[0]) * k, cur[1] + (a.target[1] - cur[1]) * k]
        pos.current[a.id] = at
        return { id: a.id, at, color: a.color, label: a.label, ring: a.ring, dim: a.dim, nap: a.nap }
      })
      if (g.current) boxes.current = draw(ctx, g.current, {
        actors, goddardAt: sc.goddardAt, t, hot: sc.hot, picking: sc.picking, bark: sc.bark, walked: sc.walked, next: sc.next,
      })
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [])

  const tap = (e: React.PointerEvent) => {
    if (!onPlace || !g.current) return
    const r = canvas.current!.getBoundingClientRect()
    const id = hitPlace(g.current, boxes.current, e.clientX - r.left, e.clientY - r.top)
    if (id) onPlace(id)
  }

  return (
    <div className={'world' + (scene.picking ? ' picking' : '')} ref={wrap}>
      <canvas ref={canvas} onPointerUp={tap} aria-label="The colony map" />
      {chip && <div className={'chip' + (chipHot ? ' hot' : '')}><i />{chip}</div>}
    </div>
  )
}
