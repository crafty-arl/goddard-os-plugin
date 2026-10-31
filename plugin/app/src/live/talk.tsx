// Messages you can scan (audit fix 3, Carl, 2026-10-30): the latest answer sits last as a card with its buttons inside,
// runs of updates with nothing from Carl between them fold into one line, and **bold** and lists render instead of
// showing their marks. Used by Goddard's chat and by a session's talk column.
import { useEffect, useState, type ReactNode } from 'react'
import { decode } from './outputs'

export type TalkMsg = { id: string; from: 'user' | 'assistant'; text: string; ts: number; choices?: string[] }

const LINK = /(https?:\/\/[^\s)]+)/g

// Bionic reading (Carl, 2026-10-30): the start of each word in bold, as a switch that's off until he turns it on. It
// lives on this device and every open chat follows it at once.
const BIONIC = 'goddard.bionic'
export const bionicOn = () => { try { return localStorage.getItem(BIONIC) === '1' } catch { return false } }
export function setBionic(on: boolean) { try { localStorage.setItem(BIONIC, on ? '1' : '0') } catch { /* this visit only */ } window.dispatchEvent(new Event(BIONIC)) }
export function useBionic(): boolean {
  const [on, setOn] = useState(bionicOn)
  useEffect(() => { const f = () => setOn(bionicOn()); window.addEventListener(BIONIC, f); return () => window.removeEventListener(BIONIC, f) }, [])
  return on
}
// Pacing (Carl, 2026-10-31: "all responses stream in with Bionic Reading and Pacing"): a new reply appears a few
// words at a time at a reading pace, so the eye can follow it; its answer buttons come in once it's all there. A tap
// shows it all at once. Off, or Reduce Motion, shows replies whole. Kept on this device, like Bionic.
export type Pace = 'off' | 'calm' | 'normal' | 'quick'
const PACE = 'goddard.pace', WPM: Record<Pace, number> = { off: 0, calm: 170, normal: 250, quick: 380 }
export const paceNow = (): Pace => { try { const v = localStorage.getItem(PACE) as Pace | null; return v && v in WPM ? v : 'normal' } catch { return 'normal' } }
export function setPace(p: Pace) { try { localStorage.setItem(PACE, p) } catch { /* this visit only */ } window.dispatchEvent(new Event(PACE)) }
export function usePace(): Pace {
  const [p, setP] = useState(paceNow)
  useEffect(() => { const f = () => setP(paceNow()); window.addEventListener(PACE, f); return () => window.removeEventListener(PACE, f) }, [])
  return p
}
const shownWhole = new Set<string>() // replies already revealed, so a re-render or a return visit never replays them
const opened = Date.now()
const wordsIn = (t: string) => (t.match(/\S+/g) ?? []).length
// how many words of a reply are showing now; every word at once for an old reply, a slow page or Reduce Motion
export function useReveal(id: string, ts: number, total: number): [number, () => void] {
  const pace = usePace()
  const still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  const fresh = !shownWhole.has(id) && ts > opened - 15_000 && pace !== 'off' && !still
  const [n, setN] = useState(fresh ? 0 : total)
  useEffect(() => {
    if (!fresh) { setN(total); return }
    const per = 60_000 / WPM[pace], step = Math.max(1, Math.round(70 / per)) // a tick every ~70ms, as many words as the pace allows
    const id2 = setInterval(() => setN(v => { const next = Math.min(total, v + step); if (next >= total) { clearInterval(id2); shownWhole.add(id) } return next }), Math.max(40, per * step))
    return () => clearInterval(id2)
  }, [id, total, fresh, pace])
  return [n, () => { shownWhole.add(id); setN(total) }]
}
// the first n words of a text, keeping its line breaks and spacing
function clip(t: string, n: number): string {
  if (n <= 0) return ''
  let seen = 0, out = ''
  for (const m of t.matchAll(/(\s*)(\S+)/g)) { if (seen >= n) break; out += m[1] + m[2]; seen++ }
  return out
}
function bio(t: string, k: string): ReactNode[] {
  return t.split(/(\s+)/).map((w, i) => {
    const letters = w.replace(/[^\p{L}\p{N}]/gu, '').length
    if (!letters) return w
    const n = letters <= 3 ? 1 : Math.ceil(letters * 0.45)
    return <span key={k + 'w' + i} className="bio"><b>{w.slice(0, n)}</b>{w.slice(n)}</span>
  })
}
// one line of text: links and **bold** (single *, _ and ` marks are dropped, not shown)
function inline(t: string, k: string, b = false): ReactNode[] {
  return t.split(/(\*\*[^*]+\*\*)/g).flatMap((p, i): ReactNode[] => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return [<b key={k + 'b' + i}>{p.slice(2, -2)}</b>]
    return p.replace(/(^|\s)[*_](\S[^*_]*?)[*_](?=\s|$|[.,!?])/g, '$1$2').replace(/`/g, '').split(LINK)
      .flatMap((s, j): ReactNode[] => /^https?:\/\//.test(s) ? [<a key={k + i + 'a' + j} href={s} target="_blank" rel="noreferrer">{s}</a>] : b ? bio(s, k + i + 'x' + j) : [s])
  })
}

// a message as blocks: paragraphs, bullet or numbered lists, and headings shown as bold lines
export function rich(text: string, b = false): ReactNode {
  const lines = decode(text).split('\n'), out: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flush = () => { if (!list) return; const L = list.ordered ? 'ol' : 'ul'; out.push(<L key={'l' + out.length}>{list.items.map((x, i) => <li key={i}>{inline(x, `l${out.length}-${i}`, b)}</li>)}</L>); list = null }
  for (const raw of lines) {
    const l = raw.trim()
    const bullet = l.match(/^[-*•·]\s+(.*)/), num = l.match(/^\d+[.)]\s+(.*)/)
    if (bullet || num) { const ordered = !!num; if (list && list.ordered !== ordered) flush(); list ??= { ordered, items: [] }; list.items.push((bullet ?? num)![1]); continue }
    flush()
    if (!l) continue
    const h = l.match(/^#{1,6}\s+(.*)/)
    out.push(<p key={'p' + out.length}>{h ? <b>{h[1]}</b> : inline(l, 'p' + out.length, b)}</p>)
  }
  flush()
  return out
}

// A reply in groups (Carl, 2026-10-30, the focus mock): the result in one line first, the one question as a gold card
// with its answers inside, then what's done and what's left as short labeled lists. The dogs write replies in that
// shape (their instructions); anything else falls back to the plain card.
type Group = { kind: 'done' | 'left' | 'next' | 'where'; label: string; items: string[] }
const HEADS: [RegExp, Group['kind'], string][] = [
  [/^done$/i, 'done', '✓ Done'], [/^(left for you|left|not done|heads up|watch out)$/i, 'left', 'Left for you'],
  [/^(next|next step|next steps)$/i, 'next', 'Next'], [/^(where|where it is|links?|files?)$/i, 'where', 'Where it is'],
]
const NEEDS = /^(needs you|question|decide|your call)$/i
export function grouped(text: string): { lead: string; ask: string; groups: Group[]; rest: string[] } | null {
  const lines = decode(text).split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return null
  const groups: Group[] = [], rest: string[] = []
  let ask = '', cur: Group | null = null, inAsk = false
  const lead = lines[0].replace(/^#+\s*/, '').replace(/\*\*/g, '')
  for (const raw of lines.slice(1)) {
    const head = raw.replace(/\*\*/g, '').match(/^#*\s*([A-Za-z ]{2,20}):\s*(.*)$/)
    const label = head?.[1].trim() ?? ''
    if (head && NEEDS.test(label)) { inAsk = true; cur = null; if (head[2]) ask = head[2]; continue }
    const h = head && HEADS.find(([re]) => re.test(label))
    if (h) { inAsk = false; cur = groups.find(g => g.kind === h[1]) ?? (groups.push({ kind: h[1], label: h[2], items: [] }), groups[groups.length - 1]); if (head![2]) cur.items.push(head![2]); continue }
    const item = raw.replace(/^[-*•·]\s+|^\d+[.)]\s+/, '')
    if (inAsk) { ask = ask ? ask + ' ' + item : item; continue }
    if (cur && raw !== item) { cur.items.push(item); continue }
    cur = null; rest.push(raw)
  }
  // no labeled question: the last line that asks one becomes the card
  if (!ask) { const q = [...rest].reverse().find(l => /\?\s*$/.test(l)); if (q) { ask = q; rest.splice(rest.lastIndexOf(q), 1) } }
  if (!groups.length && !ask) return null
  return { lead, ask, groups, rest }
}
function GroupedReply({ g, b, choices, onPick, shown, done }: { g: NonNullable<ReturnType<typeof grouped>>; b: boolean; choices: string[]; onPick: (c: string) => void; shown: number; done: boolean }) {
  const [more, setMore] = useState(false)
  // the reading order is lead, question, then each group's lines; each part shows as many words as the pace has reached
  let left = shown
  const take = (t: string) => { const c = clip(t, left); left -= wordsIn(t); return c }
  const lead = take(g.lead), ask = g.ask ? take(g.ask) : ''
  const groups = g.groups.map(x => ({ ...x, items: x.items.map(take).filter(Boolean) })).filter(x => x.items.length)
  return (
    <div className="talk-grouped">
      <p className="talk-lead">{inline(lead, 'lead', b)}{!done && !ask && !groups.length && <i className="talk-caret" aria-hidden="true" />}</p>
      {ask && <section className="talk-ask"><span>Needs you</span><p>{inline(ask, 'ask', b)}</p>
        {done && choices.length > 0 && <div className="sess-choices">{choices.map((c, n) => <button key={c} className={n === 0 ? 'go' : ''} onClick={() => onPick(c)}>{c}</button>)}</div>}</section>}
      {groups.map(x => <section key={x.kind} className={'talk-group ' + x.kind}><span>{x.label}{x.items.length > 1 ? ` · ${x.items.length}` : ''}</span>
        {x.items.map((it, i) => <p key={i}>{inline(it, x.kind + i, b)}</p>)}</section>)}
      {done && g.rest.length > 0 && <>
        <button className="talk-more" aria-expanded={more} onClick={() => setMore(m => !m)}>{more ? 'Less' : 'More detail'} <span aria-hidden="true">{more ? '▴' : '▸'}</span></button>
        {more && <div className="talk-body">{rich(g.rest.join('\n'), b)}</div>}
      </>}
      {done && !g.ask && choices.length > 0 && <div className="sess-choices">{choices.map((c, n) => <button key={c} className={n === 0 ? 'go' : ''} onClick={() => onPick(c)}>{c}</button>)}</div>}
    </div>
  )
}

// the newest reply as a card, coming in at the reading pace; a tap on it shows the rest at once
function Latest({ m, who, b, choices, onPick }: { m: TalkMsg; who: string; b: boolean; choices: string[]; onPick: (c: string) => void }) {
  const g = grouped(m.text)
  const total = g ? [g.lead, g.ask, ...g.groups.flatMap(x => x.items)].reduce((n, t) => n + wordsIn(t), 0) : wordsIn(decode(m.text))
  const [shown, finish] = useReveal(m.id, m.ts, total)
  const done = shown >= total
  return (
    <article className={'talk-latest' + (g ? ' grouped' : '') + (done ? '' : ' pacing')} aria-label={`Latest from ${who}`} aria-busy={!done} onClick={done ? undefined : finish}>
      <span className="talk-when">{g ? who : 'Latest'} · {hm(m.ts)}{!done && <span className="talk-skip"> · tap to show all</span>}</span>
      {g ? <GroupedReply g={g} b={b} choices={choices} onPick={onPick} shown={shown} done={done} />
        : <div className="talk-body">{rich(done ? m.text : clip(decode(m.text), shown), b)}{!done && <i className="talk-caret" aria-hidden="true" />}</div>}
      {!g && done && choices.length > 0 && <div className="sess-choices">{choices.map((c, n) => <button key={c} className={n === 0 ? 'go' : ''} onClick={() => onPick(c)}>{c}</button>)}</div>}
    </article>
  )
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
  const b = useBionic()
  const plainMsg = (m: TalkMsg) => { const n = note?.(m); return n ? <p key={m.id} className="sess-note">{n}</p> : <div key={m.id} className={'sess-msg ' + (m.from === 'user' ? 'me' : 'dog')}>{rich(m.text, b && m.from !== 'user')}</div> }
  const ps = parts(msgs), last = msgs[msgs.length - 1]
  return (
    <>
      {ps.map((p, i) => {
        if (p.kind === 'fold') return <Fold key={'f' + p.ms[0].id} ms={p.ms} who={who} render={plainMsg} />
        const m = p.m
        if (i === ps.length - 1 && m === last && m.from === 'assistant' && !busy) return <Latest key={m.id} m={m} who={who} b={b} choices={choices} onPick={onPick} />
        return plainMsg(m)
      })}
    </>
  )
}
