#!/usr/bin/env bun
// Undo to a save point (savepoint.ts made it): first the tree as it is now is saved too, so the undo can be undone,
// then every file goes back to how it was, and files made since are removed. The branch, its commits and the index
// are left alone. Usage: bun undo.ts <repo-root> <save-commit>   (prints JSON: { ok, restored, removed, redo })
import { rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const [root, save] = process.argv.slice(2)
const out = (o: object) => { console.log(JSON.stringify(o)); process.exit(0) }
if (!root || !/^[0-9a-f]{40}$/.test(save ?? '')) out({ ok: false, error: 'usage: undo.ts <repo-root> <save-commit>' })
const git = (args: string[], env: Record<string, string> = {}) => { const r = Bun.spawnSync(['git', '-C', root, ...args], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...env }, timeout: 60_000 }); return { ok: r.exitCode === 0, out: new TextDecoder().decode(r.stdout).trim(), err: new TextDecoder().decode(r.stderr).trim() } }
if (!git(['cat-file', '-e', `${save}^{commit}`]).ok) out({ ok: false, error: "that save point isn't in this repo" })
const who = { GIT_AUTHOR_NAME: 'Goddard OS', GIT_AUTHOR_EMAIL: 'goddard@localhost', GIT_COMMITTER_NAME: 'Goddard OS', GIT_COMMITTER_EMAIL: 'goddard@localhost' }
const idx = join(tmpdir(), `gm-undo-${Date.now()}`)
let now = ''
try {
  const env = { GIT_INDEX_FILE: idx }
  if (!git(['read-tree', 'HEAD'], env).ok) git(['read-tree', '--empty'], env)
  git(['add', '-A'], env)
  const tree = git(['write-tree'], env).out
  now = git(['commit-tree', tree, '-p', save, '-m', 'Goddard: the tree just before an undo'], who).out
} finally { rmSync(idx, { force: true }) }
if (!/^[0-9a-f]{40}$/.test(now)) out({ ok: false, error: "couldn't save the current state first, so nothing was changed" })
const redo = `refs/goddard/undo/${Date.now()}`
git(['update-ref', redo, now])
const added = git(['diff', '--name-only', '--diff-filter=A', save, now]).out.split('\n').filter(Boolean)
const changed = git(['diff', '--name-only', '--diff-filter=MDT', save, now]).out.split('\n').filter(Boolean)
const r = git(['restore', `--source=${save}`, '--worktree', '--', '.'])
if (!r.ok) out({ ok: false, error: r.err.slice(0, 200), redo })
for (const f of added) { const p = join(root, f); if (existsSync(p)) rmSync(p, { force: true }) }
out({ ok: true, restored: changed.length, removed: added.length, redo, redoCommit: now })
