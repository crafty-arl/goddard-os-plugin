import { useEffect, useState } from 'react'

// the dog computer's screen, live, in the thread (Carl, 2026-10-29: "no matter what when you open the vm you're
// showing the visual part"). Watch-only so a stray tap can't fight the dog; "Take over" opens it with control for
// logins Carl does himself. Comes through this app's own address, so it works away from home too.
export const DOG_STEP = /^(Browser:|On the dog computer|Turning the dog computer on|Checking the dog computer|Taking a save point|Rolling the dog computer)/

export function usesDogComputer(steps: { text: string }[]) {
  return steps.some(s => DOG_STEP.test(s.text.replace(/^» /, '')))
}

// the phone keyboard won't open inside the screen viewer (Carl, 2026-10-29: "there is no keyboard appearing when i
// try to type in the VM"), so typing happens here: tap the field on the dog's screen with Take over, then type below
async function send(body: { text?: string; key?: string; slot?: number }) {
  const r = await fetch('/dogview/type', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(await r.text())
}
export function Keys({ onError, slot }: { onError: (m: string) => void; slot?: number }) {
  const [text, setText] = useState('')
  const [secret, setSecret] = useState(false)
  const go = (b: { text?: string; key?: string }) => send({ ...b, slot }).catch(e => onError((e as Error).message))
  return (
    <form className="dogkeys" onSubmit={e => { e.preventDefault(); if (text) { go({ text }); setText('') } }}>
      <input value={text} onChange={e => setText(e.target.value)} type={secret ? 'password' : 'text'} placeholder="Type here, it goes to the dog's screen"
        autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} enterKeyHint="send" aria-label="Text to type on the dog computer" />
      <div className="dogkeys-row">
        <button type="submit" className="primary" disabled={!text}>Send</button>
        <button type="button" onClick={() => go({ key: 'enter' })}>Enter</button>
        <button type="button" onClick={() => go({ key: 'backspace' })} aria-label="Backspace">⌫</button>
        <button type="button" onClick={() => go({ key: 'tab' })}>Tab</button>
        <label className="small muted"><input type="checkbox" checked={secret} onChange={e => setSecret(e.target.checked)} /> Hide</label>
      </div>
    </form>
  )
}

// a slim bar in the thread; tapping it pulls the screen out full-size (Carl, 2026-10-30: "the vm should be the off
// screen view, it appears when i tap the header"). The dog's screen is tall like a phone, so it fills an upright phone.
export function DogScreen({ busy, onOpen, slot }: { busy: boolean; onOpen?: () => void; slot?: number }) {
  const base = slot ? `/dogview/${slot}/` : '/dogview/'
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState(0)
  const [typing, setTyping] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    addEventListener('keydown', esc); document.body.style.overflow = 'hidden'
    return () => { removeEventListener('keydown', esc); document.body.style.overflow = '' }
  }, [open])
  return (
    <>
      <button className={'dogbar' + (busy ? ' live' : '')} onClick={() => onOpen ? onOpen() : setOpen(true)} aria-expanded={open} aria-controls="dogsheet">
        <i aria-hidden="true" /><span className="dogbar-what">{busy ? "Dog's screen · live" : "Dog's screen"}</span><span aria-hidden="true">Watch ›</span>
      </button>
      {open && (
        <div id="dogsheet" className="dogsheet" role="dialog" aria-modal="true" aria-label="The dog computer's screen">
          <header>
            <span className="eyebrow">{typing ? "You're driving" : busy ? 'Live' : 'Dog computer'}</span>
            <span className="dogscreen-btns">
              <button className="calm-quiet" onClick={() => setKey(k => k + 1)}>Reconnect</button>
                            <button className="calm-quiet" onClick={() => { setTyping(t => !t); setErr('') }} aria-expanded={typing}>Keyboard</button>
              <button className="calm-quiet dogsheet-close" onClick={() => setOpen(false)}>Close</button>
            </span>
          </header>
          {typing && <Keys onError={setErr} slot={slot} />}
          {err && <p className="small" role="alert">{err}</p>}
          <div className="dogsheet-stage"><div className="dogsheet-frame">
            <iframe key={key + (typing ? '-c' : '')} src={typing ? base + '?control' : base} title="The dog computer's screen, live" allow="clipboard-read; clipboard-write" />
          </div></div>
        </div>
      )}
    </>
  )
}
