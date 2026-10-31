#!/usr/bin/env bun
// PreToolUse guard for Carl's LaCie drive: creating new files and folders is fine; deleting, moving or overwriting
// anything that already exists there goes to Carl as a permission ask (an Allow / No card in Goddard OS).
// It only ever asks, it never allows or denies on his behalf.
import { existsSync } from 'node:fs'
const LACIE = process.env.GODDARD_LACIE ?? '/Volumes/LaCie'
const h = JSON.parse(await Bun.stdin.text() || '{}')
const tool = String(h.tool_name ?? ''), input = h.tool_input ?? {}
let why = ''
const onLacie = (p: unknown) => typeof p === 'string' && (p === LACIE || p.startsWith(LACIE + '/'))
if ((tool === 'Write' || tool === 'NotebookEdit') && onLacie(input.file_path ?? input.notebook_path) && existsSync(input.file_path ?? input.notebook_path)) why = `overwrite ${input.file_path ?? input.notebook_path}`
if ((tool === 'Edit' || tool === 'MultiEdit') && onLacie(input.file_path)) why = `change ${input.file_path}`
if (tool === 'Bash') {
  const cmd = String(input.command ?? '')
  // anything that touches the LaCie with a delete, move, overwrite-redirect or in-place edit
  if (cmd.includes(LACIE) && /(^|[;&|\s(])(rm|rmdir|unlink|mv|truncate|shred|dd|rsync\s+[^;]*--delete|find\s+[^;]*-delete|sed\s+-i|perl\s+-pi)\b|>(?!>)\s*\S*LaCie/.test(cmd)) why = `run: ${cmd.slice(0, 200)}`
}
if (why) {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: `This would ${why} on your ${/LaCie/.test(LACIE) ? "LaCie" : "big"} drive.` } }))
}
process.exit(0)
