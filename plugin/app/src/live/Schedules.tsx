// Every scheduled job in one list (Carl, 2026-10-29: "make sure there is a way to track all cron jobs made"): the Mac,
// the Proxmox box and Hermes, scanned live by the gm-crons skill, so a job shows up whichever agent made it.
import { useEffect, useState } from 'react'

type Job = { where: string; kind: string; name: string; schedule: string; what: string; on: boolean }

export function Schedules({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<{ jobs: Job[]; reached_proxmox: boolean; at: number } | null>(null)
  const [err, setErr] = useState('')
  const load = (fresh = false) => fetch('/door/api/crons' + (fresh ? '?fresh=1' : '')).then(r => r.json()).then(j => j.ok ? setData(j) : setErr(j.error), () => setErr("Couldn't reach the Mac"))
  useEffect(() => { load() }, [])
  const groups = data ? [...new Set(data.jobs.map(j => j.where))] : []
  return (
    <section className="calm" aria-label="Schedules">
      <button className="calm-quiet sess-back" onClick={onBack}>← Goddard</button>
      <header className="calm-head"><h1>Schedules</h1>
        <span className="calm-sub sess-hint">{data ? `${data.jobs.length} jobs that run on their own, on every machine. Checked ${new Date(data.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : err || 'Checking every machine…'}</span>
      </header>
      {data && !data.reached_proxmox && <p className="calm-sub sess-wait">Couldn't reach the Proxmox box, so its jobs and Hermes's aren't listed.</p>}
      {groups.map(g => (
        <section key={g} className="sched-group">
          <span className="calm-from">{g} · {data!.jobs.filter(j => j.where === g).length}</span>
          {data!.jobs.filter(j => j.where === g).map((j, i) => (
            <details key={g + i} className="sched-row">
              <summary><i className={j.on ? 'on' : ''} aria-label={j.on ? 'on' : 'off'} /><b>{j.name}</b><span>{j.schedule}</span></summary>
              <p className="calm-sub mono">{j.kind} · {j.what}</p>
            </details>
          ))}
        </section>
      ))}
      {data && <button className="calm-quiet" onClick={() => { setData(null); load(true) }}>Check again</button>}
    </section>
  )
}
