// Builds the world scene for the sample run (used when the gm-chat door isn't reachable).
import { placeById } from './data/world'
import { AGENTS, SAMPLE_JOB } from './data/sample'
import { type State, placeFor, needsYou } from './state/store'
import type { WorldScene } from './components/World'

const REST2: [number, number] = [6, 2]

export function sampleScene(s: State, following: boolean, focus: string | null): WorldScene {
  const phase = Math.min(s.phase, 4)
  const active = SAMPLE_JOB.steps[phase].agent
  const stops: [number, number][] = []
  for (let p = 0; p <= phase; p++) if (SAMPLE_JOB.steps[p].agent === 1) stops.push(placeById(placeFor(s, p)).stand)
  return {
    agents: AGENTS.map(a => {
      let at: [number, number] = a.id === 2 ? REST2 : placeById(SAMPLE_JOB.steps[0].place).stand
      for (let p = 0; p <= phase; p++) if (SAMPLE_JOB.steps[p].agent === a.id) at = placeById(placeFor(s, p)).stand
      return { id: String(a.id), color: a.color, label: String(a.id), target: at, ring: following && a.id === active, dim: following && a.id !== active }
    }),
    goddardAt: [5, 4.4],
    walked: following ? stops : undefined,
    next: following && phase < 4 ? [stops[stops.length - 1], placeById('review').stand] : undefined,
    hot: focus ?? (following ? placeFor(s, phase) : undefined),
    picking: s.picking,
    bark: needsYou(s),
  }
}
