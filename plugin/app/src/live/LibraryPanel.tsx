// LIBRARY: every output any agent made, kept by the door in ~/GoddardLibrary. Newest first, filter by type, search,
// tap to open in the viewer, and "from Agent N" jumps back to the task's card in CHAT.
import { useEffect, useMemo, useState } from 'react'
import { fileUrl, SandboxPage, type Output } from './outputs'

export interface LibEntry {
  id: string; title: string; type: 'page' | 'image' | 'doc' | 'video' | 'audio' | 'link'
  dog: number | 'home' | null; task: string | null; taskTitle: string; job?: string; skill?: string
  at: number; source: string; path?: string; copied: boolean; note?: string
  live?: boolean; versions?: number; share?: string
}

const KINDS = [['all', 'All'], ['page', 'Pages'], ['image', 'Images'], ['doc', 'Docs'], ['video', 'Video'], ['link', 'Links']] as const
const ICON: Record<string, string> = { page: '◫', image: '▣', doc: '¶', video: '▶', audio: '♪', link: '↗' }

export function toOutput(e: LibEntry): Output {
  if (e.type === 'link') {
    const host = (() => { try { return new URL(e.source).host } catch { return '' } })()
    return { kind: 'link', url: e.source, name: e.title, site: host.endsWith('claude.ai') ? 'claude' : host.includes('substack.com') ? 'substack' : 'web' }
  }
  const ext = (e.path ?? e.source).split('.').pop()!.toLowerCase()
  const type = e.type === 'doc' ? (ext === 'md' ? 'md' : ext === 'pdf' ? 'pdf' : 'text') : e.type === 'audio' ? 'audio' : e.type
  return { kind: 'file', path: e.path ?? e.source, name: e.title, type }
}

// the Library as kept by the door, re-read every few seconds so live work shows its newest save
export function useLibrary(everyMs = 4000) {
  const [data, setData] = useState<{ dir: string; lacie?: boolean; entries: LibEntry[] } | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let stop = false
    const load = () => fetch('/door/api/library', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then(d => { if (!stop) { setData(d); setErr('') } })
      .catch(e => { if (!stop) setErr(`Couldn't read the Library (${e.message}).`) })
    load(); const id = setInterval(load, everyMs)
    return () => { stop = true; clearInterval(id) }
  }, [everyMs])
  return { data, err }
}

export function LibraryPanel({ lib, onOpen, onFrom, numberOf, nice }: {
  lib: ReturnType<typeof useLibrary>; onOpen: (o: Output) => void; onFrom: (task: string) => void; numberOf: (port: number) => string; nice: (s: string) => string
}) {
  const { data, err } = lib
  const [kind, setKind] = useState<(typeof KINDS)[number][0]>('all')
  const [q, setQ] = useState('')
  const list = useMemo(() => (data?.entries ?? []).filter(e =>
    (kind === 'all' || e.type === kind || (kind === 'video' && e.type === 'audio')) &&
    (!q || `${e.title} ${e.taskTitle} ${e.job ?? ''} ${e.skill ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [data, kind, q])

  return (
    <section className="panel library">
      <header className="panelhead">
        <span><span className="eyebrow">Library · everything the dogs made</span><h2>The Library</h2></span>
      </header>
      <p className="muted small">{data ? <>{data.entries.length} kept in <span className="mono">{data.dir.replace(/^\/Users\/[^/]+/, '~')}</span>. Files are copies, so later edits don't change them.{data.lacie === false && <b className="warn"> LaCie not connected: new work is saved on the Mac and moves over when it's back.</b>}</> : err || 'Opening the Library…'}</p>
      <div className="filters">{KINDS.map(([k, l]) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>)}</div>
      <input id="library-search" className="search" type="search" placeholder="Search the Library" value={q} onChange={e => setQ(e.target.value)} />
      <div className="libgrid">
        {list.map(e => (
          <div key={e.id} className="libitem">
            <button className="libopen" data-tile onClick={() => onOpen(toOutput(e))}>
              {e.type === 'image' && e.path ? <img src={fileUrl(e.path, e.at)} alt="" loading="lazy" /> : <span className="oico">{ICON[e.type]}</span>}
              <b>{e.title}</b>
              <span className="mono small muted">{new Date(e.at).toLocaleDateString([], { month: 'short', day: 'numeric' })}{e.skill ? ` · ${e.skill}` : ''}{e.note ? ' · not copied' : ''}{e.live ? ' · live' : ''}{e.share ? ' · shared' : ''}</span>
            </button>
            {e.task && <button className="libfrom" onClick={() => onFrom(e.task!)}>from {typeof e.dog === 'number' ? `Agent ${numberOf(e.dog)}` : 'Goddard'} · {nice(e.taskTitle).slice(0, 40)}</button>}
          </div>
        ))}
      </div>
      {data && !list.length && <p className="muted">{q || kind !== 'all' ? 'Nothing matches.' : 'Empty so far. When a dog makes a file or a link, it lands here.'}</p>}
    </section>
  )
}

// the newest thing a task has made, drawn small enough to sit in a card; updates when the dog saves again
export function LivePreview({ e, big, onOpen }: { e: LibEntry; big?: boolean; onOpen: (o: Output) => void }) {
  const url = e.path ? fileUrl(e.path, e.at) : ''
  const [text, setText] = useState('')
  useEffect(() => { if (e.type === 'doc' && url && !/\.pdf$/i.test(e.path ?? '')) fetch(url).then(r => r.text()).then(t => setText(t.slice(0, 600))).catch(() => {}) }, [url])
  return (
    <button className={'livepreview' + (big ? ' big' : '')} onClick={() => onOpen(toOutput(e))} title="Open full screen">
      <span className="lpframe">
        {e.type === 'image' && <img src={url} alt="" />}
        {e.type === 'page' && <SandboxPage url={url} title={e.title} />}
        {e.type === 'doc' && (/\.pdf$/i.test(e.path ?? '') ? <span className="oico">▤</span> : <pre>{text}</pre>)}
        {(e.type === 'video' || e.type === 'audio' || e.type === 'link') && <span className="oico">{ICON[e.type]}</span>}
      </span>
      <span className="lpcap">{e.live && <i className="dot" />}<b>{e.title}</b><span className="mono small muted">{e.versions ? `${e.versions} save${e.versions === 1 ? '' : 's'}` : ''}</span></span>
    </button>
  )
}
