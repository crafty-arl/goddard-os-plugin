// Check-ins (Carl, 2026-10-28: "do check-ins through app push notifications"): the home-screen app subscribes to push,
// and the door pings when a dog or Goddard needs Carl or comes back with work. iPhone only allows this in the app
// added to the home screen from the https address.
import { useEffect, useState } from 'react'

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
const b64 = (s: string) => { const p = (s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(p), c => c.charCodeAt(0)) }

export function registerWorker() { if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {}) }

export function CheckIns({ onToast }: { onToast: (m: string) => void }) {
  const [state, setState] = useState<'off' | 'on' | 'blocked' | 'unsupported'>('off')
  useEffect(() => {
    if (!supported()) return setState('unsupported')
    if (Notification.permission === 'denied') return setState('blocked')
    navigator.serviceWorker.ready.then(r => r.pushManager.getSubscription()).then(s => setState(s ? 'on' : 'off')).catch(() => {})
  }, [])
  const turnOn = async () => {
    try {
      if ((await Notification.requestPermission()) !== 'granted') return setState('blocked')
      const reg = await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready
      const { key } = await fetch('/door/api/push/key').then(r => r.json())
      const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) })
      const r = await fetch('/door/api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sub }) }).then(r => r.json())
      if (!r.ok) throw new Error(r.error)
      setState('on'); await fetch('/door/api/push/test', { method: 'POST' })
    } catch (e) { onToast(`Couldn't turn on check-ins: ${(e as Error).message}`) }
  }
  if (state === 'on') return <div className="checkins on"><span>🔔 Check-ins on</span><button onClick={() => fetch('/door/api/push/test', { method: 'POST' }).then(() => onToast('Test sent'))}>Send a test</button></div>
  if (state === 'unsupported') return <div className="checkins"><span className="small muted">For check-ins on your phone: open the https link in Safari, Share → Add to Home Screen, then open it from there.</span></div>
  if (state === 'blocked') return <div className="checkins"><span className="small muted">Notifications are off for Goddard. Turn them on in Settings → Notifications → Goddard.</span></div>
  return <button className="checkins cta" onClick={turnOn}><b>Turn on check-ins</b><span className="small muted">Goddard pings you when a dog needs you or comes back. Never 11 PM to 7 AM.</span></button>
}

// what Goddard owns: the standing list it checks every 30 minutes (Carl edits it)
export function OwnsEditor({ onToast }: { onToast: (m: string) => void }) {
  const [text, setText] = useState<string | null>(null)
  const load = () => fetch('/door/api/owns').then(r => r.json()).then(j => setText(j.text)).catch(() => {})
  const save = () => fetch('/door/api/owns', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) }).then(r => r.json()).then(j => onToast(j.ok ? 'Saved. Goddard uses it at the next check-in.' : j.error))
  return (
    <details className="owns" onToggle={e => { if ((e.target as HTMLDetailsElement).open && text === null) load() }}>
      <summary><b>What Goddard owns</b><span className="small muted">checks it every 30 min, 7 AM to 11 PM</span></summary>
      {text !== null && <>
        <textarea value={text} onChange={e => setText(e.target.value)} aria-label="What Goddard owns" />
        <button className="primary" onClick={save}>Save</button>
      </>}
    </details>
  )
}
