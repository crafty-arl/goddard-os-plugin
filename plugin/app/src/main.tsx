import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Root from './Root.tsx'
import { registerWorker } from './live/checkins'

registerWorker()

// a phone keeps the home-screen app open for days, so it never saw new builds (Carl, 2026-10-29: the old Start page
// still showing). When the app comes back to the front, or every few minutes, it checks the live build and reloads onto
// a newer one unless he's mid-typing. Drafts live in localStorage, so a reload loses nothing.
const mine = [...document.scripts].map(s => s.src.match(/\/assets\/(index-[\w-]+\.js)/)?.[1]).find(Boolean)
const checkBuild = () => {
  if (!mine || document.visibilityState !== 'visible') return
  fetch('/', { cache: 'no-store' }).then(r => r.text()).then(html => {
    const live = html.match(/\/assets\/(index-[\w-]+\.js)/)?.[1]
    const typing = document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLInputElement
    if (live && live !== mine && !typing) location.reload()
  }).catch(() => {})
}
document.addEventListener('visibilitychange', checkBuild)
setInterval(checkBuild, 5 * 60_000)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)

