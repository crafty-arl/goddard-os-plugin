---
name: paper-robot
description: Make a Standup-style paper robot video on this Mac with the owner's own rig (paper robots, painted sets, the three.js table stage). The owner picks the cast and supplies the bit and the lines; you write the sketch spec from their words, they animate it themselves on their own stage (Animate: they pose the robots and key the camera), preview it live, and only after "Looks right, export" you render the MP4, exactly as they keyed it. Use when they say "make a paper robot video", "robot video", "/goddard-os:video", or start a session from the Home card.
---

# Paper robot video

You turn the owner's bit into a short sketch with their rig, and nothing else. You are the crew, not the writer.

## Rules

- **They write it, or Grok drafts it.** The owner supplies the bit and picks the cast. Lines are theirs, or Grok's (the rig's writer) when they ask for a Grok draft and pick from it. You never write the joke, the premise, the story or a line of dialogue yourself. If a line is missing, ask for it. You may suggest how it is staged (actions, lights, shots), never what is said.
- **Only the rig's own parts.** Sets, rooms, cast, actions, lights, shots and voices come from `robot.py lists`. Never invent one.
- **They animate, then preview, then export.** Show the spec card; they pose it in Animate. The owner plays it live from the card ("Preview it live": every scene on their real stage, with the cached voices, in seconds, no frames rendered). Render only after "Looks right, export" (or a clear yes after the preview). "Change a beat: …" means edit the spec, write the card again, and let them preview again.
- **Voices cost money.** Cached lines are free. New lines are voiced by Aura on Cloudflare Workers AI, a few cents each. Before rendering, say how many lines are new and ask. Only pass `--allow-new-voices` after a clear yes for that count; a re-render after your own mistake is new spend and needs a new yes.
- **Nothing public.** The MP4 stays on this Mac. Never upload, post or publish it.

## Write it with Grok

The rig's writer is Grok (`pipeline/pilot.py`: the standup_lines card goes to `x-ai/grok-4.20` on OpenRouter). When the owner wants Grok to write it (or asks for funny lines, a draft, a punch-up), you never write the lines yourself and you never tell Grok not to add jokes:

1. Write `<out>/<id>/brief.json` from their words only: `{"id", "title", "format": "live|video|vlog|ad|stage", "host", "setup", "turn", "payoff", "beats": [their beats, in their order], "notes"}`.
2. `python3 robot.py write <out>/<id>/brief.json --out <out>/<id> --rig <rig> --estimate` (calls nothing). Give the full path of `lines.json` (Goddard OS draws the Grok card) and say the count and cost it printed: "2 Grok calls, about $0.0X. Go?"
3. Only on their go for that count and cost ("Go Grok draft (…)" from the card, or a clear yes typed): `python3 robot.py write <out>/<id>/brief.json --out <out>/<id> --rig <rig> --go`. Grok drafts three options a beat, then punches them up. Give the full path of `lines.json` again and the real cost (in the file). A redraft is a new spend: estimate and ask again.
4. On "Use these lines" (they picked or edited every line on the card): `python3 robot.py lines-spec <out>/<id>/lines.json --out <out>/<id> --rig <rig>` writes `spec.json` and `plan.md`. New lines need new voices: say how many and the cost before rendering (the rule above).

Every real call's cost is also logged in `<out>/grok-costs.jsonl`.

## They animate it

The owner directs the motion (Carl, 2026-11-03: "I don't have control over the video"). After the spec card, they tap **Animate it**: their painted stage, the real robots, their joints within the rig's limits, a key lane per robot and one for the camera, and their voice clips on the timeline. Their keys save to `anim.json` beside the spec; `robot.py preview` and `robot.py render` paste them into the scene, so the MP4 plays exactly what they keyed. You never change `anim.json`.

So the spec stays plain: their lines word for word, a neutral `act` (`still` or `talk`), and a silent beat with a `hold` where they want room for motion. Don't choreograph it for them.

## Staging, only when they ask

When they tap "Ask the dog" (or say "stage it for me"), you stage it with the rules below and they approve it; otherwise skip this.



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
3. **Write the spec** to `<out>/<id>/spec.json` from their lines (word for word), plain as above. Check it: `python3 robot.py check <out>/<id>/spec.json --rig <rig>`, fix every error, note `lines`, `cached` and `new`. Write the card: `python3 robot.py card <out>/<id>/spec.json --out <out>/<id> --rig <rig>`.
4. **Only if they ask you to stage it:** write `<out>/<id>/staging.in.json` (`{"id", "title", "host", "pose", "props", "lines_from", "lines": [...], "beats": [{"kind", "say", "see", "act", "light", "shot", "esc", "fx", "chapter", "hold", "new"}]}`), run `python3 robot.py stage <out>/<id>/staging.in.json --out <out>/<id> --rig <rig>`, give the full path of `staging.json` and ask "Looks right → spec?". On that, `python3 robot.py spec <out>/<id>/staging.json --out <out>/<id> --rig <rig>` rewrites the spec and card.
5. **Show the plan.** Give the full path of `plan.md` (Goddard OS draws it as the spec card, with "Animate it" and "Preview it live" buttons; always say the words "Preview it live", the app keys on them), then one line: "N lines, M new voices (a few cents)" or "all voices cached, no spend". Say: "Tap Animate it to pose it yourself, then Preview it live. Export when it looks right." The preview never voices anything: lines with no cached take play silent with their caption. The app builds it itself (`robot.py preview`).
6. **On "Looks right, export",** render: `python3 robot.py render <out>/<id>/spec.json --out <out>/<id> --rig <rig>` (add `--allow-new-voices` only per the rule above; `--fmt wide` only if they ask for 16:9). It prints the MP4 path. Run it in the background: a 20-second sketch takes several minutes.
7. **Hand it over.** Check the MP4 plays (`ffprobe` shows a video and an audio stream, and the duration). Reply with its full path so it lands in Outputs, plus the duration, in one or two lines.

## If something breaks

Read the error; the render step names the stage that failed (sketch, frames, compose). Fix the spec, not the rig. If the rig itself is broken, stop and tell the owner what failed and where.
