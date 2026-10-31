// The open layer's footer slot. Message bars render into it (Docked), so on a phone they sit in the bottom bar
// above the tabs, and on a big screen at the foot of the side panel, never inside the scrolling content.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export const FootContext = createContext<HTMLElement | null>(null)

export function Docked({ children }: { children: ReactNode }) {
  const el = useContext(FootContext)
  return el ? createPortal(children, el) : <>{children}</>
}

// the message box grows with what you type, up to about five lines, then scrolls
export const grow = (el: HTMLTextAreaElement) => { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 140) + 'px' }

// 📎 attach: the files go to the Mac (the door saves them in the Goddard Library) and their paths drop into the message,
// so the dog can open them (Carl, 2026-10-28: "allow for file upload")
export function Attach({ onAdd, onError }: { onAdd: (lines: string) => void; onError: (msg: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const pick = async (files: FileList | null) => {
    if (!files?.length) return
    const form = new FormData(); for (const f of Array.from(files)) form.append('file', f)
    setBusy(true)
    try {
      const r = await fetch('/door/api/upload', { method: 'POST', body: form })
      const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }))
      if (!j.ok) throw new Error(j.error ?? 'upload failed')
      onAdd((j.files as { name: string; path: string }[]).map(f => `📎 ${f.name}: ${f.path}`).join('\n'))
    } catch (e) { onError((e as Error).message) } finally { setBusy(false); if (input.current) input.current.value = '' }
  }
  return (
    <>
      <input ref={input} type="file" multiple hidden onChange={e => pick(e.target.files)} />
      <button type="button" className={'attach' + (busy ? ' busy' : '')} aria-label="Attach a file" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? '…' : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" /></svg>}
      </button>
    </>
  )
}

// 🎙 voice: tap to record, tap again to stop. The Mac saves it and turns it into text (Whisper, local), and the words
// drop into the message with the recording's path. Phones only allow the mic on https pages; over plain http it falls
// back to picking a recording (Voice Memos / Files) (Carl, 2026-10-28: "add voice recording").
export function Voice({ onAdd, onError }: { onAdd: (lines: string) => void; onError: (msg: string) => void }) {
  const [state, setState] = useState<'idle' | 'rec' | 'busy'>('idle')
  const [secs, setSecs] = useState(0)
  const rec = useRef<MediaRecorder | null>(null), chunks = useRef<Blob[]>([]), input = useRef<HTMLInputElement>(null)
  const live = typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'
  useEffect(() => { if (state !== 'rec') return; const t0 = Date.now(), id = setInterval(() => setSecs(Math.round((Date.now() - t0) / 1000)), 500); return () => clearInterval(id) }, [state])
  const send = async (blob: Blob, name: string) => {
    setState('busy')
    try {
      const form = new FormData(); form.append('file', blob, name)
      const r = await fetch('/door/api/voice', { method: 'POST', body: form })
      const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }))
      if (!j.ok) throw new Error(j.error ?? 'voice note failed')
      onAdd((j.text ? j.text + '\n' : '') + `🎙 voice note: ${j.path}`)
      if (!j.text) onError('Saved the recording, but couldn\'t make out the words.')
    } catch (e) { onError((e as Error).message) } finally { setState('idle'); setSecs(0) }
  }
  const tap = async () => {
    if (state === 'busy') return
    if (!live) { input.current?.click(); return }
    if (state === 'rec') { rec.current?.stop(); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream); chunks.current = []
      mr.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data) }
      mr.onstop = () => { stream.getTracks().forEach(t => t.stop()); const type = mr.mimeType || 'audio/webm'; send(new Blob(chunks.current, { type }), type.includes('mp4') ? 'voice.m4a' : 'voice.webm') }
      rec.current = mr; mr.start(); setState('rec')
    } catch { onError('The mic is blocked here. Pick a recording instead.'); input.current?.click() }
  }
  return (
    <>
      <input ref={input} type="file" accept="audio/*" capture="user" hidden onChange={e => { const f = e.target.files?.[0]; if (f) send(f, f.name); e.target.value = '' }} />
      <button type="button" className={'voice ' + state} aria-label={state === 'rec' ? 'Stop recording' : 'Record a voice note'} onClick={tap}>
        {state === 'busy' ? '…' : state === 'rec' ? <span className="mono small">{secs}s ■</span>
          : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v5" /></svg>}
      </button>
    </>
  )
}
