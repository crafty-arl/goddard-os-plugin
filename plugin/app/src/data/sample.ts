// Sample job so the screens have something real-shaped to show.
// Not connected to any agent yet: everything here is marked as a sample in the UI.

export const PHASES = ['Brief', 'Research', 'Draft', 'Check', 'Back to you'] as const
export type Phase = (typeof PHASES)[number]

export interface Step {
  phase: number // index into PHASES
  agent: 1 | 2
  place: string // place id
  doing: string
}

export interface Agent {
  id: 1 | 2
  role: string
  skill: string // a skill that really exists in Carl's harness
  color: string
}

export const AGENTS: Agent[] = [
  { id: 1, role: 'Writer', skill: 'gm-linkedin-post', color: '#BD8430' },
  { id: 2, role: 'Tag checker', skill: 'gm-publish-tags', color: '#4FA3A5' },
]

export const SAMPLE_JOB = {
  title: 'I need a LinkedIn post',
  steps: [
    { phase: 0, agent: 1, place: 'review', doing: 'Took your brief' },
    { phase: 1, agent: 1, place: 'research', doing: 'Checked facts on gmcarl.xyz' },
    { phase: 2, agent: 1, place: 'writing', doing: 'Drafting the post in your voice' },
    { phase: 3, agent: 2, place: 'research', doing: 'Checking the tags' },
    { phase: 4, agent: 1, place: 'review', doing: 'Comes back to you to check' },
  ] as Step[],
}
