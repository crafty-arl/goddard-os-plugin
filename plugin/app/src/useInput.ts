// Gamepad and keyboard as one set of buttons, so the Odin and a desk keyboard drive the same UI.
import { useEffect, useRef } from 'react'

export type Btn = 'A' | 'B' | 'X' | 'Y' | 'LB' | 'RB' | 'LT' | 'RT' | 'up' | 'down' | 'left' | 'right'

const KEYS: Record<string, Btn> = {
  Enter: 'A', ' ': 'A', Escape: 'B', Backspace: 'B', x: 'X', y: 'Y', q: 'LB', e: 'RB', f: 'LT', r: 'RT',
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
}
// standard gamepad mapping
const PAD: [number, Btn][] = [[0, 'A'], [1, 'B'], [2, 'X'], [3, 'Y'], [4, 'LB'], [5, 'RB'], [6, 'LT'], [7, 'RT'], [12, 'up'], [13, 'down'], [14, 'left'], [15, 'right']]

export function useInput(on: (b: Btn) => void) {
  const cb = useRef(on); cb.current = on
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea')) return
      const b = KEYS[e.key] ?? KEYS[e.key.toLowerCase()]
      if (!b) return
      // let a focused button handle its own Enter/Space
      if ((b === 'A') && t.tagName === 'BUTTON') return
      e.preventDefault(); cb.current(b)
    }
    addEventListener('keydown', key)
    let raf = 0
    const was = new Set<number>()
    const poll = () => {
      for (const pad of navigator.getGamepads?.() ?? []) {
        if (!pad) continue
        for (const [i, b] of PAD) {
          const down = !!pad.buttons[i]?.pressed
          if (down && !was.has(i)) cb.current(b)
          if (down) { was.add(i) } else { was.delete(i) }
        }
      }
      raf = requestAnimationFrame(poll)
    }
    raf = requestAnimationFrame(poll)
    return () => { removeEventListener('keydown', key); cancelAnimationFrame(raf) }
  }, [])
}
