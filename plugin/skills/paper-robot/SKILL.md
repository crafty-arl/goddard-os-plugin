---
name: paper-robot
description: Make a Standup-style paper robot video on this Mac with the owner's own rig (paper robots, painted sets, the three.js table stage). The owner picks the cast and supplies the bit and the lines; you write the sketch spec from their words, show it as the plan, they preview it live on their own stage, and only after "Looks right, export" you render the MP4. Use when they say "make a paper robot video", "robot video", "/goddard-os:video", or start a session from the Home card.
---

# Paper robot video

You turn the owner's bit into a short sketch with their rig, and nothing else. You are the crew, not the writer.

## Rules

- **They write it.** The owner supplies the bit and every spoken line, and picks the cast. You never write the joke, the premise, the story or a line of dialogue. If a line is missing, ask for it. You may suggest how it is staged (actions, lights, shots), never what is said.
- **Only the rig's own parts.** Sets, rooms, cast, actions, lights, shots and voices come from `robot.py lists`. Never invent one.
- **Preview first, export after.** Show the spec card. The owner plays it live from the card ("Preview it live": every scene on their real stage, with the cached voices, in seconds, no frames rendered). Render only after "Looks right, export" (or a clear yes after the preview). "Change a beat: …" means edit the spec, write the card again, and let them preview again.
- **Voices cost money.** Cached lines are free. New lines are voiced by Aura on Cloudflare Workers AI, a few cents each. Before rendering, say how many lines are new and ask. Only pass `--allow-new-voices` after a clear yes for that count; a re-render after your own mistake is new spend and needs a new yes.
- **Nothing public.** The MP4 stays on this Mac. Never upload, post or publish it.

## Where things are

- The rig: the `rig.path` in the owner's Goddard OS profile (`~/.claude/channels/gm-chat/profile.json`, module `rig`; default `~/videos/the-standup`). Read and run only: never edit, move or delete anything in it.
- The outputs: `rig.out` in the same profile (default `~/Goddard/videos`), one folder per sketch: `<out>/<id>/`.
- The tool: `robot.py` next to this file (`${CLAUDE_PLUGIN_ROOT}/skills/paper-robot/robot.py`). Run it with `python3`; it switches to the rig's own Python by itself. Pass `--rig <path>` when the profile's path is not the default.
- The spec format is documented at the top of `<rig>/pipeline/sketch.py`. Real examples: `<rig>/pipeline/episodes/ep4/*.json`.

## Steps

1. **Read the rig.** `python3 robot.py lists --rig <rig>`. Note the cast (Orchestrator, Researcher, Coder, Reviewer, Summarizer, plus Biscuit the paper dog via `"props": {"dog": true}`).
2. **Get the bit.** If they haven't said it: ask who's in it (one question, the cast as choices) and what happens, in their words. Ask for the exact lines. One question at a time.
3. **Write the spec** to `<out>/<id>/spec.json`. The id is short, lowercase, hyphens, and new (never an existing episode's id). Put their lines in `say` word for word. Pick `act`, `light` and `shot` per beat from the lists. Keep it short: a Short is 3 to 8 beats.
4. **Check it.** `python3 robot.py check <out>/<id>/spec.json --rig <rig>`. Fix every error. Note `lines`, `cached` and `new`.
5. **Show the plan.** `python3 robot.py card <out>/<id>/spec.json --out <out>/<id> --rig <rig>` writes `plan.md`. In your reply, give its full path (Goddard OS draws it as the spec card, with a "Preview it live" button; always say the words "Preview it live", the app keys on them), then one line: "N lines, M new voices (a few cents)" or "all voices cached, no spend". Say: "Tap Preview it live. Export when it looks right." The preview never voices anything: lines with no cached take play silent with their caption. The app builds it itself (`robot.py preview`); run that yourself only to check the spec builds.
6. **On "Looks right, export",** render: `python3 robot.py render <out>/<id>/spec.json --out <out>/<id> --rig <rig>` (add `--allow-new-voices` only per the rule above; `--fmt wide` only if they ask for 16:9). It prints the MP4 path. Run it in the background: a 20-second sketch takes several minutes.
7. **Hand it over.** Check the MP4 plays (`ffprobe` shows a video and an audio stream, and the duration). Reply with its full path so it lands in Outputs, plus the duration, in one or two lines.

## If something breaks

Read the error; the render step names the stage that failed (sketch, frames, compose). Fix the spec, not the rig. If the rig itself is broken, stop and tell the owner what failed and where.
