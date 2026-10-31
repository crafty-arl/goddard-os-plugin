// App state for the sample run. One job, two agents, five phases.
import { useEffect, useReducer } from 'react'
import { SAMPLE_JOB, PHASES } from '../data/sample'

export type Mode = 'tasks' | 'talk'
export type View = 'home' | 'job' | 'tasks' | 'skills' | 'task'

// a task started from a real installed skill. Not sent to an agent yet: there is no runner.
export interface Task { id: string; skill: string; group: string; brief: string; phase: number; createdAt: string }
export const TASK_PHASES = ['Brief', 'Work', 'Check', 'Back to you'] as const

export interface State {
  mode: Mode
  view: View
  phase: number // 0..4 working, 5 = done
  paused: boolean
  picking: boolean // "Go here instead": waiting for a tap on a place
  overrides: Record<number, string> // phase -> place id Carl chose instead
  toast: string | null
  dismissedNudge: boolean
  tasks: Task[]
  openTask: string | null
}

export type Action =
  | { type: 'mode'; mode: Mode }
  | { type: 'open' }
  | { type: 'back' }
  | { type: 'tick' }
  | { type: 'pause' }
  | { type: 'redo' }
  | { type: 'pick' }
  | { type: 'goHere'; place: string }
  | { type: 'approve' }
  | { type: 'restart' }
  | { type: 'toast'; text: string | null }
  | { type: 'dismissNudge' }
  | { type: 'go'; view: View }
  | { type: 'startTask'; skill: string; group: string }
  | { type: 'openTask'; id: string }
  | { type: 'brief'; id: string; text: string }
  | { type: 'removeTask'; id: string }

export const initial: State = {
  mode: 'tasks', view: 'home', phase: 2, paused: false, picking: false, overrides: {}, toast: null, dismissedNudge: false,
  tasks: loadTasks(), openTask: null,
}

const LAST = PHASES.length - 1

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'mode': return { ...s, mode: a.mode }
    case 'open': return { ...s, view: 'job' }
    case 'back':
      if (s.picking) return { ...s, picking: false }
      if (s.view === 'task' || s.view === 'job') return { ...s, view: 'tasks' }
      return { ...s, view: 'home' }
    case 'tick': return s.paused || s.picking || s.phase >= LAST ? s : { ...s, phase: s.phase + 1, dismissedNudge: false }
    case 'pause':
      if (s.phase >= LAST) return s
      return { ...s, paused: !s.paused, toast: s.paused ? 'Back to work' : 'Paused. Nothing moves until you resume.' }
    case 'redo': {
      const back = s.phase >= LAST ? LAST - 1 : s.phase
      return { ...s, phase: back, paused: false, dismissedNudge: true, toast: `Redoing ${PHASES[back]}` }
    }
    case 'pick': return s.phase > LAST ? s : { ...s, picking: true, toast: 'Tap a place on the map' }
    case 'goHere':
      // at the checkpoint, "go here" sends the writer back to work at that place
      if (s.phase === LAST) return { ...s, picking: false, phase: 2, dismissedNudge: true, overrides: { ...s.overrides, 2: a.place }, toast: 'Sent back to work. Walking over now.' }
      return { ...s, picking: false, overrides: { ...s.overrides, [s.phase]: a.place }, toast: 'Sent. Walking over now.' }
    case 'approve': return { ...s, phase: LAST + 1, toast: 'Marked done. You post it yourself.' }
    case 'restart': return { ...initial, phase: 0, view: s.view, tasks: s.tasks, toast: 'Sample run restarted' }
    case 'toast': return { ...s, toast: a.text }
    case 'dismissNudge': return { ...s, dismissedNudge: true }
    case 'go': return { ...s, mode: 'tasks', view: a.view, picking: false }
    case 'startTask': {
      const t: Task = { id: Date.now().toString(36), skill: a.skill, group: a.group, brief: '', phase: 0, createdAt: new Date().toISOString() }
      return { ...s, tasks: [t, ...s.tasks], view: 'task', openTask: t.id, toast: `New task from ${a.skill}` }
    }
    case 'openTask': return { ...s, view: 'task', openTask: a.id }
    case 'brief': return { ...s, tasks: s.tasks.map(t => (t.id === a.id ? { ...t, brief: a.text } : t)) }
    case 'removeTask': return { ...s, tasks: s.tasks.filter(t => t.id !== a.id), view: 'tasks', openTask: null, toast: 'Task removed' }
  }
}

const STEP_SECONDS = 7
const TASKS_KEY = 'goddard-os.tasks'

function loadTasks(): Task[] {
  try { return JSON.parse(localStorage.getItem(TASKS_KEY) || '[]') } catch { return [] }
}

export function useStore() {
  const [s, dispatch] = useReducer(reducer, initial)

  // the sample job moves on by itself so the whole loop can be seen
  useEffect(() => {
    if (s.paused || s.picking || s.phase >= LAST) return
    const id = setTimeout(() => dispatch({ type: 'tick' }), STEP_SECONDS * 1000)
    return () => clearTimeout(id)
  }, [s.phase, s.paused, s.picking])

  useEffect(() => {
    try { localStorage.setItem(TASKS_KEY, JSON.stringify(s.tasks)) } catch { /* private window: tasks live for this visit only */ }
  }, [s.tasks])

  useEffect(() => {
    if (!s.toast) return
    const id = setTimeout(() => dispatch({ type: 'toast', text: null }), 2600)
    return () => clearTimeout(id)
  }, [s.toast])

  // the bark: buzz the phone once when the job comes back to Carl
  useEffect(() => {
    if (s.phase === LAST) navigator.vibrate?.([80, 60, 80])
  }, [s.phase])

  return [s, dispatch] as const
}

export const needsYou = (s: State) => s.phase === LAST
export const isDone = (s: State) => s.phase > LAST

export function placeFor(s: State, phase: number) {
  return s.overrides[phase] ?? SAMPLE_JOB.steps[Math.min(phase, LAST)].place
}
