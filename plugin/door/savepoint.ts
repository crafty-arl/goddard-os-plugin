#!/usr/bin/env bun
// PreToolUse save point: before a dog or session first changes a git repo, the whole working tree (tracked changes and
// new files, not ignored ones) is saved as a hidden commit, refs/goddard/save/<port>-<time>. It never touches the
// branch, the index or any file; Undo in Goddard OS puts the tree back to it. (Carl, 2026-10-29: "Build the three")
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
const h = JSON.parse(await Bun.stdin.text() || '{}')
const port = process.env.GM_CHAT_PORT
if (!port) process.exit(0)
const tool = String(h.tool_name ?? ''), input = h.tool_input ?? {}
const path = String(input.file_path ?? input.notebook_path ?? '')
const from = tool === 'Bash' ? String(h.cwd ?? '') : path ? (existsSync(path) ? dirname(path) : dirname(path)) : ''
if (!from) process.exit(0)
// read-only shell commands don't need a save point
if (tool === 'Bash' && /^\s*(ls|cat|head|tail|grep|rg|find|git\s+(status|log|diff|show)|pwd|echo|wc|which|curl\s+-s\s+[^|]*$)\b/.test(String(input.command ?? ''))) process.exit(0)
const git = (args: string[], env: Record<string, string> = {}) => Bun.spawnSync(['git', ...args], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...env }, timeout: 25_000 })
let dir = from
while (dir && !existsSync(dir)) dir = dirname(dir)
const top = git(['-C', dir, 'rev-parse', '--show-toplevel'])
if (top.exitCode !== 0) process.exit(0)
const root = new TextDecoder().decode(top.stdout).trim()
const STATE = process.env.GM_CHAT_STATE ?? join(homedir(), '.claude', 'channels', 'gm-chat')
const file = join(STATE, 'savepoints', `${port}.json`)
type Save = { root: string; commit: string; ref: string; at: number; name: string; tool: string }
let saves: Save[] = []
try { saves = JSON.parse(readFileSync(file, 'utf8')) } catch {}
// one save point per repo per session (a session starting a new job after Go gets a fresh one from the door)
if (saves.some(s => s.root === root)) process.exit(0)
const idx = join(tmpdir(), `gm-save-${port}-${Date.now()}`)
try {
  const env = { GIT_INDEX_FILE: idx }
  if (git(['-C', root, 'read-tree', 'HEAD'], env).exitCode !== 0) git(['-C', root, 'read-tree', '--empty'], env)
  if (git(['-C', root, 'add', '-A'], env).exitCode !== 0) process.exit(0)
  const tree = new TextDecoder().decode(git(['-C', root, 'write-tree'], env).stdout).trim()
  const head = git(['-C', root, 'rev-parse', '-q', '--verify', 'HEAD']), parent = head.exitCode === 0 ? ['-p', new TextDecoder().decode(head.stdout).trim()] : []
  const name = process.env.GM_CHAT_NAME ?? `port ${port}`
  const commit = new TextDecoder().decode(git(['-C', root, 'commit-tree', tree, ...parent, '-m', `Goddard save point before ${name} changed this repo`], { GIT_AUTHOR_NAME: 'Goddard OS', GIT_AUTHOR_EMAIL: 'goddard@localhost', GIT_COMMITTER_NAME: 'Goddard OS', GIT_COMMITTER_EMAIL: 'goddard@localhost' }).stdout).trim()
  if (!/^[0-9a-f]{40}$/.test(commit)) process.exit(0)
  const ref = `refs/goddard/save/${port}-${Date.now()}`
  git(['-C', root, 'update-ref', ref, commit])
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify([...saves, { root, commit, ref, at: Date.now(), name, tool }], null, 1), { mode: 0o600 })
} finally { rmSync(idx, { force: true }) }
process.exit(0)
