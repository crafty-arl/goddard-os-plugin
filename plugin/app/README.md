# Goddard OS

Personal use only. A front end for Carl's gm-chat front door (Claude Code Channels on the Mac mini).

Carl's console home screen for his agents: a cozy 2.5D colony (a real tile map, drawn like gm-iso) wrapped in a console UI. Mobile first; from 1024px wide it switches to the desk / Odin layout with gamepad prompts.

```bash
npm install
npm run dev          # http://localhost:5173
npm run dev -- --host  # open it from the phone on the same Wi-Fi
npm run build
```

## Live mode (gm-chat)

- The dev server proxies `/door/*` to the gm-chat door on `127.0.0.1:8787` (set `GM_DOOR_URL` to change it).
- **Locked like the door:** `/door/*` and `/api/skills` answer only with the `gm_chat` cookie the door sets from its password link. Open the gm-chat link once on a device (`cat ~/.claude/channels/gm-chat/link.txt` on the Mac), then open Goddard OS **on the same address** (for example `http://192.168.x.x:5173` with `npm run dev -- --host`). Writes from another site are refused.
- Every running gm-chat thread is one agent in the colony. Where it stands comes from its real current step (reading goes to the Research shelf, editing to the Writing desk, and so on). Home is Goddard.
- **Agent slots:** "Open 3 agent slots" starts three visible Claude windows on the Mac through the door (threads named "Agent slot…"). Carl presses yes once in each, at the Mac. No hidden windows, and nothing ever answers a Claude prompt for him.
- **New task:** pick a real skill and write a one-line brief. It goes to a free slot as one message (with a reset line so the slot drops its last task). No new window opens. If no slot is free, the app says "No free agent. Open one at the Mac." and can queue the task for the next free slot.
- A slot is free again after "Looks good". Which slot holds which task is kept in that browser.
- **Steering:** Pause, Redo, Go here instead and Looks good each send one short message into that thread. Permission asks show as Allow / No and answer the real prompt.
- If the door is down or the device isn't signed in, the app says why and offers the sample run.

## What is real and what is sample

- The world is data: `src/data/world.ts` holds the 9x9 tile map and the places. `src/world/iso.ts` only draws it.
- **Skills are real.** The dev server reads every installed skill from `~/.claude/skills` (synced ones included) on each request to `/api/skills` (`skills-source.ts`, only name and description from the frontmatter). A build writes a dated snapshot to `dist/api/skills`.
- **Tasks start only from those skills.** New tasks get the phases Brief, Work, Check, Back to you, and are saved in the browser. They are **not sent to an agent yet**: there is no runner, so nothing runs, spends or posts.
- The job, agents and phases in `src/data/sample.ts` are a **sample run**. Nothing is connected to real agents, chat or posting yet, and the UI says so.
- The two sample agents use skills that exist in Carl's harness (`gm-linkedin-post`, `gm-publish-tags`).
- "Looks good" only marks the job done. Nothing is ever posted from here.

## Controls

Touch everywhere. Keyboard and gamepad (standard mapping) drive the same actions:

| Button | Key | Does |
| --- | --- | --- |
| A | Enter | Open job / approve at checkpoint / send agent to the focused place |
| B | Esc | Back / cancel picking |
| X | X | Pause / resume |
| Y | Y | Redo the current phase |
| RT | R | Go here instead (then tap or A on a place) |
| LB / RB | Q / E | Talk / Tasks |
| D-pad | Arrows | Move between places |

Place names are function labels until Carl names them.

## Ten slots, and after a restart

Goddard OS keeps 10 agent slots as its default (`SLOT_TARGET` in `src/live/slots.ts`, `GODDARD_SLOTS` for the boot script). The Tasks board shows "7 of 10 slots up" and a Needs-you card with "Open 3 more at the Mac" when some are down.

`scripts/boot.ts` starts the door, the app and the missing slots. `launchd/` holds a login item that runs it after the Mac starts. It isn't installed: see `launchd/README.md` for the one paste. After a restart you still press yes once in each slot window.

Idle slots cost nothing. Each new slot does one small first turn on your Claude plan when it starts (it is told not to reply), so 10 slots after a restart is 10 short turns.
