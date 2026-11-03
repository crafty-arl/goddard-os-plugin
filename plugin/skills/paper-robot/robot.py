#!/usr/bin/env python3
"""Paper robot video: checks a sketch spec against the rig, counts what it costs, draws the plan card, renders the MP4.

The rig (a Standup-style folder: pipeline/sketch.py, pipeline/standup.py, rig/set_shots.mjs) is only read and run,
never changed. Everything this script makes goes in the output folder, plus the rig's own work/<id>/ folder that
sketch.py always writes to.

  robot.py lists                                   what the rig has: sets, rooms, cast, actions, lights, shots, voices
  robot.py check  <spec.json>                      errors, plus how many lines are voiced, cached (free) and new (paid)
  robot.py card   <spec.json> --out DIR            DIR/plan.md, the spec as a short card for the owner's Go
  robot.py stage  <staging.json> --out DIR        checks the staging (one row per beat: the owner's line word for word, its kind,
                                                   what we see change, the shot, how much worse it looks) and writes
                                                   DIR/staging.json for the staging card; gold tags go to <DIR>/../poses-to-add.md
  robot.py spec   <staging.json> --out DIR        the approved staging -> DIR/spec.json and DIR/plan.md (the spec card)
  robot.py write  <brief.json> --out DIR --estimate   how many Grok calls a draft takes and about what they cost (calls nothing)
  robot.py write  <brief.json> --out DIR --go         Grok drafts the lines (3 options a beat) and punches them up, through the
                                                   rig's own lines card; DIR/lines.json, with what each call really cost
  robot.py lines-spec <lines.json> --out DIR       the picked lines -> DIR/spec.json and DIR/plan.md (the spec card)
  robot.py preview <spec.json> --out DIR          DIR/preview.json: each scene built for the rig's live player (no frames,
                                                   about a second), with its cached voices mixed by their cue times. Never
                                                   voices anything: a line with no cached take plays silent, with its caption
  robot.py render <spec.json> --out DIR [--fmt short|wide] [--allow-new-voices]
                                                   DIR/<id>_<fmt>.mp4 (refuses to voice new lines without the flag)

The rig folder comes from --rig, else $GM_RIG, else ~/videos/the-standup.
"""
import glob, hashlib, json, os, shutil, sys, tempfile, time

try: import numpy, PIL  # the rig's code runs in the ComfyUI venv; hop into it when started with a bare python
except ImportError:
    venv = os.path.expanduser("~/ComfyUI/.venv/bin/python")
    if os.path.exists(venv) and os.path.realpath(sys.executable) != os.path.realpath(venv): os.execv(venv, [venv] + sys.argv)
    sys.exit("The rig needs numpy and Pillow (it runs in ~/ComfyUI/.venv). Neither was found.")

def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv and sys.argv.index(name) + 1 < len(sys.argv) else default

RIG = os.path.expanduser(arg("--rig") or os.environ.get("GM_RIG") or "~/videos/the-standup")
PIPE = os.path.join(RIG, "pipeline")
if not os.path.exists(os.path.join(PIPE, "sketch.py")): sys.exit(f"No rig at {RIG} (pipeline/sketch.py is missing).")
sys.path.insert(0, PIPE)
import sketch as SK  # noqa: E402  (the rig's own lists: ACTIONS, LIGHTS, SHOTS, HOST_VOICE)

SETS = sorted({s for s, _ in SK.SPOTS})
ROOMS = sorted(r for r in (os.path.basename(os.path.dirname(p)) for p in glob.glob(os.path.join(RIG, "sets3d", "*", "paint.png"))) if not r.endswith("_wide"))
CAST = list(SK.HOST_VOICE)

def scenes(spec):
    """One flat spec per scene, merged the way standup.py merges them (a one-scene spec is its own only scene)."""
    if not spec.get("scenes"): return [spec]
    return [{**{k: v for k, v in spec.items() if k != "scenes"}, **sc, "id": f"{spec['id']}_s{i + 1}"} for i, sc in enumerate(spec["scenes"])]

def voice_of(sc, who):
    """(voice, phone) for a beat's speaker, as sketch.py picks it."""
    if who == "host": return SK.HOST_VOICE[sc["host"]["robot"]], False
    v = (sc.get("voices") or {}).get(who)
    return (v["voice"], bool(v.get("phone"))) if v else (SK.HOST_VOICE[sc["host"]["robot"]], False)

def cached(voice, phone, text):
    """the rig's cached take of this line, from any earlier sketch (the cache key is the voice and the words, not the sketch)"""
    h = hashlib.sha1(f"{voice}|{phone}|{text}".encode()).hexdigest()[:12]
    for wav in glob.glob(os.path.join(PIPE, "work", "*", f"vo-{h}.wav")):
        if os.path.exists(wav + ".words.json"): return h, os.path.dirname(wav)
    return h, None

def check(spec):
    errs, lines = [], []
    if not str(spec.get("id", "")).strip(): errs.append("the spec needs an id")
    for i, sc in enumerate(scenes(spec)):
        at = f"scene {i + 1}: " if spec.get("scenes") else ""
        if sc.get("set", "creator_room") not in SETS: errs.append(f"{at}set {sc.get('set')!r} is not one of {SETS}")
        if sc.get("room") and sc["room"] not in ROOMS: errs.append(f"{at}room {sc['room']!r} is not one of the painted rooms")
        robot = (sc.get("host") or {}).get("robot")
        if robot not in CAST: errs.append(f"{at}host {robot!r} is not one of the cast {CAST}"); continue
        if (sc.get("host") or {}).get("pose", "stand") not in ("sit", "stand"): errs.append(f"{at}pose must be sit or stand")
        if not sc.get("beats"): errs.append(f"{at}no beats")
        for j, b in enumerate(sc.get("beats") or []):
            w = f"{at}beat {j + 1}: "
            for key, ok in (("act", SK.ACTIONS), ("light", SK.LIGHTS), ("shot", SK.SHOTS)):
                if b.get(key) and b[key] not in ok: errs.append(f"{w}{key} {b[key]!r} is not in the rig's list {ok}")
            who = b.get("who", "host")
            if who != "host" and who not in (sc.get("voices") or {}): errs.append(f"{w}{who!r} speaks but has no voice under \"voices\"")
            if b.get("say"):
                v, ph = voice_of(sc, who); h, where = cached(v, ph, b["say"])
                lines.append({"scene": sc["id"], "who": who, "say": b["say"], "voice": v, "hash": h, "cached": where})
    new = [l for l in lines if not l["cached"]]
    return {"ok": not errs, "errors": errs, "lines": len(lines), "cached": len(lines) - len(new), "new": len(new),
            "new_chars": sum(len(l["say"]) for l in new), "new_lines": [f"{l['who']}: {l['say']}" for l in new], "_lines": lines}

def card(spec, report):
    """the plan card: the spec in short lines that wrap on a phone, in the order it plays"""
    fmt = "9:16 Short" if os.environ.get("FORMAT", "short") == "short" else "16:9 wide"
    out = [f"# Sketch spec · {spec.get('title') or spec['id']}", "", f"{fmt}. Tap Preview it live to watch it first. Nothing renders until you say \"Looks right, export\"."]
    many = len(scenes(spec)) > 1
    for i, sc in enumerate(scenes(spec)):
        h = sc["host"]; props = sc.get("props") or {}
        bits = [k.replace("_", " ") for k, v in props.items() if v is True] + ([f"holds {props['held']}"] if props.get("held") else [])
        bits = ["Biscuit" if b == "dog" else b for b in bits]
        own = f"{h['robot'].lower()}_room"  # sketch.py films a creator in their own room when it is painted
        room = sc.get("room") or (own if sc.get("set", "creator_room") == "creator_room" and own in ROOMS else sc.get("set", "creator_room"))
        out += ["", f"**{'Scene ' + str(i + 1) + ' · ' if many else ''}{h['robot']}** {h.get('pose', 'stand')}s · `{room}`" + (f" · {', '.join(bits)}" if bits else "")]
        for b in sc.get("beats") or []:
            how = " · ".join(x for x in (b.get("act"), b.get("light"), b.get("shot")) if x) or "hold"
            if (b.get("fx") or {}).get("blackout"): how += " · blackout"
            who = "" if b.get("who", "host") == "host" else f"{b['who']} (off screen): "
            out.append(f"- `{how}`" + (f" {who}\"{b['say']}\"" if b.get("say") else ""))
    out += ["", f"**Voices:** {report['lines']} lines · {report['cached']} cached (free) · {report['new']} new"
            + (f" ({report['new_chars']} characters on Workers AI, a few cents)" if report["new"] else " (no spend)")]
    return "\n".join(out) + "\n"

KINDS = ("SETUP", "BUILD", "TURN", "PAUSE", "PUNCH")
BEAT_KEYS = ("act", "light", "shot", "fx", "chapter", "chat", "badge", "pop", "sfx")

def visible(b):
    """what a viewer can actually see change on a beat: the rig fields, not the description"""
    fx = b.get("fx") or {}
    return (b.get("act"), b.get("light"), b.get("shot"), b.get("chapter"), int(fx.get("boxes", 0)), bool(fx.get("windows")), bool(fx.get("spray")))

def stage_check(st):
    """The staging rules (Carl, 2026-11-02: "the picture has to tell the joke too"). Returns a list of what's wrong."""
    errs, lines = [], st.get("lines") or []
    if not str(st.get("id", "")).strip(): errs.append("the staging needs an id")
    if st.get("host") not in CAST: errs.append(f"host {st.get('host')!r} is not one of the cast {CAST}")
    if st.get("room") and st["room"] not in ROOMS: errs.append(f"room {st['room']!r} is not one of the painted rooms")
    if not lines: errs.append('"lines" must list the owner\'s lines exactly as they gave them')
    beats, last_build = st.get("beats") or [], None
    if not beats: errs.append("no beats")
    for i, b in enumerate(beats):
        w, kind = f"beat {i + 1}: ", b.get("kind")
        if kind not in KINDS: errs.append(f"{w}kind must be one of {KINDS}"); continue
        if not str(b.get("see", "")).strip(): errs.append(f"{w}say what we SEE change (prop, screen, position, pose, light)")
        for key, ok in (("act", SK.ACTIONS), ("light", SK.LIGHTS), ("shot", SK.SHOTS)):
            if b.get(key) and b[key] not in ok: errs.append(f"{w}{key} {b[key]!r} is not in the rig's list {ok}")
        if b.get("shot") == "tight": errs.append(f"{w}no \"tight\": in a painted 3D room the rig turns it into a low off-center angle. Use close (centered) or push")
        if kind == "PAUSE":
            if b.get("say"): errs.append(f"{w}a PAUSE is silent")
            if not 1.0 <= float(b.get("hold", 0)) <= 1.5: errs.append(f"{w}a PAUSE holds 1 to 1.5 seconds (\"hold\")")
            if i + 1 >= len(beats) or beats[i + 1].get("kind") != "PUNCH": errs.append(f"{w}a PAUSE comes right before a PUNCH")
        else:
            if not b.get("say"): errs.append(f"{w}{kind} needs the owner's line (only a PAUSE is silent)")
            elif b["say"] not in lines: errs.append(f"{w}the line {b['say']!r} is not one of the owner's lines word for word")
        if kind == "PUNCH":
            if i == 0 or beats[i - 1].get("kind") != "PAUSE": errs.append(f"{w}every PUNCH has a silent PAUSE right before it")
            if b.get("shot") != "close" or beats[i - 1].get("shot") not in (None, "close"): errs.append(f"{w}the PAUSE and the PUNCH sit on a centered close (shot: close)")
        if kind == "BUILD":
            if last_build is not None:
                pb = beats[last_build]
                if int(b.get("esc", 0)) <= int(pb.get("esc", 0)): errs.append(f"{w}each BUILD looks worse than the last: esc must go up from {pb.get('esc', 0)}")
                if visible(b) == visible(pb): errs.append(f"{w}this BUILD looks the same as beat {last_build + 1}: change something the viewer can see (boxes, light, act, shot, chapter)")
            last_build = i
        if (b.get("fx") or {}).get("boxes") and any(x.get("shot") == "close" for x in beats[i + 1:]):
            errs.append(f"{w}fx.boxes buries the host (the pile lands on him and stays), so the close-up later would show only boxes. Escalate with light, act, chapter or shot, or tag \"new prop: app pile beside the desk\"")
        for t in b.get("new") or []:
            if not isinstance(t, str) or not t.strip(): errs.append(f"{w}gold tags are short strings like \"new pose: tired\"")
    return errs

def stage(st, out_dir):
    errs = stage_check(st)
    if errs: sys.exit("Staging has problems:\n- " + "\n- ".join(errs))
    os.makedirs(out_dir, exist_ok=True)
    st = {**st, "approved": bool(st.get("approved"))}
    p = os.path.join(out_dir, "staging.json"); json.dump(st, open(p, "w"), indent=1)
    # every gold tag (a move or prop the rig can't do yet) goes on one list for the rig work later, once each
    tags = [t.strip() for b in st["beats"] for t in (b.get("new") or [])]
    if tags:
        todo = os.path.join(os.path.dirname(os.path.abspath(out_dir.rstrip("/"))), "poses-to-add.md")
        have = open(todo).read() if os.path.exists(todo) else "# Poses and props to add to the rig\n\nGold tags from staging cards: moves or props a sketch wanted that the rig can't do yet.\n\n"
        add = [t for t in dict.fromkeys(tags) if f"- {t} " not in have]
        if add: open(todo, "w").write(have + "".join(f"- {t} (from {st['id']}, {time.strftime('%Y-%m-%d')})\n" for t in add))
    return p

def spec_from_staging(st):
    """The approved staging as a rig spec. A PAUSE folds into its PUNCH: the silence is the punch's pause, and the cut to
    the centered close moves back to where the silence starts (hold_close below), so the hold and the line share one shot."""
    spec = {"id": st["id"], "title": st.get("title") or st["id"], "set": st.get("set", "creator_room"),
            "host": {"robot": st["host"], "pose": st.get("pose", "sit")}, "props": st.get("props") or {"ring_light": True},
            "strip": st.get("strip") or {"mode": "video", "title": st.get("title") or st["id"]}, "beats": []}
    if st.get("room"): spec["room"] = st["room"]
    for k in ("voices", "ending", "endcard"):
        if st.get(k): spec[k] = st[k]
    pending = None
    for b in st["beats"]:
        if b["kind"] == "PAUSE": pending = float(b["hold"]); continue
        beat = {"who": "host", "say": b["say"], **{k: b[k] for k in BEAT_KEYS if b.get(k) is not None}}
        if pending is not None: beat.update({"pause": pending, "shot": "close", "x_hold_close": True}); pending = None
        spec["beats"].append(beat)
    return spec

def hold_close(scene_path, beats):
    """Moves each held punch's cut to its centered close back to the start of its silence (camera, look, lens, focus)."""
    scene = json.load(open(scene_path)); changed = False
    for b in beats:
        if not b.get("x_hold_close"): continue
        t0 = b["start"]; tp = round(t0 - float(b.get("pause", 0)), 3)
        tracks = [scene["camera"][k] for k in ("pos", "look", "fov") if k in scene.get("camera", {})] + ([scene["focus"]] if scene.get("focus") else [])
        for tr in tracks:
            at = [e for e in tr if abs(e[0] - t0) < 0.0005]
            if not at: continue
            before = [e for e in tr if e[0] < tp]
            keep = [e for e in tr if not (tp - 0.0015 <= e[0] < t0 - 0.0005)]
            new = ([[round(tp - 0.001, 3), before[-1][1]]] if before else []) + [[tp, at[0][1]]]
            tr[:] = sorted(keep + new, key=lambda e: e[0]); changed = True
    if changed: json.dump(scene, open(scene_path, "w"))

# the owner's own animation (Carl, 2026-11-03: "I don't have control over the video"): anim.json beside the spec holds the
# tracks he keyed in Goddard OS's Animate screen, per scene. They replace the action library's channels they cover, so
# the render plays exactly what he keyed.
ANIM = {}
ARM_IK = {"armL": ("handL", "handLFrom", "handLUntil", "handLPole"), "armR": ("handR", "handRFrom", "handRUntil", "handRPole")}
def apply_anim(scene_path, sid):
    a = (ANIM.get("scenes") or {}).get(sid)
    if not a: return
    scene = json.load(open(scene_path))
    for c in scene.get("cast") or []:
        tr = (a.get("cast") or {}).get(c["robot"])
        if not tr: continue
        an = c.setdefault("anim", {})
        for k, v in tr.items(): an[k] = v
        for arm, ik in ARM_IK.items():          # a keyed arm is posed by its joints: the hand target would override it
            if arm in tr:
                for x in ik: an.pop(x, None)
        if {"armL", "armR", "lean", "twist", "roll"} & set(tr): an.pop("flail", None); an.pop("twitch", None)
    if a.get("camera"):
        scene["camera"] = a["camera"]
        for k in ("camShake", "camSway"): scene.pop(k, None)
    if a.get("focus"): scene["focus"] = a["focus"]
    json.dump(scene, open(scene_path, "w"))

def load_anim(out_dir):
    p = os.path.join(out_dir, "anim.json")
    ANIM.clear()
    if os.path.exists(p): ANIM.update(json.load(open(p)))

def with_holds(mod):
    """wraps the rig's compiler (from out here) so every compiled scene gets its held punches"""
    orig = mod.compile_spec
    if getattr(orig, "_holds", False): return mod
    def compile_spec(spec, voice_only=False):
        r = orig(spec, voice_only)
        if voice_only: return r
        if any(b.get("x_hold_close") for b in spec.get("beats") or []): hold_close(r[0], orig(spec, True))
        apply_anim(r[0], spec.get("id")); return r
    compile_spec._holds = True; mod.compile_spec = compile_spec
    return mod
with_holds(SK)
import importlib as _il  # standup.py reloads the compiler before each scene; the wrap goes back on after every reload
_reload = _il.reload
def _reload_with_holds(m): r = _reload(m); return with_holds(r) if getattr(r, "__name__", "") == "sketch" else r
_il.reload = _reload_with_holds

# Write it with Grok (Carl, 2026-11-03: "it's not funny, I thought you were using Grok"): the rig's writer since Oct 13 is
# Grok on OpenRouter (pipeline/pilot.py, the standup_lines card). The owner gives the premise and his beats; Grok writes the
# jokes, three options a beat, then an editor pass punches them up; he picks or edits every line. Every call is paid, so
# --estimate comes first and the owner says go; each call's real cost is logged in lines.json.
GROK = os.environ.get("STANDUP_WRITER", "openrouter:x-ai/grok-4.20").split(":", 1)[-1]
EST_OUT = {"draft": 2200, "punchup": 1800}
def lines_card():
    import pilot as P
    return open(os.path.join(P.CARDS, "tasks", "standup_lines.md")).read()
def write_prompts(brief, draft=None):
    card = lines_card()
    if draft is None:
        system = card + """

You are the WRITER of The Standup (paper robots, no mouths). Carl's beats below are the spine, in his order; you write the
jokes on top of them. Be funny: escalate, misdirect, land the payoff. You may add jokes, chat lines and comments.
For EVERY beat with a say, give "options": three different lines (max 16 words each, best first) and set "say" to the first."""
        user = json.dumps({"pitch": {k: brief.get(k) for k in ("title", "format", "host", "setup", "turn", "payoff", "props") if brief.get(k)},
                           "carl_beats": brief.get("beats") or [], "notes": brief.get("notes", "")}, indent=1)
    else:
        system = card + """

You are the EDITOR (punch-up). The writer gave three options per beat. For each spoken beat keep the funniest or punch it up:
return "options" with the best first (at most three), "say" = the first, and "note": why it is funnier (max 12 words).
Keep Carl's beats and their order. Return the whole spec object, same fields."""
        user = json.dumps(draft, indent=1)
    return system, user
def price():
    """the model's price per token from OpenRouter's public list (free, no key); GM_ROBOT_PRICE="in,out" per million overrides"""
    if os.environ.get("GM_ROBOT_PRICE"): i, o = os.environ["GM_ROBOT_PRICE"].split(","); return float(i) / 1e6, float(o) / 1e6
    import urllib.request
    try:
        for m in json.loads(urllib.request.urlopen("https://openrouter.ai/api/v1/models", timeout=20).read())["data"]:
            if m["id"] == GROK: return float(m["pricing"]["prompt"]), float(m["pricing"]["completion"])
    except Exception: pass
    return None
def estimate(brief):
    sys_, user = write_prompts(brief); tin = (len(sys_) + len(user)) // 4
    calls = [{"pass": "draft", "in": tin, "out": EST_OUT["draft"]}, {"pass": "punchup", "in": tin + EST_OUT["draft"], "out": EST_OUT["punchup"]}]
    pr = price(); usd = round(sum(c["in"] * pr[0] + c["out"] * pr[1] for c in calls), 4) if pr else None
    return {"model": GROK, "calls": len(calls), "tokens": sum(c["in"] + c["out"] for c in calls), "usd": usd,
            "say": f"{len(calls)} Grok calls (draft + punch-up), about " + (f"${usd:.3f}" if usd is not None else "a few cents (price list unreachable)")}
def grok_call(system, user, max_tokens):
    """one OpenRouter call; GM_ROBOT_STUB=<dir> answers from recorded files instead (tests, $0)"""
    stub = os.environ.get("GM_ROBOT_STUB")
    if stub:
        n = len([f for f in os.listdir(stub) if f.startswith("called-")]); open(os.path.join(stub, f"called-{n}"), "w").write(user[:200])
        d = json.load(open(os.path.join(stub, f"answer-{n}.json")))
    else:
        import urllib.request
        key = open(os.path.expanduser("~/.config/openrouter/key")).read().strip()
        body = {"model": GROK, "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}], "max_tokens": max_tokens,
                "temperature": 0.9, "reasoning": {"enabled": False}, "usage": {"include": True}}
        req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions", method="POST", data=json.dumps(body).encode(),
                                     headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "X-Title": "The Standup"})
        d = json.loads(urllib.request.urlopen(req, timeout=240).read())
    import re
    text = re.sub(r"<think>.*?</think>", "", (d.get("choices") or [{}])[0].get("message", {}).get("content") or "", flags=re.S)
    m = re.search(r"\{.*\}", text, re.S)
    if not m: raise ValueError(f"Grok sent no JSON: {text[:200]}")
    u = d.get("usage") or {}
    return json.loads(m.group(0)), {"model": d.get("model", GROK), "in": u.get("prompt_tokens"), "out": u.get("completion_tokens"), "usd": u.get("cost")}
def write(brief, out_dir):
    os.makedirs(out_dir, exist_ok=True); log = []
    s1, u1 = write_prompts(brief); draft, c1 = grok_call(s1, u1, EST_OUT["draft"] + 800); log.append({"pass": "draft", "at": time.strftime("%Y-%m-%d %H:%M"), **c1})
    s2, u2 = write_prompts(brief, draft); final, c2 = grok_call(s2, u2, EST_OUT["punchup"] + 800); log.append({"pass": "punchup", "at": time.strftime("%Y-%m-%d %H:%M"), **c2})
    beats = []
    for b in final.get("beats") or []:
        opts = [o for o in (b.get("options") or ([b["say"]] if b.get("say") else [])) if isinstance(o, str) and o.strip()][:3]
        beats.append({**{k: v for k, v in b.items() if k not in ("options", "say", "note")}, "options": opts, "note": b.get("note", ""), "pick": 0, "say": opts[0] if opts else ""})
    doc = {"id": brief["id"], "title": brief.get("title") or brief["id"], "brief": brief, "writer": GROK, "spec": {k: v for k, v in final.items() if k != "beats"},
           "beats": beats, "calls": log, "usd": round(sum(c["usd"] or 0 for c in log), 4), "approved": False}
    p = os.path.join(out_dir, "lines.json"); json.dump(doc, open(p, "w"), indent=1)
    # every call's real cost, kept across sketches
    with open(os.path.join(os.path.dirname(os.path.abspath(out_dir.rstrip("/"))), "grok-costs.jsonl"), "a") as f:
        for c in log: f.write(json.dumps({"sketch": brief["id"], **c}) + "\n")
    return p
def lines_spec(doc):
    """the owner's picked (or edited) lines as the spec: Grok's staging is kept, every say is his pick"""
    beats = []
    for b in doc["beats"]:
        nb = {k: v for k, v in b.items() if k not in ("options", "note", "pick")}
        if b.get("options") or b.get("say"): nb["say"] = b.get("say") or b["options"][b.get("pick", 0)]
        if not nb.get("say"): nb.pop("say", None); nb.setdefault("hold", 1.0)
        beats.append(nb)
    spec = {**doc["spec"], "id": doc["id"], "title": doc.get("title") or doc["id"], "beats": beats}
    spec.setdefault("host", {"robot": doc["brief"].get("host", "Coder"), "pose": "sit"})
    return spec

def stage_voices(rep):
    """cached takes are copied into this sketch's own work folder, so sketch.py finds them and nothing is voiced again"""
    for l in rep["_lines"]:
        dest = os.path.join(PIPE, "work", l["scene"])
        if l["cached"] and os.path.realpath(l["cached"]) != os.path.realpath(dest):
            os.makedirs(dest, exist_ok=True)
            for f in glob.glob(os.path.join(l["cached"], f"vo-{l['hash']}.*")):
                if not os.path.exists(os.path.join(dest, os.path.basename(f))): shutil.copy2(f, dest)

def preview(spec, out_dir):
    """Builds every scene for the rig's live player (tablestage.html?play=1) without rendering a frame. Each scene gets
    preview.json (as the render films it), preview.phone.json (1x pixels, no depth of field, for phones) and
    preview.wav (its voices at their cue times; the render's room tone and sound effects are left out)."""
    rep = check(spec)
    if not rep["ok"]: sys.exit("Spec has errors:\n- " + "\n- ".join(rep["errors"]))
    stage_voices(rep); load_anim(out_dir)
    real_tts, silent = SK.tts, []
    def no_spend_tts(text, voice, phone, od):
        # a cached take is used as is; anything else gets a silent stand-in of about its spoken length, never the API.
        # It is named so neither this script nor sketch.py ever mistakes it for a real take (vo-<hash>.wav).
        h = hashlib.sha1(f"{voice}|{phone}|{text}".encode()).hexdigest()[:12]
        if os.path.exists(os.path.join(od, f"vo-{h}.wav")): return real_tts(text, voice, phone, od)
        words = text.split(); per = 1 / 2.6; dur = max(0.8, len(words) * per)
        wav = os.path.join(od, f"preview-silent-{h}.wav")
        if not os.path.exists(wav): run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", f"{dur:.2f}", wav])
        silent.append(text)
        return wav, [[w, i * per, (i + 1) * per] for i, w in enumerate(words)]
    SK.tts = no_spend_tts
    many, out = bool(spec.get("scenes")), []
    try:
        for i, sc in enumerate(scenes(spec)):
            sub = dict(sc)
            # the same seams standup.py puts between scenes: middle scenes have no end card and a short tail, later ones a short lead
            if many and i < len(spec["scenes"]) - 1: sub.pop("ending", None); sub.update({"tail": 0.2, "tail_black": 0.0})
            if many and i: sub["lead"] = 0.1
            n0 = len(silent); scene_path, dur = SK.compile_spec(sub)
            work = os.path.dirname(scene_path); scene = json.load(open(scene_path))
            json.dump(scene, open(os.path.join(work, "preview.json"), "w"))
            json.dump({**scene, "ssaa": 1, "dof": False}, open(os.path.join(work, "preview.phone.json"), "w"))
            wav = os.path.join(work, "preview.wav"); cues = scene.get("audio") or []
            ins = sum((["-i", os.path.join(RIG, c["file"])] for c in cues), [])
            run(["ffmpeg", "-v", "error", "-y", *ins, "-f", "lavfi", "-t", f"{dur:.3f}", "-i", "anullsrc=r=48000:cl=stereo",
                 "-filter_complex", "".join(f"[{k}:a]aresample=48000,aformat=channel_layouts=stereo,adelay={int(c['at'] * 1000)}:all=1,volume={c.get('gain', 0)}dB[a{k}];" for k, c in enumerate(cues))
                 + f"[{len(cues)}:a]" + "".join(f"[a{k}]" for k in range(len(cues))) + f"amix=inputs={len(cues) + 1}:normalize=0:duration=first[m]",
                 "-map", "[m]", "-c:a", "pcm_s16le", wav])
            rel = lambda p: os.path.relpath(p, RIG)
            out.append({"n": i + 1, "host": sc["host"]["robot"], "dur": round(dur, 3), "scene": rel(os.path.join(work, "preview.json")),
                        "phone": rel(os.path.join(work, "preview.phone.json")), "audio": rel(wav), "silent": silent[n0:]})
    finally: SK.tts = real_tts
    # the whole sketch's voices in one file: the preview's clock (one sound the browser lets play from a single tap)
    os.makedirs(out_dir, exist_ok=True); mix = os.path.join(out_dir, "preview.wav")
    run(["ffmpeg", "-v", "error", "-y", *sum((["-i", os.path.join(RIG, x["audio"])] for x in out), []),
         "-filter_complex", "".join(f"[{k}:a]" for k in range(len(out))) + f"concat=n={len(out)}:v=0:a=1[m]", "-map", "[m]", "-c:a", "pcm_s16le", mix])
    man = {"id": spec["id"], "title": spec.get("title") or spec["id"], "total": round(sum(s["dur"] for s in out), 3), "scenes": out, "audio": mix,
           "new_voices": rep["new"], "note": "voices only: the render adds room tone and sound effects"}
    os.makedirs(out_dir, exist_ok=True); sp = os.path.join(out_dir, "spec.json"), ""
    # only when it changed: the live stage watches this file, and an untouched spec must not look like an edit
    if not os.path.exists(sp[0]) or json.load(open(sp[0])) != spec: json.dump(spec, open(sp[0], "w"), indent=1)
    # an earlier export's progress stays: the export card says when the spec or keys changed after it
    p = os.path.join(out_dir, "preview.json"); json.dump(man, open(p, "w"), indent=1)
    return man

def run(cmd):
    import subprocess; r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode: sys.exit(f"{cmd[0]} failed: {r.stderr.strip()[-400:]}")

def render(spec, out_dir, fmt, allow_new):
    rep = check(spec)
    if not rep["ok"]: sys.exit("Spec has errors:\n- " + "\n- ".join(rep["errors"]))
    if rep["new"] and not allow_new:
        sys.exit(f"{rep['new']} line(s) need new voices ({rep['new_chars']} characters, paid). Ask first, then pass --allow-new-voices.")
    stage_voices(rep); load_anim(out_dir)
    os.makedirs(out_dir, exist_ok=True)
    spec_path = os.path.join(out_dir, "spec.json"); json.dump(spec, open(spec_path, "w"), indent=1)
    os.environ.update({"STANDUP_MASTERS": out_dir, "FORMAT": fmt})
    import standup as ST
    # frames are big (1.5x supersampled JPEGs): keep the rig's own frames folder (the big drive) when it's there,
    # else a temporary folder that is removed afterwards
    tmp = None if os.path.isdir(os.path.dirname(ST.FRAMES.rstrip("/")) or "/") and os.access(os.path.dirname(ST.FRAMES.rstrip("/")), os.W_OK) else tempfile.mkdtemp(prefix="robot-frames-")
    if tmp: ST.FRAMES = tmp
    else:  # the headless Chrome profile and other scratch go to the big drive too
        scratch = os.path.join(os.path.dirname(ST.FRAMES.rstrip("/")), "robot-tmp"); os.makedirs(scratch, exist_ok=True); os.environ["TMPDIR"] = scratch
    # progress.json next to the spec: which scene is filming, so Goddard OS can show the export moving (the rig's own
    # per-scene step is wrapped from out here, never edited)
    n, started, prog = len(scenes(spec)), time.time(), os.path.join(out_dir, "progress.json")
    def note(**k): json.dump({"id": spec["id"], "fmt": fmt, "scenes": n, "started": started, "now": time.time(), **k}, open(prog, "w"))
    one, done = ST.render_single, [0]
    def counted(*a, **k):
        note(phase="frames", done=done[0], on=done[0] + 1); r = one(*a, **k); done[0] += 1; note(phase="frames" if done[0] < n else "stitch", done=done[0], on=min(done[0] + 1, n)); return r
    ST.render_single = counted
    note(phase="frames", done=0, on=1)
    try: mp4 = ST.render_one(spec_path, fmt)
    except BaseException as e: note(phase="failed", done=done[0], on=done[0] + 1, error=str(e)[-300:]); raise
    finally:
        if tmp: shutil.rmtree(tmp, ignore_errors=True)
        else:
            for d in glob.glob(os.path.join(ST.FRAMES, f"{spec['id']}*_{fmt}")): shutil.rmtree(d, ignore_errors=True)
        # only the finished video stays: the per-scene parts and the audio mixes go
        for f in glob.glob(os.path.join(out_dir, f"{spec['id']}_s*_{fmt}.mp4")) + glob.glob(os.path.join(out_dir, "*.mix.wav")): os.remove(f)
    mp4 = os.path.join(RIG, mp4) if not os.path.isabs(mp4) else mp4
    note(phase="done", done=n, on=n, mp4=mp4)
    return mp4

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "lists":
        print(json.dumps({"rig": RIG, "sets": SETS, "rooms": ROOMS, "cast": CAST, "dog": "Biscuit (props.dog: true, sits on the desk)",
                          "actions": SK.ACTIONS, "lights": SK.LIGHTS, "shots": SK.SHOTS, "host_voices": SK.HOST_VOICE,
                          "strip_modes": ["live", "video", "vlog", "plain"]}, indent=1)); sys.exit()
    if cmd not in ("check", "card", "stage", "spec", "write", "lines-spec", "preview", "render") or len(sys.argv) < 3: sys.exit(__doc__)
    spec = json.load(open(os.path.expanduser(sys.argv[2])))
    out = os.path.expanduser(arg("--out", "") or "")
    if cmd == "check":
        r = check(spec); r.pop("_lines"); print(json.dumps(r, indent=1)); sys.exit(0 if r["ok"] else 2)
    if not out: sys.exit("--out DIR is needed")
    if cmd == "card":
        r = check(spec)
        if not r["ok"]: sys.exit("Spec has errors:\n- " + "\n- ".join(r["errors"]))
        os.makedirs(out, exist_ok=True); p = os.path.join(out, "plan.md"); open(p, "w").write(card(spec, r)); print(p); sys.exit()
    if cmd == "preview": print(json.dumps(preview(spec, out), indent=1)); sys.exit()
    if cmd == "stage": print(stage(spec, out)); sys.exit()
    if cmd == "write":
        if "--estimate" in sys.argv:
            e = estimate(spec); os.makedirs(out, exist_ok=True)
            json.dump({"id": spec["id"], "title": spec.get("title") or spec["id"], "brief": spec, "estimate": e, "beats": [], "approved": False}, open(os.path.join(out, "lines.json"), "w"), indent=1)
            print(json.dumps(e, indent=1)); sys.exit()
        if "--go" not in sys.argv: sys.exit("write needs --estimate first, then --go once the owner said yes to that cost")
        print(write(spec, out)); sys.exit()
    if cmd == "lines-spec":
        sp = lines_spec(spec); r = check(sp)
        if not r["ok"]: sys.exit("The spec from these lines has errors:\n- " + "\n- ".join(r["errors"]))
        os.makedirs(out, exist_ok=True); json.dump(sp, open(os.path.join(out, "spec.json"), "w"), indent=1)
        json.dump({**spec, "approved": True}, open(os.path.join(out, "lines.json"), "w"), indent=1)
        p = os.path.join(out, "plan.md"); open(p, "w").write(card(sp, r)); print(p); sys.exit()
    if cmd == "spec":
        errs = stage_check(spec)
        if errs: sys.exit("Staging has problems:\n- " + "\n- ".join(errs))
        sp = spec_from_staging(spec); r = check(sp)
        if not r["ok"]: sys.exit("The spec from this staging has errors:\n- " + "\n- ".join(r["errors"]))
        os.makedirs(out, exist_ok=True); json.dump(sp, open(os.path.join(out, "spec.json"), "w"), indent=1)
        json.dump({**spec, "approved": True}, open(os.path.join(out, "staging.json"), "w"), indent=1)
        p = os.path.join(out, "plan.md"); open(p, "w").write(card(sp, r)); print(p); sys.exit()
    print(render(spec, out, arg("--fmt", "short"), "--allow-new-voices" in sys.argv))
