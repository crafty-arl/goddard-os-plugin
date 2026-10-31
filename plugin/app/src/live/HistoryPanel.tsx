// HISTORY (Carl, 2026-10-28: "proper tracking history of request and needs"): every request, who took it, every time a
// dog needed Carl, his answer and how long it waited, and how it ended. Read from the door's append-only log.
import { useEffect, useMemo, useState } from 'react'
import { NAMED } from './PetHome'

type Ev = { at: number; type: string; task?: string; skill?: string; port?: number; name?: string; home?: boolean; by?: string; text?: string;
  choices?: string[]; asks?: boolean; agent?: number; allow?: boolean; tool?: string; took?: number; backfill?: boolean; from?: string }
type Filter = 'all' | 'requests' | 'needs'

// the name Carl knows: the session's title or the dog's name, never an agent number
const dogName = (e: Ev, numberOf: (p: number) => string) =>
  e.home ? 'Goddard' : NAMED.find(d => d.skill === e.skill)?.name ?? (e.name ? e.name.replace(/^(Session|Agent slot) · /, '') : e.port ? `Agent ${numberOf(e.port)}` : e.skill ?? 'a dog')
const dur = (ms: number) => { const m = Math.round(ms / 60000); return m < 1 ? 'under a minute' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min` }
// paths become names people read: a campaign plan is named by its folder, other paths drop out
const clip = (t = '', n = 140) => {
  const s = t.replace(/\S*campaigns\/\d{4}-\d{2}-\d{2}-([a-z0-9-]+)\/plan\.md/gi, (_, k: string) => `"${k.replace(/-/g, ' ')}"`)
    .replace(/(?:~|\/Users|\/Volumes)\S+/g, '').replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim()
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

export function HistoryPanel({ numberOf, onOpenDog }: { numberOf: (p: number) => string; onOpenDog: (port: number, name?: string) => void }) {
  const [events, setEvents] = useState<Ev[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  useEffect(() => {
    const load = () => fetch('/door/api/history?limit=800', { cache: 'no-store' }).then(r => r.json()).then(j => setEvents(j.events ?? [])).catch(() => {})
    load(); const id = setInterval(load, 10000); return () => clearInterval(id)
  }, [])

  // the needs still open: a dog's last question (or permission ask) with no answer from Carl after it
  const open = useMemo(() => {
    const out: Ev[] = [], answered = new Set<string>()
    for (const e of events) {            // newest first
      const k = `${e.port}`
      if (e.type === 'answer' || e.type === 'verdict') answered.add(k)
      else if ((e.type === 'said' && e.asks) || e.type === 'permission') { if (!answered.has(k)) { out.push(e); answered.add(k) } }
      else if (e.type === 'done' && e.port) answered.add(k)
    }
    return out
  }, [events])

  // how long each need waited: the answer that followed it on the same thread
  const waited = useMemo(() => {
    const m = new Map<Ev, number>(), lastAsk = new Map<string, Ev>()
    for (const e of [...events].reverse()) {
      const k = `${e.port}`
      if ((e.type === 'said' && e.asks) || e.type === 'permission') lastAsk.set(k, e)
      else if ((e.type === 'answer' || e.type === 'verdict') && lastAsk.has(k)) { m.set(e, e.at - lastAsk.get(k)!.at); lastAsk.delete(k) }
    }
    return m
  }, [events])

  const shown = events.filter(e => filter === 'all' ? e.type !== 'said' || e.asks
    : filter === 'requests' ? ['request', 'dispatch', 'done', 'lost', 'refused', 'upload'].includes(e.type)
    : (e.type === 'said' && e.asks) || ['permission', 'answer', 'verdict'].includes(e.type))
  const byDay = new Map<string, Ev[]>()
  for (const e of shown) { const d = new Date(e.at).toDateString(); byDay.set(d, [...(byDay.get(d) ?? []), e]) }

  return (
    <section className="panel history">
      <header className="panelhead"><span><span className="eyebrow">Every request and every need</span><h2>History</h2></span></header>
      {open.length > 0 && (
        <div className="hist-open">
          <span className="eyebrow">Waiting on you · {open.length}</span>
          {open.map(e => (
            <button key={e.at + (e.port ?? 0)} className="hist-need" onClick={() => e.port && onOpenDog(e.port, e.name)}>
              <b>{dogName(e, numberOf)}</b>
              <span>{e.type === 'permission' ? `Wants to use ${e.tool}: ${clip(e.text, 90)}` : clip(e.text, 110)}</span>
              <span className="mono small muted">waiting {dur(Date.now() - e.at)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="filters">{(['all', 'requests', 'needs'] as Filter[]).map(f => <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : f === 'requests' ? 'Requests' : 'Needs'}</button>)}</div>
      {!shown.length && <p className="muted small">Nothing yet. New requests and needs show up here as they happen.</p>}
      {[...byDay].map(([day, list]) => (
        <div key={day} className="hist-day">
          <span className="sectionhead mono">{day === new Date().toDateString() ? 'TODAY' : new Date(list[0].at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()}</span>
          {list.map((e, n) => <Row key={n + ':' + e.at} e={e} who={dogName(e, numberOf)} wait={waited.get(e)} />)}
        </div>
      ))}
    </section>
  )
}

function Row({ e, who, wait }: { e: Ev; who: string; wait?: number }) {
  const time = new Date(e.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const line =
    e.type === 'request' ? <><b>{e.by === 'home' ? 'Goddard' : 'You'} asked {who}</b> <span>{clip(e.text)}</span></>
    : e.type === 'dispatch' ? <><b>{who} took it</b> <span className="muted">on slot {e.agent}</span></>
    : e.type === 'said' ? <><b>{who} needed you</b> <span>{clip(e.text)}</span>{e.choices?.length ? <span className="muted"> · {e.choices.join(' / ')}</span> : null}</>
    : e.type === 'permission' ? <><b>{who} asked permission</b> <span>{e.tool}: {clip(e.text, 100)}</span></>
    : e.type === 'answer' ? <><b>{e.from === 'home' ? 'Goddard answered' : 'You answered'}</b> <span>{clip(e.text, 120)}</span>{wait != null && <span className="muted"> · after {dur(wait)}</span>}</>
    : e.type === 'verdict' ? <><b>You {e.allow ? 'allowed' : 'said no'}</b>{wait != null && <span className="muted"> · after {dur(wait)}</span>}</>
    : e.type === 'done' ? <><b>Done</b> <span className="muted">{who}{e.took ? ` · took ${dur(e.took)}` : ''}</span></>
    : e.type === 'lost' ? <><b>Lost</b> <span className="muted">{who}'s window closed before it finished</span></>
    : e.type === 'refused' ? <><b>Refused</b> <span className="muted">{clip(e.text)}</span></>
    : e.type === 'upload' ? <><b>You uploaded</b> <span>{clip(e.text, 80)}</span> <span className="muted">· in the Library</span></>
    : <span>{e.type}</span>
  return <div className={'hist-row ' + e.type}><span className="mono small muted">{time}</span><span className="hist-text">{line}</span></div>
}
