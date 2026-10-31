// Just chat with Goddard (Carl, 2026-10-29: "What if I just want a standard chat" / "Just chat"): a plain back and forth,
// no plan, no interview, no done list. Same look as a session's talk column, with the live box while Goddard works.
import { useEffect, useRef, useState } from 'react'
import { type Thread, useThread } from './door'
import { Talk } from './talk'
import { Attach, Voice, grow } from './dock'
import { Working } from './Session'

export function GoddardChat({ thread, onBack, onToast, first }: { thread?: Thread; onBack: () => void; onToast: (m: string) => void; first?: string }) {
  const live = useThread(thread?.port ?? null)
  const [draft, setDraft] = useState(first ?? '')
  const end = useRef<HTMLDivElement>(null)
  // the live socket only replays what this Goddard process saw since it started; the door keeps the longer record
  const [earlier, setEarlier] = useState<{ id: string; from: 'user' | 'assistant'; text: string; ts: number; choices?: string[] }[]>([])
  useEffect(() => {
    fetch('/door/api/history?limit=600').then(r => r.json()).then(j => setEarlier(((j.events ?? []) as { at: number; type: string; text?: string; home?: boolean; from?: string }[])
      .filter(e => e.home && e.text && (e.type === 'said' || (e.type === 'answer' && e.from === 'carl')))
      .slice(-30).map((e, i) => ({ id: 'h' + i + e.at, from: e.type === 'said' ? 'assistant' : 'user', text: e.text!, ts: e.at }))), () => {})
  }, [])
  const seen = new Set(live.msgs.map(m => m.text.trim()))
  const msgs = [...earlier.filter(m => !seen.has(m.text.trim()) && m.ts < (live.msgs[0]?.ts ?? Infinity)), ...live.msgs].slice(-80)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [msgs.length, live.busy.on, live.steps.length])
  const say = (t: string) => { if (!t.trim()) return; if (!live.say(t.trim())) onToast('Goddard is connecting. One second.'); else setDraft('') }
  const last = msgs[msgs.length - 1]
  const choices = last?.from === 'assistant' ? last.choices ?? [] : []
  const lastMine = [...msgs].reverse().find(m => m.from === 'user')?.ts ?? 0
  return (
    <section className="sess chat" aria-label="Chat with Goddard">
      <header className="sess-head">
        <button className="calm-quiet" onClick={onBack}>← Home</button>
        <h1>Goddard</h1>
        <span className="sess-head-pad" aria-hidden="true" />
      </header>
      <div className="sess-talk chat-talk">
        <div className="sess-msgs" role="log">
          {!thread && <p className="sess-note">Goddard is waking up…</p>}
          <Talk msgs={msgs.filter(m => !(m.from === 'user' && /^From Home:/.test(m.text)))} who="Goddard" choices={choices} onPick={say} busy={live.busy.on} />
          {live.busy.on && <Working steps={live.steps} since={lastMine} doing={live.busy.text ?? thread?.doing} />}
          <div ref={end} />
        </div>
        <form className="sess-say" onSubmit={e => { e.preventDefault(); say(draft) }}>
          <Attach onAdd={l => setDraft(d => (d ? d + '\n' : '') + l)} onError={onToast} />
          <Voice onAdd={l => setDraft(d => (d ? d + '\n' : '') + l)} onError={onToast} />
          <textarea autoFocus value={draft} rows={1} onChange={e => { setDraft(e.target.value); grow(e.target) }} placeholder="Say anything…" aria-label="Message Goddard"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); say(draft) } }} />
          <button type="submit" disabled={!draft.trim()} aria-label="Send">↑</button>
        </form>
      </div>
    </section>
  )
}
