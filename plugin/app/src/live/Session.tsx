// A session (Carl, 2026-10-28): someone brings an artifact (a file, a link, a note, a voice memo), and a dog builds the
// system around it and the plan to move it forward, then works it with them one question at a time. On a big screen
// the talk is on the left and the board on the right: what was brought, the phases, the sheet filling in from their
// own words, the skills and files in use, and what done means. On a phone the board folds above the talk.
import { useEffect, useRef, useState } from 'react'
import { type Thread, type SavePoint, type SessionMode, MODES, modeLabel, useThread, startSession, setSessionMode, endSession, saveSession, sessionTitle, isSession, loadSaves, undoTo } from './door'
import { type Output, findOutputs, OutputStrip, PlanCards } from './outputs'

// what a finished session hands the next one: its saved sheet, what comes next, and a name
export type Carry = { brought: string; want: string; title: string }
const docOf = (path: string): Output => ({ kind: 'file', path, type: 'md', name: path.split('/').pop()! })
import { linkify } from './ChatPanel'
import { Attach, Voice, grow } from './dock'
import { DogScreen, Keys, usesDogComputer } from './DogScreen'
import { VideoPreview, ExportCard, StagingCard, RigRenderCard, LinesCard } from './VideoPreview'
import { Animate } from './Animate'
import { Talk, rich, grouped, useBionic, setBionic, usePace, setPace, type Pace } from './talk'

const DRAFT = 'goddard.session-draft'

// step 1: bring something
export function SessionStart({ onStarted, onCancel, onToast, carry }: { onStarted: (port: number) => void; onCancel: () => void; onToast: (m: string) => void; carry?: Carry }) {
  // Carl, 2026-10-29: "when i start a session just take me to a chat page and my first prompt should go through a back
  // end prompt to ensure my prompt is properly scoped". One box; the door scopes the first message before the dog sees it.
  // What he typed is kept on this device until the session starts, so a reload never loses it.
  // a kept draft only comes back for 30 minutes, and a carried-on start is never kept: old text must never ride along
  // on a new session (the audit found an old prompt stuck onto the Cocktails one)
  const saved = (() => { try { const d = JSON.parse(localStorage.getItem(DRAFT) || '{}'); return d.at && Date.now() - d.at < 30 * 60000 ? d : {} } catch { return {} } })()
  const first = carry ? [carry.brought, carry.want].filter(Boolean).join('\n') : [saved.text ?? saved.brought, saved.want].filter(Boolean).join('\n')
  const [draft, setDraft] = useState<string>(first)
  const [sent, setSent] = useState<string | null>(null)
  const [pending, setPending] = useState(0)
  const [auto, setAuto] = useState(false)
  const [mode, setMode] = useState<SessionMode>('plan')
  const isAuto = mode === 'plan' && (auto || /^\s*auto\b/i.test(draft))
  useEffect(() => { if (carry) return; try { draft.trim() ? localStorage.setItem(DRAFT, JSON.stringify({ text: draft, at: Date.now() })) : localStorage.removeItem(DRAFT) } catch { /* this visit only */ } }, [draft])
  const add = (l: string) => { setPending(n => Math.max(0, n - 1)); setDraft(d => (d ? d + '\n' : '') + l) }
  const go = () => {
    const t = draft.trim()
    if (!t || sent) return
    setSent(t)
    startSession(t, '', carry?.title ?? '', isAuto, mode).then(j => { try { localStorage.removeItem(DRAFT) } catch { /* fine */ } onStarted(j.port) },
      e => { setSent(null); onToast((e as Error).message) })
  }
  return (
    <section className="sess" aria-label="New session">
      <header className="sess-head">
        <button className="calm-quiet" onClick={onCancel}>← Goddard</button>
        <h1>{carry ? 'Carry it on' : 'New session'}</h1>
        <span />
      </header>
      <div className="sess-talk sess-new">
        <div className="sess-msgs" role="log">
          {!sent && <p className="sess-msg dog">{mode === 'talk' ? "What's on your mind? Just say it." : mode === 'do' ? "What should I do? Bring a file, a link, a voice note, or just say it. I'll get straight to it." : "What are we working on? Bring a file, a link, a voice note, or just say it. I'll scope it, set up the plan, and we go."}</p>}
          {sent && <p className="sess-msg me">{linkify(sent)}</p>}
          {!sent && isAuto && <p className="sess-note">Auto is on: the dog runs it end to end for up to 45 minutes and reports back. Your creative calls get parked for you, and nothing goes live without your tap.</p>}
          {sent && <div className="sess-working"><span className="eyebrow">{mode === 'talk' ? 'Opening the chat' : isAuto ? 'Scoping it · Auto' : 'Scoping it'}</span><p className="calm-sub">{mode === 'talk' ? 'A dog picks it up in a moment.' : "Pinning down what it is, what done looks like, and what's out of scope. Then a dog picks it up."}</p></div>}
        </div>
        {!sent && pending > 0 && <p className="calm-sub sess-why">Your file or recording is still coming through.</p>}
        {!sent && <ModePick mode={mode} onPick={setMode} />}
        {!sent && mode === 'plan' && <div className="sess-choices"><button className={isAuto ? 'go' : ''} aria-pressed={isAuto} onClick={() => setAuto(v => !v)}>{isAuto ? 'Auto: on' : 'Auto: off'}</button></div>}
        <form className="sess-say" onSubmit={e => { e.preventDefault(); go() }}>
          <span onClickCapture={() => setPending(n => n + 1)} style={{ display: 'contents' }}><Attach onAdd={add} onError={m => { setPending(0); onToast(m) }} /><Voice onAdd={add} onError={m => { setPending(0); onToast(m) }} /></span>
          <textarea value={draft} rows={1} disabled={!!sent} onChange={e => { setDraft(e.target.value); grow(e.target) }} placeholder="Just talk…" aria-label="Your first message" autoFocus
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go() } }} />
          <button type="submit" disabled={!draft.trim() || !!sent} aria-label="Send">↑</button>
        </form>
      </div>
    </section>
  )
}

// step 2 on: the talk and the board
export function SessionView({ thread, onBack, onToast, onView, onContinue }: { thread?: Thread; port: number; onBack: () => void; onToast: (m: string) => void; onView: (o: Output) => void; onContinue: (c: Carry) => void }) {
  const port = thread?.port ?? null
  const live = useThread(port)
  const [draft, setDraft] = useState('')
  const [drawer, setDrawer] = useState(false)
  const [saves, setSaves] = useState<SavePoint[]>([])
  // the screen view (Carl, 2026-10-30): once a dog is on its computer, the session becomes the dog's screen with the
  // HUD, chat and composer each in their own zone around it. null = automatic; ← in the HUD goes back to the chat
  const [screen, setScreen] = useState<boolean | null>(null)
  const [typing, setTyping] = useState(false)
  const [keyErr, setKeyErr] = useState('')
  const [bare, setBare] = useState(false) // Hide: just the screen, nothing on it
  useEffect(() => { if (port) loadSaves(port).then(setSaves, () => {}) }, [port, live.steps.length])
  const perm = live.asks[0]
  const end = useRef<HTMLDivElement>(null)
  // the kickoff is the door's hand-off to the dog, not something Carl said (the board shows what he brought)
  // the kickoff is the door's hand-off to the dog; Carl sees only his own first words from it
  const msgs = live.msgs.filter(m => !(m.from === 'user' && /^Carl reopened this/.test(m.text)))
    .map(m => m.from === 'user' && /^Carl switched this chat/.test(m.text) ? { ...m, text: `↪ Switched to ${m.text.match(/ to (Plan it|Just talk|Just do it)\./)?.[1] ?? 'a new mode'}` } : m)
    .map(m => m.from === 'user' && /^New (session\.|chat \(Just talk\)\.|job \(Just do it\)\.)/.test(m.text) ? { ...m, text: m.text.match(/Carl's words:\n([\s\S]*?)\n---/)?.[1] ?? '' } : m).filter(m => m.text)
    .map(m => m.from === 'assistant' && m.text.startsWith("Here's the setup for") ? { ...m, text: "Here's the setup. It's on the board: what you brought, the phases, the sheet we'll fill, and what done means. Go?" } : m)
  const noteOf = (m: { from: string; text: string }) => m.from === 'user' && /^From Home:/.test(m.text) ? 'Goddard passed the dog a note' : m.from === 'user' && m.text.startsWith('↪ ') ? m.text.slice(2) : null
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [msgs.length, live.busy.on, live.steps.length])
  const say = (t: string) => { if (!t.trim()) return; if (!live.say(t.trim())) onToast('Not connected yet. One second.'); else setDraft('') }
  const last = [...msgs].reverse()[0]
  const lastMine = [...msgs].reverse().find(m => m.from === 'user')?.ts ?? 0
  // suggestions of what to say next always show once the dog has answered: its own, or plain ones that keep it moving
  const FALLBACK = thread?.board?.finished ? ['What comes next?', 'Read it back to me'] : ['Ask me something harder', "What's still open?", 'Show me the sheet so far']
  const mode = thread?.sessionMode ?? 'plan'
  // only Plan it fills in suggestions of its own; a chat or a job shows the dog's, when it gave some
  const choices = last?.from === 'assistant' ? (last.choices?.length ? last.choices : mode === 'plan' ? FALLBACK : []) : []
  const [switching, setSwitching] = useState(false)
  // a paper robot video session shows what the dog made right in the talk: the spec card (plan.md) and the video, in
  // the same card and strip Home uses. Other sessions are unchanged.
  const robot = live.msgs.some(m => m.text.includes('paper-robot') || (m.from === 'assistant' && (m.text.includes('Preview it live') || m.text.includes('/staging.json') || m.text.includes('/lines.json'))))
  const outs = robot ? findOutputs(msgs.filter(m => m.from === 'assistant').map(m => m.text)) : []
  // the spec card's sketch plays live before it renders; export and changes go back through the dog
  const card = [...outs].reverse().find(o => o.kind === 'file' && /(^|\/)plan\.md$/.test(o.path)) as Extract<Output, { kind: 'file' }> | undefined
  const [preview, setPreview] = useState<string | null>(null)
  const [animate, setAnimate] = useState<string | null>(null)
  // the staging the dog wrote (the newest staging.json it named), drawn as the staging card above the spec
  // Grok's draft (the newest lines.json the dog named), drawn as the lines card
  const linesFile = robot ? [...msgs].reverse().filter(m => m.from === 'assistant').map(m => m.text.match(/(?:~|\/)[^\s`'"]*\/lines\.json/)?.[0]).find(Boolean) : undefined
  const staging = robot ? [...msgs].reverse().filter(m => m.from === 'assistant').map(m => m.text.match(/(?:~|\/)[^\s`'"]*\/staging\.json/)?.[0]).find(Boolean) : undefined
  const sayRef = useRef<HTMLTextAreaElement>(null)
  const bionic = useBionic(), pace = usePace()
  // Focus mode: one question on the screen, everything else gone, pings held on the door until it ends
  const [focusUntil, setFocusUntil] = useState(0)
  const focusFor = (minutes: number) => fetch('/door/api/focus', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ minutes }) })
    .then(r => r.json()).then((j: { until: number }) => setFocusUntil(j.until || 0), () => setFocusUntil(minutes ? Date.now() + minutes * 60000 : 0))
  const switchTo = (m: SessionMode) => { setSwitching(false); if (m === mode || !thread) return
    setSessionMode(thread.port, m).then(() => onToast(`Switched to ${modeLabel(m)}`), e => onToast((e as Error).message)) }
  const b = thread?.board
  const onComputer = live.shots.length > 0 || usesDogComputer(live.steps)
  const showScreen = onComputer && screen !== false
  if (!thread) return <section className="calm"><button className="calm-quiet sess-back" onClick={onBack}>← Goddard</button><p className="calm-line">Waking the dog for this session…</p></section>
  const msgEl = (m: (typeof msgs)[number]) => noteOf(m) ? <p key={m.id} className="sess-note">{noteOf(m)}</p> : <div key={m.id} className={'sess-msg ' + (m.from === 'user' ? 'me' : 'dog')}>{rich(m.text)}</div>
  const askEl = perm && (
    <article className={'sess-ask' + (/go live/.test(perm.description) ? ' live' : '')} role="alertdialog" aria-label={perm.description}>
      <b>{perm.description}</b>
      {perm.input_preview && <pre>{perm.input_preview}</pre>}
      <div className="calm-btns"><button className="go" onClick={() => live.verdict(perm.request_id, 'allow')}>Allow</button><button onClick={() => live.verdict(perm.request_id, 'deny')}>No</button></div>
    </article>
  )
  const choicesEl = choices.length > 0 && !live.busy.on && <div className="sess-choices">{choices.map((c, i) => <button key={c} className={i === 0 ? 'go' : ''} onClick={() => say(c)}>{c}</button>)}</div>
  const composer = (
    <form className="sess-say" onSubmit={e => { e.preventDefault(); say(draft) }}>
      <Attach onAdd={l => setDraft(d => (d ? d + '\n' : '') + l)} onError={onToast} />
      <Voice onAdd={l => setDraft(d => (d ? d + '\n' : '') + l)} onError={onToast} />
      <textarea value={draft} rows={1} onChange={e => { setDraft(e.target.value); grow(e.target) }} placeholder="Just talk…" aria-label="Talk"
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); say(draft) } }} />
      <button type="submit" disabled={!draft.trim()} aria-label="Send">↑</button>
    </form>
  )
  if (focusUntil > Date.now()) return <FocusView thread={thread} until={focusUntil} last={last?.from === 'assistant' ? last.text : ''} choices={perm ? [] : choices} busy={live.busy.on}
    doing={live.busy.text ?? thread.doing} onPick={say} onExit={() => focusFor(0)} onEnd={() => setFocusUntil(0)} />
  if (showScreen) {
    const done = b?.done ?? [], met = done.filter(d => d.met).length
    const left = thread.auto ? Math.max(0, Math.round((thread.auto.until - Date.now()) / 60000)) : null
    const doing = live.busy.on ? plainStep(live.busy.text ?? thread.doing ?? 'Thinking it over') : 'Waiting for you'
    // what the dog did since Carl last spoke, newest first, in plain words (the mock's step trail)
    const trail = live.steps.filter(st => st.ts >= lastMine).slice(live.busy.on ? -6 : -5, live.busy.on ? -1 : undefined).reverse() // while working, the newest is the line above
    return (
      <section className={'scv' + (bare ? ' bare' : '') + (typing ? ' driving' : '')} aria-label={`Session: ${sessionTitle(thread)}, on the dog computer`}>
        {/* zone 1: the HUD */}
        <header className="scv-hud">
          <button className="scv-p" onClick={() => setScreen(false)} aria-label="Back to the chat view">←</button>
          <b className="scv-title">{sessionTitle(thread)}<small> · on the dog computer</small></b>
          <span className="scv-p"><i className={'scv-dot' + (live.busy.on ? ' live' : '')} aria-hidden="true" />{live.busy.on ? 'Live' : 'Idle'}{thread.slot ? ` · screen ${thread.slot}` : ''}</span>
          <span className="scv-grow" />
          {b && <button className="scv-p" onClick={() => { setScreen(false); setDrawer(true) }} aria-label="Open the plan">
            <span className="scv-bars" aria-hidden="true">{b.phases.map((_, i) => <i key={i} className={i < b.now ? 'd' : i === b.now ? 'n' : ''} />)}</span>
            {b.finished || b.now >= b.phases.length ? 'Done' : `Phase ${b.now + 1} · ${b.phases[b.now]}`}</button>}
          {b && <span className="scv-p"><span className="scv-ok">{met}/{done.length || 1}</span> done</span>}
          {left !== null && <span className="scv-p scv-gold">Auto · {left} min</span>}
          <button className={'scv-p' + (typing ? ' on' : '')} onClick={() => { setTyping(t => !t); setKeyErr('') }} aria-pressed={typing}>Keyboard</button>
          <button className="scv-p" onClick={() => setBare(true)}>Full screen</button>
        </header>
        {bare && <button className="scv-p scv-show" onClick={() => setBare(false)}>Show chat</button>}
        {/* zone 2: the screen, never covered */}
        <div className="scv-screen"><div className="scv-frame">
          <iframe key={(typing ? 'c' : 'w') + (thread.slot ?? 0)} src={(thread.slot ? `/dogview/${thread.slot}/` : '/dogview/') + (typing ? '?control' : '')} title="The dog computer's screen, live" />
          {live.busy.on && !typing && <i className="scv-scan" aria-hidden="true" />}
        </div></div>
        {/* zone 3: the rail (sideways) or the stack under the screen (upright): now doing, chat, choices, composer */}
        <div className="scv-rail">
          <div key={doing} className={'scv-now' + (live.busy.on ? ' live' : '')} role="status" aria-live="polite">{live.busy.on ? <i className="scv-spin" aria-hidden="true" /> : <b className="scv-ok" aria-hidden="true">✓</b>}{doing}</div>
          {trail.length > 0 && <ol className="scv-trail" aria-label="What the dog did">{trail.map(st => <li key={st.id}><span aria-hidden="true">✓</span>{plainStep(st.text)}</li>)}</ol>}
          {typing && <Keys onError={setKeyErr} slot={thread.slot} />}
          {keyErr && <p className="small" role="alert">{keyErr}</p>}
          <div className="scv-chat" role="log">{msgs.slice(-8).map(msgEl)}<div ref={end} /></div>
          {askEl}
          {choicesEl}
          <button className={'scv-wheel' + (typing ? ' on' : '')} onClick={() => { setTyping(t => !t); setKeyErr('') }} aria-pressed={typing}>{typing ? 'Hand it back' : 'Take the wheel'}</button>
          {composer}
        </div>
      </section>
    )
  }
  return (
    <section className="sess" aria-label={`Session: ${sessionTitle(thread)}`}>
      <header className="sess-head">
        <button className="calm-quiet" onClick={onBack}>← Goddard</button>
        <h1>{sessionTitle(thread)}</h1>
        {!isSession(thread) ? <span className="sess-head-pad" aria-hidden="true" /> : <button className="calm-quiet" onClick={() => confirm(mode === 'plan' ? 'End this session? The sheet is saved as a document in your Library.' : 'End this chat?') && endSession(thread.port).then(r => { if (r.path) onToast('Saved the sheet to your Library'); onBack() }, e => onToast((e as Error).message))}>End</button>}
      </header>
      <div className="sess-tools">
        {isSession(thread) && <ModeBar mode={mode} open={switching} onToggle={() => setSwitching(v => !v)} onPick={switchTo} />}
        <button className={'sess-tool' + (bionic ? ' on' : '')} aria-pressed={bionic} onClick={() => setBionic(!bionic)}>Bionic</button>
        <button className={'sess-tool' + (pace !== 'off' ? ' on' : '')} onClick={() => setPace(NEXT_PACE[pace])} aria-label={`Reading pace: ${pace}. Tap to change.`}>Pace · {pace}</button>
        <button className="sess-tool fo" onClick={() => focusFor(25)}>Focus ◎</button>
      </div>
      {/* on a phone the board is an off-screen drawer: one slim bar shows where you are, a tap slides the plan in */}
      {mode === 'plan' && <button className="sess-planbar" onClick={() => setDrawer(true)} aria-expanded={drawer} aria-controls="sess-board">
        <span className="sess-planbar-what">{thread.auto ? `Auto · ${Math.max(0, Math.round((thread.auto.until - Date.now()) / 60000))} min left · ` : ''}{b ? (b.finished || b.now >= b.phases.length ? '✓ Done' : `Phase ${b.now + 1} of ${b.phases.length} · ${b.phases[b.now]}`) : live.busy.on || msgs.length < 2 ? 'Setting up' : 'No plan yet'}</span>
        {b && <span className="sess-planbar-done">{(b.done ?? []).filter(d => d.met).length}/{(b.done ?? []).length || 1} done</span>}
        <span aria-hidden="true">Plan ›</span>
      </button>}
      {drawer && <div className="sess-scrim" onClick={() => setDrawer(false)} aria-hidden="true" />}
      <div className={'sess-cols' + (mode !== 'plan' && !saves.length ? ' no-board' : '')}>
        <aside id="sess-board" className={'sess-board' + (drawer ? ' open' : '')} aria-label="The system">
          <button className="calm-quiet sess-drawer-close" onClick={() => setDrawer(false)}>Close ›</button>
          {saves.length > 0 && <SavesView saves={saves} onUndo={sp => { if (!confirm(`Put ${sp.repo} back to how it was at ${new Date(sp.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}? What it is now gets saved first, so this can be undone too.`)) return
            undoTo(thread.port, sp.commit).then(r => onToast(`${sp.repo} is back: ${r.restored} file${r.restored === 1 ? '' : 's'} restored, ${r.removed} new removed`), e => onToast((e as Error).message)) }} />}
          {b ? <BoardView b={b} approved={thread.plan?.approved !== false} onAddDone={w => say(`Add to done: ${w}`)}
            onOpen={() => b.finished ? onView(docOf(b.finished.path)) : saveSession(thread.port).then(p => onView(docOf(p)), e => onToast((e as Error).message))}
            onContinue={() => { const go = (p: string) => onContinue({ brought: `📎 ${sessionTitle(thread)} (session sheet): ${p}`, want: b.finished?.next || b.next || '', title: sessionTitle(thread).replace(/\s+\d+$/, '').slice(0, 27).replace(/\s+\S*$/, s => sessionTitle(thread).length > 27 ? '' : s) + ' ' + ((Number(sessionTitle(thread).match(/\s(\d+)$/)?.[1]) || 1) + 1) })
              b.finished ? go(b.finished.path) : saveSession(thread.port).then(go, e => onToast((e as Error).message)) }} /> : mode === 'plan' ? <p className="calm-sub">The dog is looking at what you brought. The system shows up here.</p> : <p className="calm-sub">No plan in {modeLabel(mode)}. Switch to Plan it for phases and a Done list.</p>}
        </aside>
        <div className="sess-talk">
          {onComputer && <DogScreen busy={live.busy.on} onOpen={() => setScreen(true)} slot={thread.slot} />}
          <div className="sess-msgs" role="log">
            <Talk msgs={msgs} who="the dog" choices={perm ? [] : choices} onPick={say} busy={live.busy.on} note={noteOf} />
            {robot && !card && <RigRenderCard />}
            {linesFile && <LinesCard path={linesFile} onSay={say} onOwn={() => { setDraft('My lines: '); setTimeout(() => sayRef.current?.focus(), 50) }} />}
            {staging && <StagingCard path={staging} onApprove={() => say('Looks right → spec')}
              onChange={() => { setDraft('Change a beat: '); setTimeout(() => sayRef.current?.focus(), 50) }} />}
            {outs.length > 0 && <div className="sess-outs">
              {card && <><div className="vp-two"><button className="vp-open an-open" onClick={() => setAnimate(card.path)}>✎ Animate it</button><button className="vp-open" onClick={() => setPreview(card.path)}>▶ Preview it live</button></div><span className="vp-hint">You pose it, or watch it as is. Nothing renders yet.</span></>}
              {card && <ExportCard plan={card.path} onOpen={path => onView({ kind: 'file', path, type: 'video', name: path.split('/').pop()! })} />}
              <PlanCards outputs={outs} />
              <OutputStrip outputs={outs} onOpen={onView} /></div>}
            {live.busy.on && <Working steps={live.steps} since={lastMine} doing={live.busy.text ?? thread.doing} />}
            <div ref={end} />
          </div>
          {perm && (
            <article className={'sess-ask' + (/go live/.test(perm.description) ? ' live' : '')} role="alertdialog" aria-label={perm.description}>
              <b>{perm.description}</b>
              {perm.input_preview && <pre>{perm.input_preview}</pre>}
              <div className="calm-btns"><button className="go" onClick={() => live.verdict(perm.request_id, 'allow')}>Allow</button><button onClick={() => live.verdict(perm.request_id, 'deny')}>No</button></div>
            </article>
          )}
          {perm && choicesEl}
          <form className="sess-say" onSubmit={e => { e.preventDefault(); say(draft) }}>
            <Attach onAdd={l => setDraft(d => (d ? d + '\n' : '') + l)} onError={onToast} />
            <Voice onAdd={l => setDraft(d => (d ? d + '\n' : '') + l)} onError={onToast} />
            <textarea ref={sayRef} value={draft} rows={1} onChange={e => { setDraft(e.target.value); grow(e.target) }} placeholder="Just talk…" aria-label="Talk"
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); say(draft) } }} />
            <button type="submit" disabled={!draft.trim()} aria-label="Send">↑</button>
          </form>
        </div>
      </div>
      {animate && <Animate plan={animate} onClose={() => setAnimate(null)}
        onExport={() => { setAnimate(null); say('Looks right, export') }}
        onAsk={() => { setAnimate(null); setDraft('Stage it for me: '); setTimeout(() => sayRef.current?.focus(), 50) }} />}
      {preview && <VideoPreview plan={preview} onClose={() => setPreview(null)}
        onExport={() => { setPreview(null); say('Looks right, export') }}
        onChange={() => { setPreview(null); setDraft('Change a beat: '); setTimeout(() => sayRef.current?.focus(), 50) }} />}
    </section>
  )
}

function BoardView({ b, approved, onOpen, onContinue, onAddDone }: { b: NonNullable<Thread['board']>; approved: boolean; onOpen: () => void; onContinue: () => void; onAddDone: (what: string) => void }) {
  const [own, setOwn] = useState<string | null>(null)
  const filled = b.sheet.filter(r => r.value.trim()).length
  const done = b.done ?? [{ what: b.done_when, met: !!b.finished }], met = done.filter(d => d.met).length
  return (
    <>
      {b.finished && (
        <section className="sess-finished">
          <b>✓ Done</b>
          <span>Every condition is met. The sheet is saved in your Library.</span>
          {b.finished.next && <span className="muted">Next: {b.finished.next}</span>}
          <div className="calm-btns"><button className="go" onClick={onOpen}>Open the artifact</button><button onClick={onContinue}>Continue in a new session</button></div>
        </section>
      )}
      {(b.yours?.length ?? 0) > 0 && (
        <section className="sess-yours" aria-label="Yours to decide">
          <span className="eyebrow">Yours to decide · {b.yours!.length}</span>
          {b.yours!.map(q => <p key={q}>{q}</p>)}
          <span className="calm-sub">Auto parked these because they're your calls. Answer any of them in the chat.</span>
        </section>
      )}
      <span className="calm-from">You brought</span>
      <p className="sess-art">{b.artifact}</p>
      <p className="calm-sub">{b.goal}</p>
      <div className="sess-phases" role="img" aria-label={b.now >= b.phases.length ? 'All phases done' : `Phase ${b.now + 1} of ${b.phases.length}`} style={{ gridTemplateColumns: `repeat(${b.phases.length}, minmax(0, 1fr))` }}>
        {b.phases.map((_, i) => <span key={i} className={i < b.now ? 'done' : i === b.now && approved ? 'now' : ''} />)}
      </div>
      <ol className="sess-phaselist">{b.phases.map((p, i) => <li key={i} className={i < b.now ? 'done' : i === b.now ? 'now' : ''}>{p}</li>)}</ol>
      {!approved && <p className="calm-sub sess-wait">Waiting for your Go on this setup.</p>}
      <span className="calm-from">The sheet · {filled} of {b.sheet.length}</span>
      <dl className="sess-sheet">{b.sheet.map(r => <div key={r.name}><dt>{r.name}</dt><dd className={r.value.trim() ? '' : 'empty'}>{r.value.trim() || 'Not yet'}</dd></div>)}</dl>
      <span className="calm-from">Done when · {met} of {done.length}</span>
      <ul className="sess-done">{done.map((d, i) => <li key={i} className={d.met ? 'met' : ''}><span aria-hidden="true">{d.met ? '✓' : '○'}</span>{d.what}</li>)}</ul>
      {!b.finished && (
        <div className="sess-ideas" aria-label="Add to done">
          {(b.done_ideas ?? []).map(x => <button key={x} onClick={() => onAddDone(x)}>+ {x}</button>)}
          {own === null ? <button className="own" onClick={() => setOwn('')}>+ Your own</button>
            : <form onSubmit={e => { e.preventDefault(); if (own.trim()) { onAddDone(own.trim()); setOwn(null) } }}><input autoFocus value={own} onChange={e => setOwn(e.target.value)} placeholder="Done means…" aria-label="Your own done condition" onBlur={() => !own.trim() && setOwn(null)} /></form>}
        </div>
      )}
      {!b.finished && <div className="sess-boardbtns"><button className="calm-quiet" onClick={onOpen}>See the sheet as a document</button><button className="calm-quiet" onClick={onContinue}>Continue in a new session</button></div>}
      {b.resources.length > 0 && <><span className="calm-from">Using</span><p className="calm-sub mono">{b.resources.join(' · ')}</p></>}
    </>
  )
}

// what the dog is doing right now, as it happens: its own "thinking out loud" lines and each tool it reaches for
const STEP_PLAIN = (t: string) => t.replace(/^» /, '').replace(/(?:~|\/Users\/[^/\s]+|\/Volumes\/[^/\s]+)\/(?:[^\s/]+\/)*/g, '')
const NEXT_PACE: Record<Pace, Pace> = { calm: 'normal', normal: 'quick', quick: 'off', off: 'calm' }
// a tool step in plain words ("Using browser · browser_click" → "Clicking"); the dog's own status lines pass through
const TOOL_WORDS: Record<string, string> = {
  web_open: 'Opening a page', browser_navigate: 'Opening a page', web_look: 'Looking at the page', browser_snapshot: 'Reading the page',
  browser_take_screenshot: 'Looking at the screen', web_click: 'Clicking', browser_click: 'Clicking', web_type: 'Typing', browser_type: 'Typing',
  browser_fill_form: 'Filling in the form', web_scroll: 'Scrolling', web_back: 'Going back', browser_navigate_back: 'Going back',
  browser_evaluate: 'Reading the page', browser_close: 'Closing the browser', browser_select_option: 'Choosing an option',
  browser_press_key: 'Pressing a key', browser_wait_for: 'Waiting for the page', browser_tabs: 'Switching tabs', vm_run: 'Running a command on the dog computer',
}
const plainStep = (t: string) => {
  const tool = t.match(/\b((?:web|browser|vm)_[a-z_]+)\b/)?.[1]
  if (tool && TOOL_WORDS[tool]) return TOOL_WORDS[tool]
  const p = STEP_PLAIN(t).replace(/^Browser: /, '') // the dog computer's steps already read plainly ("Browser: clicking "Tickets"")
  return p.charAt(0).toUpperCase() + p.slice(1)
}
export function Working({ steps, since, doing }: { steps: { id: string; text: string; ts: number }[]; since: number; doing?: string }) {
  const [now, setNow] = useState(Date.now())
  const [shown] = useState(Date.now()) // no message of Carl's to count from (a reopened thread): count from when this appeared
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id) }, [])
  const mine = steps.filter(s => s.ts >= since).slice(-6)
  const start = mine[0]?.ts ?? (since || shown), secs = Math.max(0, Math.round((now - start) / 1000))
  return (
    <div className="sess-live" role="status" aria-live="polite">
      <span className="sess-live-head"><i className="sess-pulse" aria-hidden="true" />{STEP_PLAIN(doing || 'Thinking it over')}<span className="muted">{secs}s</span></span>
      {mine.length > 0 && <ol>{mine.map((s, i) => <li key={s.id} className={(s.text.startsWith('» ') ? 'say' : '') + (i === mine.length - 1 ? ' now' : '')}>{STEP_PLAIN(s.text)}</li>)}</ol>}
    </div>
  )
}

// every repo this session changed, with the picture from before it did, and a way back
function SavesView({ saves, onUndo }: { saves: SavePoint[]; onUndo: (s: SavePoint) => void }) {
  return (
    <section className="sess-saves" aria-label="Save points">
      <span className="calm-from">Save points</span>
      {saves.map(sp => (
        <div key={sp.commit} className="sess-save"><span><b>{sp.repo}</b> · before {new Date(sp.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span><button className="calm-quiet" onClick={() => onUndo(sp)}>Undo to here</button></div>
      ))}
    </section>
  )
}

// the three modes, picked before the first message
function ModePick({ mode, onPick }: { mode: SessionMode; onPick: (m: SessionMode) => void }) {
  return (
    <div className="sess-modes" role="radiogroup" aria-label="Mode">
      {MODES.map(m => <button key={m.id} role="radio" aria-checked={mode === m.id} className={mode === m.id ? 'on' : ''} onClick={() => onPick(m.id)}>{m.label}</button>)}
      <p className="calm-sub">{MODES.find(m => m.id === mode)!.line}</p>
    </div>
  )
}
// the mode a running chat is in, and the switch
function ModeBar({ mode, open, onToggle, onPick }: { mode: SessionMode; open: boolean; onToggle: () => void; onPick: (m: SessionMode) => void }) {
  return (
    <div className="sess-modebar">
      <button className="sess-modebar-now" onClick={onToggle} aria-expanded={open}>{modeLabel(mode)} <span aria-hidden="true">{open ? '▴' : '▾'}</span></button>
      {open && <div className="sess-modebar-menu" role="menu">{MODES.map(m => (
        <button key={m.id} role="menuitemradio" aria-checked={mode === m.id} className={mode === m.id ? 'on' : ''} onClick={() => onPick(m.id)}><b>{m.label}</b><span>{m.line}</span></button>
      ))}</div>}
    </div>
  )
}

// Focus mode (the mock's screen 5): the dog's one current question fills the screen with its answers and the talk
// box; the timer, the way out, and a quiet line saying pings are held. Nothing else from the app is on screen.
function FocusView({ thread, until, last, choices, busy, doing, onPick, onExit, onEnd }: {
  thread: Thread; until: number; last: string; choices: string[]; busy: boolean; doing?: string
  onPick: (t: string) => void; onExit: () => void; onEnd: () => void
}) {
  const [now, setNow] = useState(Date.now())
  const [draft, setDraft] = useState('')
  const [held, setHeld] = useState(0)
  const [leaving, setLeaving] = useState(false)
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id) }, [])
  useEffect(() => { const get = () => fetch('/door/api/focus').then(r => r.json()).then((j: { held: number }) => setHeld(j.held ?? 0), () => {}); get(); const id = setInterval(get, 15000); return () => clearInterval(id) }, [])
  useEffect(() => { if (now >= until) onEnd() }, [now, until])
  const left = Math.max(0, until - now), mins = Math.ceil(left / 60000)
  const g = last ? grouped(last) : null
  const lines = last ? last.split('\n').map(l => l.replace(/[*#_`]/g, '').trim()).filter(Boolean) : []
  const question = g?.ask || [...lines].reverse().find(l => l.endsWith('?')) || g?.lead || lines[0] || ''
  const exit = () => { setLeaving(true); setTimeout(onExit, 420) }
  const send = (t: string) => { if (t.trim()) { onPick(t.trim()); setDraft('') } }
  return (
    <section className={'fmode' + (leaving ? ' leaving' : '')} aria-label={`Focus: ${sessionTitle(thread)}`}>
      <i className="focus-glow" aria-hidden="true" />
      <header className="focus-top">
        <span className="focus-timer"><span className="focus-dot" aria-hidden="true"><i /></span>Focus · {mins} min left</span>
        <button onClick={exit}>Exit focus</button>
      </header>
      <div className="focus-main">
        <span className="focus-what">{sessionTitle(thread)} · {busy ? 'working' : 'one question'}</span>
        {busy ? <p className="focus-q working">{STEP_PLAIN(doing || 'Thinking it over')}…</p> : <p className="focus-q">{question || 'Your turn.'}</p>}
        {!busy && choices.length > 0 && <div className="focus-picks">{choices.map((c, i) => <button key={c} style={{ animationDelay: `${0.35 + i * 0.1}s` }} onClick={() => send(c)}>{c}</button>)}</div>}
      </div>
      <form className="focus-say" onSubmit={e => { e.preventDefault(); send(draft) }}>
        <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Say it…" aria-label="Your answer" />
        <button type="submit" disabled={!draft.trim()} aria-label="Send">↑</button>
      </form>
      <p className="focus-held">{held ? `${held} ${held === 1 ? 'thing is' : 'things are'} waiting. ` : ''}Pings are held until you're done.</p>
    </section>
  )
}
