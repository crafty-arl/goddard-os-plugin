import { useEffect, useState } from 'react'
import { useStore, needsYou, isDone, placeFor } from './state/store'
import { PLACES, placeById } from './data/world'
import { SAMPLE_JOB } from './data/sample'
import { GoddardHead } from './components/GoddardHead'
import { World } from './components/World'
import { sampleScene } from './sampleScene'
import { useInput, type Btn } from './useInput'
import { TasksPanel, SkillsPanel, TaskDetail } from './components/Tasks'
import {
  ModeSwitch, Greeting, JumpBack, Shelf, TabBar, PhaseTrack, AgentLife, AgentRows,
  QuickButtons, Checkpoint, Done, Banner, Talk, HintBar,
} from './components/Panels'

function useWide() {
  const q = '(min-width: 1024px)'
  const [wide, setWide] = useState(() => matchMedia(q).matches)
  useEffect(() => {
    const m = matchMedia(q), f = () => setWide(m.matches)
    m.addEventListener('change', f); return () => m.removeEventListener('change', f)
  }, [])
  return wide
}

export function SampleApp() {
  const [s, d] = useStore()
  const wide = useWide()
  const [focus, setFocus] = useState<number | null>(null)
  const phase = Math.min(s.phase, 4)
  const following = wide || s.view === 'job'

  const onPlace = (id: string) => {
    if (s.picking) d({ type: 'goHere', place: id })
    else d({ type: 'toast', text: `${placeById(id).label}. Tap Go here instead to send the agent.` })
  }

  useInput((b: Btn) => {
    if (b === 'LB') return d({ type: 'mode', mode: 'talk' })
    if (b === 'RB') return d({ type: 'mode', mode: 'tasks' })
    if (s.mode === 'talk') return
    if (['up', 'down', 'left', 'right'].includes(b)) {
      const step = b === 'right' || b === 'down' ? 1 : -1
      return setFocus(f => ((f ?? -1) + step + PLACES.length) % PLACES.length)
    }
    if (b === 'A') {
      if (s.picking && focus !== null) return d({ type: 'goHere', place: PLACES[focus].id })
      if (needsYou(s) && (wide || s.view === 'job')) return d({ type: 'approve' })
      return d({ type: 'open' })
    }
    if (b === 'B') { setFocus(null); return d({ type: 'back' }) }
    if (b === 'X') return d({ type: 'pause' })
    if (b === 'Y') return d({ type: 'redo' })
    if (b === 'RT') return d({ type: 'pick' })
  })

  const chip = needsYou(s) ? 'AGENT 1 IS WAITING FOR YOU'
    : isDone(s) ? 'ALL DONE'
    : s.picking ? 'TAP WHERE THE AGENT SHOULD GO'
    : following ? `FOLLOWING AGENT ${SAMPLE_JOB.steps[phase].agent} · ${placeById(placeFor(s, phase)).label.toUpperCase()}` : undefined

  const world = (
    <World scene={sampleScene(s, following, focus !== null ? PLACES[focus].id : null)}
      onPlace={onPlace} chip={chip} chipHot={needsYou(s) || s.picking} />
  )
  const tileTap = (label: string) => label === 'New task' ? d({ type: 'go', view: 'skills' })
    : d({ type: 'toast', text: `${label}: sample tile, not wired yet` })
  const side = s.view === 'tasks' ? <TasksPanel s={s} d={d} /> : s.view === 'skills' ? <SkillsPanel d={d} /> : s.view === 'task' ? <TaskDetail s={s} d={d} /> : null

  if (wide) {
    return (
      <div className="app desk">
        <header className="top">
          <div className="brand"><GoddardHead size={64} /><div><h1>GODDARD OS</h1><p className="muted"><Greeting s={s} /></p></div></div>
          <ModeSwitch s={s} d={d} pads />
          <div className="right"><span className="sample">SAMPLE DATA</span><Clock /></div>
        </header>
        {s.mode === 'talk' ? <main className="talkwrap"><Talk /></main> : (
          <main className="deskgrid">
            <div className="stage">{world}</div>
            <aside className="col">
              {side ?? <>
              <section className="card job">
                <header className="jobhead">
                  <span><span className="eyebrow">Jump back in · Job from your skills</span><h2>{SAMPLE_JOB.title}</h2></span>
                </header>
                <PhaseTrack s={s} />
                <AgentRows s={s} />
              </section>
              {needsYou(s) ? <Checkpoint s={s} d={d} pads /> : isDone(s) ? <Done d={d} /> : <QuickButtons s={s} d={d} pads />}
              </>}
              <Shelf onTile={tileTap} />
            </aside>
          </main>
        )}
        <HintBar />
        <Toast text={s.toast} />
      </div>
    )
  }

  return (
    <div className="app phone">
      <Banner s={s} d={d} />
      {s.mode === 'talk' ? (
        <main className="stack">
          <TopHeader s={s} d={d} />
          <Talk />
        </main>
      ) : side ? (
        <main className="stack">{side}</main>
      ) : s.view === 'home' ? (
        <main className="stack">
          <TopHeader s={s} d={d} />
          <JumpBack s={s} d={d} />
          <div className="sectionhead"><span className="mono">THE COLONY</span><span className="mono muted small">2 agents out · {needsYou(s) ? 1 : 0} need you</span></div>
          {world}
          <Shelf onTile={tileTap} />
        </main>
      ) : (
        <main className="stack">
          <header className="jobbar">
            <button className="round" onClick={() => d({ type: 'back' })} aria-label="Back">‹</button>
            <span><span className="eyebrow">Job · from your skills</span><h2>{SAMPLE_JOB.title}</h2></span>
            <span className="badges"><i style={{ background: '#BD8430' }}>1</i><i style={{ background: '#4FA3A5' }}>2</i></span>
          </header>
          <PhaseTrack s={s} />
          {world}
          {needsYou(s) ? <Checkpoint s={s} d={d} /> : isDone(s) ? <Done d={d} /> : <><AgentLife s={s} /><QuickButtons s={s} d={d} /></>}
        </main>
      )}
      <TabBar s={s} d={d} />
      <Toast text={s.toast} />
    </div>
  )
}

function TopHeader({ s, d }: { s: ReturnType<typeof useStore>[0]; d: ReturnType<typeof useStore>[1] }) {
  return (
    <header className="head">
      <div className="brand"><GoddardHead size={40} /><div><h1>GODDARD OS</h1><p className="muted small"><Greeting s={s} /></p></div></div>
      <ModeSwitch s={s} d={d} />
    </header>
  )
}

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(id) }, [])
  return <span className="clock">{now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
}

function Toast({ text }: { text: string | null }) {
  return <div className={'toast' + (text ? ' show' : '')} role="status" aria-live="polite">{text}</div>
}
