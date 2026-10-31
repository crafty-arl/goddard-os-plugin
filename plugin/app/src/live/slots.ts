// Agent slots: gm-chat threads Carl opens at the Mac ahead of time (one "yes" each, in a visible window).
// New tasks go to a free slot as a message, so no new window has to open while he's away.
import { useEffect, useState } from 'react'
import { type Thread, newThread } from './door'

export const SLOT_PREFIX = 'Agent slot'
// kept short and reply-free so an idle slot costs one small first turn, then nothing while it waits
const SLOT_BRIEF = `${SLOT_PREFIX}. You are a standing agent for Goddard OS. Do not reply now; wait quietly. Tasks will arrive as messages.`
export const SLOT_TARGET = 1 // one dog by default; Carl adds more with the Add a dog button (2026-10-28)

export interface Opening { count: number; base: number; at: number } // windows launched, still waiting for Carl's yes

const KEY = 'goddard-os.slots'
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} } }

export function useSlots() {
  const [state, setState] = useState<{ opening: Opening | null }>(() => ({ opening: null, ...load() }))
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* this visit only */ } }, [state])
  return {
    ...state,
    opened: (count: number, base: number) => setState(s => ({ ...s, opening: { count, base, at: Date.now() } })),
  }
}

export const isSlot = (t: Thread) => t.name.startsWith(SLOT_PREFIX)
// a dog Carl named when he added it (Carl, 2026-10-28: "named dogs"): its slot is called "Agent slot · <name>"
export const dogName = (t: Thread) => t.name.match(/^Agent slot · (.+)$/)?.[1]?.trim() || null

// opens background dogs on the Mac (claude --bg), one after another: no window, no yes to press
// (Carl, 2026-10-28: "drop the visible-windows rule")
export async function openSlots(n: number, folder: string, server: string, name?: string, role?: string, job?: string) {
  for (let i = 0; i < n; i++) await newThread(SLOT_BRIEF, server, folder, true, name ? `${SLOT_PREFIX} · ${name}` : undefined, role, job)
}
