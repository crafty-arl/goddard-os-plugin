// Sign-in and devices (Carl, 2026-10-30: "each phone gets its own key you can revoke ... use Passkey"). Add a passkey
// for this device, see every device that has one, remove any of them, and turn the shared password link off once
// every device you use has a passkey. The server side is passkeys.ts, in front of everything.
import { useEffect, useState } from 'react'
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'

type Dev = { id: string; name: string; created: number; lastSeen: number; active: boolean; me: boolean }
const post = (url: string, body?: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })
  .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? `${r.status}`); return j })
const when = (t: number) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' })
const guessName = () => /iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) ? 'iPad' : /Android/.test(navigator.userAgent) ? 'Android phone' : /Mac/.test(navigator.userAgent) ? 'Mac' : 'This device'

// the Locked screen's passkey button: one tap, Face ID, in
export async function passkeySignIn(): Promise<string> {
  const opts = await post('/auth/login/options')
  const r = await startAuthentication({ optionsJSON: opts })
  const j = await post('/auth/login/verify', r)
  return j.device as string
}

export function SignIn({ onBack, onToast }: { onBack: () => void; onToast: (m: string) => void }) {
  const [devs, setDevs] = useState<Dev[] | null>(null)
  const [pw, setPw] = useState(true)
  const [secure, setSecure] = useState(true)
  const [name, setName] = useState(guessName())
  const [busy, setBusy] = useState(false)
  const [sure, setSure] = useState<string | null>(null) // the device waiting on a second tap to remove
  const load = () => {
    fetch('/auth/state').then(r => r.json()).then(s => setSecure(!!s.secure)).catch(() => {})
    fetch('/auth/devices').then(r => r.json()).then(j => { setDevs(j.devices ?? []); setPw(j.passwordSignIn !== false) }).catch(() => setDevs([]))
  }
  useEffect(load, [])
  const add = async () => {
    setBusy(true)
    try {
      const opts = await post('/auth/register/options')
      const response = await startRegistration({ optionsJSON: opts })
      await post('/auth/register/verify', { name, response })
      onToast(`Passkey saved for ${name}`); load()
    } catch (e) { onToast((e as Error).name === 'NotAllowedError' ? 'Cancelled' : (e as Error).message) }
    setBusy(false)
  }
  const remove = (d: Dev) => post('/auth/devices/revoke', { id: d.id }).then(() => { onToast(`${d.name} removed. It's signed out now.`); setSure(null); load() }, e => onToast(e.message))
  const setPassword = (on: boolean) => post('/auth/password', { on }).then(() => { setPw(on); onToast(on ? 'The password link works again' : 'The password link is off. Passkeys only.') }, e => onToast(e.message))
  const me = devs?.find(d => d.me)

  return (
    <section className="sess setup" aria-label="Sign-in and devices">
      <header className="sess-head">
        <button className="calm-quiet" onClick={onBack}>← Home</button>
        <h1>Sign-in</h1>
        <span className="sess-head-pad" aria-hidden="true" />
      </header>
      <div className="setup-body">
        <p className="calm-sub">Each phone or computer signs in with its own passkey (Face ID or Touch ID). Remove a device and it's signed out at once.</p>
        {!secure && <p className="setup-test bad">Passkeys need the https address. Open Goddard OS from its https link to add one.</p>}
        <span className="calm-from">This device</span>
        {me ? <p className="setup-test ok">✓ Signed in with its passkey: {me.name}</p> : <>
          <label className="setup-field"><span>Name it</span><input value={name} onChange={e => setName(e.target.value)} maxLength={40} /></label>
          <div className="setup-tests"><button onClick={add} disabled={busy || !secure || !name.trim()}>{busy ? 'Waiting for Face ID…' : 'Add a passkey for this device'}</button></div>
        </>}
        <span className="calm-from">Devices with a passkey · {devs?.length ?? 0}</span>
        {devs?.length === 0 && <p className="home-empty">None yet.</p>}
        {devs?.map(d => (
          <div key={d.id} className="home-row signin-dev">
            <b>{d.name}{d.me ? ' (this one)' : ''}</b>
            <span className="muted">added {when(d.created)} · seen {when(d.lastSeen)}</span>
            {sure === d.id ? <button className="signin-x on" onClick={() => remove(d)}>Remove?</button> : <button className="signin-x" onClick={() => setSure(d.id)} aria-label={`Remove ${d.name}`}>Remove</button>}
          </div>
        ))}
        <span className="calm-from">The password link</span>
        <button className={'setup-toggle' + (pw ? ' on' : '')} role="switch" aria-checked={pw} onClick={() => setPassword(!pw)} disabled={!pw ? false : !me}>
          <span>{pw ? 'On: the old sign-in link still works' : 'Off: passkeys only'}</span><i aria-hidden="true" />
        </button>
        <p className="calm-sub">{pw ? (me ? 'Turn it off once every device you use has a passkey.' : 'You can turn it off from a device that signed in with its passkey.') : 'Only devices on the list above can get in.'}</p>
      </div>
    </section>
  )
}
