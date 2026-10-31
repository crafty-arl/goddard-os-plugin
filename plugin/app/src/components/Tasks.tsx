import { useMemo, useState } from 'react'
import { useSkills, GROUP_ORDER, type Skill } from '../data/skills'
import { PHASES, SAMPLE_JOB } from '../data/sample'
import { type Action, type State, TASK_PHASES, needsYou, isDone } from '../state/store'

type D = (a: Action) => void

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`
}

function MiniBars({ n, at }: { n: number; at: number }) {
  return <span className="minibars">{Array.from({ length: n }, (_, i) => <i key={i} className={i < at ? 'done' : i === at ? 'now' : ''} />)}</span>
}

export function TasksPanel({ s, d }: { s: State; d: D }) {
  const sampleState = needsYou(s) ? 'Needs you' : isDone(s) ? 'Done' : s.paused ? 'Paused' : PHASES[Math.min(s.phase, 4)]
  return (
    <section className="panel">
      <header className="panelhead">
        <span><span className="eyebrow">Tasks</span><h2>On the board</h2></span>
        <button className="pillbtn" onClick={() => d({ type: 'go', view: 'skills' })}>+ New task</button>
      </header>
      <button className={'taskrow' + (needsYou(s) ? ' hot' : '')} onClick={() => d({ type: 'open' })}>
        <span className="tr-main"><b>{SAMPLE_JOB.title}</b><span className="mono muted small">gm-linkedin-post · gm-publish-tags · sample run</span></span>
        <span className="tr-side"><MiniBars n={5} at={s.phase} /><span className="small">{sampleState}</span></span>
      </button>
      {s.tasks.map(t => (
        <button key={t.id} className="taskrow" onClick={() => d({ type: 'openTask', id: t.id })}>
          <span className="tr-main"><b>{t.brief || t.skill}</b><span className="mono muted small">{t.skill} · {ago(t.createdAt)}</span></span>
          <span className="tr-side"><MiniBars n={TASK_PHASES.length} at={t.phase} /><span className="small">Waiting for brief</span></span>
        </button>
      ))}
      {s.tasks.length === 0 && <p className="muted small">No tasks of your own yet. Start one from a skill.</p>}
    </section>
  )
}

export function SkillsPanel({ d }: { d: D }) {
  const { data, error, reload } = useSkills()
  const [q, setQ] = useState('')
  const groups = useMemo(() => {
    const list = (data?.skills ?? []).filter(sk => !q || (sk.name + ' ' + sk.description).toLowerCase().includes(q.toLowerCase()))
    const by = new Map<string, Skill[]>()
    for (const sk of list) by.set(sk.group, [...(by.get(sk.group) ?? []), sk])
    return GROUP_ORDER.filter(g => by.has(g)).map(g => [g, by.get(g)!] as const)
  }, [data, q])
  return (
    <section className="panel">
      <header className="panelhead">
        <span><span className="eyebrow">New task · pick a skill</span><h2>Your skills</h2></span>
        <button className="pillbtn ghost" onClick={reload}>Refresh</button>
      </header>
      <p className="muted small">
        {data ? <>{data.skills.length} installed in Claude Code on the Mac, read from <span className="mono">{data.from}</span> at {new Date(data.readAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Tasks only start from these.</> : error ?? 'Reading your skills…'}
      </p>
      <input id="skill-search" className="search" type="search" placeholder="Search skills" value={q} onChange={e => setQ(e.target.value)} />
      {groups.map(([g, list]) => (
        <div key={g} className="skillgroup">
          <div className="sectionhead"><span className="mono">{g.toUpperCase()}</span><span className="mono muted small">{list.length}</span></div>
          {list.map(sk => (
            <div key={sk.name} className="skill">
              <span className="sk-main"><b className="mono">{sk.name}</b><span className="desc">{sk.description}</span></span>
              <button className="pillbtn" onClick={() => d({ type: 'startTask', skill: sk.name, group: sk.group })}>Start</button>
            </div>
          ))}
        </div>
      ))}
      {data && groups.length === 0 && <p className="muted">No skill matches “{q}”.</p>}
    </section>
  )
}

export function TaskDetail({ s, d }: { s: State; d: D }) {
  const t = s.tasks.find(x => x.id === s.openTask)
  const { data } = useSkills()
  if (!t) return null
  const sk = data?.skills.find(x => x.name === t.skill)
  return (
    <section className="panel">
      <header className="jobbar">
        <button className="round" onClick={() => d({ type: 'back' })} aria-label="Back">‹</button>
        <span><span className="eyebrow">Task · from {t.skill}</span><h2>{t.brief || 'New task'}</h2></span>
      </header>
      <div className="phases">
        <div className="bars">{TASK_PHASES.map((p, i) => <span key={p} className={i < t.phase ? 'done' : i === t.phase ? 'now' : ''} />)}</div>
        <div className="names">{TASK_PHASES.map((p, i) => <span key={p} className={i === t.phase ? 'now' : ''}>{p}</span>)}</div>
      </div>
      <div className="card">
        <span className="eyebrow">Skill</span>
        <b className="mono">{t.skill}</b>
        <span className="muted small">{sk?.description ?? 'Reading skill…'}</span>
        {sk && <span className="mono muted small">{sk.path}</span>}
      </div>
      <label className="card brief" htmlFor={`brief-${t.id}`}>
        <span className="eyebrow">Brief · one line</span>
        <input id={`brief-${t.id}`} value={t.brief} placeholder="What is this for?" onChange={e => d({ type: 'brief', id: t.id, text: e.target.value })} />
      </label>
      <div className="card notyet">
        <b>Not sent to an agent yet</b>
        <span className="muted small">The task is saved on this device. Running it needs the agent runner, which is the next build step. Nothing runs, spends or posts from here.</span>
      </div>
      <button className="pillbtn ghost danger" onClick={() => d({ type: 'removeTask', id: t.id })}>Remove task</button>
    </section>
  )
}
