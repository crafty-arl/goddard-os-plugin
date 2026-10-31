// Outputs: what an agent made, pulled from its replies (file paths and links) and shown inside Goddard OS.
// Files come read-only from the door (/door/api/file), which only serves from shared folders.
import { useEffect, useState } from 'react'

export type Output =
  | { kind: 'file'; path: string; name: string; type: 'image' | 'video' | 'audio' | 'page' | 'pdf' | 'text' | 'md' }
  | { kind: 'link'; url: string; name: string; site: 'claude' | 'substack' | 'web' }

const EXT: Record<string, Extract<Output, { kind: 'file' }>['type']> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image',
  mp4: 'video', webm: 'video', mov: 'video', mp3: 'audio', wav: 'audio',
  html: 'page', htm: 'page', pdf: 'pdf', md: 'md', txt: 'text', json: 'text', csv: 'text',
}

export function findOutputs(texts: string[]): Output[] {
  const out: Output[] = [], seen = new Set<string>()
  for (const raw of texts) {
    const t = decode(raw)
    for (const m of t.matchAll(/https?:\/\/[^\s)<>"'`]+/g)) {
      const url = m[0].replace(/[.,;:!?]+$/, '')
      if (seen.has(url)) continue; seen.add(url)
      const host = new URL(url).host
      const site = host.endsWith('claude.ai') ? 'claude' : host.includes('substack.com') ? 'substack' : 'web'
      out.push({ kind: 'link', url, site, name: site === 'claude' ? 'Claude artifact' : site === 'substack' ? 'Substack draft' : host })
    }
    // home folders and the LaCie drive (where the Goddard Library and campaign plans live)
    for (const m of t.matchAll(/(?:~|\/Users\/[^/\s]+|\/Volumes\/LaCie)\/[^\s`'"<>()]+\.([A-Za-z0-9]{2,4})\b/g)) {
      const path = m[0], type = EXT[m[1].toLowerCase()]
      if (!type || seen.has(path)) continue; seen.add(path)
      out.push({ kind: 'file', path, type, name: path.split('/').pop()! })
    }
  }
  return out
}

export const fileUrl = (path: string, v?: number) => '/door/api/file?path=' + encodeURIComponent(path) + (v ? `&v=${v}` : '')

export function decode(t: string) { const el = document.createElement('textarea'); el.innerHTML = t; return el.value }

const ICON: Record<string, string> = { image: '▣', video: '▶', audio: '♪', page: '◫', pdf: '▤', text: '≡', md: '¶', claude: '✦', substack: '✉', web: '↗' }

// A dog's plan (a Fetch campaign card, or any plan.md) is drawn right in the chat, not left as a path to tap.
export function PlanCards({ outputs, folded }: { outputs: Output[]; folded?: boolean }) {
  const plans = outputs.filter((o): o is Extract<Output, { kind: 'file' }> => o.kind === 'file' && o.type === 'md' && /(^|\/)plan\.md$|\/campaigns\//.test(o.path))
  if (!plans.length) return null
  if (folded) return <>{plans.slice(-1).map(o => <details key={o.path} className="planfold"><summary>See the plan</summary><section className="plancard"><TextView url={fileUrl(o.path)} md /></section></details>)}</>
  return <>{plans.slice(-1).map(o => <section key={o.path} className="plancard"><TextView url={fileUrl(o.path)} md /></section>)}</>
}

export function OutputStrip({ outputs, onOpen }: { outputs: Output[]; onOpen: (o: Output) => void }) {
  if (!outputs.length) return null
  return (
    <section className="outputs">
      <span className="eyebrow">Outputs · {outputs.length}</span>
      <div className="ostrip">
        {outputs.map(o => (
          <button key={o.kind === 'file' ? o.path : o.url} className="ochip" onClick={() => onOpen(o)}>
            {o.kind === 'file' && o.type === 'image'
              ? <img src={fileUrl(o.path)} alt="" loading="lazy" />
              : <span className="oico">{ICON[o.kind === 'file' ? o.type : o.site]}</span>}
            <span className="oname">{o.name}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

// full-screen viewer over the world; B or the close button goes back
export function OutputViewer({ output, onClose }: { output: Output; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Backspace') { e.stopPropagation(); onClose() } }
    addEventListener('keydown', k, true); return () => removeEventListener('keydown', k, true)
  }, [onClose])
  return (
    <div className="viewer" role="dialog" aria-label={output.name}>
      <header>
        <b>{output.name}</b>
        <span className="mono muted small">{output.kind === 'file' ? output.path : output.url}</span>
        <button className="backbtn" onClick={onClose}>B · Close</button>
      </header>
      <div className="vbody">{output.kind === 'file' ? <FileView o={output} /> : <LinkView o={output} />}</div>
    </div>
  )
}

function FileView({ o }: { o: Extract<Output, { kind: 'file' }> }) {
  const url = fileUrl(o.path)
  if (o.type === 'image') return <img className="vimg" src={url} alt={o.name} />
  if (o.type === 'video') return <video className="vimg" src={url} controls />
  if (o.type === 'audio') return <audio src={url} controls />
  // pages run sandboxed: scripts allowed, but no same-origin, so nothing reaches Goddard OS or the door
  if (o.type === 'page') return <SandboxPage url={url} className="vframe" title={o.name} />
  if (o.type === 'pdf') return <iframe className="vframe" src={url} title={o.name} />
  return <TextView url={url} md={o.type === 'md'} />
}

// A page from the Mac, drawn in a sandbox with no way back into Goddard OS. A sandboxed frame can't send the sign-in
// cookie, so the page is fetched here first and handed over as srcdoc (pages with all their parts inline render fully).
export function SandboxPage({ url, className, title }: { url: string; className?: string; title: string }) {
  const [html, setHtml] = useState<string | null>(null)
  useEffect(() => { let on = true; fetch(url).then(r => (r.ok ? r.text() : Promise.reject())).then(t => on && setHtml(t)).catch(() => on && setHtml('<p style="font:14px sans-serif;padding:16px">Could not open this page.</p>')); return () => { on = false } }, [url])
  // a fresh frame per version: changing srcdoc on a live sandboxed frame doesn't always repaint
  return html === null ? <span className={className} /> : <iframe key={html.length + ':' + html.slice(0, 64) + url} className={className} srcDoc={html} sandbox="allow-scripts allow-popups" title={title} tabIndex={-1} />
}

function TextView({ url, md }: { url: string; md: boolean }) {
  const [text, setText] = useState<string | null>(null), [err, setErr] = useState('')
  useEffect(() => { fetch(url).then(r => (r.ok ? r.text() : Promise.reject(new Error(`${r.status}`)))).then(setText).catch(e => setErr(`Couldn't open it (${e.message}).`)) }, [url])
  if (err) return <p className="err">{err}</p>
  if (text === null) return <p className="muted">Opening…</p>
  return md ? <article className="vmd" dangerouslySetInnerHTML={{ __html: markdown(text) }} /> : <pre className="vtext">{text}</pre>
}

function LinkView({ o }: { o: Extract<Output, { kind: 'link' }> }) {
  return (
    <div className="vlink">
      <span className="oico big">{ICON[o.site]}</span>
      <b>{o.name}</b>
      <span className="mono small">{o.url}</span>
      <p className="muted small">{o.site === 'claude' ? "Claude artifacts don't open inside other apps (they need your claude.ai login), so this opens it in the browser." : 'Opens in the browser.'}</p>
      <a className="pillbtn" href={o.url} target="_blank" rel="noreferrer">Open</a>
    </div>
  )
}

// a small markdown renderer: everything is escaped first, then headings, lists, bold, italics, code and links
function markdown(src: string) {
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
  const inline = (s: string) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
  const out: string[] = []; let list = false, code = false
  for (const line of src.split('\n')) {
    if (line.startsWith('```')) { if (list) { out.push('</ul>'); list = false } out.push(code ? '</pre>' : '<pre>'); code = !code; continue }
    if (code) { out.push(esc(line)); continue }
    const li = line.match(/^\s*[-*]\s+(.*)/)
    if (li) { if (!list) { out.push('<ul>'); list = true } out.push(`<li>${inline(li[1])}</li>`); continue }
    if (list) { out.push('</ul>'); list = false }
    const h = line.match(/^(#{1,4})\s+(.*)/)
    if (h) out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`)
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`)
  }
  if (list) out.push('</ul>'); if (code) out.push('</pre>')
  return out.join('\n')
}
