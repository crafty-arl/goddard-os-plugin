import type React from 'react'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import { mountTown, ABOUT, PLACES, type Place, type Town, type TownDog } from './town'

interface Props {
  dogs: TownDog[]
  chip?: string
  chipHot?: boolean
  picking?: boolean
  onPickDog?: (key: string | null) => void
  onTapPlace?: (p: Place) => void
  onLeanIn?: (key: string) => void
  preview?: (key: string) => ReactNode // the picked dog's newest work, live
}

// The town on screen, plus the card that floats beside the picked dog or the building you're on.
export const TownWorld = forwardRef<Town | null, Props>(function TownWorld({ dogs, chip, chipHot, picking, onPickDog, onTapPlace, onLeanIn, preview }, ref) {
  const svg = useRef<SVGSVGElement>(null)
  const art = useRef<HTMLCanvasElement>(null)
  const town = useRef<Town | null>(null)
  const cbs = useRef({ onPickDog, onTapPlace }); cbs.current = { onPickDog, onTapPlace }
  const [picked, setPicked] = useState<string | null>(null)
  const [, setTick] = useState(0)
  const card = useRef<HTMLDivElement>(null)

  useEffect(() => {
    town.current = mountTown(svg.current!, {
      art: art.current ?? undefined,
      onPickDog: k => { setPicked(k); cbs.current.onPickDog?.(k) },
      onTapPlace: p => { setTick(t => t + 1); cbs.current.onTapPlace?.(p) },
    })
    ;(window as unknown as { __town?: Town | null }).__town = town.current   // for the on-route check in development
    return () => town.current?.destroy()
  }, [])
  // hand out a live view of whichever town is mounted now (React may mount it twice in development)
  useImperativeHandle(ref, () => new Proxy({} as Town, { get: (_, k) => (town.current as unknown as Record<string | symbol, unknown> | null)?.[k] }), [])
  useEffect(() => { town.current?.setDogs(dogs) }, [dogs])

  // keep the floating card next to what it describes
  useEffect(() => {
    let raf = 0
    const place = () => {
      const p = town.current?.screenPoint(town.current.picked), c = card.current
      if (c) { if (p) { c.style.left = p[0] + 'px'; c.style.top = p[1] + 'px'; c.hidden = false } else c.hidden = true }
      raf = requestAnimationFrame(place)
    }
    raf = requestAnimationFrame(place)
    return () => cancelAnimationFrame(raf)
  }, [])

  const d = picked ? dogs.find(x => x.key === picked) : undefined
  const b = !d ? town.current?.building : null
  return (
    <div className={'world town' + (picking ? ' picking' : '')}>
      <canvas ref={art} className="townart" aria-hidden="true" />
      <svg ref={svg} aria-label="GoddardOS town" />
      {chip && <div className={'chip' + (chipHot ? ' hot' : '')}><i />{chip}</div>}
      <MapControls town={town} />
      <div ref={card} className="towncard" hidden>
        {d ? <>
          <b>{d.title}</b>
          <i>{d.visitor ? (d.busy ? 'visiting · working' : 'visiting · idle') : d.napping ? 'napping' : d.busy ? 'working' : d.places.includes('door') ? 'waiting on you' : 'here'}</i>
          {d.step && <span>{d.step}</span>}
          <span>→ {PLACES[d.places[d.places.length - 1]].n}</span>
          {preview?.(d.key)}
          {onLeanIn && !d.visitor && <button onClick={() => onLeanIn(d.key)}>A · lean in</button>}
        </> : b ? <>
          <b>{PLACES[b].n}</b>
          <i>{ABOUT[b]}</i>
          <span>{dogs.filter(x => x.places[x.places.length - 1] === b).length} dog(s) here</span>
        </> : null}
      </div>
    </div>
  )
})

// Turn the town (hold to keep turning), back to the straight-on view, zoom, and the map full screen.
// On a phone two fingers do the same: twist to turn, pinch to zoom.
function MapControls({ town }: { town: React.MutableRefObject<Town | null> }) {
  const spin = useRef(0)
  const [full, setFull] = useState(false)
  const [deg, setDeg] = useState(0)
  const [top, setTop] = useState(false)
  useEffect(() => { document.body.classList.toggle('mapfull', full); return () => document.body.classList.remove('mapfull') }, [full])
  useEffect(() => { const id = setInterval(() => setDeg(Math.round((town.current?.rotation ?? 0) * 180 / Math.PI)), 200); return () => clearInterval(id) }, [town])
  // a tap turns to the next painting (45°); holding keeps stepping round, one painting at a time
  const hold = (dir: 1 | -1) => () => {
    clearInterval(spin.current); town.current?.step(dir)
    spin.current = window.setInterval(() => town.current?.step(dir), 550)
  }
  const stop = () => { clearInterval(spin.current); spin.current = 0 }
  return (
    <div className="mapctl" onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}>
      <button aria-label="Turn the map left" onPointerDown={hold(-1)}>⟲</button>
      <button aria-label="Straight-on view" className="deg" onClick={() => town.current?.resetView()}>{deg ? `${deg}°` : 'N'}</button>
      <button aria-label="Turn the map right" onPointerDown={hold(1)}>⟳</button>
      <button aria-label={top ? 'Angled view' : 'Top-down view'} className={'mode' + (top ? ' on' : '')} onClick={() => { const on = !town.current?.top; town.current?.setTop(on); setTop(on) }}>{top ? '3D' : 'TOP'}</button>
      <button aria-label="Zoom in" onClick={() => town.current?.zoom(1.25)}>+</button>
      <button aria-label="Zoom out" onClick={() => town.current?.zoom(0.8)}>−</button>
      <button aria-label={full ? 'Show the panels again' : 'Make the map full screen'} className={full ? 'on' : ''} onClick={() => setFull(f => !f)}>{full ? '⤡' : '⤢'}</button>
    </div>
  )
}
