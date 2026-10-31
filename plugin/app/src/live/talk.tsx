// Messages you can scan (audit fix 3, Carl, 2026-10-30): the latest answer sits last as a card with its buttons inside,
// runs of updates with nothing from Carl between them fold into one line, and **bold** and lists render instead of
// showing their marks. Used by Goddard's chat and by a session's talk column.
import { useState, type ReactNode } from 'react'
import { decode } from './outputs'

export type TalkMsg = { id: string; from: 'user' | 'assistant'; text: string; ts: number; choices?: string[] }

const LINK = /(https?:\/\/[^\s)]+)/g
// one line of text: links and **bold** (single *, _ and ` marks are dropped, not shown)
function inline(t: string, k: string): ReactNode[] {
  return t.split(/(\*\*[^*]+\*\*)/g).flatMap((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return [<b key={k + 'b' + i}>{p.slice(2, -2)}</b>]
    return p.replace(/(^|\s)[*_](\S[^*_]*?)[*_](?=\s|$|[.,!?])/g, '$1$2').replace(/`/g, '').split(LINK)
      .map((s, j) => /^https?:\/\//.test(s) ? <a key={k + i + 'a' + j} href={s} target="_blank" rel="noreferrer">{s}</a> : s)
  })
}

// a message as blocks: paragraphs, bullet or numbered lists, and headings shown as bold lines
export function rich(text: string): ReactNode {
  const lines = decode(text).split('\n'), out: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flush = () => { if (!list) return; const L = list.ordered ? 'ol' : 'ul'; out.push(<L key={'l' + out.length}>{list.items.map((x, i) => <li key={i}>{inline(x, `l${out.length}-${i}`)}</li>)}</L>); list = null }
  for (const raw of lines) {
    const l = raw.trim()
    const bullet = l.match(/^[-*•·]\s+(.*)/), num = l.match(/^\d+[.)]\s+(.*)/)
    if (bullet || num) { const ordered = !!num; if (list && list.ordered !== ordered) flush(); list ??= { ordered, items: [] }; list.items.push((bullet ?? num)![1]); continue }
    flush()
    if (!l) continue
    const h = l.match(/^#{1,6}\s+(.*)/)
    out.push(<p key={'p' + out.length}>{h ? <b>{h[1]}</b> : inline(l, 'p' + out.length)}</p>)
  }
  flush()
  return out
}

const hm = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const firstLine = (t: string) => decode(t).replace(/[*_`#]/g, '').split('\n').map(s => s.trim()).find(Boolean) ?? ''

type Part = { kind: 'msg'; m: TalkMsg } | { kind: 'fold'; ms: TalkMsg[] }
// fold: two or more replies in a row with nothing from Carl between them, except the newest message of all
function parts(msgs: TalkMsg[]): Part[] {
  const out: Part[] = [], lastIdx = msgs.length - 1
  let run: TalkMsg[] = []
  const flush = () => { if (run.length >= 2) out.push({ kind: 'fold', ms: run }); else run.forEach(m => out.push({ kind: 'msg', m })); run = [] }
  msgs.forEach((m, i) => {
    if (m.from === 'assistant' && i !== lastIdx) run.push(m)
    else { flush(); out.push({ kind: 'msg', m }) }
  })
  flush()
  return out
}

function Fold({ ms, who, render }: { ms: TalkMsg[]; who: string; render: (m: TalkMsg) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const span = hm(ms[0].ts) === hm(ms[ms.length - 1].ts) ? hm(ms[0].ts) : `${hm(ms[0].ts)} to ${hm(ms[ms.length - 1].ts)}`
  return (
    <div className="talk-fold">
      <button onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span>{ms.length} updates from {who} · {span}</span>
        <span className="talk-fold-peek">Last: {firstLine(ms[ms.length - 1].text)}</span>
        <i aria-hidden="true">{open ? '⌃' : '›'}</i>
      </button>
      {open && ms.map(render)}
    </div>
  )
}

// the talk: older runs folded, Carl's own words as bubbles, the newest reply as a card with its choices inside
// note(m) turns a message into a quiet one-line note instead (Goddard passing a dog a note, say)
export function Talk({ msgs, who, choices, onPick, busy, note }: {
  msgs: TalkMsg[]; who: string; choices: string[]; onPick: (c: string) => void; busy: boolean; note?: (m: TalkMsg) => string | null
}) {
  const plainMsg = (m: TalkMsg) => { const n = note?.(m); return n ? <p key={m.id} className="sess-note">{n}</p> : <div key={m.id} className={'sess-msg ' + (m.from === 'user' ? 'me' : 'dog')}>{rich(m.text)}</div> }
  const ps = parts(msgs), last = msgs[msgs.length - 1]
  return (
    <>
      {ps.map((p, i) => {
        if (p.kind === 'fold') return <Fold key={'f' + p.ms[0].id} ms={p.ms} who={who} render={plainMsg} />
        const m = p.m
        if (i === ps.length - 1 && m === last && m.from === 'assistant' && !busy) {
          return (
            <article key={m.id} className="talk-latest" aria-label={`Latest from ${who}`}>
              <span className="talk-when">Latest · {hm(m.ts)}</span>
              <div className="talk-body">{rich(m.text)}</div>
              {choices.length > 0 && <div className="sess-choices">{choices.map((c, n) => <button key={c} className={n === 0 ? 'go' : ''} onClick={() => onPick(c)}>{c}</button>)}</div>}
            </article>
          )
        }
        return plainMsg(m)
      })}
    </>
  )
}
