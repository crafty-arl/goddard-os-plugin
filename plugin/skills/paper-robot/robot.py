#!/usr/bin/env python3
"""Paper robot video: checks a sketch spec against the rig, counts what it costs, draws the plan card, renders the MP4.

The rig (a Standup-style folder: pipeline/sketch.py, pipeline/standup.py, rig/set_shots.mjs) is only read and run,
never changed. Everything this script makes goes in the output folder, plus the rig's own work/<id>/ folder that
sketch.py always writes to.

  robot.py lists                                   what the rig has: sets, rooms, cast, actions, lights, shots, voices
  robot.py check  <spec.json>                      errors, plus how many lines are voiced, cached (free) and new (paid)
  robot.py card   <spec.json> --out DIR            DIR/plan.md, the spec as a short card for the owner's Go
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
    stage_voices(rep)
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
    os.makedirs(out_dir, exist_ok=True); json.dump(spec, open(os.path.join(out_dir, "spec.json"), "w"), indent=1)
    # a new preview means the spec may have changed: an older export's progress no longer describes it
    if os.path.exists(os.path.join(out_dir, "progress.json")): os.remove(os.path.join(out_dir, "progress.json"))
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
    stage_voices(rep)
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
    if cmd not in ("check", "card", "preview", "render") or len(sys.argv) < 3: sys.exit(__doc__)
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
    print(render(spec, out, arg("--fmt", "short"), "--allow-new-voices" in sys.argv))
