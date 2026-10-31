// CHAT: talking to Goddard and every task in one stream. Carl's messages and Goddard's on the left/right, each task
// as a live card at the moment it started, anything waiting on Carl answered right on its card at the bottom, and one
// input that talks to Goddard or, with "To: Agent N", to one dog. "/" or + starts a task from a skill.
import { useEffect, useMemo, useRef, useState } from 'react'
import { type Thread, type Task, type Msg, useThread, STEER } from './door'
import { findOutputs, OutputStrip, PlanCards, decode, type Output } from './outputs'
import { LivePreview, type LibEntry } from './LibraryPanel'
import { Docked, grow, Attach, Voice } from './dock'
import { Progress } from './Progress'
import { dogName } from './slots'

export interface ChatCtx {
  agents: Thread[]
  tasks: Task[]
  numberOf: (port: number) => string
  colorOf: (port: number) => string
  nice: (brief: string) => string
  whereOf: (t: Thread) => string
  openThread: (port: number) => void
  openDone: (id: string) => void
  finish: (task: Task) => void
  sayTo: (port: number, text: string) => Promise<void>
  onView: (o: Output) => void
  latest: (taskId: string) => LibEntry | undefined
  newTask: (brief: string) => void
  toast: (t: string) => void
}

type Filter = 'all' | 'tasks' | 'needs'
export const FILTERS: Filter[] = ['all', 'tasks', 'needs']

export function ChatPanel({ home, homeChat, ctx, filter, setFilter, focusTask }: {
  home: Thread | undefined; homeChat: ReturnType<typeof useThread>; ctx: ChatCtx
  filter: Filter; setFilter: (f: Filter) => void; focusTask: string | null
}) {
  const [draft, setDraft] = useState('')
  const [to, setTo] = useState<number | null>(null)
  const chats = useChats()
  const [chatId, setChatId] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const chat = chats.list.find(c => c.id === chatId) ?? chats.list.find(c => !c.to) ?? chats.list[chats.list.length - 1]
  const inChat = (ts: number) => !chat || (ts >= chat.from && (!chat.to || ts < chat.to))
  const end = useRef<HTMLDivElement>(null)
  const byPort = new Map(ctx.agents.map(a => [a.port, a]))

  // waiting on Carl: a permission ask, or an agent that replied and stopped while still holding its task
  const waiting = ctx.tasks.filter(t => {
    const th = t.status === 'active' && t.port ? byPort.get(t.port) : undefined
    return !!th && (th.needsYou || (!th.busy && th.last.text === 'Replied' && th.last.at >= t.at))
  })

  // the stream: Goddard chat + task cards (a swarm job is one card), in time order
  type Item = { at: number; kind: 'msg'; m: Msg } | { at: number; kind: 'task'; t: Task } | { at: number; kind: 'job'; job: string; ts: Task[] }
  const items: Item[] = useMemo(() => {
    const out: Item[] = []
    if (filter === 'all') for (const m of homeChat.msgs) if (inChat(m.ts)) out.push({ at: m.ts, kind: 'msg', m })
    if (filter !== 'needs') {
      const jobs = new Map<string, Task[]>()
      for (const t of ctx.tasks) {
        if (t.status === 'lost' || !inChat(t.at)) continue
        if (t.parent) jobs.set(t.parent, [...(jobs.get(t.parent) ?? []), t])
        else out.push({ at: t.at, kind: 'task', t })
      }
      for (const [job, ts] of jobs) out.push({ at: Math.min(...ts.map(t => t.at)), kind: 'job', job, ts })
    }
    return out.sort((a, b) => a.at - b.at).slice(-80)
  }, [homeChat.msgs, ctx.tasks, filter, chat?.id, chat?.to])
  const isDone = (it: Item) => (it.kind === 'task' && it.t.status === 'done') || (it.kind === 'job' && it.ts.every(t => t.status === 'done'))
  const doneItems = items.filter(isDone), liveItems = items.filter(it => !isDone(it))

  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [items.length, waiting.length])
  useEffect(() => { if (focusTask) document.querySelector(`[data-task="${focusTask}"]`)?.scrollIntoView({ block: 'center' }) }, [focusTask])

  const send = async () => {
    const text = draft.trim(); if (!text) return
    if (text.startsWith('/')) { ctx.newTask(text.slice(1).trim()); setDraft(''); return }
    if (to) { try { await ctx.sayTo(to, text); ctx.toast(`Sent to Agent ${ctx.numberOf(to)}`); setDraft('') } catch (e) { ctx.toast((e as Error).message) } return }
    if (homeChat.say(text)) setDraft(''); else ctx.toast('Goddard is offline. Try again in a moment.')
  }
  const working = homeChat.busy.on || !!home?.busy

  return (
    <section className="panel chat">

      {/* threads: one Goddard, many chats */}
      <div className="chatpick">
        <button className="chatcur" onClick={() => setPicking(p => !p)} aria-expanded={picking}>
          <b>{titleOf(chat, homeChat.msgs)}</b><span className="muted small">{chats.list.length > 1 ? `${chats.list.length} chats ▾` : '▾'}</span>
        </button>
        <button className="chatnew" onClick={() => chats.act('new').then(l => { setChatId(l.find(c => !c.to)?.id ?? null); setPicking(false) })}>+ New chat</button>
      </div>
      {picking && (
        <div className="chatlist">
          {chats.list.slice().reverse().map(c => (
            <div key={c.id} className={'chatrow' + (c.id === chat?.id ? ' on' : '')}>
              <button className="grow" onClick={() => { setChatId(c.id); setPicking(false) }}>
                <b>{titleOf(c, homeChat.msgs)}</b><span className="muted small">{!c.to ? 'open now' : c.from ? when(c.from) : 'earlier'}</span>
              </button>
              <button className="clear" aria-label="Clear this chat" onClick={() => chats.act('clear', c.id).then(l => { if (c.id === chat?.id) setChatId(l.find(x => !x.to)?.id ?? null) })}>Clear</button>
            </div>
          ))}
          {chats.list.some(c => c.to) && <button className="clearold" onClick={() => chats.act('clear-old').then(() => setChatId(null))}>Clear all old chats</button>}
        </div>
      )}
      <div className="stream">
        {filter !== 'all' && <button className="filterchip" onClick={() => setFilter('all')}>{filter === 'needs' ? 'Only what needs you' : 'Only tasks'} · show all ×</button>}
        {!items.length && filter !== 'needs' && <p className="muted small">Say hi to Goddard, or start a task with + or "/".</p>}
        {/* finished work folds into one line, so the stream is what's live */}
        {doneItems.length > 0 && (
          <details className="donefold">
            <summary><span className="gold">✓</span> {doneItems.length} done</summary>
            {doneItems.map(it => it.kind === 'task' ? <TaskCard key={it.t.id} t={it.t} ctx={ctx} focus={focusTask === it.t.id} onReply={setTo} />
              : it.kind === 'job' ? <JobCard key={'j' + it.job} job={it.job} ts={it.ts} ctx={ctx} onReply={setTo} focusTask={focusTask} /> : null)}
          </details>
        )}
        {liveItems.map(it =>
          it.kind === 'msg' ? <Bubble key={'m' + it.m.id} m={it.m} />
          : it.kind === 'task' ? <TaskCard key={it.t.id} t={it.t} ctx={ctx} focus={focusTask === it.t.id} onReply={setTo} />
          : <JobCard key={'j' + it.job} job={it.job} ts={it.ts} ctx={ctx} onReply={setTo} focusTask={focusTask} />)}
        {working && filter === 'all' && <div className="bubble2 gd typing"><span className="dots"><i /><i /><i /></span><span className="mono small muted">{homeChat.busy.text || home?.doing || 'Thinking it over'}</span></div>}
        {waiting.length > 0 && <div className="sectionhead waithead"><span>Waiting on you</span><span className="mono muted small">{waiting.length}</span></div>}
        {waiting.map(t => <AskCard key={'ask' + t.id} t={t} th={byPort.get(t.port!)!} ctx={ctx} />)}
        {filter === 'needs' && !waiting.length && <p className="muted small">Nothing is waiting on you.</p>}
        <div ref={end} />
      </div>

      <Docked><form className="composer footer" onSubmit={e => { e.preventDefault(); send(); e.currentTarget.querySelector('textarea')!.style.height = '' }}>
        {to && <div className="tochip"><span>To: Agent {ctx.numberOf(to)}</span><button type="button" onClick={() => setTo(null)} aria-label="Talk to Goddard instead">×</button></div>}
        <div className="row">
          <button type="button" className="plus" onClick={() => ctx.newTask(draft.replace(/^\//, '').trim())} aria-label="Start a task from a skill">+</button>
          <Attach onAdd={l => setDraft(d => (d ? d + '\n' : '') + l)} onError={ctx.toast} />
          <Voice onAdd={l => setDraft(d => (d ? d + '\n' : '') + l)} onError={ctx.toast} />
          <textarea id="chat-box" rows={1} value={draft} aria-label={to ? `Message Agent ${ctx.numberOf(to)}` : 'Message Goddard'} placeholder={to ? `Tell Agent ${ctx.numberOf(to)}…` : 'Tell Goddard…'}
            onChange={e => { setDraft(e.target.value); grow(e.target) }}
            onFocus={() => document.body.classList.add('typing')} onBlur={() => document.body.classList.remove('typing')}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); e.currentTarget.style.height = '' } }} />
          <button type="submit" className="pillbtn send" disabled={!draft.trim()} aria-label="Send">↑</button>
        </div>
      </form></Docked>
    </section>
  )
}

function Bubble({ m }: { m: Msg }) {
  return <div className={'bubble2 ' + (m.from === 'user' ? 'me' : 'gd')}><p className="rich">{linkify(decode(m.text))}</p></div>
}

function TaskCard({ t, ctx, focus, onReply }: { t: Task; ctx: ChatCtx; focus: boolean; onReply: (p: number) => void }) {
  const th = t.port ? ctx.agents.find(a => a.port === t.port) : undefined
  if (t.status === 'done') {
    return (
      <button className={'tcard done' + (focus ? ' focus' : '')} data-task={t.id} onClick={() => ctx.openDone(t.id)}>
        <span className="gold">✓</span> {t.port ? `Agent ${ctx.numberOf(t.port)}` : 'Task'} · {ctx.nice(t.brief)}
      </button>
    )
  }
  return (
    <div className={'tcard' + (th?.needsYou ? ' hot' : '') + (focus ? ' focus' : '')} data-task={t.id}>
      <button className="tmain" onClick={() => (t.port ? ctx.openThread(t.port) : ctx.toast(t.mode === 'cheap' ? (t.status === 'active' ? 'With Hermes: Cheap tasks come back here' : 'Hermes answered: see the result') : 'Queued: it starts when a dog is free'))}>
        {t.port ? <span className="badge big" style={{ background: ctx.colorOf(t.port) }}>{ctx.numberOf(t.port)}</span> : <span className="badge big queued">…</span>}
        <span className="tbody">
          <b>{DOGS[t.skill] ?? (t.port ? `Agent ${ctx.numberOf(t.port)}` : 'Task')}{t.by === 'home' ? <span className="muted small"> · from Goddard</span> : null}</b>
          <span className="tbrief">{ctx.nice(t.brief)}</span>
          <Progress task={t} thread={th} />
        </span>
      </button>
      {t.port && <button className="reply" onClick={() => onReply(t.port!)}>Reply</button>}
      {ctx.latest(t.id) && <div className="tpreview"><LivePreview e={ctx.latest(t.id)!} onOpen={ctx.onView} /></div>}
    </div>
  )
}

function JobCard({ job, ts, ctx, onReply, focusTask }: { job: string; ts: Task[]; ctx: ChatCtx; onReply: (p: number) => void; focusTask: string | null }) {
  const done = ts.every(t => t.status === 'done')
  return (
    <div className={'jobcard' + (done ? ' done' : '')}>
      <span className="eyebrow">{done ? '✓ Job done' : 'Job'} · {job} · {ts.length} dogs</span>
      {ts.map(t => <TaskCard key={t.id} t={t} ctx={ctx} focus={focusTask === t.id} onReply={onReply} />)}
    </div>
  )
}

// a dog that needs Carl, answered right here: its question, its choices, Allow / No, or Looks good / Redo
function AskCard({ t, th, ctx }: { t: Task; th: Thread; ctx: ChatCtx }) {
  const live = useThread(t.port)
  const last = [...live.msgs].reverse().find(m => m.from === 'assistant')
  const outputs = findOutputs(live.msgs.filter(m => m.from === 'assistant').map(m => m.text))
  const answer = (text: string) => { if (live.say(text)) ctx.toast(`Sent to Agent ${ctx.numberOf(t.port!)}`) }
  return (
    <div className="askcard" data-ask={t.id}>
      <header>
        <span className="badge" style={{ background: ctx.colorOf(t.port!) }}>{ctx.numberOf(t.port!)}</span>
        <b>{(th.home ? 'Goddard' : dogName(th)) ?? DOGS[t.skill] ?? `Agent ${ctx.numberOf(t.port!)}`} needs you</b>
        <button className="link" onClick={() => ctx.openThread(t.port!)}>Open</button>
      </header>
      <span className="mono small muted">{ctx.nice(t.brief)}</span>
      {live.asks.map(a => (
        <div key={a.request_id} className="permission">
          <p>{a.description}</p>
          {a.input_preview && <pre className="preview">{a.input_preview}</pre>}
          <div className="chips"><button className="gold" onClick={() => live.verdict(a.request_id, 'allow')}>Allow</button><button onClick={() => live.verdict(a.request_id, 'deny')}>No</button></div>
        </div>
      ))}
      {last && <p className="rich">{linkify(decode(last.text))}</p>}
      <PlanCards outputs={outputs} />
      <OutputStrip outputs={outputs} onOpen={ctx.onView} />
      {!live.asks.length && !th.busy && (
        <div className="chips">
          {last?.choices?.length
            ? last.choices.map(c => <button key={c} onClick={() => answer(c)}>{c}</button>)
            : <>
                <button className="gold" onClick={() => { answer(STEER.approve); ctx.finish(t) }}>✓ Looks good</button>
                <button onClick={() => answer(STEER.redo)}>↺ Redo</button>
              </>}
        </div>
      )}
    </div>
  )
}

export function linkify(text: string) {
  return text.split(/(https?:\/\/[^\s)]+)/g).map((p, i) => (/^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer">{p}</a> : p))
}


const DOGS: Record<string, string> = { 'gm-fetch': 'Fetch', 'gm-scribbles': 'Scribbles', 'gm-bloodhound': 'Bloodhound' }

// chat threads kept by the door, shared by the phone and the desk
type Chat = { id: string; from: number; to?: number; title?: string }
function useChats() {
  const [list, setList] = useState<Chat[]>([])
  const load = () => fetch('/door/api/chats', { cache: 'no-store' }).then(r => r.json()).then(j => setList(j.chats ?? [])).catch(() => {})
  useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id) }, [])
  const act = (what: 'new' | 'clear' | 'clear-old', id?: string): Promise<Chat[]> =>
    fetch(`/door/api/chats/${what}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) })
      .then(r => r.json()).then(j => { setList(j.chats ?? []); return j.chats ?? [] })
  return { list, act }
}
// a chat is named by its first thing Carl said in it
function titleOf(c: Chat | undefined, msgs: Msg[]) {
  if (!c) return 'Chat'
  if (c.title) return c.title
  const first = msgs.find(m => m.from === 'user' && m.ts >= c.from && (!c.to || m.ts < c.to))
  return first ? decode(first.text).replace(/\s+/g, ' ').slice(0, 40) : 'New chat'
}
function when(t: number) {
  const d = new Date(t), today = new Date()
  return d.toDateString() === today.toDateString() ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
