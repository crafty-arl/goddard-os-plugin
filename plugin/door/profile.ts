/**
 * The owner's profile: who runs this Goddard OS and which parts of it they have. Everything that used to be written
 * into the code for one person (their name, the home server, the dog computer VM, the helper on another box, the big
 * drive) lives here, so the same code can ship to someone else and a setup screen can fill it in.
 *
 * Each part is a module that is on or off. With no profile file the defaults are an empty, Mac-only setup; an
 * existing install keeps its own file (profile.json in the state folder), so nothing it has changes.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { STATE_DIR } from './common'

export interface Profile {
  owner: { name: string; call: string; studio?: string } // the owner's name, what the dogs call them, their studio's name
  memory?: { on: boolean; path: string }          // a folder of notes the dogs read (a "mind")
  dogComputer?: {                                  // a computer the dogs can drive (browser, screen, shell)
    on: boolean
    kind: 'proxmox-vm' | 'this-mac'
    host?: string        // the VM host, as user@address (proxmox-vm)
    vm?: string          // the VM's own address (proxmox-vm)
    slots: number        // how many sessions can each have their own screen at once
  }
  helper?: { on: boolean; name: string; bus: string } // an always-on helper on another box, reached through a bus
  bigDrive?: { on: boolean; path: string }            // a drive for large files; used only while it's plugged in
  pings?: { on: boolean; quiet: [number, number]; perHour: number; digest?: number } // phone notifications: quiet from..to, at most n an hour, and the hour of the evening card (18 by default)
  phone?: { reach: 'wifi' | 'tailscale'; host?: string } // how the phone reaches the app, and its https address (Tailscale)
}

export const PROFILE_FILE = join(STATE_DIR, 'profile.json')

const BLANK: Profile = { owner: { name: 'Owner', call: 'boss' }, pings: { on: true, quiet: [23, 7], perHour: 1 }, phone: { reach: 'wifi' } }

let cached: { at: number; p: Profile } | null = null
// read fresh at most every 10 seconds, so an edit to the file takes effect without a restart
export function profile(): Profile {
  if (cached && Date.now() - cached.at < 10_000) return cached.p
  let p = BLANK
  try { if (existsSync(PROFILE_FILE)) p = { ...BLANK, ...JSON.parse(readFileSync(PROFILE_FILE, 'utf8')) } } catch { /* a broken file falls back to the blank setup */ }
  cached = { at: Date.now(), p }
  return p
}

export const has = (m: 'memory' | 'dogComputer' | 'helper' | 'bigDrive' | 'pings') => !!profile()[m]?.on

// the folder Home and the quick helpers run in: the notes folder when there is one, else the home folder (as ~/...)
export const mindDir = () => (has('memory') && profile().memory!.path) || '~'

export function saveProfile(p: Profile) {
  writeFileSync(PROFILE_FILE, JSON.stringify(p, null, 1) + '\n', { mode: 0o600 })
  cached = null
}

// The instructions were written for Carl. For anyone else, each piece of text the dogs read (their instructions, tasks,
// tool descriptions, gate answers) gets the owner's name and studio at the moment it is sent.
export function own(text: string): string {
  // the helper's address is never written into the instructions themselves; it comes from the profile
  const bus = profile().helper?.bus ?? ''
  text = text.replace(/\{\{helper\.bus\}\}/g, bus || 'the helper (not set up)')
    .replace(/\{\{helper\.ssh\}\}/g, (() => { try { return 'root@' + new URL(bus).hostname } catch { return 'the helper' } })())
  const o = profile().owner
  if (o.name === 'Carl' && (o.studio ?? 'GM! Carl') === 'GM! Carl') return text
  const studio = o.studio || `${o.name}'s studio`, p = profile()
  // parts written only for one setup (<!-- only:helper -->...<!-- /only -->, or only:carl) are left out when they don't apply
  text = text.replace(/<!-- only:(\w+) -->([\s\S]*?)<!-- \/only -->(\n?)/g, (_, m: string, body: string, nl: string, at: number, all: string) =>
    m !== 'carl' && has(m as 'helper') ? body + nl : (at === 0 || all[at - 1] === '\n' ? '' : nl)) // a whole line left out takes its line break with it
  // the places written into the instructions (Carl's notes folder, helper and drive) become this owner's own
  return text.replace(/~\/gm-mind\b/g, mindDir()).replace(/\/Volumes\/LaCie\b/g, p.bigDrive?.path || 'the big drive (not set up)')
    .replace(/\bGM! Carl studio\b/g, /studio$/i.test(studio) ? studio : `${studio} studio`).replace(/\bGM! Carl\b/g, studio).replace(/\bCarl\b/g, o.name)
}

// an instructions file, with the owner's name in it, as a copy in the launch folder (the original is never changed)
export function ownFile(path: string, dir: string): string {
  const text = readFileSync(path, 'utf8'), named = own(text)
  if (named === text) return path
  const out = join(dir, 'owned-' + path.split('/').pop())
  writeFileSync(out, named, { mode: 0o600 })
  return out
}
