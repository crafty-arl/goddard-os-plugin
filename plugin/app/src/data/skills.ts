// The skills really installed in Claude Code on this Mac, read by the dev server from ~/.claude/skills.
import { useEffect, useState } from 'react'

export interface Skill { name: string; description: string; group: string; source: 'local' | 'synced'; path: string }
export interface SkillList { readAt: string; from: string; skills: Skill[] }

export function useSkills() {
  const [data, setData] = useState<SkillList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = () => {
    setError(null)
    fetch('/api/skills')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch(e => setError(`Couldn't read the skills list (${e.message}). It comes from the dev server on the Mac.`))
  }
  useEffect(load, [])
  return { data, error, reload: load }
}

export const GROUP_ORDER = ['GM! Carl', 'Images & brand', 'Video', 'Docs & research', 'Build & tools', 'Other']
