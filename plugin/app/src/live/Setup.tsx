// Setup (ship plan, 2026-10-30): six steps, one at a time, that write the owner's profile (profile.json, kept by the
// door). Every part after the first can be skipped, and each has a "Test it" button. Nothing is saved until the last
// step's Save, so walking through it never changes a running setup. Carl's own profile fills every step in.
import { useEffect, useState, type ReactNode } from 'react'
import { CheckIns } from './checkins'

type Profile = {
  owner: { name: string; call: string; studio?: string }
  memory?: { on: boolean; path: string }
  dogComputer?: { on: boolean; kind: 'proxmox-vm' | 'this-mac'; host?: string; vm?: string; slots: number }
  helper?: { on: boolean; name: string; bus: string }
  bigDrive?: { on: boolean; path: string }
  pings?: { on: boolean; quiet: [number, number]; perHour: number }
  phone?: { reach: 'wifi' | 'tailscale'; host?: string }
}
type Test = { ok: boolean; said: string } | 'testing'

const STEPS = ['You and your Mac', 'Reach it from your phone', 'Your dogs', 'The dog computer', 'Pings', 'More connections']
const hour = (h: number) => h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? 'noon' : `${h - 12} PM`

export function Setup({ onBack, onPack, onToast }: { onBack: () => void; onPack: () => void; onToast: (m: string) => void }) {
  const [p, setP] = useState<Profile | null>(null)
  const [step, setStep] = useState(0)
  const [tests, setTests] = useState<Record<string, Test>>({})
  const [saving, setSaving] = useState(false)
  useEffect(() => { fetch('/door/api/profile').then(r => r.json()).then(j => setP(j.profile)).catch(() => onToast("Couldn't read the setup")) }, [])
  if (!p) return <section className="calm"><button className="calm-quiet sess-back" onClick={onBack}>← Home</button><p className="calm-line">Reading your setup…</p></section>

  const set = (f: (q: Profile) => Profile) => setP(q => q && f(q))
  const test = (part: string, value: Record<string, unknown> = {}) => {
    setTests(t => ({ ...t, [part]: 'testing' }))
    fetch('/door/api/profile/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ part, value }) })
      .then(r => r.json()).then(r => setTests(t => ({ ...t, [part]: r })), () => setTests(t => ({ ...t, [part]: { ok: false, said: "Couldn't run the test" } })))
  }
  const result = (part: string) => { const t = tests[part]; return t && <p className={'setup-test ' + (t === 'testing' ? '' : t.ok ? 'ok' : 'bad')} role="status">{t === 'testing' ? 'Testing…' : (t.ok ? '✓ ' : '✕ ') + t.said}</p> }
  const save = () => {
    setSaving(true)
    fetch('/door/api/profile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) }).then(r => r.json())
      .then(j => { if (j.error) throw new Error(j.error); onToast('Setup saved'); onBack() }).catch(e => { setSaving(false); onToast((e as Error).message) })
  }
  const mem = p.memory ?? { on: false, path: '~/notes' }
  const dc = p.dogComputer ?? { on: false, kind: 'this-mac' as const, slots: 3 }
  const helper = p.helper ?? { on: false, name: 'Helper', bus: '' }
  const drive = p.bigDrive ?? { on: false, path: '/Volumes/' }
  const pings = p.pings ?? { on: true, quiet: [23, 7] as [number, number], perHour: 1 }

  const body: ReactNode[] = [
    <>
      <Field label="Your name"><input value={p.owner.name} onChange={e => set(q => ({ ...q, owner: { ...q.owner, name: e.target.value } }))} maxLength={40} /></Field>
      <Field label="What the dogs call you"><input value={p.owner.call} onChange={e => set(q => ({ ...q, owner: { ...q.owner, call: e.target.value } }))} maxLength={20} /></Field>
      <Field label="Your studio's name"><input value={p.owner.studio ?? ''} onChange={e => set(q => ({ ...q, owner: { ...q.owner, studio: e.target.value } }))} maxLength={40} placeholder="optional" /></Field>
      <Toggle on={mem.on} onChange={on => set(q => ({ ...q, memory: { ...mem, on } }))} label="A notes folder the dogs read" />
      {mem.on && <Field label="Notes folder"><input value={mem.path} onChange={e => set(q => ({ ...q, memory: { ...mem, path: e.target.value } }))} /></Field>}
      <div className="setup-tests"><button onClick={() => test('mac')}>Test this Mac</button>{mem.on && <button onClick={() => test('memory', mem)}>Test the folder</button>}</div>
      {result('mac')}{result('memory')}
    </>,
    <>
      <Choice value={p.phone?.reach ?? 'wifi'} onChange={v => set(q => ({ ...q, phone: { ...q.phone, reach: v as 'wifi' | 'tailscale' } }))} options={[
        ['wifi', 'Home wifi only', 'Simplest. Works when your phone is on the same wifi as this Mac.'],
        ['tailscale', 'From anywhere, through Tailscale', 'Your phone reaches the app away from home too. Needs Tailscale on your phone and on a box at home.'],
      ]} />
      {p.phone?.reach === 'tailscale' && <Field label="Its https address"><input value={p.phone.host ?? ''} onChange={e => set(q => ({ ...q, phone: { reach: 'tailscale', host: e.target.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '') } }))} placeholder="your-box.tailnet.ts.net" /></Field>}
      <p className="calm-sub">To check it, open this app on your phone{p.phone?.reach === 'tailscale' ? ' with wifi off' : ''}. If Home loads, it works.</p>
    </>,
    <>
      <p className="calm-sub">Each dog is its own Claude session with one job. Your dogs live in The pack, where you add, rename or change them.</p>
      <button className="calm-start" onClick={onPack}><b>Open The pack</b><span>See your dogs and add a new one.</span></button>
    </>,
    <>
      <Choice value={dc.on ? dc.kind : 'none'} onChange={v => set(q => ({ ...q, dogComputer: v === 'none' ? { ...dc, on: false } : { ...dc, on: true, kind: v as 'proxmox-vm' | 'this-mac' } }))} options={[
        ['none', 'None', 'The dogs work with files and links only.'],
        ['this-mac', 'A browser on this Mac', 'The dogs open pages on this Mac. You watch them work here.'],
        ['proxmox-vm', 'A VM on a home server', 'The dogs get their own computer with its own screen, one per session. Needs a Proxmox box.'],
      ]} />
      {dc.on && dc.kind === 'proxmox-vm' && <>
        <Field label="Server, as user@address"><input value={dc.host ?? ''} onChange={e => set(q => ({ ...q, dogComputer: { ...dc, host: e.target.value } }))} placeholder="root@192.168.1.10" /></Field>
        <Field label="The VM's address"><input value={dc.vm ?? ''} onChange={e => set(q => ({ ...q, dogComputer: { ...dc, vm: e.target.value } }))} /></Field>
        <Field label="Screens at once"><input type="number" min={1} max={6} value={dc.slots} onChange={e => set(q => ({ ...q, dogComputer: { ...dc, slots: Math.max(1, Math.min(6, Number(e.target.value) || 1)) } }))} /></Field>
      </>}
      {dc.on && <div className="setup-tests"><button onClick={() => test('dogComputer', dc)}>Test it</button></div>}
      {result('dogComputer')}
    </>,
    <>
      <Toggle on={pings.on} onChange={on => set(q => ({ ...q, pings: { ...pings, on } }))} label="Ping my phone when a dog needs me or comes back" />
      {pings.on && <>
        <div className="setup-row">
          <Field label="Quiet from"><select value={pings.quiet[0]} onChange={e => set(q => ({ ...q, pings: { ...pings, quiet: [Number(e.target.value), pings.quiet[1]] } }))}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hour(h)}</option>)}</select></Field>
          <Field label="Until"><select value={pings.quiet[1]} onChange={e => set(q => ({ ...q, pings: { ...pings, quiet: [pings.quiet[0], Number(e.target.value)] } }))}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hour(h)}</option>)}</select></Field>
        </div>
        <p className="calm-sub">At most one ping an hour. Anything else waits and comes as one digest.</p>
        <CheckIns onToast={onToast} />
        <div className="setup-tests"><button onClick={() => test('pings')}>Test it</button></div>
        {result('pings')}
      </>}
    </>,
    <>
      <Toggle on={helper.on} onChange={on => set(q => ({ ...q, helper: { ...helper, on } }))} label="An always-on helper on another box" />
      {helper.on && <>
        <Field label="Its name"><input value={helper.name} onChange={e => set(q => ({ ...q, helper: { ...helper, name: e.target.value } }))} /></Field>
        <Field label="Its address"><input value={helper.bus} onChange={e => set(q => ({ ...q, helper: { ...helper, bus: e.target.value } }))} placeholder="http://192.168.1.20:7790" /></Field>
        <div className="setup-tests"><button onClick={() => test('helper', helper)}>Test it</button></div>{result('helper')}
      </>}
      <Toggle on={drive.on} onChange={on => set(q => ({ ...q, bigDrive: { ...drive, on } }))} label="A drive for big files" />
      {drive.on && <>
        <Field label="Where it mounts"><input value={drive.path} onChange={e => set(q => ({ ...q, bigDrive: { ...drive, path: e.target.value } }))} /></Field>
        <div className="setup-tests"><button onClick={() => test('bigDrive', drive)}>Test it</button></div>{result('bigDrive')}
      </>}
    </>,
  ]

  const last = step === STEPS.length - 1
  return (
    <section className="sess setup" aria-label="Setup">
      <header className="sess-head">
        <button className="calm-quiet" onClick={onBack}>← Home</button>
        <h1>Setup</h1>
        <span className="sess-head-pad" aria-hidden="true" />
      </header>
      <div className="setup-body">
        <div className="setup-dots" aria-label={`Step ${step + 1} of ${STEPS.length}`}>{STEPS.map((s, i) => <button key={s} className={i === step ? 'now' : i < step ? 'done' : ''} onClick={() => setStep(i)} aria-label={s} />)}</div>
        <span className="calm-from">Step {step + 1} of {STEPS.length}{step > 0 ? ' · you can skip this' : ''}</span>
        <h2 className="setup-h">{STEPS[step]}</h2>
        {body[step]}
      </div>
      <div className="setup-nav">
        {step > 0 && <button onClick={() => setStep(s => s - 1)}>Back</button>}
        {last ? <button className="go" disabled={saving || !p.owner.name.trim()} onClick={save}>{saving ? 'Saving…' : 'Save setup'}</button>
          : <button className="go" disabled={!p.owner.name.trim()} onClick={() => setStep(s => s + 1)}>Next</button>}
      </div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="setup-field"><span>{label}</span>{children}</label>
}
function Toggle({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return <button className={'setup-toggle' + (on ? ' on' : '')} role="switch" aria-checked={on} onClick={() => onChange(!on)}><span>{label}</span><i aria-hidden="true" /></button>
}
function Choice({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string, string][] }) {
  return (
    <div className="setup-choices" role="radiogroup">
      {options.map(([v, t, d]) => <button key={v} role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}><b>{t}</b><span>{d}</span></button>)}
    </div>
  )
}
