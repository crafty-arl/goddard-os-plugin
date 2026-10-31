// Talks to Carl's gm-chat front door (through the dev server's /door proxy) and to each thread's own socket.
import { useEffect, useRef, useState } from 'react'

export interface Thread {
  port: number; home?: boolean; name: string; server: string; folder: string
  busy: boolean; doing: string; needsYou: boolean; last: { text: string; at: number }
  plan?: { steps: string[]; now: number; done: boolean; at: number; approved?: boolean } | null // the steps the dog posted before starting
  board?: Board | null // a session's system: what was brought, the phases, and the sheet filled from Carl's words
  auto?: { until: number } // Auto is running this session on its own until then
  slot?: number // this session's own screen on the dog computer (1-3)
  sessionMode?: SessionMode // a session's mode: plan, talk or do
}
export interface Board { artifact: string; goal: string; phases: string[]; now: number; sheet: { name: string; value: string }[]; resources: string[]; done_when: string
  done?: { what: string; met: boolean }[]; done_ideas?: string[]; next?: string; finished?: { at: number; path: string; next?: string }; yours?: string[]; at: number }
export const isSession = (t: Thread) => t.name.startsWith('Session · ')
export const sessionTitle = (t: Thread) => t.name.replace(/^(Session|Agent slot) · /, '') // a dog's chat opens in the same view, under its own name
// each session keeps its own mode (Carl, 2026-10-30: "make plan mode its own mode to keep every chat different")
export type SessionMode = 'plan' | 'talk' | 'do'
export const MODES: { id: SessionMode; label: string; line: string }[] = [
  { id: 'plan', label: 'Plan it', line: 'Phases, a working sheet and a Done list. It waits for your Go.' },
  { id: 'talk', label: 'Just talk', line: 'A plain chat. No plan, no board.' },
  { id: 'do', label: 'Just do it', line: 'Straight to work, no plan to approve. Still asks before anything goes live.' },
]
export const modeLabel = (m?: SessionMode) => MODES.find(x => x.id === (m ?? 'plan'))!.label
export const startSession = (artifact: string, want: string, title: string, auto = false, mode: SessionMode = 'plan') => post('/door/api/session/start', { artifact, want, title, auto, mode }).then(j => j as { port: number; name: string })
export const setSessionMode = (port: number, mode: SessionMode) => post('/door/api/session/mode', { port, mode })
export const endSession = (port: number) => post('/door/api/session/end', { port }).then(j => j as { path?: string })
export interface SessionIdea { title: string; why: string; brought: string; want: string; from: 'carry-on' | 'unfinished' | 'upload' | 'goals'; reopen?: string }
// an unfinished session opens back up on its own board (and its own conversation when the door finds it)
export const reopenSession = (title: string) => post('/door/api/session/reopen', { title }).then(j => j as { port: number; name: string; resumed: boolean })
export const loadSessionIdeas = () => fetch('/door/api/session/ideas').then(r => r.json()).then(j => (j.ideas ?? []) as SessionIdea[])
export interface SavePoint { root: string; repo: string; commit: string; at: number }
export const loadSaves = (port: number) => fetch(`/door/api/session/saves?port=${port}`).then(r => r.json()).then(j => (j.saves ?? []) as SavePoint[])
export const undoTo = (port: number, commit: string) => post('/door/api/session/undo', { port, commit }).then(j => j as { restored: number; removed: number })
export const saveSession = (port: number) => post('/door/api/session/save', { port }).then(j => j.path as string)
// one skill + brief on one agent slot; kept by the door so Goddard OS and Home share the board
export interface Task {
  id: string; skill: string; brief: string; parent?: string; by: 'carl' | 'home'
  port: number | null; status: 'queued' | 'active' | 'done' | 'lost'; at: number; doneAt?: number; result?: string
  mode?: 'cheap' | 'creative' | 'best'; why?: string; ran?: string // the router lane, why it was picked, and what it actually ran on
}
export interface DoorList { threads: Thread[]; servers: { name: string; up: boolean }[]; folders: string[]; tasks?: Task[] }

async function post(path: string, body: unknown) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }))
  if (!j.ok) throw new Error(j.error ?? 'failed')
  return j
}
export const startTask = (skill: string, brief: string, port?: number) => post('/door/api/tasks', { skill, brief, ...(port ? { port } : {}) }).then(j => j.task as Task)
export const draftRole = (name: string, job: string) => post('/door/api/dogs/draft', { name, job }).then(j => j.role as string)
export const removeDog = (port: number) => post('/door/api/dogs/remove', { port })
export interface Recipe { id: string; title: string; skill: string; brief: string; at: number }
export const loadRecipes = () => fetch('/door/api/recipes').then(r => r.json()).then(j => (j.recipes ?? []) as Recipe[])
export const saveRecipe = (title: string, skill: string, brief: string) => post('/door/api/recipes', { title, skill, brief }).then(j => j.recipe as Recipe)
export const dropRecipe = (id: string) => post('/door/api/recipes', { remove: id })
export const finishTask = (id: string) => post('/door/api/tasks/done', { id })
// 'offline' says which part didn't answer ('mac': the Mac itself, 'door': the gm-chat door on it) and carries the
// last board it saw, so the app can keep showing it away from home when the connection drops.
export type DoorState = { kind: 'loading' } | { kind: 'locked' } | { kind: 'offline'; why: 'mac' | 'door'; last?: DoorList; seen?: number } | { kind: 'ok'; list: DoorList }

const LAST = 'goddard.lastBoard'
function remembered(): { list: DoorList; at: number } | null {
  try { return JSON.parse(localStorage.getItem(LAST) ?? 'null') } catch { return null }
}

export function useDoor(everyMs = 2500) {
  const [state, setState] = useState<DoorState>({ kind: 'loading' })
  const [tick, setTick] = useState(0)
  const last = useRef(remembered())
  useEffect(() => {
    let stop = false
    const down = (why: 'mac' | 'door') => setState({ kind: 'offline', why, last: last.current?.list, seen: last.current?.at })
    const poll = async () => {
      try {
        const r = await fetch('/door/api/list', { cache: 'no-store', signal: AbortSignal.timeout(8000) })
        if (stop) return
        if (r.status === 401) setState({ kind: 'locked' })
        else if (!r.ok) down('door')
        else {
          const list = await r.json()
          last.current = { list, at: Date.now() }
          try { localStorage.setItem(LAST, JSON.stringify(last.current)) } catch { /* private mode: just don't remember */ }
          setState({ kind: 'ok', list })
        }
      } catch { if (!stop) down('mac') }
    }
    poll()
    const id = setInterval(poll, everyMs)
    return () => { stop = true; clearInterval(id) }
  }, [everyMs, tick])
  return [state, () => setTick(t => t + 1)] as const
}

export async function newThread(what: string, server: string, folder: string, bg = false, name?: string, role?: string, job?: string) {
  const r = await fetch('/door/api/new', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ what, server, folder, bg, name, role, job }) })
  const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }))
  if (!j.ok) throw new Error(j.error ?? 'could not start')
  return j.name as string
}

export async function startHome() {
  const r = await fetch('/door/api/home', { method: 'POST' })
  const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }))
  if (!j.ok) throw new Error(j.error ?? 'could not start Home')
}

// --- one thread's live socket -------------------------------------------------

export type Wire =
  | { type: 'msg'; id: string; from: 'user' | 'assistant'; text: string; ts: number; choices?: string[] }
  | { type: 'edit'; id: string; text: string }
  | { type: 'ask'; request_id: string; tool_name: string; description: string; input_preview?: string }
  | { type: 'asked'; request_id: string; behavior: 'allow' | 'deny' }
  | { type: 'step'; id: string; text: string; ts: number }
  | { type: 'done' }
  | { type: 'busy'; on: boolean; text?: string }
  | ({ type: 'shot' } & Shot)

export interface Msg { id: string; from: 'user' | 'assistant'; text: string; ts: number; choices?: string[] }
export interface Ask { request_id: string; tool_name: string; description: string; input_preview?: string }
export interface Step { id: string; text: string; ts: number }
// a picture of the dog-box browser, sent each time a dog looks at a page
export interface Shot { id: string; src: string; url: string; title: string; ts: number }

export function useThread(port: number | null) {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [steps, setSteps] = useState<Step[]>([])
  const [asks, setAsks] = useState<Ask[]>([])
  const [shots, setShots] = useState<Shot[]>([])
  const [online, setOnline] = useState(false)
  const [busy, setBusy] = useState<{ on: boolean; text?: string }>({ on: false })
  const ws = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!port) return
    let closed = false, retry = 0
    const connect = () => {
      setMsgs([]); setSteps([]); setAsks([]); setShots([])
      // cookies ignore the port, so the gm_chat login from the door covers each thread's socket too
      const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/t/${port}/ws`)
      ws.current = sock
      sock.onopen = () => setOnline(true)
      sock.onclose = () => { setOnline(false); if (!closed) retry = window.setTimeout(connect, 2500) }
      sock.onmessage = e => {
        let m: Wire
        try { m = JSON.parse(e.data) } catch { return }
        if (m.type === 'msg') setMsgs(l => [...l, m])
        else if (m.type === 'edit') setMsgs(l => l.map(x => (x.id === m.id ? { ...x, text: m.text } : x)))
        else if (m.type === 'step') setSteps(l => [...l, m])
        else if (m.type === 'shot') setShots(l => [...l, m].slice(-20))
        else if (m.type === 'ask') setAsks(l => [...l.filter(a => a.request_id !== m.request_id), m])
        else if (m.type === 'asked') setAsks(l => l.filter(a => a.request_id !== m.request_id))
        else if (m.type === 'busy') setBusy({ on: m.on, text: m.text })
        else if (m.type === 'done') setBusy({ on: false })
      }
    }
    connect()
    return () => { closed = true; clearTimeout(retry); ws.current?.close() }
  }, [port])

  const say = (text: string) => {
    if (ws.current?.readyState !== 1) return false
    ws.current.send(JSON.stringify({ id: 'g' + Date.now().toString(36), text }))
    setMsgs(l => [...l, { id: 'local' + Date.now(), from: 'user', text, ts: Date.now() }])
    return true
  }
  const verdict = (request_id: string, behavior: 'allow' | 'deny') => {
    ws.current?.send(JSON.stringify({ type: 'verdict', request_id, behavior }))
    setAsks(l => l.filter(a => a.request_id !== request_id))
  }
  return { msgs, steps, asks, shots, online, busy, say, verdict }
}

// --- where a step happens in the colony -----------------------------------------

export function placeForStep(text: string): string {
  const t = text.toLowerCase()
  if (!t || t.startsWith('✓') || t.includes('writing back')) return 'review'
  if (/higgsfield|image|picture|video|hyperframes|render|png|jpg/.test(t)) return 'picture'
  if (/^(reading|searching|finding|opening)/.test(t)) return 'research'
  if (/^(editing|writing|running|using skill)/.test(t)) return 'writing'
  if (/plan|helper/.test(t)) return 'tangent'
  if (t.startsWith('thinking')) return 'review'
  return 'writing'
}

// what "Go here instead" asks the agent to do at each place
export const GO_HERE: Record<string, string> = {
  research: 'Go back and research this more before going on.',
  writing: 'Move on to writing it now.',
  picture: 'Switch to working on the images for this.',
  review: 'Stop here and bring me what you have so far.',
  tangent: 'Park this as a tangent: write a one-line note of where you are, then stop.',
  play: 'Take a break from this one. Stop and wait for me.',
}

export const STEER = {
  pause: 'Pause after this step and wait for me.',
  resume: 'Carry on.',
  redo: 'Redo your last step a different way.',
  approve: 'Looks good. Thanks.',
}

// one message to an agent whose screen isn't open: connect, send, close
export function sayTo(port: number, text: string): Promise<void> {
  return new Promise((ok, fail) => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/t/${port}/ws`)
    const timer = setTimeout(() => { ws.close(); fail(new Error('That dog did not answer. Try again.')) }, 5000)
    ws.onopen = () => { ws.send(JSON.stringify({ id: 'g' + Date.now().toString(36), text })); clearTimeout(timer); setTimeout(() => ws.close(), 300); ok() }
    ws.onerror = () => { clearTimeout(timer); fail(new Error("Couldn't reach that dog.")) }
  })
}

// every other Claude Code session on this Mac (from `claude agents`), read-only: they visit the Workshop
export interface OtherSession { id: string; name: string; cwd: string; kind: string; status: string; startedAt: number; steps: string[]; last: string; at: number }
export function useSessions(everyMs = 10000) {
  const [list, setList] = useState<OtherSession[]>([])
  useEffect(() => {
    let stop = false
    const load = () => fetch('/door/api/sessions', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null))
      .then(d => { if (!stop && d) setList(d.sessions ?? []) }).catch(() => {})
    load(); const id = setInterval(load, everyMs)
    return () => { stop = true; clearInterval(id) }
  }, [everyMs])
  return list
}
