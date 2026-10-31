// Goddard OS on top of the gm-chat door: every thread is one agent in the colony, Home is Goddard.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Docked, FootContext, grow, Attach, Voice } from './dock'
import { PetHome, NAMED, NewDog, type Pet } from './PetHome'
import { CalmHome } from './CalmHome'
import { HistoryPanel } from './HistoryPanel'
import { stageOf } from './Progress'
import { placeById } from '../data/world'
import { GoddardHead } from '../components/GoddardHead'
import { TownWorld } from '../town/TownWorld'
import { PLACES as TOWN_PLACES, type Place, type Town, type TownDog } from '../town/town'
import { HintBar } from '../components/Panels'
import { SkillsPicker } from './SkillsPicker'
import { useInput } from '../useInput'
import { type DoorList, type Thread, type Task, startTask, finishTask, removeDog, sayTo, useThread, placeForStep, GO_HERE, STEER, startHome, useSessions } from './door'
import { useSlots, isSlot, openSlots, dogName, SLOT_TARGET } from './slots'
import { findOutputs, OutputStrip, OutputViewer, PlanCards, type Output } from './outputs'
import { ChatPanel, FILTERS, type ChatCtx } from './ChatPanel'
import { LibraryPanel, LivePreview, useLibrary, type LibEntry } from './LibraryPanel'
import { DogScreen, usesDogComputer } from './DogScreen'

const COLORS = ['#BD8430', '#4FA3A5', '#D98B6A', '#8FA3D9', '#B07CC6', '#9CC46B']
const PHASES = ['Brief', 'Work', 'Back to you'] as const
// the three full screens LB / RB move between; everything else is a HUD layer on the world
const PAGES = ['home', 'library', 'skills'] as const
const pageOf = (v: { kind: string }): (typeof PAGES)[number] => (v.kind === 'library' || v.kind === 'skills' ? v.kind : 'home')
// colony place (from a real step) -> the town building it happens in, and back for "Go here instead"
const STEP_TO_TOWN: Record<string, Place> = { research: 'library', writing: 'workshop', picture: 'studio', review: 'post', tangent: 'think', play: 'kennel', nap: 'kennel' }
const TOWN_TO_GO: Record<Place, string> = { library: 'research', radio: 'research', workshop: 'writing', studio: 'picture', door: 'review', post: 'review', bus: 'review', think: 'tangent', kennel: 'play' }
// a task's name for the board: its brief without the safety line Goddard puts first
const nice = (brief: string) => brief.replace(/^(DRAFT ONLY|DRAFTS? ONLY)[^.]*\.\s*/i, '').replace(/\s+/g, ' ').trim() || brief

type View = { kind: 'home' } | { kind: 'history' } | { kind: 'thread'; port: number } | { kind: 'tasks' } | { kind: 'skills' } | { kind: 'talk' } | { kind: 'chat' } | { kind: 'library' } | { kind: 'done'; id: string }

const statusOf = (t: Thread) => (t.needsYou ? 'Needs you' : t.busy ? t.doing || 'Working' : t.last.text || 'Idle')
const phaseOf = (t: Thread) => (t.needsYou || !t.busy ? 2 : 1)

export function LiveApp({ list, wide, refresh, stale }: { list: DoorList; wide: boolean; refresh: () => void; stale?: boolean }) {
  const [call, setCall] = useState('boss') // what the dogs call the owner, from their profile
  useEffect(() => { fetch('/door/api/profile').then(r => r.json()).then(j => { if (j.profile?.owner?.call) setCall(j.profile.owner.call) }, () => {}) }, [])
  const agents = list.threads.filter(t => !t.home)
  const home = list.threads.find(t => t.home)
  const [view, setView] = useState<View>({ kind: 'home' })
  const [picking, setPicking] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [pickedPort, setPickedPort] = useState<number | null>(null)
  const [viewing, setViewing] = useState<Output | null>(null)
  // on the desk the right column follows the dog you picked on the map, else whoever needs you
  const followed = view.kind === 'thread' ? agents.find(a => a.port === view.port) ?? null
    : wide ? agents.find(a => a.port === pickedPort) ?? agents.find(a => a.needsYou) ?? agents[0] ?? null : null
  const live = useThread(followed?.port ?? null)
  const lib = useLibrary(4000)
  // the newest thing a task has made (live while it works), for previews on the world, the Job card and CHAT
  const latestFor = (taskId: string | undefined): LibEntry | undefined =>
    taskId ? (lib.data?.entries ?? []).filter(e => e.task === taskId && e.type !== 'link').sort((a, b) => b.at - a.at)[0] : undefined
  const homeLive = useThread(home?.port ?? null)   // the chat with Goddard stays connected
  const [chatFilter, setChatFilter] = useState<(typeof FILTERS)[number]>('all')
  const [focusTask, setFocusTask] = useState<string | null>(null)
  const [pickerBrief, setPickerBrief] = useState('')
  const slots = useSlots()
  const tasks = list.tasks ?? []
  // the task each agent is on (or just finished): the door's board is the truth
  const taskFor = (port: number): Task | undefined =>
    [...tasks].reverse().find(t => t.port === port && (t.status === 'active' || t.status === 'done'))
  const holding = (t: Thread) => taskFor(t.port)?.status === 'active'
  const free = agents.filter(t => isSlot(t) && !t.busy && !t.needsYou && !holding(t))
  const queued = tasks.filter(t => t.status === 'queued')
  // done = Carl said Looks good and it hasn't picked up new work; it naps until the next task
  const isDoneT = (t: Thread) => taskFor(t.port)?.status === 'done' && !t.busy && !t.needsYou
  const napping = (t: Thread) => !t.busy && !t.needsYou && (isDoneT(t) || (isSlot(t) && !taskFor(t.port)))
  const phaseAt = (t: Thread) => (isDoneT(t) ? PHASES.length : phaseOf(t))
  // a slot carries its task's name only while working on it; once done it's a free slot again
  const titleOf = (t: Thread) => (taskFor(t.port)?.status === 'active' ? nice(taskFor(t.port)!.brief) : undefined) ?? (isSlot(t) ? (t.busy || t.needsYou ? 'Agent slot' : 'Free agent slot') : t.name)

  const give = async (skill: string, brief: string, port?: number) => {
    const t = await startTask(skill, brief, port)
    refresh()
    if (t.status === 'active' && t.port) { setToast(`Given to Agent ${numberOf(t.port)}`); setView({ kind: 'thread', port: t.port }) }
    else if (t.mode === 'cheap') { setToast('Sent to Hermes (Cheap, free)'); setView({ kind: 'tasks' }) }
    else { setToast('No free agent yet. Queued: it starts when one frees up.'); setView({ kind: 'tasks' }) }
  }
  const slotsUp = agents.filter(isSlot).length
  // windows opened in the last 15 minutes that haven't joined yet are still waiting for Carl's yes at the Mac
  const waiting = slots.opening && Date.now() - slots.opening.at < 15 * 60000 ? Math.max(0, slots.opening.count - Math.max(0, slotsUp - slots.opening.base)) : 0
  const missing = Math.max(0, SLOT_TARGET - slotsUp - waiting)
  const openMissing = () => {
    if (!missing) return setToast(waiting ? `${waiting} windows already waiting for your yes at the Mac` : `All ${SLOT_TARGET} slots are up`)
    const mac = list.servers.find(s => s.name === 'Mac mini')?.name ?? list.servers[0]?.name ?? 'Mac mini'
    const folder = list.folders.includes('~/gm-mind') ? '~/gm-mind' : list.folders[0]
    const n = missing
    openSlots(n, folder, mac).then(() => { slots.opened(n, slotsUp); setToast(`${n} dogs starting in the background on the Mac. Nothing to press.`); refresh() }).catch(e => setToast((e as Error).message))
  }
  // one more background dog, on Carl's press
  const [newDog, setNewDog] = useState(false)
  const addDog = (name?: string, role?: string, job?: string) => {
    const mac = list.servers.find(s => s.name === 'Mac mini')?.name ?? list.servers[0]?.name ?? 'Mac mini'
    const folder = list.folders.includes('~/gm-mind') ? '~/gm-mind' : list.folders[0]
    const n = name?.replace(/[^\p{L}\p{N} '-]/gu, '').trim().slice(0, 24) || undefined
    setToast(n ? `Waking ${n}…` : 'Adding a dog…')
    openSlots(1, folder, mac, n, role, job).then(() => { setToast(`${n ?? 'New dog'} is starting. It shows up in a few seconds.`); refresh() }).catch(e => setToast((e as Error).message))
  }

  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 2600); return () => clearTimeout(id) }, [toast])

  // the bark: buzz once when any thread starts needing Carl
  const needing = agents.filter(a => a.needsYou).map(a => a.port).join(',')
  const prev = useRef(needing)
  useEffect(() => { if (needing && needing !== prev.current) navigator.vibrate?.([80, 60, 80]); prev.current = needing }, [needing])

  // numbers and colours stay with a slot (by port), so a dog keeps its tag however the board re-sorts
  const byPort = [...agents].sort((a, b) => a.port - b.port)
  const colorOf = (port: number) => COLORS[Math.max(0, byPort.findIndex(a => a.port === port)) % COLORS.length]
  const numberOf = (port: number) => String(byPort.findIndex(a => a.port === port) + 1)

  // the town: each slot is one of Carl's PiDogs, Home is Goddard; where a dog goes comes from its real step
  const townRef = useRef<Town | null>(null)
  const others = useSessions()
  const townDogs: TownDog[] = useMemo(() => {
    const list: TownDog[] = agents.map(a => {
      const nap = napping(a)
      const here = STEP_TO_TOWN[placeForStep(a.busy ? a.doing : a.last.text)] ?? 'workshop'
      const places: Place[] = nap ? ['kennel']
        // a dog that needs Carl stays where its step is and barks there; finished work goes home to the Dish Rack
        : a.needsYou ? [here === 'door' ? 'workshop' : here]
        : a.busy ? (here === 'library' ? ['library', 'workshop'] : [here, 'library'])
        : holding(a) ? ['door'] : ['kennel']
      return { key: String(a.port), label: numberOf(a.port), color: colorOf(a.port), title: titleOf(a),
        step: a.busy ? a.doing : a.needsYou ? 'Needs you' : nap ? '' : a.last.text, places, busy: a.busy, napping: nap }
    })
    others.forEach((o, i) => list.push({ key: 'v:' + o.id, label: String.fromCharCode(97 + (i % 26)), color: '#8C8A84', title: o.name,
      step: o.steps[o.steps.length - 1] ?? '', places: o.status === 'busy' ? ['workshop', 'library'] : ['workshop'], busy: o.status === 'busy', visitor: true }))
    if (home) list.push({ key: 'home', label: 'G', color: '#BD8430', title: 'Goddard', step: home.busy ? home.doing : 'Home, listening', places: home.busy ? ['bus', 'think'] : ['bus'], busy: home.busy })
    return list
  }, [agents, home, tasks, others])
  // the thread you're on is the dog the camera rides with
  useEffect(() => { if (view.kind === 'thread') townRef.current?.pick(String(view.port)) }, [view])

  const send = (text: string, note: string) => { if (live.say(text)) setToast(note); else setToast('Thread is offline. Try again in a moment.') }
  const onTownPlace = (p: Place) => {
    if (!picking) { if (p === 'library') setView({ kind: 'library' }); return }
    setPicking(false)
    if (followed) send(GO_HERE[TOWN_TO_GO[p]], `Sent to the ${TOWN_PLACES[p].n}`)
  }
  const leanIn = (key: string) => key.startsWith('v:') ? undefined : (key === 'home' ? setView({ kind: 'talk' }) : openThread(Number(key)))
  // a dog that was restarted comes back on a new port: follow it by name, and say so when the thread is gone
  const openThread = (port: number, name?: string) => {
    const t = list.threads.find(x => x.port === port) ?? (name ? list.threads.find(x => x.name === name) : undefined)
    if (!t) return setToast('That thread has closed. What it did is in History, and its files are in the Library.')
    setView({ kind: 'thread', port: t.port })
  }

  // spatial D-pad focus over a full page's tiles (the focused tile gets the gold ring)
  const moveTile = (dir: 'up' | 'down' | 'left' | 'right') => {
    const tiles = [...document.querySelectorAll<HTMLElement>('.page [data-tile]')]
    if (!tiles.length) return
    const cur = document.activeElement as HTMLElement | null
    if (!cur || !tiles.includes(cur)) { tiles[0].focus(); tiles[0].scrollIntoView({ block: 'nearest' }); return }
    const a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2
    const v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir]
    let best: HTMLElement | null = null, bs = 1e9
    for (const t of tiles) {
      if (t === cur) continue
      const r = t.getBoundingClientRect(), dx = r.left + r.width / 2 - ax, dy = r.top + r.height / 2 - ay, along = dx * v[0] + dy * v[1]
      if (along <= 4) continue
      const sc = along + Math.abs(dx * v[1] - dy * v[0]) * 2
      if (sc < bs) { bs = sc; best = t }
    }
    if (best) { best.focus(); best.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }
  }
  const pageSwipe = useRef<{ x: number; y: number } | null>(null)

  useInput(b => {
    const town = townRef.current
    // LB / RB flip between the three screens: the world (with its CHAT HUD), the Library, Skills
    if (b === 'LB' || b === 'RB') {
      const i = Math.max(0, PAGES.indexOf(pageOf(view)))
      const next = PAGES[(i + (b === 'RB' ? 1 : -1) + PAGES.length) % PAGES.length]
      if (next === 'skills') setPickerBrief('')
      return setView({ kind: next })
    }
    if (pageOf(view) !== 'home') {
      if (b === 'up' || b === 'down' || b === 'left' || b === 'right') return moveTile(b)
      if (b === 'A') { (document.activeElement as HTMLElement | null)?.click?.(); return }
      if (b === 'B') return setView({ kind: 'home' })
    }
    if (view.kind === 'chat' && b === 'X') { const i = FILTERS.indexOf(chatFilter); return setChatFilter(FILTERS[(i + 1) % FILTERS.length]) }
    if (b === 'up' || b === 'down' || b === 'left' || b === 'right') return town?.nextBuilding(b)
    if (b === 'LT') return town?.pickNext(-1)
    if (b === 'RT') {
      if (view.kind === 'thread' && followed) { setPicking(true); setToast('Pick a place: D-pad, then A') ; return }
      return town?.pickNext(1)
    }
    if (viewing) { if (b === 'B') setViewing(null); return }
    if (b === 'B') {
      if (picking) return setPicking(false)
      if (town?.picked) return town.pick(null)
      if (view.kind !== 'home') return setView({ kind: 'home' })
      return town?.overview()
    }
    if (b === 'A') {
      if (picking && town?.building) return onTownPlace(town.building)
      if (!town?.picked && town?.building === 'library') return setView({ kind: 'library' })
      if (town?.picked) return leanIn(town.picked)
      if (!town?.building && agents[0]) return openThread((agents.find(a => a.needsYou) ?? agents[0]).port)
      return
    }
    if (!followed) return
    if (b === 'X') send(STEER.pause, 'Asked to pause')
    if (b === 'Y') send(STEER.redo, 'Asked to redo the last step')
  })

  const chip = picking ? 'TAP WHERE THE AGENT SHOULD GO'
    : followed ? (followed.needsYou ? `AGENT ${numberOf(followed.port)} NEEDS YOU` : `FOLLOWING AGENT ${numberOf(followed.port)} · ${titleOf(followed).toUpperCase().slice(0, 28)}`)
    : agents.length ? `${agents.length} OUT · ${agents.filter(a => a.needsYou).length} NEED YOU` : 'NOBODY OUT'
  const world = <TownWorld ref={townRef} dogs={townDogs} chip={chip} chipHot={picking || !!followed?.needsYou} picking={picking} onTapPlace={onTownPlace} onLeanIn={leanIn} onPickDog={k => setPickedPort(k && /^\d+$/.test(k) ? Number(k) : null)}
    preview={key => { if (key.startsWith('v:')) return <VisitorCard s={others.find(o => 'v:' + o.id === key)} />; const e = key === 'home' ? undefined : latestFor(taskFor(Number(key))?.id); return e ? <LivePreview e={e} onOpen={setViewing} /> : null }} />

  // greet by the clock, and say what's true: how many dogs are actually working
  const hr = new Date().getHours(), hello = `${hr < 5 ? 'Late one' : hr < 12 ? 'Morning' : hr < 17 ? 'Afternoon' : 'Evening'}, ${call}.`
  const busyN = agents.filter(a => a.busy).length
  const greeting = agents.some(a => a.needsYou) ? `${hello} One thing when you have a minute.` : busyN ? `${hello} ${busyN} working.` : `${hello} The pack is resting.`

  const board = (
    <section className="panel">
      <header className="panelhead">
        <span><span className="eyebrow">Tasks · live from gm-chat</span><h2>On the board</h2></span>
        <button className="pillbtn" onClick={() => setView({ kind: 'skills' })}>+ New task</button>
      </header>
      <div className="slotline">
        <span className="small"><b>{slotsUp} dog{slotsUp === 1 ? '' : 's'} up</b><span className="muted"> · {free.length} free{waiting ? ` · ${waiting} waiting for your yes` : ''}{queued.length ? ` · ${queued.length} queued` : ''}{others.length ? ` · ${others.length} other session${others.length === 1 ? '' : 's'} visiting` : ''}</span></span>
        <button className="pillbtn ghost" onClick={() => setNewDog(v => !v)}>+ Add a dog</button>
      </div>
      {newDog && <NewDog className="card" onWake={(n, r, j) => { addDog(n, r, j); setNewDog(false) }} onCancel={() => setNewDog(false)} />}
      {missing > 0 && (
        <section className="card checkpoint slotsdown">
          <header><span className="eyebrow">Needs you · at the Mac</span><span className="mono muted small">{slotsUp}/{SLOT_TARGET}</span></header>
          <p>No dogs are running. Start one in the background on the Mac; there's nothing to press there.</p>
          <div className="quick"><button className="primary grow" onClick={openMissing}>Start a dog</button></div>
        </section>
      )}
      {(() => {
        const row = (t: Thread) => (
          <button key={t.port} className={'taskrow' + (t.needsYou ? ' hot' : '') + (isDoneT(t) ? ' donerow' : '')} onClick={() => openThread(t.port)}>
            <span className="badge" style={{ background: colorOf(t.port) }}>{numberOf(t.port)}</span>
            <span className="tr-main"><b>{titleOf(t)}</b><span className="mono muted small">{active(t) ? `${taskFor(t.port)!.skill}${taskFor(t.port)!.by === 'home' ? ' · from Goddard' : ''}` : t.server}</span></span>
            <span className="tr-side">{active(t) && <Mini at={phaseAt(t)} />}<span className="small">{napping(t) ? 'Napping' : statusOf(t).slice(0, 32)}</span></span>
          </button>
        )
        const active = (t: Thread) => taskFor(t.port)?.status === 'active'
        const idle = (t: Thread) => isSlot(t) && !active(t) && !t.busy && !t.needsYou
        const jobs = [...new Set(agents.filter(active).map(t => taskFor(t.port)?.parent).filter(Boolean))] as string[]
        const groups: [string, Thread[]][] = [
          ...jobs.map(j => [`Job · ${j}`, agents.filter(t => active(t) && taskFor(t.port)?.parent === j)] as [string, Thread[]]),
          ['Working', agents.filter(t => !(active(t) && taskFor(t.port)?.parent) && !idle(t))],
          ['Napping · free', agents.filter(idle)],
        ]
        const done = tasks.filter(t => t.status === 'done').slice(-8).reverse()
        return <>
          {groups.map(([group, rows]) => rows.length > 0 && (
            <div key={group} className="taskgroup">
              <div className="sectionhead"><span className="mono">{group.toUpperCase()}</span><span className="mono muted small">{rows.length}</span></div>
              {rows.map(row)}
            </div>
          ))}
          {done.length > 0 && (
            <div className="taskgroup">
              <div className="sectionhead"><span className="mono">DONE</span><span className="mono muted small">{done.length}</span></div>
              {done.map(d => <button key={d.id} className="taskrow donerow" onClick={() => setView({ kind: 'done', id: d.id })}><span className="tr-main"><b>{nice(d.brief)}</b><span className="mono muted small">{d.skill}{d.parent ? ` · ${d.parent}` : ''}{d.by === 'home' ? ' · from Goddard' : ''}</span></span><span className="tr-side"><Mini at={PHASES.length} /><span className="small">✓ Done</span></span></button>)}
            </div>
          )}
          {queued.length > 0 && (
            <div className="taskgroup">
              <div className="sectionhead"><span className="mono">QUEUED</span><span className="mono muted small">{queued.length}</span></div>
              {queued.map(q => <div key={q.id} className="taskrow"><span className="tr-main"><b>{nice(q.brief)}</b><span className="mono muted small">{q.skill}{q.parent ? ` · ${q.parent}` : ''} · waits for a free agent</span></span></div>)}
            </div>
          )}
        </>
      })()}
      {!agents.length && <p className="muted small">No threads running. Start one from a skill.</p>}
    </section>
  )

  const [draft, setDraft] = useState('')
  // the open layer's footer slot: message bars render there (Docked), so they sit at the bottom, never in the scroll
  const [foot, setFoot] = useState<HTMLDivElement | null>(null)
  const reply = (text: string) => { if (!text.trim()) return; send(text.trim(), `Sent to Agent ${followed ? numberOf(followed.port) : ''}`); setDraft('') }
  const lastFromAgent = [...live.msgs].reverse().find(m => m.from === 'assistant')

  // the dog's name comes from its job's skill (Fetch, Scribbles, Bloodhound); plain "Agent N" otherwise
  const dogOf = (t: Thread) => DOGS[taskFor(t.port)?.skill ?? ''] ?? `Agent ${numberOf(t.port)}`
  const job = followed ? taskFor(followed.port) : undefined
  const outs = findOutputs(live.msgs.filter(m => m.from === 'assistant').map(m => m.text))
  // the next other dog that needs Carl, so "Next" always means "the next decision"
  const nextNeedy = agents.find(a => a.needsYou && a.port !== followed?.port)

  // One screen, top to bottom: who and where (header), the job, your move (last message, plan, buttons), your reply.
  // Everything else (outputs, steps, the full conversation, pause and redirect) sits under one "More" fold.
  const threadPanel = followed && (
    <section className="panel thread">
      <header className="threadbar decide">
        {!wide && <button className="backbtn" onClick={() => setView({ kind: 'chat' })} aria-label="Back to all dogs">‹ All dogs</button>}
        <span className="tb-who"><b>{dogOf(followed)}</b><span className={'mono small' + (followed.needsYou || !followed.busy ? ' gold' : ' muted')}>{dogOf(followed).startsWith('Agent') ? '' : `Agent ${numberOf(followed.port)} · `}{isDoneT(followed) ? 'done' : followed.needsYou ? 'needs you' : followed.busy ? 'working' : 'your move'}{live.online ? '' : ' · reconnecting'}</span></span>
        {nextNeedy ? <button className="backbtn" onClick={() => openThread(nextNeedy.port)} aria-label={`Next dog that needs you: Agent ${numberOf(nextNeedy.port)}`}>Next {numberOf(nextNeedy.port)} ›</button> : <span className="tb-spacer" />}
      </header>
      {live.asks.map(a => (
        <section key={a.request_id} className="card checkpoint">
          <header><span className="eyebrow">Needs you · permission</span><span className="mono muted small">{a.tool_name}</span></header>
          <p>{a.description}</p>
          {a.input_preview && <pre className="preview">{a.input_preview}</pre>}
          <div className="quick">
            <button className="primary grow" onClick={() => live.verdict(a.request_id, 'allow')}>Allow</button>
            <button className="grow" onClick={() => live.verdict(a.request_id, 'deny')}>No</button>
          </div>
        </section>
      ))}
      {(live.shots.length > 0 || usesDogComputer(live.steps)) && <DogScreen busy={followed.busy} slot={followed.slot} />}
      {live.shots.length > 0 && <SeenShots shots={live.shots} busy={followed.busy} />}
      {lastFromAgent && (() => {
        const { ask, facts, asks } = splitAsk(decode(lastFromAgent.text))
        const choices = lastFromAgent.choices ?? []
        const waiting = !followed.busy && !isDoneT(followed)
        // a report with no question: the only open call is the hand-off it names (e.g. "start gm-scribbles"), or closing it
        const handTo = !choices.length && !asks ? Object.keys(DOGS).find(k => k !== taskFor(followed.port)?.skill && decode(lastFromAgent.text).includes(k)) : undefined
        const plan = outs.find(o => o.kind === 'file' && o.type === 'md' && /plan\.md$/.test(o.path))
        const markDone = () => { send(STEER.approve, 'Done. Agent is free again.'); const t = taskFor(followed.port); if (t) finishTask(t.id).then(refresh).catch(e => setToast(e.message)) }
        return (
          <section className={'card decision' + (waiting ? ' fresh' : '')}>
            <span className="eyebrow">{isDoneT(followed) ? 'Done' : followed.busy ? `${dogOf(followed)} is working · last said` : choices.length || asks ? `${dogOf(followed)} asks` : `${dogOf(followed)} reports`}</span>
            <h2 className="ask">{ask}</h2>
            {facts && <RichText text={facts} />}
            <PlanCards outputs={outs} folded />
            {waiting && (
              <div className="decide-actions">
                {choices.length
                  ? <>
                      <button className="primary big" onClick={() => reply(choices[0])}>{choices[0]}</button>
                      {choices.length > 1 && <div className="row2">{choices.slice(1).map(c => <button key={c} onClick={() => reply(c)}>{c}</button>)}</div>}
                    </>
                  : asks
                  ? <>
                      <button className="primary big" onClick={markDone}>Looks good</button>
                      <div className="row2"><button onClick={() => send(STEER.redo, 'Asked to redo the last step')}>Redo</button></div>
                    </>
                  : handTo
                  ? <>
                      <button className="primary big" onClick={() => { give(handTo, plan && plan.kind === 'file' ? `Write for the approved plan at ${plan.path}` : nice(taskFor(followed.port)?.brief ?? '')).then(markDone).catch(e => setToast((e as Error).message)) }}>Start {DOGS[handTo]} on this</button>
                      <div className="row2"><button onClick={markDone}>Just close it</button></div>
                    </>
                  : <div className="row2"><button onClick={markDone}>Close it</button></div>}
                <p className="muted small center">Nothing posts without your tap.</p>
              </div>
            )}
            {!isDoneT(followed) && (
              <div className="steer">
                <button onClick={() => send(STEER.pause, `Asked ${dogOf(followed)} to pause`)}>❚❚ Pause</button>
                <button className={picking ? 'on' : ''} onClick={() => { setPicking(true); setToast('Tap a building: Library = research · Workshop = write · Studio = pictures · Think Tower = plan · Post Office = report back') }}>⌖ Send to a building</button>
              </div>
            )}
          </section>
        )
      })()}
      <details className="card more fold">
        <summary><b>Details</b><span className="mono muted small">{[outs.length && `${outs.length} file${outs.length > 1 ? 's' : ''}`, `${live.steps.length} steps`, `${live.msgs.length} messages`].filter(Boolean).join(' · ')}</span></summary>
        {job && <details className="jobline"><summary><span className="eyebrow">Job</span> {nice(job.brief)}</summary><span className="mono muted small">{job.skill}{job.mode ? ` · ${job.mode}` : ''}</span></details>}
        <div className={'phases' + (isDoneT(followed) ? ' complete' : '')}>
          <div className="bars">{PHASES.map((p, i) => <span key={p} className={i < phaseAt(followed) ? 'done' : i === phaseAt(followed) ? 'now' : ''} />)}</div>
          <div className="names">{PHASES.map((p, i) => <span key={p} className={i === phaseAt(followed) ? 'now' : i < phaseAt(followed) ? 'done' : ''}>{p}</span>)}{isDoneT(followed) && <span className="donechip">✓ Done</span>}</div>
        </div>
        {latestFor(taskFor(followed.port)?.id) && <LivePreview e={latestFor(taskFor(followed.port)?.id)!} big onOpen={setViewing} />}
        <OutputStrip outputs={outs} onOpen={setViewing} />
        <Steps steps={live.steps} busy={followed.busy} />
        <Chat msgs={live.msgs} />
      </details>
      <Docked><form className="composer footer" onSubmit={e => { e.preventDefault(); reply(draft); e.currentTarget.querySelector('textarea')!.style.height = '' }}>
        <div className="row">
          <Attach onAdd={l => setDraft(d => (d ? d + '\n' : '') + l)} onError={setToast} />
          <Voice onAdd={l => setDraft(d => (d ? d + '\n' : '') + l)} onError={setToast} />
          <textarea id="reply-box" rows={1} value={draft} aria-label={`Message ${dogOf(followed)}`} placeholder={`Tell ${dogOf(followed)}…`}
            onChange={e => { setDraft(e.target.value); grow(e.target) }}
            onFocus={() => document.body.classList.add('typing')} onBlur={() => document.body.classList.remove('typing')}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); reply(draft); e.currentTarget.style.height = '' } }} />
          <button type="submit" className="pillbtn send" disabled={!draft.trim()} aria-label="Send">↑</button>
        </div>
      </form></Docked>
    </section>
  )

  const talk = home
    ? <TalkPanel home={home} chat={homeLive} wide={wide} />
    : (
      <section className="card talk">
        <GoddardHead size={72} />
        <h2>Talk</h2>
        <p>Home isn't open. It starts a Claude window in Terminal on the Mac, in ~/gm-mind, and picks up its last chat. Press yes there once.</p>
        <button onClick={() => startHome().then(() => { setToast('Opening Home on the Mac'); refresh() }).catch(e => setToast(e.message))}>Start Home</button>
      </section>
    )

  const doneTask = view.kind === 'done' ? tasks.find(t => t.id === view.id) : undefined
  const donePanel = doneTask && (
    <section className="panel thread">
      <header className="threadbar">
        {!wide && <button className="backbtn" onClick={() => setView({ kind: 'chat' })} aria-label="Back to all agents">‹ All</button>}
        {doneTask.port != null && <span className="badge" style={{ background: colorOf(doneTask.port) }}>{numberOf(doneTask.port)}</span>}
        <span className="tb-title"><b>{DOGS[doneTask.skill] ?? (doneTask.port != null ? `Agent ${numberOf(doneTask.port)}` : 'Task')}</b><span className="mono muted small">Done{doneTask.by === 'home' ? ' · from Goddard' : ''}</span></span>
      </header>
      <details className="jobline"><summary><span className="eyebrow">Job</span> {nice(doneTask.brief)}</summary><span className="mono muted small">{doneTask.skill}{doneTask.parent ? ` · ${doneTask.parent}` : ''}{doneTask.mode ? ` · ${doneTask.mode}` : ''}</span></details>
      <div className="phases complete">
        <div className="bars">{PHASES.map(p => <span key={p} className="done" />)}</div>
        <div className="names">{PHASES.map(p => <span key={p} className="done">{p}</span>)}<span className="donechip">✓ Done</span></div>
      </div>
      <section className="card said">
        <span className="eyebrow">Brought back</span>
        {doneTask.result ? <RichText text={doneTask.result} /> : <p className="muted small">No answer was kept for this one.</p>}
        <PlanCards outputs={findOutputs([doneTask.result ?? ''])} />
      </section>
      {findOutputs([doneTask.result ?? '']).length > 0 && (
        <details className="card more fold">
          <summary><b>More</b><span className="mono muted small">{findOutputs([doneTask.result ?? '']).length} files</span></summary>
          <OutputStrip outputs={findOutputs([doneTask.result ?? ''])} onOpen={setViewing} />
        </details>
      )}
    </section>
  )

  const picker = <SkillsPicker key={pickerBrief} initialBrief={pickerBrief} freeCount={free.length} queued={queued.length} onGive={give} onOpenSlots={openMissing}
    onQueue={(skill, brief) => { give(skill, brief).catch(e => setToast((e as Error).message)) }} />

  // The screen is the world. Everything else is a HUD layer over it: a side panel on the desk / Odin, a bottom
  // sheet on the phone, one at a time. B (or a swipe down on the sheet) puts the layer away.
  const needy = agents.find(a => a.needsYou)
  const readout = (
    <div className="readout">
      <span><b>{agents.filter(a => a.busy).length}</b> working</span>
      <button className={'needbtn' + (needy ? ' hot' : '')} onClick={() => { setChatFilter('needs'); setView({ kind: 'chat' }) }} aria-label="Show what needs you"><b>{agents.filter(a => a.needsYou).length}</b> need you</button>
      {lib.data?.lacie === false && <span className="hot">LaCie not connected</span>}
      {stale ? <span className="live stale">OFFLINE</span> : <span className="live">LIVE</span>}
      {wide && <Clock />}
    </div>
  )
  const chatCtx: ChatCtx = {
    agents, tasks, numberOf, colorOf, nice,
    whereOf: t => TOWN_PLACES[STEP_TO_TOWN[placeForStep(t.doing)] ?? 'workshop'].n,
    openThread, openDone: id => setView({ kind: 'done', id }),
    finish: t => { finishTask(t.id).then(refresh).catch(e => setToast((e as Error).message)) },
    sayTo, onView: setViewing,
    latest: latestFor,
    newTask: brief => { setPickerBrief(brief); setView({ kind: 'skills' }) },
    toast: setToast,
  }
  const chat = <ChatPanel home={home} homeChat={homeLive} ctx={chatCtx} filter={chatFilter} setFilter={setChatFilter} focusTask={focusTask} />
  const library = <LibraryPanel lib={lib} onOpen={setViewing} numberOf={numberOf} nice={nice} onFrom={id => { setFocusTask(id); setChatFilter('all'); setView({ kind: 'chat' }) }} />
  // without Home there's no Goddard to chat with yet: show Start Home instead
  // on a phone the Library and Skills are drawers that come up over the world (swipe down to put it away); big screens keep the full page
  const page = view.kind === 'library' && wide ? library : view.kind === 'skills' && wide ? picker : null
  const layer = page ? null : view.kind === 'history' ? <HistoryPanel numberOf={numberOf} onOpenDog={openThread} /> : view.kind === 'library' ? library : view.kind === 'skills' ? picker : view.kind === 'chat' || view.kind === 'talk' ? (home ? chat : talk) : view.kind === 'tasks' ? board
    : view.kind === 'done' ? (donePanel ?? board) : view.kind === 'thread' ? (threadPanel ?? board)
    : wide ? (threadPanel ?? board) : null
  const close = () => setView({ kind: 'home' })
  const next = useNext(tasks.length)
  // the pocket pets: Carl's named dogs (each with its recipe), plus any other dog holding a job
  const [exploring, setExploring] = useState(false)
  // the phone opens on the calm home; the pack (each dog's own screen) is one tap away
  const [petsOpen, setPetsOpen] = useState(false)
  useEffect(() => { document.body.classList.toggle('mapfull', exploring) }, [exploring])
  // the pet has its own header on the phone; the HUD readout steps aside while it's showing
  const petShown = !wide && view.kind === 'home' && !exploring
  useEffect(() => { document.body.classList.toggle('pethome', petShown) }, [petShown])
  const pets: Pet[] = useMemo(() => {
    const byPortT = new Map(agents.map(a => [a.port, a]))
    const today = new Date().toDateString()
    // the same stages as the progress bar: asking → needs, working or just picked up → cooking, answered since → back
    const stateOf = (t?: Task, th?: Thread): Pet['state'] => { const st = stageOf(t, th); return !t || t.status !== 'active' || !th ? 'ready' : th.needsYou ? 'needs' : st === 3 ? 'back' : 'cooking' }
    const out: Pet[] = NAMED.map(d => {
      const mine = tasks.filter(t => t.skill === d.skill && t.status !== 'lost').sort((a, b) => b.at - a.at)
      // each of these dogs is its own session now (named "Agent slot · Scribbles" and so on)
      const own = agents.find(a => dogName(a) === d.name)
      const t = mine[0], th = own ?? (t?.status === 'active' && t.port ? byPortT.get(t.port) : undefined)
      const recipe = next?.action?.skill === d.skill ? { ...d.recipe!, title: next.title.replace(/^Write the posts for /, '').replace(/,.*$/, '') + ' posts', makes: 'drafts for the plan', needs: 'nothing (plan approved)', brief: next.action.brief } : d.recipe
      return { key: d.skill, name: d.name, skill: d.skill, color: d.color, task: t, thread: th, state: own || t ? stateOf(t, th) : 'resting', recipe,
        jobsToday: mine.filter(x => x.status === 'done' && new Date(x.doneAt ?? 0).toDateString() === today).length }
    })
    // dogs Carl named: always on the pack, with their own job if they have one (a job for Scribbles & co. shows on that dog)
    const named = new Set<number>()
    // every working dog has a tile, so each can be seen and removed; ones Carl didn't name go by their number
    for (const th of agents) {
      if (!isSlot(th) || NAMED.some(d => d.name === dogName(th))) continue
      const name = dogName(th) ?? `Agent ${numberOf(th.port)}`
      named.add(th.port)
      const t = tasks.find(x => x.status === 'active' && x.port === th.port)
      const own = t && !NAMED.some(d => d.skill === t.skill) ? t : undefined
      const helping = t && !own ? NAMED.find(d => d.skill === t.skill)?.name : undefined
      out.push({ key: 'p' + th.port, name, color: colorOf(th.port), task: own, thread: th, state: own ? stateOf(own, th) : 'ready', helping,
        jobsToday: tasks.filter(x => x.port === th.port && x.status === 'done' && new Date(x.doneAt ?? 0).toDateString() === today).length })
    }
    for (const t of tasks) {
      if (t.status !== 'active' || !t.port || named.has(t.port) || NAMED.some(d => d.skill === t.skill)) continue
      const th = byPortT.get(t.port); if (!th) continue
      out.push({ key: 'p' + t.port, name: `Agent ${numberOf(t.port)}`, color: colorOf(t.port), task: t, thread: th, state: stateOf(t, th), jobsToday: 0 })
    }
    const rank = { needs: 0, back: 1, cooking: 2, ready: 3, resting: 4 }
    return out.sort((a, b) => rank[a.state] - rank[b.state])
  }, [agents, tasks, next])
  const swipe = useRef<number | null>(null)

  return (
    <div className={'app hud ' + (wide ? 'desk' : 'phone')}>
      <div className="worldlayer">{world}</div>
      <header className="hudtop">
        <div className="brand"><GoddardHead size={wide ? 56 : 36} barking={!!needy} /><div><h1>GODDARD OS</h1><p className="muted small">{greeting}</p></div></div>
        {wide && (
          <div className="mode" role="tablist">
            <kbd className="key wide">LB</kbd>
            <button className={view.kind === 'chat' ? 'on' : ''} onClick={() => setView({ kind: 'chat' })}>CHAT</button>
            <button className={view.kind !== 'chat' ? 'on' : ''} onClick={close}>WORLD</button>
            <kbd className="key wide">RB</kbd>
          </div>
        )}
        {readout}
      </header>
      {/* the desk keeps its banner; the phone's calm home already shows the one thing that needs Carl */}
      {needy && wide && view.kind !== 'thread' && view.kind !== 'chat' && (
        <button className="banner" onClick={() => { setChatFilter('needs'); setView({ kind: 'chat' }) }}>
          <GoddardHead size={30} />
          <span><b className="mono">NEEDS YOU</b><span>Agent {numberOf(needy.port)}: {titleOf(needy)}</span></span>
          <span className="a small">A</span>
        </button>
      )}
      {missing > 0 && wide && view.kind === 'home' && !needy && (
        <button className="banner quiet" onClick={() => setView({ kind: 'tasks' })}>
          <span><b className="mono">AT THE MAC</b><span>{missing} slot{missing === 1 ? '' : 's'} down. Open them from Tasks.</span></span>
        </button>
      )}
      {layer && (wide ? (
        <aside className="layer side">
          <div className="deskTabs">
            <button className={view.kind === 'home' || view.kind === 'thread' ? 'on' : ''} onClick={close}>Following</button>
            <button className={view.kind === 'chat' || view.kind === 'done' ? 'on' : ''} onClick={() => setView({ kind: 'chat' })}>Chat</button>
            <button className={view.kind === 'library' ? 'on' : ''} onClick={() => setView({ kind: 'library' })}>Library</button>
            <button className={view.kind === 'tasks' ? 'on' : ''} onClick={() => setView({ kind: 'tasks' })}>Slots</button>
            <button className={view.kind === 'skills' ? 'on' : ''} onClick={() => { setPickerBrief(''); setView({ kind: 'skills' }) }}>+ Task</button>
          </div>
          <FootContext.Provider value={foot}>{layer}</FootContext.Provider>
          <div className="sheetfoot" ref={setFoot} />
        </aside>
      ) : (
        <section className="layer sheet" key={view.kind}>
          <div className="handle" onPointerDown={e => { swipe.current = e.clientY }}
            onPointerUp={e => { if (swipe.current !== null && e.clientY - swipe.current > 50) close(); swipe.current = null }}
            onClick={close} role="button" aria-label="Back to the world"><i /></div>
          <div className="sheetbody"><FootContext.Provider value={foot}>{layer}</FootContext.Provider></div>
        </section>
      ))}
      {!wide && view.kind === 'home' && !exploring && !petsOpen && (
        <CalmHome threads={list.threads} tasks={list.tasks ?? []} home={home} onPack={() => setPetsOpen(true)}
          onHistory={() => setView({ kind: 'history' })} onToast={setToast} refresh={refresh} onView={setViewing}
          preview={id => { const e = latestFor(id); return e ? <LivePreview e={e} big onOpen={setViewing} /> : null }} />
      )}
      {!wide && view.kind === 'home' && !exploring && petsOpen && <button className="calm-back" onClick={() => setPetsOpen(false)}>← Goddard</button>}
      {!wide && view.kind === 'home' && !exploring && petsOpen && (
        <PetHome pets={pets} numberOf={numberOf} onAddDog={addDog} onView={setViewing}
          preview={id => { const e = latestFor(id); return e ? <LivePreview e={e} big onOpen={setViewing} /> : null }}
          onRemove={p => { if (!p.thread) return; removeDog(p.thread.port).then(j => { setToast(`${p.name} is gone${j.requeued ? '. Its job is back in line.' : '.'}`); refresh() }).catch(e => setToast((e as Error).message)) }}
          onCook={(skill, brief, port) => { give(skill, brief, port).catch(e => setToast((e as Error).message)) }}
          onTalk={p => (p.thread ? openThread(p.thread.port) : (document.querySelector('.pet-say textarea') as HTMLTextAreaElement | null)?.focus())}
          onSay={(port, text) => { sayTo(port, text).then(() => setToast('Sent')).catch(e => setToast((e as Error).message)) }}
          onGoodDog={p => { if (!p.thread || !p.task) return; sayTo(p.thread.port, STEER.approve).catch(() => {}); finishTask(p.task.id).then(() => { setToast('Good dog. Job closed.'); refresh() }).catch(e => setToast((e as Error).message)) }}
          onOther={() => { setPickerBrief(''); setView({ kind: 'skills' }) }}
          onExplore={() => setExploring(true)}
          onChat={() => setView({ kind: 'chat' })} onLibrary={() => setView({ kind: 'library' })} onHistory={() => setView({ kind: 'history' })} onError={setToast} />
      )}
      {!wide && exploring && <button className="explore-close" onClick={() => setExploring(false)} aria-label="Back to your dogs">✕ Back to the pack</button>}
      {wide && view.kind === 'home' && (() => {
        // the one next move, always: a dog that needs Carl, then a dog that's back with work, then the next real dated thing
        const back = agents.find(a => !a.busy && !a.needsYou && taskFor(a.port)?.status === 'active' && a.last.at >= (taskFor(a.port)?.at ?? 0) && a.last.text === 'Replied')
        const dog = needy ?? back
        const card = dog
          ? { eyebrow: needy ? `${DOGS[taskFor(dog.port)?.skill ?? ''] ?? `Agent ${numberOf(dog.port)}`} needs you` : `${DOGS[taskFor(dog.port)?.skill ?? ''] ?? `Agent ${numberOf(dog.port)}`} is back`,
              title: titleOf(dog), why: needy ? 'Your answer lets it carry on.' : 'Look it over, then close it or send it on.', label: needy ? 'Answer' : 'See it', go: () => openThread(dog.port) }
          : next ? { eyebrow: next.kind === 'clear' ? 'All clear' : 'Next move', title: next.title, why: next.why, label: next.action?.label,
              go: next.action ? () => { give(next.action!.skill, next.action!.brief).catch(e => setToast((e as Error).message)) } : undefined } : null
        if (!card || card.eyebrow === 'All clear' && wide) return null
        return (
          <section className={'nextmove' + (wide ? ' desk' : '') + (needy ? ' hot' : '')}>
            <span className="eyebrow">{card.eyebrow}</span>
            <b className="nm-title">{card.title}</b>
            <span className="muted small">{card.why}</span>
            {card.go && card.label && <button className="primary big" onClick={card.go}>{card.label}</button>}
          </section>
        )
      })()}
      {wide ? <HintBar /> : (
        <nav className="tabbar"><div className="footslot" ref={setFoot} /><div className="pill">
          <button className={view.kind === 'home' ? 'on' : ''} onClick={close}>WORLD</button>
          <button className={['chat', 'talk', 'thread', 'done', 'tasks'].includes(view.kind) ? 'on' : ''} onClick={() => setView({ kind: 'chat' })}>CHAT</button>
          <button className={view.kind === 'library' ? 'on' : ''} onClick={() => setView({ kind: 'library' })}>LIBRARY</button>
          <button className={view.kind === 'skills' ? 'on' : ''} onClick={() => { setPickerBrief(''); setView({ kind: 'skills' }) }}>SKILLS</button>
        </div></nav>
      )}
      {page && (
        <section className="page" key={view.kind}
          onPointerDown={e => { pageSwipe.current = { x: e.clientX, y: e.clientY } }}
          onPointerUp={e => {
            const s0 = pageSwipe.current; pageSwipe.current = null
            if (!s0 || wide) return
            const dx = e.clientX - s0.x, dy = e.clientY - s0.y
            if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 1.5) {
              const i = PAGES.indexOf(pageOf(view)), next = PAGES[(i + (dx < 0 ? 1 : -1) + PAGES.length) % PAGES.length]
              if (next === 'skills') setPickerBrief('')
              setView({ kind: next })
            }
          }}>
          <nav className="pagetabs" aria-label="Screens">
            <kbd className="key wide">LB</kbd>
            {PAGES.map(p => (
              <button key={p} className={pageOf(view) === p ? 'on' : ''} onClick={() => { if (p === 'skills') setPickerBrief(''); setView({ kind: p }) }}>
                {p === 'home' ? 'WORLD' : p.toUpperCase()}
              </button>
            ))}
            <kbd className="key wide">RB</kbd>
          </nav>
          <div className="pagebody">{page}</div>
        </section>
      )}
      {viewing && <OutputViewer output={viewing} onClose={() => setViewing(null)} />}
      <Toast text={toast} />
    </div>
  )
}

// Talk: the Home thread as a plain chat with Goddard, inside the app.
function TalkPanel({ home, chat, wide }: { home: Thread; chat: ReturnType<typeof useThread>; wide: boolean }) {
  const [draft, setDraft] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const msgs = chat.msgs.slice(-60)
  // the thread's own socket says when Goddard is working; the door's list is the backup
  const working = chat.busy.on || home.busy
  const doing = chat.busy.text || home.doing
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [msgs.length, working])
  // a turn that ends with no answer is a real problem on the Mac, not something to hide
  const [wasWorking, setWasWorking] = useState(false)
  const [stalled, setStalled] = useState(false)
  useEffect(() => {
    if (working) { setWasWorking(true); setStalled(false); return }
    if (wasWorking && msgs[msgs.length - 1]?.from === 'user') setStalled(true)
    setWasWorking(false)
  }, [working])
  useEffect(() => { if (msgs[msgs.length - 1]?.from === 'assistant') setStalled(false) }, [msgs.length])
  const sendIt = () => { if (draft.trim() && chat.say(draft.trim())) setDraft('') }
  const lastAgent = [...msgs].reverse().find(m => m.from === 'assistant')
  return (
    <section className={'panel talkchat' + (wide ? ' wide' : '')}>
      <header className="threadbar">
        <GoddardHead size={36} barking={home.needsYou} />
        <span className="tb-title"><b>Goddard</b><span className="mono muted small">Home · ~/gm-mind{chat.online ? '' : ' · reconnecting'}</span></span>
      </header>
      {!msgs.length && <p className="muted small">{chat.online ? 'No messages yet. Say hi.' : 'Connecting to Home…'}</p>}
      <div className="bubbles">
        {msgs.map(m => (
          <div key={m.id} className={'bubble2 ' + (m.from === 'user' ? 'me' : 'gd')}><RichText text={m.text} /></div>
        ))}
        {working && <div className="bubble2 gd typing"><span className="dots"><i /><i /><i /></span><span className="mono small muted">{doing || 'Thinking it over'}</span></div>}
        <div ref={end} />
      </div>
      {stalled && (
        <section className="card notyet">
          <b>Goddard stopped without answering</b>
          <span className="muted small">Something went wrong in the Home window on the Mac (it may be showing an error there). Try once more, or close that window and use Start Home.</span>
        </section>
      )}
      {chat.asks.map(a => (
        <section key={a.request_id} className="card checkpoint">
          <header><span className="eyebrow">Needs you · permission</span><span className="mono muted small">{a.tool_name}</span></header>
          <p>{a.description}</p>
          {a.input_preview && <pre className="preview">{a.input_preview}</pre>}
          <div className="quick">
            <button className="primary grow" onClick={() => chat.verdict(a.request_id, 'allow')}>Allow</button>
            <button className="grow" onClick={() => chat.verdict(a.request_id, 'deny')}>No</button>
          </div>
        </section>
      ))}
      {!working && msgs[msgs.length - 1]?.from === 'assistant' && lastAgent?.choices?.length ? (
        <div className="chips">{lastAgent.choices.map(c => <button key={c} onClick={() => chat.say(c)}>{c}</button>)}</div>
      ) : null}
      <Docked><form className="composer footer" onSubmit={e => { e.preventDefault(); sendIt(); e.currentTarget.querySelector('textarea')!.style.height = '' }}>
        <div className="row">
          <Attach onAdd={l => setDraft(d => (d ? d + '\n' : '') + l)} onError={() => {}} />
          <Voice onAdd={l => setDraft(d => (d ? d + '\n' : '') + l)} onError={() => {}} />
          <textarea id="talk-box" rows={1} value={draft} aria-label="Message Goddard" placeholder="Tell Goddard…"
            onChange={e => { setDraft(e.target.value); grow(e.target) }}
            onFocus={() => document.body.classList.add('typing')} onBlur={() => document.body.classList.remove('typing')}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendIt(); e.currentTarget.style.height = '' } }} />
          <button type="submit" className="pillbtn send" disabled={!draft.trim()} aria-label="Send">↑</button>
        </div>
      </form></Docked>
    </section>
  )
}

function Mini({ at }: { at: number }) { // at === PHASES.length means every phase is done
  return <span className="minibars">{PHASES.map((p, i) => <i key={p} className={i < at ? 'done' : i === at ? 'now' : ''} />)}</span>
}

function Steps({ steps, busy }: { steps: { id: string; text: string }[]; busy: boolean }) {
  if (!steps.length) return null
  const rows = steps.map((s, i) => ({ ...s, place: placeById(placeForStep(s.text)).label, now: busy && i === steps.length - 1 }))
  return (
    <details className="card life fold">
      <summary><b>Its path ({steps.length} steps)</b><span className="mono muted small">now at the {rows[rows.length - 1].place}</span></summary>
      {rows.slice(-12).reverse().map((r, i, a) => (
        <div key={r.id} className={'row ' + (r.now ? 'now' : 'done')}>
          <span className="tag">{r.now ? 'NOW' : ''}</span>
          <span className="place">{i === 0 || a[i - 1].place !== r.place ? r.place : ''}</span>
          <span className="doing">{r.text.replace(/^» /, '')}</span>
        </div>
      ))}
    </details>
  )
}

// messages the app itself sent to set a slot up; shown as one quiet line instead of the full text
const SETUP = /^(Agent slot\.|New task from Goddard OS\.)/

function Chat({ msgs }: { msgs: { id: string; from: string; text: string }[] }) {
  if (!msgs.length) return null
  const task = [...msgs].reverse().find(m => m.text.startsWith('New task from Goddard OS.'))
  const shown = msgs.filter(m => !SETUP.test(m.text))
  return (
    <details className="card chatlog fold">
      <summary><b>Conversation</b><span className="mono muted small">{shown.length} messages</span></summary>
      {task && <p className="setup small muted">Task given: {task.text.match(/Use the (.+?) skill: ([^\n]*)/)?.slice(1).join(' · ') ?? 'from Goddard OS'}</p>}
      {shown.map(m => <div key={m.id} className={'msg ' + (m.from === 'user' ? 'you' : 'it')}><b className="mono small">{m.from === 'user' ? 'YOU' : 'AGENT'}</b><RichText text={m.text} /></div>)}
    </details>
  )
}

// agent text arrives HTML-escaped; decode it as plain text and make bare links tappable
function decode(t: string) {
  const el = document.createElement('textarea'); el.innerHTML = t; return el.value
}
function RichText({ text }: { text: string }) {
  const parts = decode(text).split(/(https?:\/\/[^\s)]+)/g)
  return <p className="rich">{parts.map((p, i) => (/^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer">{p}</a> : p))}</p>
}

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(id) }, [])
  return <span className="clock">{now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
}

function Toast({ text }: { text: string | null }) {
  return <div className={'toast' + (text ? ' show' : '')} role="status" aria-live="polite">{text}</div>
}

// a visiting session: where it is, its last few steps and its latest words. Read-only on purpose.
function VisitorCard({ s }: { s?: import('./door').OtherSession }) {
  if (!s) return null
  return (
    <span className="visitor">
      <span className="mono small muted">{s.cwd.replace(/^\/Users\/[^/]+/, '~')}{s.at ? ` · ${Math.max(0, Math.round((Date.now() - s.at) / 60000))}m ago` : ''}</span>
      {s.steps.slice(-3).map((t, i) => <span key={i} className="small">· {t}</span>)}
      {s.last && <span className="small muted">“{s.last.slice(0, 140)}{s.last.length > 140 ? '…' : ''}”</span>}
    </span>
  )
}

const DOGS: Record<string, string> = { 'gm-fetch': 'Fetch', 'gm-scribbles': 'Scribbles', 'gm-bloodhound': 'Bloodhound' }


// Split a dog's message into the one question to decide (its last line with a "?", else its first line)
// and the rest as supporting facts, with bare file paths dropped (the plan shows as its own toggle).
function splitAsk(text: string): { ask: string; facts: string; asks: boolean } {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean).filter(l => !/^(~|\/Users\/|\/Volumes\/)\S+$/.test(l))
  let i = -1
  for (let j = lines.length - 1; j >= 0; j--) if (lines[j].endsWith('?')) { i = j; break }
  const asks = i >= 0
  if (i < 0) i = 0
  return { ask: lines[i] ?? '', facts: lines.filter((_, j) => j !== i).join('\n'), asks }
}

// the door's pick for the next real dated thing (an approved campaign to write for, or the nearest goal step)
type Next = { kind: 'campaign' | 'goal' | 'clear'; title: string; why: string; action: { label: string; skill: string; brief: string } | null }
function useNext(bump: number) {
  const [n, setN] = useState<Next | null>(null)
  useEffect(() => {
    const load = () => fetch('/door/api/next', { cache: 'no-store' }).then(r => r.json()).then(setN).catch(() => {})
    load(); const id = setInterval(load, 30000); return () => clearInterval(id)
  }, [bump])
  return n
}

// what the dog sees in the dog-box browser (Carl, 2026-10-29: "show each screenshot in the dog's thread"): the newest
// picture big, the earlier ones as a strip to step back through
function SeenShots({ shots, busy }: { shots: { id: string; src: string; url: string; title: string; ts: number }[]; busy: boolean }) {
  const [pick, setPick] = useState<string | null>(null)
  const [gone, setGone] = useState<Set<string>>(new Set())
  const kept = shots.filter(s => !gone.has(s.id))
  const cur = kept.find(s => s.id === pick) ?? kept[kept.length - 1]
  if (!cur) return null
  const lose = (id: string) => setGone(g => new Set(g).add(id)) // the door keeps the last 40 per thread
  let host = ''
  try { host = new URL(cur.url).host } catch {}
  return (
    <section className="card seen">
      <header><span className="eyebrow">{busy && cur === kept[kept.length - 1] ? 'What it sees now' : 'What it saw'}</span>
        <span className="mono muted small">{host || 'dog-box browser'} · {new Date(cur.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></header>
      <a href={cur.src} target="_blank" rel="noreferrer"><img src={cur.src} alt={`The dog-box browser on ${cur.title || host || 'a page'}`} onError={() => lose(cur.id)} /></a>
      {cur.title && <p className="small">{cur.title}</p>}
      {kept.length > 1 && (
        <div className="seen-strip">{kept.map(s => <button key={s.id} className={s === cur ? 'on' : ''} onClick={() => setPick(s.id)} aria-label={`Picture from ${new Date(s.ts).toLocaleTimeString()}`}><img src={s.src} alt="" onError={() => lose(s.id)} /></button>)}</div>
      )}
    </section>
  )
}
