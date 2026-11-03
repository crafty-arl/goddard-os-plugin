---
name: paper-robot
description: Make a Standup-style paper robot video on this Mac with the owner's own rig (paper robots, painted sets, the three.js table stage). The owner picks the cast and supplies the bit and the lines; you write the sketch spec from their words, show it as the plan, they preview it live on their own stage, and only after "Looks right, export" you render the MP4. Use when they say "make a paper robot video", "robot video", "/goddard-os:video", or start a session from the Home card.
---

# Paper robot video

You turn the owner's bit into a short sketch with their rig, and nothing else. You are the crew, not the writer.

## Rules

- **They write it.** The owner supplies the bit and every spoken line, and picks the cast. You never write the joke, the premise, the story or a line of dialogue. If a line is missing, ask for it. You may suggest how it is staged (actions, lights, shots), never what is said.
- **Only the rig's own parts.** Sets, rooms, cast, actions, lights, shots and voices come from `robot.py lists`. Never invent one.
- **Stage, preview, then export.** Show the staging card first (below), then the spec card. The owner plays it live from the card ("Preview it live": every scene on their real stage, with the cached voices, in seconds, no frames rendered). Render only after "Looks right, export" (or a clear yes after the preview). "Change a beat: …" means edit the spec, write the card again, and let them preview again.
- **Voices cost money.** Cached lines are free. New lines are voiced by Aura on Cloudflare Workers AI, a few cents each. Before rendering, say how many lines are new and ask. Only pass `--allow-new-voices` after a clear yes for that count; a re-render after your own mistake is new spend and needs a new yes.
- **Nothing public.** The MP4 stays on this Mac. Never upload, post or publish it.

## Staging: the picture tells the joke too

Before any spec, you stage the bit and the owner approves it. One row per beat:

- **Their line, word for word.** List every line they gave under `"lines"` exactly as typed; each beat's `say` must be one of them. If the lines came from another model (Kimi, you), set `"lines_from"` to it: the card warns them, and you ask for their own words.
- **Kind:** SETUP, BUILD, TURN, PAUSE or PUNCH.
- **What we SEE change** (`see`): a prop, a screen, where they are, the pose, the light. Then the rig fields that make it real: `act`, `light`, `shot`, `fx.boxes` (a pile that grows), `chapter` (a clock like "4:12 AM"), `chat`.
- **Escalation** (`esc` 0 to 3): each BUILD looks worse than the last, and something the viewer can see changes.
- **A silent hold before every punch:** a PAUSE (`hold` 1 to 1.5 s) right before the PUNCH, both on `shot: close` (the rig's only centered framing). Never `tight`: in a painted 3D room the rig turns it into a low, off-center angle.
- **One room, the same robots,** unless the owner asks for a cut.
- **Gold tags** (`new`: ["new pose: tired"]) for any move or prop the rig can't do yet. They're collected into `<out>/poses-to-add.md` for rig work later; stage with what the rig has meanwhile.

You may propose staging (what we see). You never write or change the joke or a line.

## Where things are

- The rig: the `rig.path` in the owner's Goddard OS profile (`~/.claude/channels/gm-chat/profile.json`, module `rig`; default `~/videos/the-standup`). Read and run only: never edit, move or delete anything in it.
- The outputs: `rig.out` in the same profile (default `~/Goddard/videos`), one folder per sketch: `<out>/<id>/`.
- The tool: `robot.py` next to this file (`${CLAUDE_PLUGIN_ROOT}/skills/paper-robot/robot.py`). Run it with `python3`; it switches to the rig's own Python by itself. Pass `--rig <path>` when the profile's path is not the default.
- The spec format is documented at the top of `<rig>/pipeline/sketch.py`. Real examples: `<rig>/pipeline/episodes/ep4/*.json`.

## Steps

1. **Read the rig.** `python3 robot.py lists --rig <rig>`. Note the cast (Orchestrator, Researcher, Coder, Reviewer, Summarizer, plus Biscuit the paper dog via `"props": {"dog": true}`).
2. **Get the bit.** If they haven't said it: ask who's in it (one question, the cast as choices) and what happens, in their words. Ask for the exact lines. One question at a time.
3. **Stage it.** Write `<out>/<id>/staging.in.json`:
   `{"id", "title", "host": "<robot>", "pose": "sit"|"stand", "props": {...}, "lines_from": "carl"|"<model>", "lines": [...], "beats": [{"kind", "say", "see", "act", "light", "shot", "esc", "fx", "chapter", "hold", "new"}]}`.
   Run `python3 robot.py stage <out>/<id>/staging.in.json --out <out>/<id> --rig <rig>`. Fix every problem it names. It writes `staging.json`; give its full path in your reply (Goddard OS draws it as the staging card) and ask: "Looks right → spec?" On "Change a beat: …", change that beat and stage again.
4. **On "Looks right → spec",** run `python3 robot.py spec <out>/<id>/staging.json --out <out>/<id> --rig <rig>`: it writes `spec.json` and `plan.md` from the approved staging. Then `python3 robot.py check <out>/<id>/spec.json --rig <rig>` and note `lines`, `cached` and `new`.
5. **Show the plan.** Give the full path of `plan.md` (Goddard OS draws it as the spec card, with a "Preview it live" button; always say the words "Preview it live", the app keys on them), then one line: "N lines, M new voices (a few cents)" or "all voices cached, no spend". Say: "Tap Preview it live. Export when it looks right." The preview never voices anything: lines with no cached take play silent with their caption. The app builds it itself (`robot.py preview`).
6. **On "Looks right, export",** render: `python3 robot.py render <out>/<id>/spec.json --out <out>/<id> --rig <rig>` (add `--allow-new-voices` only per the rule above; `--fmt wide` only if they ask for 16:9). It prints the MP4 path. Run it in the background: a 20-second sketch takes several minutes.
7. **Hand it over.** Check the MP4 plays (`ffprobe` shows a video and an audio stream, and the duration). Reply with its full path so it lands in Outputs, plus the duration, in one or two lines.

## If something breaks

Read the error; the render step names the stage that failed (sketch, frames, compose). Fix the spec, not the rig. If the rig itself is broken, stop and tell the owner what failed and where.
