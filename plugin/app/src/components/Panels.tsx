import { GoddardHead } from './GoddardHead'
import { AGENTS, PHASES, SAMPLE_JOB } from '../data/sample'
import { placeById } from '../data/world'
import { type Action, type State, placeFor, needsYou, isDone } from '../state/store'

type D = (a: Action) => void

export function ModeSwitch({ s, d, pads }: { s: State; d: D; pads?: boolean }) {
  return (
    <div className="mode" role="tablist" aria-label="Mode">
      {pads && <kbd className="key wide">LB</kbd>}
      {(['talk', 'tasks'] as const).map(m => (
        <button key={m} role="tab" aria-selected={s.mode === m} className={s.mode === m ? 'on' : ''} onClick={() => d({ type: 'mode', mode: m })}>
          {m.toUpperCase()}
        </button>
      ))}
      {pads && <kbd className="key wide">RB</kbd>}
    </div>
  )
}

export function Greeting({ s }: { s: State }) {
  if (needsYou(s)) return <>Woof. Agent 1 needs you.</>
  if (isDone(s)) return <>Evening, boss. All quiet.</>
  return <>Evening, boss. Two out working{s.paused ? ', paused' : ''}.</>
}

export function JumpBack({ s, d }: { s: State; d: D }) {
  const phase = Math.min(s.phase, 4)
  return (
    <button className="jump" onClick={() => d({ type: 'open' })}>
      <span className="thumb" aria-hidden>✎</span>
      <span className="jtext">
        <span className="eyebrow">Jump back in</span>
        <span className="jtitle">{SAMPLE_JOB.title}</span>
        <span className="muted">
          {isDone(s) ? 'Done · ready for you to post' : `Phase ${phase + 1} of 5 · ${PHASES[phase]} · at the ${placeById(placeFor(s, phase)).label}`}
        </span>
      </span>
      <span className="abtn"><span className="a">A</span><small>Resume</small></span>
    </button>
  )
}

const TILES = [
  { icon: '▤', label: 'Last work', sub: 'Opened 12m ago' },
  { icon: '✦', label: 'Tangents', sub: '3 parked' },
  { icon: '◉', label: 'Play', sub: 'Just for fun' },
  { icon: '+', label: 'New task', sub: 'From a skill' },
]

export function Shelf({ onTile }: { onTile: (label: string) => void }) {
  return (
    <div className="shelf">
      {TILES.map((t, i) => (
        <button key={t.label} className={'tile' + (i === 0 ? ' sel' : '')} onClick={() => onTile(t.label)}>
          <span className="face" aria-hidden>{t.icon}</span>
          <span className="tl">{t.label}</span>
          <span className="muted small">{t.sub}</span>
        </button>
      ))}
    </div>
  )
}

export function TabBar({ s, d }: { s: State; d: D }) {
  const tabs = [
    { id: 'home', label: 'HOME', on: s.mode === 'tasks' && s.view === 'home', go: () => d({ type: 'go', view: 'home' }) },
    { id: 'tasks', label: 'TASKS', on: s.mode === 'tasks' && ['tasks', 'task', 'job'].includes(s.view), go: () => d({ type: 'go', view: 'tasks' }) },
    { id: 'talk', label: 'TALK', on: s.mode === 'talk', go: () => d({ type: 'mode', mode: 'talk' }) },
    { id: 'skills', label: 'SKILLS', on: s.mode === 'tasks' && s.view === 'skills', go: () => d({ type: 'go', view: 'skills' }) },
  ]
  return (
    <nav className="tabbar">
      <div className="pill">
        {tabs.map(t => <button key={t.id} className={t.on ? 'on' : ''} onClick={t.go}>{t.label}</button>)}
      </div>
    </nav>
  )
}

export function PhaseTrack({ s }: { s: State }) {
  return (
    <div className="phases" aria-label="Phases">
      <div className="bars">
        {PHASES.map((p, i) => <span key={p} className={i < s.phase ? 'done' : i === s.phase ? 'now' : ''} />)}
      </div>
      <div className="names">
        {PHASES.map((p, i) => <span key={p} className={i < s.phase ? 'done' : i === s.phase ? 'now' : ''}>{p}</span>)}
      </div>
    </div>
  )
}

export function AgentLife({ s }: { s: State }) {
  const phase = Math.min(s.phase, 4)
  const agent = AGENTS.find(a => a.id === SAMPLE_JOB.steps[phase].agent)!
  return (
    <section className="card life">
      <header>
        <span className="badge" style={{ background: agent.color }}>{agent.id}</span>
        <b>Agent {agent.id} · {agent.role}</b>
        <span className="mono muted small">skill: {agent.skill}</span>
      </header>
      {SAMPLE_JOB.steps.map((st, i) => {
        const tag = i < s.phase ? 'DONE' : i === s.phase ? (s.paused ? 'PAUSED' : 'NOW') : 'NEXT'
        return (
          <div key={i} className={'row ' + tag.toLowerCase()}>
            <span className="tag">{tag}</span>
            <span className="place">{placeById(placeFor(s, i)).label}</span>
            <span className="doing">{st.agent === 2 ? `Agent 2: ${st.doing}` : st.doing}</span>
          </div>
        )
      })}
    </section>
  )
}

export function AgentRows({ s }: { s: State }) {
  const phase = Math.min(s.phase, 4)
  return (
    <div className="agents">
      {AGENTS.map(a => {
        const mine = SAMPLE_JOB.steps.map((st, i) => ({ st, i })).filter(x => x.st.agent === a.id && x.i <= phase)
        const last = mine[mine.length - 1]
        const active = SAMPLE_JOB.steps[phase].agent === a.id
        return (
          <div key={a.id} className="agent">
            <span className="badge big" style={{ background: a.color }}>{a.id}</span>
            <span className="who"><b>Agent {a.id} · {a.role}</b><span className="mono muted small">skill: {a.skill}</span></span>
            <span className="where">
              <b className={active ? 'gold' : ''}>{last ? placeById(placeFor(s, last.i)).label : 'Research shelf'}</b>
              <span className="muted small">{active ? (s.paused ? 'Paused' : SAMPLE_JOB.steps[phase].doing) : 'Waiting'}</span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function QuickButtons({ s, d, pads }: { s: State; d: D; pads?: boolean }) {
  return (
    <div className="quick">
      <button onClick={() => d({ type: 'pause' })} className={s.paused ? 'on' : ''}>
        {pads ? <kbd className="key x">X</kbd> : <span aria-hidden>{s.paused ? '▶' : '❚❚'}</span>}
        {s.paused ? 'Resume' : 'Pause'}
      </button>
      <button onClick={() => d({ type: 'redo' })}>{pads ? <kbd className="key y">Y</kbd> : <span aria-hidden>↺</span>}Redo</button>
      <button onClick={() => d({ type: 'pick' })} className={'grow' + (s.picking ? ' on' : '')}>
        {pads ? <kbd className="key wide">RT</kbd> : <span aria-hidden>⌖</span>}Go here instead
      </button>
    </div>
  )
}

export function Checkpoint({ s, d, pads }: { s: State; d: D; pads?: boolean }) {
  return (
    <>
      {!s.dismissedNudge && (
        <div className="nudge">
          <GoddardHead size={64} barking />
          <div className="bubble">
            <span className="eyebrow">Woof</span>
            Boss, Agent 1 is back at the Review table. The draft is ready for your eyes.
          </div>
        </div>
      )}
      <section className="card checkpoint">
        <header><span className="eyebrow">Checkpoint · Back to you</span><span className="mono muted small">Phase 5 of 5</span></header>
        <div className="draft">
          <b>Draft post</b>
          <i /><i /><i /><i />
          <span className="muted small">Sample. The real draft shows here once the writer is connected.</span>
        </div>
        <span className="ok small">✓ Agent 2 checked the tags (gm-publish-tags)</span>
      </section>
      <div className="quick">
        <button className="primary grow" onClick={() => d({ type: 'approve' })}>{pads ? <kbd className="key a">A</kbd> : '✓'} Looks good</button>
        <button onClick={() => d({ type: 'redo' })}>{pads ? <kbd className="key y">Y</kbd> : '↺'} Redo</button>
        <button onClick={() => d({ type: 'pick' })}>{pads ? <kbd className="key wide">RT</kbd> : '⌖'} Go here</button>
      </div>
      <p className="muted small center">Looks good only marks it done. You post it yourself.</p>
    </>
  )
}

export function Done({ d }: { d: D }) {
  return (
    <section className="card done">
      <span className="eyebrow">Done</span>
      <p>The draft is marked done. Nothing was posted. You post it yourself.</p>
      <button onClick={() => d({ type: 'restart' })}>Run the sample again</button>
    </section>
  )
}

export function Banner({ s, d }: { s: State; d: D }) {
  if (!needsYou(s) || s.view === 'job') return null
  return (
    <button className="banner" onClick={() => d({ type: 'open' })}>
      <GoddardHead size={34} />
      <span><b className="mono">GODDARD OS</b><span>Woof. Agent 1 needs you: LinkedIn draft is ready to check.</span></span>
      <span className="muted small">now</span>
    </button>
  )
}

export function Talk() {
  return (
    <section className="card talk">
      <GoddardHead size={72} />
      <h2>Talk</h2>
      <p>Raw conversation with Goddard lives here.</p>
      <p className="muted">Not connected yet. This build has no chat backend, so there is nothing to type into. Tasks run on a sample job for now.</p>
    </section>
  )
}

export function HintBar() {
  const hints: [string, string, string][] = [
    ['✥', 'Building to building', ''], ['LT RT', 'Pick a dog', 'wide'], ['A', 'Lean in', 'a'], ['B', 'Let go / back', 'b'],
    ['X', 'Pause / filter', 'x'], ['Y', 'Redo', 'y'], ['LB RB', 'World · Library · Skills', 'wide'],
  ]
  return (
    <footer className="hints">
      <span className="muted small">Keys: arrows · F/R for LT/RT · Enter A · Esc B · X · Y · Q/E</span>
      <div>{hints.map(([k, l, c]) => <span key={l}><kbd className={'key ' + c}>{k}</kbd>{l}</span>)}</div>
    </footer>
  )
}
