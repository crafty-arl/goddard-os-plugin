// The calm home (Carl, 2026-10-28: "a calm, soft flow ... first step, then the next step"). Goddard speaks in one line,
// one card shows the single thing that needs Carl most, and everything else waits quietly as "N more". When he
// answers, the card settles with a small check and the next one takes its place. The order lives here in code:
// a permission first (a dog is blocked on it), then Goddard's own questions, then the dogs' asks, longest waiting
// first, then work that came back for review. "Later" hides an item until the time it names.
import { useEffect, useMemo, useState } from 'react'
import { type Thread, type Task, type Recipe, type SessionIdea, loadSessionIdeas, reopenSession, isSession, sessionTitle, modeLabel, useThread, sayTo, finishTask, startTask, loadRecipes, saveRecipe, dropRecipe, STEER } from './door'
import { decode, findOutputs, OutputStrip, PlanCards, type Output } from './outputs'
import type { ReactNode } from 'react'
import { dogName, isSlot } from './slots'
import { PlansView } from './PlansView'
import { grouped } from './talk'
import { SessionStart, SessionView, type Carry } from './Session'
import { Schedules } from './Schedules'
import { Setup } from './Setup'
import { SignIn } from './SignIn'
import { GoddardChat } from './Chat'

export interface Item { key: string; port: number; who: string; kind: 'needs' | 'back'; task?: Task; at: number }

const LATER = 'goddard.later'
const loadLater = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(LATER) || '{}') } catch { return {} } }
// "later": this evening if it's daytime, else tomorrow morning
const laterUntil = () => { const d = new Date(), h = d.getHours(); if (h < 17) d.setHours(19, 0, 0, 0); else { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0) } return d.getTime() }
const laterLabel = () => new Date().getHours() < 17 ? 'Later tonight' : 'Tomorrow'
// plain words: no file paths, no markdown marks, one line
const plain = (t: string) => decode(t).replace(/(?:~|\/Users|\/Volumes)\S+/g, '').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim()
const ago = (at: number) => { const m = Math.round((Date.now() - at) / 60000); return m < 60 ? `${Math.max(1, m)} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d` }
const cut = (t: string, n: number) => t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t

export function useQueue(threads: Thread[], tasks: Task[]) {
  const [later, setLater] = useState(loadLater)
  useEffect(() => { try { localStorage.setItem(LATER, JSON.stringify(later)) } catch { /* this visit only */ } }, [later])
  const items = useMemo(() => {
    const now = Date.now(), out: Item[] = []
    for (const t of threads) {
      const task = tasks.find(x => x.status === 'active' && x.port === t.port)
      const who = t.home ? 'Goddard' : isSession(t) ? sessionTitle(t) : dogName(t) ?? 'A dog'
      if (!t.home && !isSlot(t) && !isSession(t)) continue
      // a session asks inside its own screen; the home card only nudges toward it
      if (isSession(t)) { if (t.needsYou) out.push({ key: `s${t.port}:${t.last.at}`, port: t.port, who, kind: 'needs', at: t.last.at }); continue }
      // a dog's ask only counts while it holds a job (a plan left over from a dropped job isn't Carl's to answer)
      if (t.needsYou && (t.home || task)) out.push({ key: `n${t.port}:${t.last.at}`, port: t.port, who, kind: 'needs', task, at: t.last.at })
      else if (!t.home && task && !t.busy && t.last.text === 'Replied' && t.last.at > task.at) out.push({ key: `b${t.port}:${t.last.at}`, port: t.port, who, kind: 'back', task, at: t.last.at })
    }
    const rank = (i: Item) => (i.kind === 'needs' ? (i.who === 'Goddard' ? 0 : 1) : 2)
    return out.filter(i => !(later[i.key] > now)).sort((a, b) => rank(a) - rank(b) || a.at - b.at)
  }, [threads, tasks, later])
  return { items, putOff: (i: Item) => setLater(l => ({ ...l, [i.key]: laterUntil() })) }
}

// proof a job is done: what the dog made (a picture, a page, a file or a link), never just the words "it's done"
type Proof = { preview: (taskId: string) => ReactNode; onView: (o: Output) => void }

export function CalmHome({ threads, tasks, home, onPack, onHistory, onToast, refresh, preview, onView, onMap }: {
  threads: Thread[]; tasks: Task[]; home?: Thread; onPack?: () => void; onMap?: () => void; onHistory: () => void; onToast: (m: string) => void; refresh: () => void
} & Proof) {
  const { items, putOff } = useQueue(threads, tasks)
  const [settled, setSettled] = useState<string | null>(null)
  const [plans, setPlans] = useState(false)
  const [sess, setSess] = useState<'new' | number | null>(null)
  const [reopening, setReopening] = useState<string | null>(null)
  const reopen = (title: string) => {
    setReopening(title); onToast(`Opening ${title} back up…`)
    reopenSession(title).then(r => { refresh(); setSess(r.port) }).catch(e => onToast(`Couldn't reopen it: ${(e as Error).message}`)).finally(() => setReopening(null))
  }
  const [carry, setCarry] = useState<Carry | undefined>()
  const [sched, setSched] = useState(false)
  const [setup, setSetup] = useState(false)
  const [signin, setSignin] = useState(false)
  // a new install (no profile saved yet) opens on Setup; once it's saved, Home opens as usual
  const [call, setCall] = useState('boss') // what the dogs call the owner, from their profile
  const [rig, setRig] = useState(false) // the paper robot video rig (profile module "rig"): on adds its card under Start
  const [work, setWork] = useState<{ dir: string; trusted: boolean } | null>(null) // the folder the dogs work in, and whether Claude Code may start there
  const readProfile = (first = false) => fetch('/door/api/profile').then(r => r.json()).then(j => { if (first && j.exists === false) setSetup(true); if (j.profile?.owner?.call) setCall(j.profile.owner.call); if (j.exists) setWork(j.work ?? null); setRig(!!j.profile?.rig?.on) }, () => {})
  useEffect(() => { readProfile(true) }, [])
  const [chat, setChat] = useState(false)
  // Carl, 2026-10-29: "Start first". The session loop is the main thing; the rest waits behind More
  const [more, setMore] = useState(false)
  const [later, setLater] = useState(false) // the rest of Pick up, folded (the mock's "Later · N")
  // sessions worth hopping into, from real things only (what came next, what stopped short, new uploads, goal tasks)
  const [ideas, setIdeas] = useState<SessionIdea[]>([])
  useEffect(() => { loadSessionIdeas().then(setIdeas, () => {}) }, [threads.filter(isSession).length])
  const sessions = threads.filter(isSession)
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const reload = () => loadRecipes().then(setRecipes, () => {})
  useEffect(() => { reload() }, [])
  const [picked, setPicked] = useState<string | null>(null)
  const focus = items.find(i => i.key === picked) ?? items[0]
  const isDone = (t: Thread) => !!(t.board?.finished || (t.board && t.board.now >= t.board.phases.length))
  // a test run never shows on Home (the audit's "Overlap test A/B")
  const real = sessions.filter(t => !/\btest\b/i.test(sessionTitle(t)))
  const running = threads.filter(t => (isSession(t) ? real.includes(t) && (t.busy || !!t.auto) : t.busy && (t.home || isSlot(t))) && !t.needsYou)
  const pickup = real.filter(t => !t.needsYou && !running.includes(t) && !isDone(t))
  const finished = real.filter(isDone)
  // a session's own question, in one line, for its Needs you card
  // a grouped reply shows its one question here; anything else, its first words
  const askOf = (port: number) => { const t = threads.find(x => x.port === port); if (!t?.last.text || t.last.text === 'Replied') return ''; const g = grouped(t.last.text); return cut(plain(g?.ask || g?.lead || t.last.text), 140) }
  const top = focus
  const working = running.length
  const hour = new Date().getHours(), hello = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening'
  const line = top ? `${hello}, ${call}. One thing when you have a minute.`
    : working ? `${hello}, ${call}. Nothing needs you. ${working === 1 ? 'One thing is' : `${working} things are`} running.` : `${hello}, ${call}. All quiet.`
  const done = (who: string) => { setSettled(`${who} has it from here`); refresh(); setTimeout(() => setSettled(null), 6000) }

  const ask = (text: string) => { if (!home) return onToast('Goddard is waking up'); sayTo(home.port, text).then(() => { setPlans(false); onToast('Goddard has it') }, e => onToast((e as Error).message)) }
  if (sess === 'new') return <SessionStart key={carry?.brought ?? 'new'} carry={carry} onCancel={() => { setCarry(undefined); setSess(null) }} onToast={onToast} onStarted={p => { setCarry(undefined); refresh(); setSess(p) }} />
  if (typeof sess === 'number') return <SessionView port={sess} thread={threads.find(t => t.port === sess)} onBack={() => setSess(null)} onToast={onToast} onView={onView} onContinue={c => { setCarry(c); setSess('new') }} />
  if (chat) return <GoddardChat thread={home} onBack={() => setChat(false)} onToast={onToast} />
  if (sched) return <Schedules onBack={() => setSched(false)} />
  if (signin) return <SignIn onBack={() => setSignin(false)} onToast={onToast} />
  if (setup) return <Setup onBack={() => { setSetup(false); readProfile() }} onPack={onPack ? () => { setSetup(false); onPack() } : undefined} onToast={onToast} />
  if (plans) return <section className="calm"><PlansView onBack={() => setPlans(false)} onAsk={ask} /></section>

  return (
    <section className="calm" aria-label="Goddard">
      <header className="calm-head">
        <span className="calm-day">{new Date().toLocaleDateString([], { weekday: 'long' })} {hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}</span>
        <h1>{line}</h1>
      </header>
      {work && !work.trusted && <TrustStep dir={work.dir} onDone={() => readProfile()} />}
      <Evening onOpen={t => reopen(t)} onView={onView} />
      {settled && <div className="calm-done" role="status"><span aria-hidden="true">✓</span>{settled}</div>}
      {/* Home in three lists, always in this order (audit fix 1, 2026-10-30): what needs Carl, what's running, what he can pick up */}
      {/* grouped by what Carl does next (the focus mock, 2026-10-30): do now, running, pick up; an empty group says nothing */}
      {!items.length && !running.length && <p className="home-clear"><span aria-hidden="true">✓</span>Nothing needs you, and nothing is running.</p>}
      {items.length > 0 && <section className="home-list" aria-label="Do now">
        <span className="home-label do">Do now · {items.length}</span>
        {focus && (focus.key.startsWith('s') ? (
          <article className="calm-card">
            <span className="calm-from">Session · {focus.who}</span>
            <p className="calm-line">{askOf(focus.port) || 'Your session is waiting on you.'}</p>
            <div className="calm-btns"><button className="go" onClick={() => setSess(focus.port)}>Open it</button><button onClick={() => putOff(focus)}>{laterLabel()}</button></div>
          </article>
        ) : <><Card key={focus.key} item={focus} thread={threads.find(t => t.port === focus.port)} onDone={done} onLater={() => putOff(focus)} onToast={onToast} preview={preview} onView={onView} />
          {focus.port && <button className="calm-quiet home-open" onClick={() => setSess(focus.port!)}>Open {focus.who}'s chat ›</button>}</>)}
        {items.filter(i => i !== focus).map(i => (
          <button key={i.key} className="home-row" onClick={() => setPicked(i.key)}>
            <i className="home-dot need" aria-hidden="true" /><b>{i.who}</b><span className="muted">waiting {ago(i.at)}</span>
          </button>
        ))}
      </section>}
      {running.length > 0 && <section className="home-list" aria-label="Running">
        <span className="home-label">Running · {running.length} · nothing to do</span>
        {running.map(t => (
          <button key={t.port} className="home-row" onClick={() => t.home ? setChat(true) : setSess(t.port)}>
            <i className="home-dot live" aria-hidden="true" /><b>{isSession(t) ? sessionTitle(t) : t.home ? 'Goddard' : dogName(t) ?? 'A dog'}</b>
            <span className="muted">{t.auto ? `Auto · ${Math.max(0, Math.round((t.auto.until - Date.now()) / 60000))} min left` : cut(plain(t.doing || 'working'), 40)}</span>
          </button>
        ))}
      </section>}
      {/* the dogs by name, words only (no pack, no pictures): a tap opens that dog's chat */}
      {threads.some(t => isSlot(t) && !running.includes(t) && !items.some(i => i.port === t.port)) && <nav className="home-dogs" aria-label="Your dogs">
        <span className="home-label">Dogs</span>
        <div>{threads.filter(t => isSlot(t) && !running.includes(t) && !items.some(i => i.port === t.port)).map(t => (
          <button key={t.port} onClick={() => setSess(t.port)}>{dogName(t) ?? 'A dog'}</button>
        ))}</div>
      </nav>}
      <section className="home-list calm-sessions" aria-label="Pick up">
        <span className="home-label">Pick up</span>
        {/* half-done work first, then what comes next after finished work */}
        {pickup.map(t => (
          <button key={t.port} className="home-row" onClick={() => setSess(t.port)}>
            <i className="home-dot" aria-hidden="true" /><b>{sessionTitle(t)}</b>
            <span className="muted">{(t.sessionMode ?? 'plan') !== 'plan' ? `${modeLabel(t.sessionMode)}${t.busy ? ' · working' : ''}` : t.board ? `phase ${t.board.now + 1} of ${t.board.phases.length}` : 'no plan yet'}</span>
          </button>
        ))}
        {(() => {
          // test runs and one-word starts ("Hi") aren't work to pick up
          const real = ideas.filter(i => !/\btest\b/i.test(i.title) && i.title.replace(/^(Next for|Finish) /, '').trim().length > 3)
            .sort((a, b) => Number(b.from === 'unfinished') - Number(a.from === 'unfinished'))
          const room = Math.max(0, 2 - pickup.length), shown = later ? real : real.slice(0, room), rest = real.length - room
          return <>
            {shown.map(i => (
              <button key={i.from + i.title} className="calm-idea" disabled={reopening === i.reopen && !!i.reopen} onClick={() => i.reopen ? reopen(i.reopen) : (setCarry({ brought: i.brought, want: i.want, title: i.title.replace(/^(Next for|Finish) /, '').slice(0, 26) }), setSess('new'))}>
                <span className={'calm-idea-kind ' + i.from}>{i.from === 'unfinished' ? 'Unfinished' : i.from === 'carry-on' ? 'Next step' : i.from === 'upload' ? 'You added this' : 'From your goals'}</span>
                <b>{i.title.replace(/^(Next for|Finish) /, '')}</b><span>{i.why}</span>
              </button>
            ))}
            {rest > 0 && !later && <button className="home-later" onClick={() => setLater(true)}>Later · {rest} more <span aria-hidden="true">▸</span></button>}
          </>
        })()}
        <button className="calm-start" onClick={() => { setCarry(undefined); setSess('new') }}><b>Start a session <span aria-hidden="true">＋</span></b><span>Bring anything. Plan it, just talk, or just do it.</span></button>
        {/* the paper robot video add-on: a Plan-it session that brings the paper-robot skill; Carl adds who's in it and the bit */}
        {rig && <button className="calm-start robot" onClick={() => { setCarry({ brought: 'Make a paper robot video with my Standup rig. Use the paper-robot skill (goddard-os:paper-robot in the plugin): spec card, live preview, export on my OK.', want: "Who's in it and what happens: ", title: 'Robot video' }); setSess('new') }}><b>Make a paper robot video <em>NEW</em></b><span>Pick your robots, say the bit. A dog builds the sketch.</span></button>}
      </section>
      <button className="calm-quiet calm-morebtn" aria-expanded={more} onClick={() => setMore(m => !m)}>{more ? 'Less' : 'More'}</button>
      {more && <div className="calm-extra">
      {recipes.length > 0 && (
        <section className="calm-recipes" aria-label="Your recipes">
          <span className="calm-from">Your recipes · one tap runs it again</span>
          <div>{recipes.map(r => (
            <span key={r.id} className="calm-recipe">
              <button onClick={() => startTask(r.skill, r.brief).then(() => { onToast(`Started "${r.title}". Its dog will show you the plan first.`); refresh() }, e => onToast((e as Error).message))}>{r.title}</button>
              <button className="x" aria-label={`Remove ${r.title}`} onClick={() => confirm(`Remove the "${r.title}" recipe?`) && dropRecipe(r.id).then(reload)}>✕</button>
            </span>
          ))}</div>
        </section>
      )}
      {finished.length > 0 && <section className="home-list" aria-label="Finished sessions">
        <span className="calm-from">Finished sessions · {finished.length}</span>
        {finished.map(t => <button key={t.port} className="home-row" onClick={() => setSess(t.port)}><span aria-hidden="true">✓</span><b>{sessionTitle(t)}</b></button>)}
      </section>}
      <DoneToday tasks={tasks} threads={threads} preview={preview} onView={onView} onSaved={t => { reload(); onToast(`Saved "${t}". It's under More.`) }} />
      <nav className="calm-links" aria-label="More">
        {onPack && <button onClick={onPack}>The pack</button>}<button onClick={() => setPlans(true)}>Plans</button><button onClick={() => setSched(true)}>Schedules</button><button onClick={onHistory}>History</button><button onClick={() => setSetup(true)}>Setup</button><button onClick={() => setSignin(true)}>Sign-in</button>{onMap && <button onClick={onMap}>{onPack ? 'Sessions only' : 'Show the map and the pack'}</button>}
      </nav>
      </div>}
      <button className="calm-say calm-chatbtn" onClick={() => setChat(true)} aria-label="Chat with Goddard">
        <span>{home ? 'Chat with Goddard…' : 'Goddard is waking up…'}</span><i aria-hidden="true">↑</i>
      </button>
    </section>
  )
}

// the one card: a permission, a plan waiting for Go, a question, or work back for review
function Card({ item, thread, onDone, onLater, onToast, preview, onView }: { item: Item; thread?: Thread; onDone: (who: string) => void; onLater: () => void; onToast: (m: string) => void } & Proof) {
  const live = useThread(item.port)
  const last = [...live.msgs].reverse().find(m => m.from === 'assistant')
  const lines = last ? decode(last.text).split('\n').map(l => l.trim()).filter(Boolean) : []
  const question = [...lines].reverse().find(l => l.endsWith('?'))
  const perm = live.asks[0]
  const answer = (text: string) => { if (live.say(text)) onDone(item.who); else sayTo(item.port, text).then(() => onDone(item.who), (e: Error) => onToast(e.message)) }
  // the job's name: the first sentence of its brief, short, after any "Use the x skill:" lead-in
  const job = item.task ? cut(plain(item.task.brief.replace(/^.*?skill:\s*/i, '')).split(/(?<=[.!?])\s/)[0].replace(/[.!?]$/, ''), 48) : ''
  const from = item.who + (job ? ` · ${job}` : '')

  if (perm) return (
    <article className="calm-card">
      <span className="calm-from">{item.who} · needs your OK to go on</span>
      <p className="calm-line">{cut(plain(perm.description), 120)}</p>
      {perm.input_preview && <p className="calm-sub mono">{cut(plain(perm.input_preview), 140)}</p>}
      <div className="calm-btns">
        <button className="go" onClick={() => { live.verdict(perm.request_id, 'allow'); onDone(item.who) }}>Allow</button>
        <button onClick={() => { live.verdict(perm.request_id, 'deny'); onDone(item.who) }}>No</button>
      </div>
    </article>
  )

  const plan = thread?.plan
  if (plan && plan.approved === false) return (
    <article className="calm-card">
      <span className="calm-from">{from}</span>
      <p className="calm-line">{item.who} has a plan. It starts when you say go.</p>
      <details className="calm-steps"><summary>{plan.steps.length} steps · see them</summary><ol>{plan.steps.map((s, i) => <li key={i}>{s}</li>)}</ol></details>
      <div className="calm-btns">
        <button className="go" onClick={() => answer('Go')}>Go</button>
        <button onClick={onLater}>{laterLabel()}</button>
      </div>
      <button className="calm-quiet" onClick={() => answer('Change the plan')}>Change the plan</button>
    </article>
  )

  if (item.kind === 'back') return (
    <article className="calm-card">
      <span className="calm-from">{from}</span>
      <p className="calm-line">{item.who} is back with it.</p>
      {lines[0] && <p className="calm-sub">{cut(plain(lines[0]), 160)}</p>}
      <Shown texts={live.msgs.filter(m => m.from === 'assistant' && m.ts >= (item.task?.at ?? 0)).map(m => m.text)} taskId={item.task?.id} answer={last?.text} preview={preview} onView={onView} />
      <div className="calm-btns">
        <button className="go" onClick={() => { answer(STEER.approve); if (item.task) finishTask(item.task.id).catch(() => {}) }}>Looks good</button>
        <button onClick={onLater}>{laterLabel()}</button>
      </div>
      <button className="calm-quiet" onClick={() => answer(STEER.redo)}>Redo it</button>
    </article>
  )

  const choices = last?.choices ?? []
  const context = lines.find(l => l !== question && !/^[-·•\d]/.test(l))
  return (
    <article className="calm-card">
      <span className="calm-from">{from}</span>
      {context && <p className="calm-line">{cut(plain(context), 150)}</p>}
      {question && <p className="calm-sub">{cut(plain(question), 140)}</p>}
      {!context && !question && <p className="calm-line">{item.who} is waiting on you.</p>}
      <div className="calm-btns">
        {choices.length
          ? choices.slice(0, 2).map((c, n) => <button key={c} className={n === 0 ? 'go' : ''} onClick={() => answer(c)}>{cut(c, 26)}</button>)
          : <button className="go" onClick={() => (document.getElementById('calm-answer') as HTMLInputElement | null)?.focus()}>Answer</button>}
        {choices.length < 2 && <button onClick={onLater}>{laterLabel()}</button>}
      </div>
      {choices.length >= 2 && <button className="calm-quiet" onClick={onLater}>{laterLabel()}</button>}
      <form className="calm-reply" onSubmit={e => { e.preventDefault(); const f = e.currentTarget.elements.namedItem('a') as HTMLInputElement; if (f.value.trim()) { answer(f.value.trim()); f.value = '' } }}>
        <label htmlFor="calm-answer" className="sr">Answer {item.who}</label>
        <input id="calm-answer" name="a" placeholder={`Or tell ${item.who}…`} />
      </form>
    </article>
  )
}

// what came back, shown: the live piece itself when the Library has it, the files and links it named, and the
// dog's own words folded underneath. With no file or link it says so plainly, so "done" is never just a claim.
function Shown({ texts, taskId, answer, preview, onView }: { texts: string[]; taskId?: string; answer?: string } & Proof) {
  const outs = findOutputs(texts), big = taskId ? preview(taskId) : null
  return (
    <div className="calm-proof">
      {big}
      <PlanCards outputs={outs} folded={!!big} />
      <OutputStrip outputs={outs} onOpen={onView} />
      {!big && !outs.length && <p className="calm-sub calm-nofile">No file or link came back, only its answer.</p>}
      {answer && <details className="calm-steps"><summary>Read what it said</summary><p className="rich">{decode(answer)}</p></details>}
    </div>
  )
}

// today's finished jobs, each with its proof one tap away
function DoneToday({ tasks, threads, preview, onView, onSaved }: { tasks: Task[]; threads: Thread[]; onSaved: (title: string) => void } & Proof) {
  const start = new Date().setHours(0, 0, 0, 0)
  const done = tasks.filter(t => t.status === 'done' && (t.doneAt ?? t.at) >= start).sort((a, b) => (b.doneAt ?? b.at) - (a.doneAt ?? a.at))
  if (!done.length) return null
  const who = (t: Task) => { const th = threads.find(x => x.port === t.port); return th ? (th.home ? 'Goddard' : dogName(th) ?? 'A dog') : t.skill.replace(/^gm-/, '') }
  return (
    <section className="calm-donelist" aria-label="Done today">
      <span className="calm-from">Done today · {done.length}</span>
      {done.map(t => (
        <details key={t.id} className="calm-doneitem">
          <summary><span aria-hidden="true">✓</span> {who(t)} · {jobName(t)}</summary>
          <Shown texts={[t.result ?? '']} taskId={t.id} answer={t.result} preview={preview} onView={onView} />
          <SaveRecipe task={t} name={jobName(t)} onSaved={onSaved} />
        </details>
      ))}
    </section>
  )
}

// the job's name: its first real sentence (a one- or two-word lead like "Read-only." is a rule, not the job)
const jobName = (t: Task) => { const ss = plain(t.brief.replace(/^.*?skill:\s*/i, '')).split(/(?<=[.!?])\s/); return cut((ss.find(x => x.split(' ').length > 2) ?? ss[0]).replace(/[.!?]$/, ''), 40) }

// "Save as a recipe": the same job (same dog, same brief) under a name Carl picks, as a button on the home screen
function SaveRecipe({ task, name, onSaved }: { task: Task; name: string; onSaved: (title: string) => void }) {
  const [open, setOpen] = useState(false), [title, setTitle] = useState(name), [busy, setBusy] = useState(false)
  if (!open) return <button className="calm-quiet calm-save" onClick={() => setOpen(true)}>Save as a recipe</button>
  return (
    <form className="calm-reply calm-saveform" onSubmit={e => {
      e.preventDefault(); if (!title.trim() || busy) return; setBusy(true)
      saveRecipe(title.trim(), task.skill, task.brief).then(() => { setOpen(false); onSaved(title.trim()) }, () => setBusy(false))
    }}>
      <label htmlFor={`r-${task.id}`} className="calm-from">Name it</label>
      <input id={`r-${task.id}`} value={title} onChange={e => setTitle(e.target.value)} maxLength={40} autoFocus />
      <div className="calm-btns"><button className="go" type="submit" disabled={busy || !title.trim()}>Save</button><button type="button" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  )
}

// The evening card (Carl, 2026-10-30): from 6 PM to midnight, the day in one card: what got done (each with what it
// made), what needs him, and one next step. "Got it" puts it away until tomorrow evening.
type Digest = { hour: number; done: { who: string; what: string; proof?: string }[]; needs: string[]; lost: number; next: { title: string; why: string } | null }
const EVENING = 'goddard.evening'
function Evening({ onOpen, onView }: { onOpen: (title: string) => void } & Pick<Proof, 'onView'>) {
  const [d, setD] = useState<Digest | null>(null)
  const day = new Date().toDateString()
  const [gone, setGone] = useState(() => { try { return localStorage.getItem(EVENING) === day } catch { return false } })
  useEffect(() => { if (!gone) fetch('/door/api/digest').then(r => r.json()).then(setD, () => {}) }, [gone])
  if (gone || !d || new Date().getHours() < d.hour || (!d.done.length && !d.needs.length && !d.next)) return null
  const put = () => { try { localStorage.setItem(EVENING, day) } catch { /* this visit only */ } setGone(true) }
  const open = (p: string) => /^https?:/.test(p) ? window.open(p, '_blank', 'noopener') : onView({ kind: 'file', path: p, type: (p.split('.').pop() ?? 'md') as never, name: p.split('/').pop()! } as Output)
  return (
    <article className="calm-card evening" aria-label="Your day">
      <span className="calm-from">Your day · {d.done.length} done{d.needs.length ? ` · ${d.needs.length} need${d.needs.length === 1 ? 's' : ''} you` : ''}</span>
      {d.done.length > 0 ? <ul className="evening-done">{d.done.map((x, i) => (
        <li key={i}><span aria-hidden="true">✓</span><span><b>{x.who}</b> · {x.what}</span>{x.proof && <button className="calm-quiet" onClick={() => open(x.proof!)}>See it</button>}</li>
      ))}</ul> : <p className="calm-sub">Nothing finished today.</p>}
      {d.lost > 0 && <p className="calm-sub">{d.lost} job{d.lost === 1 ? '' : 's'} got lost today.</p>}
      {d.needs.length > 0 && <p className="calm-line">Waiting on you: {d.needs.join(', ')}.</p>}
      {d.next && <p className="calm-sub">Next: {d.next.title} ({d.next.why})</p>}
      <div className="calm-btns">{d.next && <button className="go" onClick={() => onOpen(d.next!.title)}>Pick it up</button>}<button onClick={put}>Got it</button></div>
    </article>
  )
}

// the one step only the owner can take: telling Claude Code it may work in this folder (a new install's first run)
function TrustStep({ dir, onDone }: { dir: string; onDone: () => void }) {
  return (
    <article className="calm-card trust-step" aria-label="One step before your dogs can start">
      <span className="calm-from">One step before your dogs can start</span>
      <p className="calm-line">Claude Code needs your OK to work in {dir}. On this Mac, open Terminal and run:</p>
      <pre className="trust-cmd">cd {dir} && claude</pre>
      <p className="calm-sub">Choose <b>Yes, I trust this folder</b>, then type <b>/exit</b>. Goddard starts within two minutes.</p>
      <div className="calm-btns"><button className="go" onClick={onDone}>I did it</button></div>
    </article>
  )
}
