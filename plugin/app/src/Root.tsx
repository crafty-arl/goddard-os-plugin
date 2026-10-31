import { passkeySignIn } from './live/SignIn'
import { useEffect, useState } from 'react'
import { useDoor } from './live/door'
import { LiveApp } from './live/LiveApp'
import { SampleApp } from './App'

// Every screen gets the phone's calm layout, a full-screen browser too (Carl, 2026-10-28: "ensure fullscreen on
// browser matches mobile"). The old desk layout stays one switch away for the TV: add ?desk to the address.
function useWide() {
  const q = '(min-width: 1024px)', desk = new URLSearchParams(location.search).has('desk')
  const [wide, setWide] = useState(() => desk && matchMedia(q).matches)
  useEffect(() => { if (!desk) return; const m = matchMedia(q), f = () => setWide(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f) }, [])
  return wide
}

// Live when the gm-chat door answers; otherwise the labelled sample run, with the reason on top.
export default function Root() {
  const [door, refresh] = useDoor()
  const wide = useWide()
  const [sample, setSample] = useState(false)
  const bad = new URLSearchParams(location.search).get('signin') === 'bad'
  const [pkErr, setPkErr] = useState('')
  // the password form shows only while the owner keeps the old link switched on
  const [pwOn, setPwOn] = useState(true)
  useEffect(() => { fetch('/auth/state').then(r => r.json()).then(s => setPwOn(s.passwordSignIn !== false)).catch(() => {}) }, [])
  if (door.kind === 'ok' && !sample) return <LiveApp list={door.list} wide={wide} refresh={refresh} />
  // away from home and the line dropped: keep the last board on screen, read-only in spirit, with the reason on top
  if (door.kind === 'offline' && door.last && !sample) return (
    <>
      <div className="offline" role="status">
        <b>{door.why === 'mac' ? "Can't reach the Mac" : "The gm-chat door isn't answering"}</b>
        <span>{door.seen ? `Last seen ${ago(door.seen)}. ` : ''}{door.why === 'mac' ? 'Check Tailscale is on, with subnets allowed.' : 'The Mac is up; the door will be back when a thread starts it.'} Showing the last board.</span>
        <button onClick={refresh}>Retry</button>
      </div>
      <LiveApp list={door.last} wide={wide} refresh={refresh} stale />
    </>
  )
  if (door.kind === 'loading') return <div className="boot mono muted">Knocking on the door…</div>
  return (
    <>
      {!sample && (
        <div className="doorline">
          {door.kind === 'locked'
            ? <><button className="signin-pk" onClick={() => passkeySignIn().then(() => location.replace('/'), e => setPkErr((e as Error).name === 'NotAllowedError' ? '' : (e as Error).message))}>Sign in with a passkey</button>
              {pkErr && <b className="signin-err">{pkErr}</b>}
              {pwOn && <form className="signin" method="post" action="/signin">
                <span>Locked. Paste your gm-chat sign-in link (on the Mac: <span className="mono">cat ~/.claude/channels/gm-chat/link.txt</span>).</span>
                {bad && <b>That link didn't match. Check it's the latest one.</b>}
                <input name="link" type="password" autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="http://…:8787/?p=…" required />
                <button type="submit">Sign in</button>
              </form>}</>
            : door.kind === 'offline' ? (door.why === 'mac'
              ? <>Can't reach the Mac. Away from home? Turn on Tailscale with subnets allowed, then retry. <button onClick={refresh}>Retry</button></>
              : <>The gm-chat door isn't answering on the Mac. Start a gm-chat thread to bring it up.</>) : null}
          <button onClick={() => setSample(true)}>Show the sample</button>
        </div>
      )}
      {sample && <SampleApp />}
    </>
  )
}

function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
