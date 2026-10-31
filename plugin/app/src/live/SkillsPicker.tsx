// New task: pick one of the real installed skills and say what it's for. It goes to a free agent slot as a message.
import { useMemo, useState } from 'react'
import { useSkills, GROUP_ORDER, type Skill } from '../data/skills'

interface Props {
  freeCount: number
  queued: number
  onGive: (skill: string, brief: string) => Promise<void>
  onQueue: (skill: string, brief: string) => void
  onOpenSlots: () => void
  initialBrief?: string
}

export function SkillsPicker({ freeCount, queued, onGive, onQueue, onOpenSlots, initialBrief = '' }: Props) {
  const { data, error, reload } = useSkills()
  const [q, setQ] = useState('')
  const [skill, setSkill] = useState<Skill | null>(null)
  const [brief, setBrief] = useState(initialBrief)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const groups = useMemo(() => {
    const ls = (data?.skills ?? []).filter(sk => !q || (sk.name + ' ' + sk.description).toLowerCase().includes(q.toLowerCase()))
    const by = new Map<string, Skill[]>()
    for (const sk of ls) by.set(sk.group, [...(by.get(sk.group) ?? []), sk])
    return GROUP_ORDER.filter(g => by.has(g)).map(g => [g, by.get(g)!] as const)
  }, [data, q])

  if (skill) {
    const give = async () => {
      setBusy(true); setErr(null)
      try { await onGive(skill.name, brief.trim()) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
    }
    return (
      <section className="panel">
        <header className="jobbar">
          <button className="round" onClick={() => setSkill(null)} aria-label="Back to skills">‹</button>
          <span><span className="eyebrow">New task · from {skill.name}</span><h2>What's it for?</h2></span>
        </header>
        <p className="muted small">{skill.description}</p>
        <label className="card brief" htmlFor="new-brief">
          <span className="eyebrow">Brief · one line</span>
          <input id="new-brief" value={brief} placeholder="e.g. a post for Friday's Season Zero night" onChange={e => setBrief(e.target.value)} />
        </label>
        {freeCount > 0 ? (
          <div className="card notyet">
            <b>{freeCount} free agent{freeCount === 1 ? '' : 's'} ready</b>
            <span className="muted small">The task goes to a standing agent slot on the Mac as a message. No new window opens. It runs on your Claude plan and asks you before anything risky.</span>
          </div>
        ) : (
          <div className="card notyet">
            <b>No free agent. Open one at the Mac.</b>
            <span className="muted small">Queue it and it goes to the first agent that frees up{queued ? ` (${queued} already waiting)` : ''}, or open agent slots while you're at the Mac.</span>
            <button className="pillbtn ghost" onClick={onOpenSlots}>Open the missing slots at the Mac</button>
          </div>
        )}
        {err && <p className="err small">{err}</p>}
        <div className="quick">
          {freeCount > 0
            ? <button className="primary grow" disabled={!brief.trim() || busy} onClick={give}>{busy ? 'Handing it over…' : 'Give to a free agent'}</button>
            : <button className="primary grow" disabled={!brief.trim()} onClick={() => onQueue(skill.name, brief.trim())}>Queue it</button>}
        </div>
      </section>
    )
  }

  return (
    <section className="panel">
      <header className="panelhead">
        <span><span className="eyebrow">New task · pick a skill</span><h2>Your skills</h2></span>
        <button className="pillbtn ghost" onClick={reload}>Refresh</button>
      </header>
      <p className="muted small">
        {data ? <>{data.skills.length} installed in Claude Code on the Mac, read from <span className="mono">{data.from}</span>. Tasks only start from these. {freeCount} free agent{freeCount === 1 ? '' : 's'}.</> : error ?? 'Reading your skills…'}
      </p>
      <input id="skill-search" className="search" type="search" placeholder="Search skills" value={q} onChange={e => setQ(e.target.value)} />
      {groups.map(([g, ls]) => (
        <div key={g} className="skillgroup">
          <div className="sectionhead"><span className="mono">{g.toUpperCase()}</span><span className="mono muted small">{ls.length}</span></div>
          <div className="skillrows">
            {ls.map(sk => (
              <button key={sk.name} className="skill" data-tile onClick={() => setSkill(sk)}>
                <span className="sk-main"><b className="mono">{sk.name}</b><span className="desc">{sk.description}</span></span>
                <span className="pillbtn">Pick</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}
