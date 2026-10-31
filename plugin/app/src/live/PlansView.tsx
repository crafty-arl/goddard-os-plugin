// Plans over time (Carl, 2026-10-28): each long-running plan Goddard saved once Carl said it looked right, as a thin
// progress bar, its dated milestones with today's step marked, and what Goddard remembers about it. Changing a plan
// goes through Goddard in plain words.
import { useEffect, useState } from 'react'

type Plan = { id: string; goal: string; by: string; owner: string; next: string; milestones: { date: string; what: string; done: boolean }[]; remember: string[]; status: string }

const day = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString([], { weekday: 'short', month: 'numeric', day: 'numeric' })

export function PlansView({ onBack, onAsk }: { onBack: () => void; onAsk: (text: string) => void }) {
  const [plans, setPlans] = useState<Plan[] | null>(null)
  useEffect(() => { fetch('/door/api/plans', { cache: 'no-store' }).then(r => r.json()).then(j => setPlans(j.plans ?? [])).catch(() => setPlans([])) }, [])
  const today = new Date().toISOString().slice(0, 10)
  return (
    <section className="plans" aria-label="Plans">
      <button className="calm-quiet left" onClick={onBack}>← Back</button>
      <header className="calm-head"><span className="calm-day">Plans</span><h1>What's moving over time</h1></header>
      {plans && !plans.length && <p className="calm-sub">No plans yet. Tell Goddard a goal and a "by when", like "the Standup weekly by December", and it will draft one for you to check.</p>}
      {(plans ?? []).filter(p => p.status !== 'done').map(p => {
        const done = p.milestones.filter(m => m.done).length, nextM = p.milestones.find(m => !m.done)
        return (
          <article key={p.id} className="plan">
            <h2>{p.goal}, by {day(p.by)}</h2>
            <span className="calm-from">{done} of {p.milestones.length} done{p.owner ? ` · ${p.owner} owns it` : ''}{p.status === 'paused' ? ' · paused' : ''}</span>
            <div className="plan-bar" role="img" aria-label={`${done} of ${p.milestones.length} milestones done`}>{p.milestones.map((m, i) => <span key={i} className={m.done ? 'on' : ''} />)}</div>
            <ol className="plan-ms">
              {p.milestones.map((m, i) => (
                <li key={i} className={m.done ? 'done' : m === nextM ? 'now' : ''}>
                  <span className="plan-date">{day(m.date)}</span>
                  <span><b>{m.what}</b>{m === nextM && p.next ? <span className="plan-next">Next step: {p.next}</span> : null}{!m.done && m.date < today ? <span className="plan-late">a little behind</span> : null}</span>
                </li>
              ))}
            </ol>
            {p.remember.length > 0 && <div className="plan-mem"><span className="calm-from">Remembered</span>{p.remember.map((r, i) => <span key={i}>{r}</span>)}</div>}
            <button className="calm-quiet" onClick={() => onAsk(`About the plan "${p.goal}": I want to change the dates.`)}>Change dates</button>
          </article>
        )
      })}
    </section>
  )
}
