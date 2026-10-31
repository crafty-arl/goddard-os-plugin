// One clear progress bar for every task (Carl, 2026-10-28: "a clear progress bar for all task"). A dog can't know how
// many steps a job will take, so there's no made-up percent: five named stages, the one it's on lit, how long it's been,
// and its latest real step.
import type { Task, Thread } from './door'

export const STAGES = ['Asked', 'Picked up', 'Working', 'Your turn', 'Done'] as const

export function stageOf(t: Task | undefined, th: Thread | undefined): number {
  if (!t) return -1
  if (t.status === 'done') return 4
  if (t.status === 'queued') return 0
  if (t.status === 'lost') return -2
  if (th?.needsYou) return 3
  if (th?.busy) return 2
  // not working and not asking: if it has said something since the job began, it's your turn; else it's just starting
  if (th && th.last.at > t.at) return 3
  return 1
}

const ago = (ms: number) => { const m = Math.max(0, Math.round(ms / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min` }

export function Progress({ task, thread, compact }: { task: Task; thread?: Thread; compact?: boolean }) {
  const at = stageOf(task, thread)
  if (at === -2) return <div className="prog lost"><span className="prog-note">Lost: its window closed before it finished</span></div>
  const note = at === 4 ? `done${task.doneAt ? ` · took ${ago(task.doneAt - task.at)}` : ''}`
    : at === 3 ? (thread?.needsYou ? 'waiting on you' : 'back with it · your move')
    : at === 2 ? `${ago(Date.now() - task.at)} · ${thread?.doing || 'working'}`
    : at === 1 ? 'picked up, starting'
    : (task as Task & { want?: number }).want ? 'its dog is picking it up' : 'waiting for a free dog'
  return (
    <div className={'prog' + (compact ? ' compact' : '')} role="progressbar" aria-valuemin={1} aria-valuemax={5} aria-valuenow={at + 1} aria-valuetext={`${STAGES[at]}: ${note}`}>
      <div className="prog-bars">{STAGES.map((s, i) => <span key={s} className={i < at ? 'done' : i === at ? (at === 3 ? 'now hot' : at === 4 ? 'done' : 'now') : ''} />)}</div>
      {!compact && <div className="prog-names">{STAGES.map((s, i) => <span key={s} className={i === at ? 'on' : ''}>{s}</span>)}</div>}
      <span className="prog-note">{note}</span>
      {!compact && <PlanList task={task} thread={thread} at={at} />}
    </div>
  )
}

// the dog's own plan for this job, posted before it took a step: ✓ done, ▶ now, ○ still to come
function PlanList({ task, thread, at }: { task: Task; thread?: Thread; at: number }) {
  const plan = thread?.plan && thread.plan.at >= task.at ? thread.plan : null
  if (!plan) return at === 1 || at === 2 ? <span className="prog-plan-wait">Waiting for its plan…</span> : null
  const finished = plan.done || at === 4
  // Carl's rule: the dog waits for his Go on its plan before step 1
  if (plan.approved === false && !finished) return (
    <ol className="prog-plan" aria-label="Its plan, waiting for your go">
      {plan.steps.map((s, i) => <li key={i} className="todo"><span aria-hidden="true">○</span>{s}</li>)}
      <li className="wait"><span aria-hidden="true">?</span>Waiting for your Go</li>
    </ol>
  )
  return (
    <ol className="prog-plan" aria-label="Its plan">
      {plan.steps.map((s, i) => {
        const st = finished || i < plan.now ? 'done' : i === plan.now ? (at === 3 ? 'wait' : 'now') : 'todo'
        return <li key={i} className={st}><span aria-hidden="true">{st === 'done' ? '✓' : st === 'now' ? '▶' : st === 'wait' ? '?' : '○'}</span>{s}</li>
      })}
    </ol>
  )
}
