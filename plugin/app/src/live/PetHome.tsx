// Pocket pet (Carl, 2026-10-28: "I like the pocket pet ... build it"). On the phone, home is one dog at a time, big in a
// framed screen in front of the building it's at, with what it's doing, one recipe card and a few big buttons. Swipe
// sideways for the next dog; "The pack" shows them all; the neighborhood opens the full town.
import { useRef, useState } from 'react'
import { Attach, Voice, grow } from './dock'
import { Progress } from './Progress'
import { type Thread, type Task, useThread, STEER, draftRole } from './door'
import { decode, findOutputs, OutputStrip, type Output } from './outputs'
import { linkify } from './ChatPanel'
import { CheckIns, OwnsEditor } from './checkins'
import type { ReactNode } from 'react'
import { PLACES, type Place } from '../town/town'

export type PetState = 'needs' | 'back' | 'cooking' | 'ready' | 'resting'
export interface Pet {
  key: string; name: string; skill?: string; color: string
  task?: Task; thread?: Thread; state: PetState; jobsToday: number
  helping?: string // a dog Carl named that is cooking for Scribbles, Fetch or Bloodhound right now
  recipe?: { title: string; makes: string; needs: string; takes: string; brief: string; skill: string }
}

// the dogs Carl named, each with the recipe it cooks when nothing more urgent is on (real skills, no invented facts)
export const NAMED: { name: string; skill: string; color: string; recipe: Pet['recipe'] }[] = [
  { name: 'Scribbles', skill: 'gm-scribbles', color: '#9CC46B', recipe: { title: 'Daily copy', makes: 'drafts for the next 3 days', needs: 'nothing', takes: '~10 min · 0 credits', skill: 'gm-scribbles', brief: 'Daily run, 3 days ahead. Drafts only, never schedule. Report after each phase.' } },
  { name: 'Fetch', skill: 'gm-fetch', color: '#7FB2E5', recipe: { title: 'Plan a campaign', makes: 'one campaign card', needs: 'your Approve', takes: '~5 min · 0 credits', skill: 'gm-fetch', brief: 'Pick one campaign from Carl\'s goals (nearest real date first), build the card, and ask him Approve / Edit / Skip.' } },
  { name: 'Bloodhound', skill: 'gm-bloodhound', color: '#E58F6B', recipe: { title: 'Next Standup', makes: 'one episode + a test', needs: 'your bits, and an OK before any spend', takes: 'asks the cost first', skill: 'gm-bloodhound', brief: 'Make the next Standup episode from Carl\'s own bits. Before anything that costs credits, give the count and cost and wait.' } },
]

const MOOD: Record<PetState, string> = { needs: 'waiting on you', back: 'proud', cooking: 'focused', ready: 'eager', resting: 'napping' }
const SPRITE: Record<PetState, string> = { needs: 'sit', back: 'carry', cooking: 'walk2', ready: 'sit', resting: 'sleep' }

// where in the painting a place sits (the straight-on plate), so the frame shows that building behind the dog
function backdrop(p: Place) {
  const b = PLACES[p], x = 450 + (b.i - b.j) * 30, y = 70 + (b.i + b.j) * 15 - b.h * 0.4
  const fx = (x - 57) / 1229, fy = (y + 108.5) / 686
  return { backgroundImage: 'url(/town/town-plate.jpg)', backgroundSize: '520% auto', backgroundPosition: `${(fx * 100).toFixed(1)}% ${(fy * 100).toFixed(1)}%` }
}

export function PetHome({ pets, onAddDog, onRemove, onView, preview, onCook, onTalk, onSay, onGoodDog, onOther, onExplore, onChat, onLibrary, onHistory, onError }: {
  pets: Pet[]; numberOf: (port: number) => string; onAddDog: (name: string, role: string, job: string) => void; onRemove: (p: Pet) => void;
  onView: (o: Output) => void; preview: (taskId: string) => ReactNode; onChat: () => void; onLibrary: () => void; onHistory: () => void; onError: (m: string) => void
  onCook: (skill: string, brief: string, port?: number) => void; onTalk: (p: Pet) => void; onSay: (port: number, text: string) => void
  onGoodDog: (p: Pet) => void; onOther: () => void; onExplore: () => void
}) {
  const [idx, setIdx] = useState(0)
  const [pack, setPack] = useState(false)
  const [draft, setDraft] = useState('')
  const [naming, setNaming] = useState(false) // adding a dog: its name, job and role
  const swipe = useRef<number | null>(null)
  const pet = pets[Math.min(idx, pets.length - 1)]
  const live = useThread(pet?.thread?.port ?? null)
  if (!pet) return null
  const go = (d: number) => setIdx(i => (i + d + pets.length) % pets.length)

  if (pack) return (
    <section className="pet pack" aria-label="The pack">
      <header className="pet-top"><b className="pet-title">The pack</b><button className="pet-link" onClick={() => setPack(false)}>Back to {pet.name}</button></header>
      {/* the main chat: Goddard knows every dog's job and hands work to the right one */}
      <button className="pack-goddard" onClick={onChat}>
        <span className="pack-goddard-dot" aria-hidden="true">G</span>
        <span><b>Talk to Goddard</b><span className="small muted">The main chat. Say what you need; Goddard picks the dog.</span></span>
      </button>
      <CheckIns onToast={onError} />
      <OwnsEditor onToast={onError} />
      <div className="pack-grid">
        {pets.map((p, n) => (
          <div key={p.key} className="pack-cell">
            <button className={'pack-tile' + (p.state === 'needs' ? ' hot' : '')} onClick={() => { setIdx(n); setPack(false) }}>
              <img src={`/town/dog/${SPRITE[p.state]}.png`} alt="" />
              <b>{p.name}</b>
              <span className="mono small" style={{ color: p.state === 'needs' ? 'var(--gold)' : 'var(--mute)' }}>{label(p)}</span>
              {p.task && p.task.status !== 'lost' && <Progress task={p.task} thread={p.thread} compact />}
            </button>
            {/* only working dogs can go; Scribbles, Fetch and Bloodhound are recipes, not sessions */}
            {!p.skill && p.thread && <button className="pack-x" aria-label={`Remove ${p.name}`} onClick={() => {
              if (confirm(`Remove ${p.name}?${p.task || p.helping ? ' Its job goes back in line.' : ''}`)) { setIdx(0); onRemove(p) }
            }}>✕</button>}
          </div>
        ))}
        {!naming && <button className="pack-tile add" onClick={() => setNaming(true)}><span className="plusring">+</span><b>Add a dog</b><span className="mono small muted">you name it and give it a job</span></button>}
      </div>
      {naming && <NewDog onWake={(n, r, j) => { onAddDog(n, r, j); setNaming(false) }} onCancel={() => setNaming(false)} />}
      <button className="pack-town" onClick={onExplore} style={backdrop('bus')}><span>The neighborhood · tap to explore</span></button>
      {/* everything else lives here, one tap away, so the dog's screen can stay just the dog */}
      <nav className="pack-hub" aria-label="More">
        <button onClick={onHistory}>History</button><button onClick={onLibrary}>Library</button><button onClick={onOther}>Skills</button>
      </nav>
    </section>
  )

  const last = [...live.msgs].reverse().find(m => m.from === 'assistant')
  const said = last ? decode(last.text).split('\n').map(l => l.trim()).filter(Boolean) : []
  const question = [...said].reverse().find(l => l.endsWith('?'))
  const choices = last?.choices ?? []
  const since = pet.task?.at ?? 0
  const outs = findOutputs(live.msgs.filter(m => m.from === 'assistant' && m.ts >= since).map(m => m.text))
  // a finished job keeps its result on the board; a job still open shows the dog's latest answer
  const dishText = pet.task?.status === 'done' ? pet.task.result ?? '' : (pet.state === 'back' || pet.state === 'needs') && said.length > 1 ? last?.text ?? '' : ''
  const dishOuts = pet.task?.status === 'done' ? findOutputs([pet.task.result ?? '']) : outs
  const bubble = pet.helping ? `Helping ${pet.helping}.` : pet.state === 'ready' ? (pet.recipe ? `Want me to cook "${pet.recipe.title}"?` : 'Ready when you are. Text me a job.')
    : pet.state === 'resting' ? 'Resting.' : pet.state === 'cooking' ? (/^(Running|Using|Reading|Writing|Searching)\b|[~/]/.test(pet.thread?.doing ?? '') || !pet.thread?.doing ? 'Working on it.' : pet.thread.doing) : (question ?? said[0] ?? 'Back with it.')

  // the two piles, like a dot's: things to decide and things to review, across every dog
  const decide = pets.filter(p => p.state === 'needs'), review = pets.filter(p => p.state === 'back')
  const jump = (p: Pet) => setIdx(pets.indexOf(p))

  return (
    <section className={'pet' + (pet.state === 'needs' ? ' hot' : '')} aria-label={`${pet.name}, ${MOOD[pet.state]}`}
      onPointerDown={e => { swipe.current = e.clientX }}
      onPointerUp={e => { const s = swipe.current; swipe.current = null; if (s !== null && Math.abs(e.clientX - s) > 60 && pets.length > 1) go(e.clientX < s ? 1 : -1) }}>

      {(decide.length > 0 || review.length > 0) && (
        <div className="foryou" aria-label="For you">
          {decide.length > 0 && <button className="hot" onClick={() => jump(decide.find(p => p !== pet) ?? decide[0])}>Decide · {decide.length}<span>{decide.map(p => p.name).join(', ')}</span></button>}
          {review.length > 0 && <button onClick={() => jump(review.find(p => p !== pet) ?? review[0])}>Review · {review.length}<span>{review.map(p => p.name).join(', ')}</span></button>}
        </div>
      )}
      {/* no window into the dog (Carl, 2026-10-28): its name and one plain line about what it's doing */}
      <header className="pet-head">
        <h1>{pet.name}</h1>
        <p>{bubble}</p>
      </header>

      <div className="pet-under">
        <span className="pet-mood">{pet.name} · {MOOD[pet.state]}{pet.jobsToday ? ` · ${pet.jobsToday} done today` : ''}</span>
        <div className="pet-dots" role="tablist" aria-label="Dogs">
          {pets.map((p, n) => <button key={p.key} role="tab" aria-selected={n === idx} aria-label={p.name} className={n === idx ? 'on' : p.state === 'needs' ? 'hot' : ''} style={n === idx ? { background: p.color } : undefined} onClick={() => setIdx(n)} />)}
          <button className="pet-packbtn" onClick={() => setPack(true)} aria-label="The pack and more">⋯</button>
        </div>
      </div>

      {pet.state === 'ready' && pet.recipe && (
        <div className="pet-card">
          <span className="eyebrow">Recipe · ready</span>
          <b className="pet-card-title">{pet.recipe.title}</b>
          <span className="small muted">Makes {pet.recipe.makes} · needs {pet.recipe.needs} · {pet.recipe.takes}</span>
        </div>
      )}
      {(pet.state === 'needs' || pet.state === 'back' || pet.state === 'cooking') && pet.task && (
        <div className={'pet-card' + (pet.state === 'needs' ? ' hot' : '')}>
          <span className="pet-card-from">{pet.state === 'needs' ? 'Waiting on you' : pet.state === 'back' ? 'Back with it' : 'Working'}</span>
          <b className="pet-card-title">{question && pet.state !== 'cooking' ? question : jobName(pet.task.brief)}</b>
          <Progress task={pet.task} thread={pet.thread} />
        </div>
      )}

      {/* what the dog made (Carl, 2026-10-28: "there is no place to see the output"): its whole last answer, the files
          it named, and the live preview of what it saved */}
      {pet.task && dishText && (
        <details className="pet-dish" open={pet.state === 'back'}>
          <summary><b>{pet.task.status === 'done' ? `Last job: what ${pet.name} made` : `What ${pet.name} made`}</b><span className="mono small muted">{dishOuts.length ? `${dishOuts.length} file${dishOuts.length === 1 ? '' : 's'}` : 'its answer'}</span></summary>
          {preview(pet.task.id)}
          {dishOuts.length > 0 && <OutputStrip outputs={dishOuts} onOpen={onView} />}
          <p className="rich pet-dish-text">{linkify(decode(dishText))}</p>
        </details>
      )}

      <div className={'pet-actions' + (choices.some(c => c.length > 14) && (pet.state === 'needs' || pet.state === 'back') ? ' stack' : '')}>
        {pet.state === 'ready' && pet.recipe && <>
          <button className="primary" onClick={() => onCook(pet.recipe!.skill, pet.recipe!.brief)}>Cook it</button>
          <button onClick={() => onTalk(pet)}>Talk</button>
          <button onClick={onOther}>More recipes</button>
        </>}
        {pet.state === 'cooking' && pet.thread && <>
          <button className="primary" onClick={() => onTalk(pet)}>Talk</button>
          <button onClick={() => onSay(pet.thread!.port, STEER.pause)}>Pause</button>
        </>}
        {(pet.state === 'needs' || pet.state === 'back') && pet.thread && (choices.length
          ? <>{choices.slice(0, 2).map((c, n) => <button key={c} className={n === 0 ? 'primary' : ''} onClick={() => onSay(pet.thread!.port, c)}>{c}</button>)}<button onClick={() => onTalk(pet)}>Talk</button></>
          : question
          ? <><button className="primary" onClick={() => onTalk(pet)}>Answer</button></>
          : <><button className="primary good" onClick={() => onGoodDog(pet)}>Good dog</button><button onClick={() => onSay(pet.thread!.port, STEER.redo)}>Redo</button><button onClick={() => onTalk(pet)}>Talk</button></>)}
        {pet.state === 'resting' && <button className="primary" onClick={onOther}>Give a job</button>}
      </div>

      {/* text the dog: while it has a job, it reads this right away; when it's free, this becomes its next job */}
      <form className="pet-say" onSubmit={e => {
        e.preventDefault(); const t = draft.trim(); if (!t) return
        if (pet.thread && pet.task?.status === 'active') onSay(pet.thread.port, t)
        else if (pet.thread && !pet.skill) onCook('my-voice', t, pet.thread.port) // a dog Carl named: the job goes to that dog
        else onCook(pet.skill ?? pet.recipe?.skill ?? 'my-voice', t)
        setDraft(''); e.currentTarget.querySelector('textarea')!.style.height = ''
      }}>
        <Attach onAdd={l => setDraft(d => (d ? d + '\n' : '') + l)} onError={onError} />
        <Voice onAdd={l => setDraft(d => (d ? d + '\n' : '') + l)} onError={onError} />
        <textarea rows={1} value={draft} aria-label={`Message ${pet.name}`} placeholder={pet.task?.status === 'active' ? `Tell ${pet.name}…` : `Give ${pet.name} a job…`}
          onChange={e => { setDraft(e.target.value); grow(e.target) }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }} />
        <button type="submit" className="send" disabled={!draft.trim()} aria-label="Send">↑</button>
      </form>
    </section>
  )
}

function label(p: Pet) {
  return p.state === 'needs' ? 'NEEDS YOU' : p.state === 'back' ? 'back with it' : p.state === 'cooking' ? 'cooking' : p.helping ? `helping ${p.helping}` : p.state === 'ready' ? `ready${p.recipe ? ` · ${p.recipe.title}` : ''}` : 'napping'
}

// a job's name for people: a campaign plan becomes "<campaign> posts", other briefs lose file paths and get cut short
function jobName(brief: string) {
  const plan = brief.match(/campaigns\/\d{4}-\d{2}-\d{2}-([a-z0-9-]+)\/plan\.md/i)
  if (plan) { const n = plan[1].replace(/-/g, ' '); return n.charAt(0).toUpperCase() + n.slice(1) + ' posts' }
  const t = brief.replace(/(?:~|\/Users|\/Volumes)\S+/g, '').replace(/\s+/g, ' ').trim()
  return t.length > 70 ? t.slice(0, 68).replace(/\s+\S*$/, '') + '…' : t
}

// A new named dog, made whole (Carl, 2026-10-28: "do the whole thing give the dog a complete system instructions role"):
// Carl names it and says its job in a line, Goddard drafts its role, Carl reads and edits it, then wakes it. Nothing
// starts before he has seen the role.
export function NewDog({ onWake, onCancel, className = '' }: { onWake: (name: string, role: string, job: string) => void; onCancel: () => void; className?: string }) {
  const [name, setName] = useState(''), [job, setJob] = useState(''), [role, setRole] = useState<string | null>(null)
  const [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const draft = () => { setBusy(true); setErr(''); draftRole(name.trim(), job.trim()).then(setRole, e => setErr((e as Error).message)).finally(() => setBusy(false)) }
  return (
    <section className={'newdog ' + className} aria-label="Add a dog">
      <span className="eyebrow">New dog · {role === null ? 'step 1 of 2' : 'step 2 of 2 · read its role'}</span>
      {role === null ? <>
        <label>Name<input autoFocus value={name} maxLength={24} placeholder="What you call it" onChange={e => setName(e.target.value)} /></label>
        <label>Its job, in one line<textarea rows={2} value={job} maxLength={400} placeholder="What it does for the studio" onChange={e => setJob(e.target.value)} /></label>
        {err && <p className="small" style={{ color: 'var(--gold)' }}>{err}</p>}
        <div className="naming-btns">
          <button className="primary" disabled={busy || !name.trim() || !job.trim()} onClick={draft}>{busy ? 'Goddard is writing its role…' : 'Write its role'}</button>
          <button onClick={onCancel}>Cancel</button>
        </div>
      </> : <>
        <b className="newdog-name">{name.trim()}</b>
        <textarea className="newdog-role" value={role} onChange={e => setRole(e.target.value)} aria-label={`${name.trim()}'s role`} />
        <span className="small muted">This is its whole rulebook. Change anything you like.</span>
        <div className="naming-btns">
          <button className="primary" disabled={!role.trim()} onClick={() => onWake(name.trim(), role, job.trim())}>Wake {name.trim()}</button>
          <button disabled={busy} onClick={draft}>{busy ? 'Rewriting…' : 'Rewrite'}</button>
          <button onClick={onCancel}>Cancel</button>
        </div>
      </>}
    </section>
  )
}
