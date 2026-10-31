// Reads the skills that are really installed in Claude Code on this Mac (~/.claude/skills, including synced ones).
// Only the frontmatter is read: name and description. Nothing is executed.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { homedir } from 'node:os'

export interface SkillInfo { name: string; description: string; group: string; source: 'local' | 'synced'; path: string }

export const SKILLS_DIR = join(homedir(), '.claude', 'skills')

function frontmatter(text: string) {
  const m = text.match(/^---\n([\s\S]*?)\n---/)
  if (!m) return {}
  const out: Record<string, string> = {}
  let key = ''
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/)
    if (kv) { key = kv[1]; out[key] = kv[2].replace(/^["']|["']$/g, '').trim() }
    else if (key && /^\s+/.test(line)) out[key] = (out[key] + ' ' + line.trim()).trim()
  }
  return out
}

function group(name: string) {
  if (name.startsWith('gm-') || ['my-voice', 'storytelling-with-claude', 'ask-goddard', 'morning'].includes(name)) return 'GM! Carl'
  if (name.startsWith('higgsfield')) return 'Images & brand'
  if (/^(hyperframes|motion|music-to|faceless|general-video|talking-head|embedded-captions|pr-to-video|product-launch|slideshow|remotion|media-use)/.test(name)) return 'Video'
  if (/^(docx|pptx|xlsx|pdf|docs|deep-research|skill-creator|what-am-i-signing|attorney|legal|import-memory)/.test(name)) return 'Docs & research'
  if (/^(cloudflare|wrangler|workers|durable|sandbox|agents-sdk|basin|nextjs|turnstile|web-perf|ui-design|figma|k2|reverse|computer-use|built-in-browser|chrome-browser)/.test(name)) return 'Build & tools'
  return 'Other'
}

export function readSkills(): SkillInfo[] {
  const found: SkillInfo[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > 3 || !existsSync(dir)) return
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith('.')) continue
      const p = join(dir, entry)
      if (!statSync(p).isDirectory()) continue
      const md = join(p, 'SKILL.md')
      if (existsSync(md)) {
        const fm = frontmatter(readFileSync(md, 'utf8'))
        const name = fm.name || entry
        found.push({
          name, description: fm.description || '', group: group(name),
          source: relative(SKILLS_DIR, p).startsWith('synced') ? 'synced' : 'local',
          path: '~/.claude/skills/' + relative(SKILLS_DIR, p),
        })
      } else walk(p, depth + 1)
    }
  }
  walk(SKILLS_DIR, 0)
  const seen = new Set<string>()
  return found.filter(s => !seen.has(s.name) && seen.add(s.name)).sort((a, b) => a.name.localeCompare(b.name))
}
