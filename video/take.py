#!/usr/bin/env python3
"""The two-part A2A take: opens its own visible 'Google Chrome for Testing' window on the lab, screen-records only that window's page area.
Part 1 runs two questions on the A2A with remote agents tab (our two agents over A2A, with MCP behind them); part 2 runs two questions and a refusal on
the Custodian to AWS agent tab (agent -> Privilege gateway -> AWS agent), with numbered captions and the API call reel opened at the key frames. No sign-in is involved:
the lab calls with its own key. Adapted from the CIMD take (privilege-cimd-test/video).

Usage: python3 take.py <work_dir>
  work_dir gets: ready.json (window geometry), go.flag (you create it), take.mp4, take.log

Which screen: MONITOR picks "medium" (an external monitor the window is placed on; default) or "laptop" (the
built-in display, for a laptop-only setup). The window SIZE is the same either way (1440x980) and fits
comfortably on both. avfoundation's screen device NUMBERS are not stable on this machine - they shift whenever
a camera connects (an iPhone via Continuity Camera adds two more entries ahead of the screens, for example) -
so this never hardcodes one: at startup, the window briefly paints itself solid green and a quick capture from
every "Capture screen N" device picks out whichever one actually shows it. Set CAPTURE_DEVICE to skip this and
force a specific index (faster, but only safe if you just calibrated and nothing has changed since).
"""
import json, os, re, signal, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright
import base64
import captions, onscreen_mask
from story_bridge import overlay_script, slide_payload as _slide_payload, hold_bubble, hold_slide as _hold_slide
OPENING_SLIDE = CLOSING_SLIDE = STEPS = SLIDES = None   # filled in main() from the lab's /api/story (the one shared parser)
MASK_SCRIPT = None   # the on-screen masking script, built in main() from the lab's .env

WORK = Path(sys.argv[1] if len(sys.argv) > 1 else "take-work").resolve()
# Two videos, one per screen (owner, 2026-11-22): the window is full screen (Chrome --kiosk) so the video fills the display.
#   PROFILE=monitor  the middle 1920x1080 monitor: large app font (L) and large slides and captions
#   PROFILE=laptop   the built-in display (1800x1169 points): small app font (S) so busy screens fit; slides and captions at normal size
# SEGMENT=all (default) records the whole video; SEGMENT=main stops before the end slides so the logs of THAT run can be captured; SEGMENT=end records only
# the end slides (protect, observability, closing) from assets/observability.json. join.sh joins main and end into one video.
SEGMENT = os.environ.get("SEGMENT", "all")
PROFILE = os.environ.get("PROFILE", "monitor")
PROFILES = {"monitor": dict(monitor="medium", display=(1920, 1080), font="L", scale=1.3, dsf=1, video=(1920, 1080)),
            "laptop":  dict(monitor="laptop", display=(1800, 1169), font="S", scale=1.0, dsf=2, video=(1800, 1169))}   # Playwright records in page (CSS) pixels: a bigger canvas only adds grey bands, so the video is the display's own 1800x1169 points
_prof = PROFILES[PROFILE]
FONT = os.environ.get("FONT", _prof["font"]); SCALE = float(os.environ.get("SCALE", _prof["scale"]))
MONITOR = os.environ.get("MONITOR", _prof["monitor"])        # "medium" (the middle external monitor) or "laptop" (built-in display)
# Each preset's own global top-left in Quartz/Chromium coordinates (top-left origin, Y grows downward - NOT the
# bottom-left/Y-up convention AppKit's NSScreen reports). "medium" was measured once against a real monitor
# arrangement; "laptop" is exact by definition (a display's own top-left is Quartz (0, 0) only for the main
# display, which the built-in one is on a laptop with no other display marked main).
# The window sits at the display's own top-left and is made full screen. Re-read the layout before a take (NSScreen frames: Quartz y = main height - (y + h)).
PRESETS = {"medium": {"origin": (-1920, -905), "win": (-1920, -905)}, "laptop": {"origin": (0, 0), "win": (0, 0)}}
_preset = PRESETS.get(MONITOR, PRESETS["medium"])
ORIGIN_X, ORIGIN_Y = int(os.environ.get("DISPLAY_X", _preset["origin"][0])), int(os.environ.get("DISPLAY_Y", _preset["origin"][1]))
WIN_X, WIN_Y = int(os.environ.get("WIN_X", _preset["win"][0])), int(os.environ.get("WIN_Y", _preset["win"][1]))
WIN_W, WIN_H = _prof["display"]   # the window is the whole display
OUT_W = int(os.environ.get("OUT_W", 2400))   # a retina capture (3600 px wide on the laptop) is scaled down to this width: a full-size encode stalls and loses the file
REHEARSE = os.environ.get("REHEARSE") == "1"   # headless, no recording, no waiting for a person (runs against whatever route the app has: live or the local stand-in)
SAMPLE = os.environ.get("SAMPLE") == "1"       # preview: headless, full timing, records with Playwright, mock stand-in allowed, labelled SAMPLE in the video
HEADLESS_REAL = os.environ.get("HEADLESS_REAL") == "1"   # the REAL take (live route, Real mode, all checks) recorded headless by Playwright, for when the screen is locked or off
RECORD_PW = (SAMPLE or HEADLESS_REAL) and not REHEARSE
HEADLESS = REHEARSE or SAMPLE or HEADLESS_REAL
WAIT_GO = os.environ.get("WAIT_GO") == "1"     # wait for go.flag before recording (default: start after the calibration, no sign-in is needed here)
THEME = os.environ.get("THEME", "light")         # "dark" or "light": the page theme shown throughout the take (standard, 2026-11-21: light by default)
APP = os.environ.get("APP_URL", "http://localhost:6881")   # the standalone lab main agent
def log(*a):
    WORK.mkdir(parents=True, exist_ok=True)
    with (WORK / "take.log").open("a") as f:
        print(*a, file=f, flush=True)

def list_screen_devices():
    """The avfoundation device numbers currently labelled "Capture screen N" - never hardcoded, since a camera
    connecting or disconnecting (including an iPhone via Continuity Camera) shifts every index after it."""
    out = subprocess.run(["ffmpeg", "-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""],
                         capture_output=True, text=True, timeout=15).stderr
    return [int(m.group(1)) for m in re.finditer(r"\[(\d+)\] Capture screen \d+", out)]

def detect_capture_device(work):
    """Which of the current "Capture screen N" devices actually shows this window: paint the page solid green,
    grab one frame from each candidate, and pick whichever has a large contiguous green run (a plain "any green
    pixel" test false-positives on a green-ish desktop wallpaper). Raises with a clear message if none match,
    rather than silently guessing wrong and recording the wrong screen."""
    from PIL import Image
    candidates = list_screen_devices()
    if not candidates:
        raise RuntimeError("no avfoundation 'Capture screen N' device found - is Screen Recording permission granted?")
    best = (None, 0)
    for dev in candidates:
        frame = work / f"_calib_{dev}.png"
        r = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "avfoundation",
                           "-framerate", "30", "-pixel_format", "uyvy422", "-i", f"{dev}:none", "-frames:v", "1", str(frame)],
                          capture_output=True, timeout=15)
        if r.returncode != 0 or not frame.exists():
            continue
        im = Image.open(frame).convert("RGB")
        w, h = im.size
        px = im.load()
        matched = 0
        for y in range(0, h, 3):
            run = 0
            for x in range(w):
                px_r, px_g, px_b = px[x, y]
                if px_g > 120 and px_g > px_r * 2.2 and px_g > px_b * 2.2:
                    run += 1
                    if run > w * 0.3:
                        matched += run
                else:
                    run = 0
        frame.unlink(missing_ok=True)
        log("calibration: device", dev, "matched", matched)
        if matched > best[1]:
            best = (dev, matched)
    if best[0] is None:
        raise RuntimeError(f"calibration found the green marker on none of {candidates} - the window may be off-screen for this MONITOR preset")
    return best[0]

# The pop-ups and slides are the SHARED overlay (web/src/story/overlay.js, vendored) and the holds are the shared formulas (hold.js): see story_bridge.py. The video has no copy of either.
TOTAL = 25 if SAMPLE else 27   # numbered caption bubbles; the take counts them and logs a mismatch (conditional scenes change the count)
P1_Q1 = "What can Bob Reyes reach?"                      # a clean A2A handoff, MCP data with the email redacted
P1_Q2 = "Review access on prod-db-primary"               # the data call the gateway blocks (AI Guard), by design of the injection demo
P2_Q1 = "Use add_numbers to add 987654321 and 123456789. Show the exact tool call you made and the value it returned."
P2_Q2 = "Add 48,213 and 9,787, then say whether the result is even or odd."
P2_SUM = "1111111110"; P2_SUM2 = "58000"

ASSETS = Path(__file__).parent / "assets"
PUBLIC_IMAGES = None   # {captured name: redacted name}, checked by OCR in main() before the browser opens (onscreen_mask.public_image)

def public_images(slides, rules, assets=ASSETS):
    """Every image any slide of this take can show (opening, closing and the rest), mapped to its OCR-checked redacted copy. Refuses before recording."""
    return {s["image"]: onscreen_mask.public_image(s["image"], assets, rules) for s in slides if s and s.get("image")}

def slide_payload(cfg):
    """captions.py's flat slide -> the shared overlay's shape (story_bridge.slide_payload). Images come from the local, gitignored assets folder. Edit captions.md, not this.
    A masked take shows only the redacted copy that main() checked; an image it did not check is never shown."""
    if cfg.get("image") and PUBLIC_IMAGES is not None:
        cfg = {**cfg, "image": PUBLIC_IMAGES.get(cfg["image"])}   # None (no image) if somehow unchecked: fail safe, without stopping the recorder
    return _slide_payload(cfg, ASSETS)

def first_sentence(s, limit=150):
    """A caption fact line: the text up to its first full stop, never cut mid-word."""
    s = (s or "").strip().split("\n")[0]
    cut = s.find(". ")
    s = s[:cut + 1] if cut > 0 else s
    return s if len(s) <= limit else s[:limit].rsplit(" ", 1)[0] + "..."

def observability_slide():
    """The slide right before the closing: what the recorded run left behind for observability. The captured evidence (assets/observability.json,
    written after the main take from the logs of that run) fills it; without it a live take refuses to finish."""
    cfg = dict(SLIDES["observability"])
    ev = Path(__file__).parent / "assets" / "observability.json"
    if ev.exists():
        d = json.loads(ev.read_text())
        for k in ("image", "lead", "col_a_heading", "col_a_lines", "col_b_heading", "col_b_lines", "verdict"):
            if k in d: cfg[k] = d[k]
        cfg["image"] = None; cfg["wide"] = False   # text only (owner, 2026-11-24): no console screenshot in a public video
    elif not SAMPLE:
        raise RuntimeError("assets/observability.json is missing: capture the logs of the recorded run first (the observability slide is a standard)")
    return cfg

def main():
    global OPENING_SLIDE, CLOSING_SLIDE, STEPS, SLIDES
    WORK.mkdir(parents=True, exist_ok=True)
    try:   # the wording, from the lab's /api/story (the one shared parser), checked to be this checkout's captions.md
        OPENING_SLIDE, CLOSING_SLIDE, STEPS, SLIDES = captions.load(APP, Path(__file__).parent / "captions.md")
    except ValueError as e:
        log("cannot read the wording:", e); raise SystemExit(f"take.py: {e}")
    # A live take is published: real hosts, the client id and the runtime id are masked on screen, from the lab's own .env (never written here). No masks, no live take.
    global MASK_SCRIPT, PUBLIC_IMAGES
    env_file = Path(os.environ.get("MASK_ENV", str(Path.home() / "Development/AI-DEMO-Standalone/standalone/privilege-a2a-anthropic-demo-LAB/.env")))
    try:
        rules = onscreen_mask.mask_rules(env_file)
    except (OSError, onscreen_mask.MaskConfigError) as e:   # every take is masked, the sample too (its fixtures carry real hosts)
        log("no on-screen masks: refusing the take"); raise SystemExit(f"take.py: cannot build the on-screen masks from {env_file} ({type(e).__name__}): a public video must not show real hosts; set MASK_ENV to the lab's .env")
    MASK_SCRIPT = onscreen_mask.mask_script(rules)
    log("on-screen masks:", len(rules["pairs"]), "rules,", len(rules["detect"]), "leak detectors")
    PUBLIC_IMAGES = public_images([OPENING_SLIDE, CLOSING_SLIDE, *SLIDES.values()], rules)   # before the browser opens: a bad copy stops the take now
    log("slide images: redacted copies checked by OCR:", len(PUBLIC_IMAGES))
    profile = tempfile.mkdtemp(prefix="a2a-take-")
    # No "Save password?" bubble in the recording: switch the password manager off in this throw-away profile.
    (Path(profile) / "Default").mkdir(parents=True, exist_ok=True)
    (Path(profile) / "Default" / "Preferences").write_text(json.dumps({
        "credentials_enable_service": False, "credentials_enable_autosignin": False,
        "profile": {"password_manager_enabled": False}, "autofill": {"profile_enabled": False, "credit_card_enabled": False}}))
    from datetime import datetime, timezone
    result = {"ok": False, "started_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"), "stamps": {}}
    def stamp(name): result["stamps"][name] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    def grab_obs(page, name):
        """Read the lab's own run-observability record for the run that just ended (what each layer logged), straight from the app, and keep it in result.json.
        The end slide is built from these records, so it shows the very run that was recorded. A failed read is logged and recorded as such, never invented."""
        try:
            page.wait_for_timeout(1500)   # a log line is written the moment the lab decides; this only lets the stream settle
            rec = page.evaluate("fetch('/api/run-observability').then(r => r.json())")
        except Exception as e:
            rec = {"error": "capture_failed", "message": str(e)[:200]}
        result.setdefault("obs", {})[name] = rec
        r = rec.get("record") if isinstance(rec, dict) else None
        log("observability", name, "->", json.dumps({"coverage": r.get("coverage"), "summary": r.get("summary")}) if r else json.dumps(rec)[:200])
    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(
            profile, headless=HEADLESS, no_viewport=not HEADLESS, viewport={"width": WIN_W, "height": WIN_H} if HEADLESS else None,
            **({"device_scale_factor": _prof["dsf"]} if HEADLESS else {}),   # the laptop is a retina display: render at 2x, record at 2400 px wide
            color_scheme="light",
            **({"record_video_dir": str(WORK / "pw-video"), "record_video_size": {"width": _prof["video"][0], "height": _prof["video"][1]}} if RECORD_PW else {}),
            args=[f"--window-position={WIN_X},{WIN_Y}", f"--window-size={WIN_W},{WIN_H}", "--no-first-run", "--no-default-browser-check", *([] if HEADLESS else ["--kiosk"])])
        if MASK_SCRIPT: ctx.add_init_script(MASK_SCRIPT)   # first, so nothing real is ever drawn
        ctx.add_init_script("window.__cmScale = " + json.dumps(SCALE) + ";")
        ctx.add_init_script("window.__pillText = " + json.dumps("SAMPLE: simulated stand-in, not a live run" if SAMPLE else None) + ";")
        ctx.add_init_script(overlay_script())
        # The lab's observability drawer opens itself when a run ends and would reflow the page being filmed: keep it out of the picture. The take reads its record instead.
        ctx.add_init_script("document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '#run-obs-drawer{display:none!important}'; document.head.appendChild(s); });")
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(APP + "/"); page.wait_for_selector("#tab-aws")
        page.select_option("[data-testid=theme-select]", THEME)
        if not HEADLESS:
            subprocess.run(["osascript", "-e", 'tell application "System Events" to set frontmost of (first process whose name is "Google Chrome for Testing") to true'], capture_output=True)
        page.bring_to_front(); page.wait_for_timeout(1500 if HEADLESS else 4500)   # a full-screen window needs a moment to settle

        if HEADLESS:
            DEV = None
        elif os.environ.get("CAPTURE_DEVICE"):
            DEV = os.environ["CAPTURE_DEVICE"]; log("capture device: forced via CAPTURE_DEVICE=", DEV)
        else:
            # Cover body itself (the page paints an opaque background over the viewport) with the green marker.
            page.evaluate("""() => { document.body.style.setProperty('background', '#00FF00', 'important');
                document.body.style.setProperty('min-height', '100vh', 'important'); }""")
            page.wait_for_timeout(500)
            DEV = str(detect_capture_device(WORK))
            page.evaluate("() => { document.body.style.removeProperty('background'); document.body.style.removeProperty('min-height'); }")
            log("capture device: auto-detected", DEV, "for MONITOR=", MONITOR, "at", (WIN_X, WIN_Y))

        g = page.evaluate("() => ({screenX: window.screenX, screenY: window.screenY, outerW: window.outerWidth, outerH: window.outerHeight, innerW: window.innerWidth, innerH: window.innerHeight, dpr: window.devicePixelRatio})")
        dpr = g["dpr"] or 1   # ffmpeg crops PHYSICAL pixels; window geometry is logical, so scale by devicePixelRatio
        g["crop"] = {"w": round(g["innerW"] * dpr), "h": round(g["innerH"] * dpr),
                     "x": round((g["screenX"] - ORIGIN_X) * dpr), "y": round((g["screenY"] - ORIGIN_Y + (g["outerH"] - g["innerH"])) * dpr)}
        (WORK / "ready.json").write_text(json.dumps(g)); log("ready", g)
        page.evaluate("o => window.__cm.cap(o)", dict(n=0, total=TOTAL, title="Test frame", text="This is the recording area. Nothing is being recorded yet.", target="#tab-aws"))
        if WAIT_GO:
            log("waiting for go.flag")
            while not (WORK / "go.flag").exists():
                if (WORK / "abort.flag").exists():
                    log("aborted"); ctx.close(); return
                time.sleep(0.5)
        else:
            page.wait_for_timeout(2000)
        page.evaluate("() => window.__cm.clear()")
        c = g["crop"]
        ff = None if HEADLESS else subprocess.Popen(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "avfoundation", "-framerate", "30", "-capture_cursor", "1",
                               "-pixel_format", "uyvy422", "-i", f"{DEV}:none", "-vf", f"crop={c['w']}:{c['h']}:{c['x']}:{c['y']}" + (f",scale={OUT_W}:-2" if c["w"] > OUT_W else ""),
                               "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-an", "-t", "900", str(WORK / "take.mp4")],
                              stdin=subprocess.PIPE, stderr=open(WORK / "ffmpeg.log", "w"))
        log("rehearsal" if REHEARSE else "sample recording started (playwright)" if SAMPLE else "recording started"); time.sleep(0.2 if REHEARSE else 1.5)
        shots = os.environ.get("REHEARSE_SHOTS")
        count = {"n": 0}

        def snap(name):
            if REHEARSE and shots:
                page.wait_for_timeout(300); Path(shots).mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(Path(shots) / f"{name}.png"))

        def bubble(key, target=None, lines=None, secs=None, prefer=None, sample_key=None, place=None):
            """One numbered caption. The number is counted here, so a conditional scene never leaves a gap."""
            count["n"] += 1
            if not HEADLESS:
                # the window must still be where the recording crops: a display that sleeps or reconnects moves it, and the video then shows the desktop
                geo = page.evaluate("() => [window.screenX, window.screenY, window.innerWidth, window.innerHeight]")
                if geo != [g["screenX"], g["screenY"], g["innerW"], g["innerH"]]:
                    log("WARNING: the window moved or resized at caption %d (%s, expected %s): this recording is not usable" % (count["n"], geo, [g["screenX"], g["screenY"], g["innerW"], g["innerH"]]))
                    result["window_moved_at"] = count["n"]; result["ok"] = False   # another window (another session's browser, a permission dialog) must never end up in the recording: keep ours in front
                subprocess.run(["osascript", "-e", 'tell application "System Events" to set frontmost of (first process whose name is "Google Chrome for Testing") to true'], capture_output=True)
                page.bring_to_front()
            st = STEPS[sample_key] if (SAMPLE and sample_key) else STEPS[key]
            page.evaluate("o => window.__cm.cap(o)", dict(n=count["n"], total=TOTAL, title=st["title"], text=st["text"], target=target, lines=lines, prefer=prefer, place=place))
            snap(f"step-{count['n']:02d}-{key}")
            page.wait_for_timeout(int((secs if secs is not None else hold_bubble(page, st["text"], lines)) * 1000 * (0.04 if REHEARSE else 1)))

        def show_slide(cfg, extra=0.0, name="slide", cap=30.0):
            payload = slide_payload(cfg)
            page.evaluate("o => window.__cm.slide(o)", payload)
            snap(name)
            total_ms = int(_hold_slide(page, payload) * 1000 * (0.04 if REHEARSE else 1))   # the shared formula (owner rule 2026-11-22: no slide is held longer than 10 s)
            pre_ms = min(6000, int(total_ms * 0.45))
            page.wait_for_timeout(pre_ms)
            # Scroll a card taller than the viewport so the verdict line is not cut off in a silent recording.
            page.evaluate("() => window.__cm.scrollSlide()")   # the shared overlay scrolls a tall card to its verdict
            page.wait_for_timeout(max(0, total_ms - pre_ms))
            page.evaluate("() => window.__cm.clear()")

        def tag(selector, ident):
            """Give the first match an id so a caption can point at it (the overlay targets by selector)."""
            page.evaluate("i => document.querySelectorAll('#' + i).forEach((e) => e.removeAttribute('id'))", ident)
            loc = page.locator(selector)
            if loc.count(): loc.first.evaluate("(e, i) => { e.id = i; }", ident)
            else: log("tag: nothing matches", selector)

        def frame_sel(root, title):
            return f"{root} .reel__frame:has(.reel__title:text-is('{title}'))"

        def popout(frame, section=None, key=None, lines=None, sample_key=None, prefer="right", scroll_after=None):
            """Open a reel frame, point a caption at one section of its pop-out, close it again with Esc."""
            if not page.locator(frame).count():
                log("pop-out skipped, no such frame:", frame); return
            page.locator(frame).first.scroll_into_view_if_needed(); page.locator(frame).first.click()
            page.wait_for_selector(".reel-dialog"); page.wait_for_timeout(500)
            target = ".reel-dialog"
            if section:
                found = page.evaluate("t => { const s = [...document.querySelectorAll('.reel-sec')].find((x) => x.querySelector('h4').textContent === t); if (!s) return false; s.id = 'cm-sec'; return true; }", section)
                if found: target = "#cm-sec"
                else: log("pop-out section not found:", section)
            if scroll_after:   # a long table: scroll the pop-out while the caption is up so the rest is seen
                page.evaluate("ms => setTimeout(() => { const b = document.querySelector('.reel-dialog__body'); if (b) b.scrollTo({top: b.scrollHeight, behavior: 'smooth'}); }, ms)", int(scroll_after * 1000 * (0.04 if REHEARSE else 1)))
            if key: bubble(key, target, lines=lines, prefer=prefer, sample_key=sample_key)
            page.keyboard.press("Escape"); page.wait_for_timeout(400)
            page.evaluate("() => window.__cm.clear()")

        def type_prompt(input_sel, text):
            page.click(input_sel); page.type(input_sel, text, delay=30 if not REHEARSE else 0); page.wait_for_timeout(300 if not REHEARSE else 0)

        def states(prefix="aws-s-"):
            return page.evaluate("p => ['custodian','main','gateway','aws'].map(i => i + ': ' + document.getElementById(p + i).textContent)", prefix)

        try:
            if SEGMENT == "end":
                page.goto(APP + "/"); page.wait_for_selector("#tab-aws")
                page.select_option("[data-testid=theme-select]", THEME); page.select_option("[data-testid=font-select]", FONT)
                page.wait_for_timeout(1500)
                show_slide(SLIDES["protect"], extra=2.0, name="slide-protect", cap=54.0)   # "what else could it stop?"
                show_slide(observability_slide(), extra=2.0, name="slide-observability", cap=40.0)   # what the run left behind, right before the closing
                closing = dict(CLOSING_SLIDE)
                if SAMPLE:
                    closing["lead"] = STEPS["sample_closing_lead"]["text"]
                    closing["col_a_lines"] = [STEPS["sample_closing_bullet"]["text"], *CLOSING_SLIDE["col_a_lines"][1:]]
                show_slide(closing, extra=3.0, name="closing", cap=48.0)
                result["ok"] = True
            else:
                if SAMPLE:
                    show_slide(SLIDES["sample_note"], extra=2.0, name="sample_note", cap=22.0)
                show_slide(OPENING_SLIDE, extra=4.0, name="opening", cap=36.0)

                # ===================== Part 1: our two agents (A2A with remote agents tab) =====================
                if SAMPLE:
                    # The mock lab has no model, so the sample replays two recorded live runs of the chat route (kept in assets/, local only:
                    # they carry internal hostnames). The tabs, the reel and the trace are still drawn by the lab from those events.
                    fixtures = {"bob": (Path(__file__).parent / "assets" / "sample-part1-bob.sse").read_text(),
                                "blocked": (Path(__file__).parent / "assets" / "sample-part1-blocked.sse").read_text()}
                    def replay(route):
                        body = json.loads(route.request.post_data or "{}")
                        route.fulfill(status=200, headers={"Content-Type": "text/event-stream"}, body=fixtures["blocked" if "prod-db" in body.get("message", "") else "bob"])
                    page.route("**/chat", replay)
                page.goto(APP + "/"); page.wait_for_selector("#tab-aws")
                page.select_option("[data-testid=theme-select]", THEME); page.select_option("[data-testid=font-select]", FONT)
                app_mode = page.evaluate("fetch('/api/info').then(r => r.json()).then(j => j.source)")   # the lab's Mock/Real switch
                status = page.evaluate("fetch('/status').then(r => r.json())")
                log("app mode (Mock/Real switch):", app_mode, "| status:", json.dumps({k: status.get(k) for k in ("mode", "viaGateway", "bearerOnA2A")}))
                if not SAMPLE and app_mode != "real":
                    raise RuntimeError(f"the take needs Real mode (switch says {app_mode!r}); refusing to record a mock")
                page.wait_for_timeout(1200)
                bubble("p1_intro", "#chat", prefer="right")
                type_prompt("#input", P1_Q1)
                bubble("p1_prompt", "#input", lines=["asks: " + P1_Q1], prefer="above", secs=4.5)
                page.evaluate("() => window.__cm.clear()")
                stamp("part1_question_1"); page.click("#send")
                page.wait_for_selector("#reel-review .reel__frame", timeout=90000); page.wait_for_selector("#who .who-hop", timeout=90000)
                page.wait_for_function("!document.getElementById('send').disabled", timeout=120000); page.wait_for_timeout(800)
                titles1 = page.eval_on_selector_all("#reel-review .reel__title", "els => els.map(e => e.textContent)")
                answer1 = (page.inner_text("#messages .message.agent >> nth=-1") if page.locator("#messages .message.agent").count() else "").strip()
                log("part 1 / prompt 1 frames:", titles1, "| answer:", answer1[:160])
                ok1 = "Send the message" in titles1 and "Tool result" in titles1 and bool(answer1) and "Request failed" not in answer1
                result.update(part1_frames=titles1, part1_answer=answer1[:300])
                grab_obs(page, "part1_allowed")
                bubble("p1_handoff", "#who", place="bl")
                popout(frame_sel("#reel-review", "Send the message"), "The call", "p1_message")
                if "Call the tool" in titles1:
                    page.locator(frame_sel("#reel-review", "Call the tool")).first.scroll_into_view_if_needed()
                    tag(frame_sel("#reel-review", "Call the tool"), "cm-mcp-frame")
                    bubble("p1_mcp", "#cm-mcp-frame", prefer="below")
                redacted = page.evaluate("() => document.getElementById('trace').textContent.includes('REDACTED')")
                popout(frame_sel("#reel-review", "Tool result"), "What came back", "p1_redacted", lines=["the email came back as [REDACTED:pii]"] if redacted else None)
                log("part 1: redaction marker in trace:", redacted)
                tag("#messages .message.agent >> nth=-1", "cm-answer1")
                bubble("p1_answer", "#cm-answer1", prefer="right", lines=[first_sentence(answer1)])
                page.evaluate("() => window.__cm.clear()")
                # the refused question
                type_prompt("#input", P1_Q2)
                bubble("p1_refuse_prompt", "#input", lines=["asks: " + P1_Q2], prefer="above", secs=4.5)
                page.evaluate("() => window.__cm.clear()")
                stamp("part1_question_2"); page.click("#send")
                page.wait_for_function("document.querySelectorAll('#trace .trace.error').length > 0 || !document.getElementById('send').disabled", timeout=120000)
                page.wait_for_function("!document.getElementById('send').disabled", timeout=120000); page.wait_for_timeout(800)
                titles2 = page.eval_on_selector_all("#reel-review .reel__title", "els => els.map(e => e.textContent)")
                blocked = page.evaluate("() => /content_blocked|blocked by security policy/i.test(document.getElementById('trace').textContent)")
                log("part 1 / prompt 2 frames:", titles2, "| blocked marker in trace:", blocked)
                result.update(part1_blocked=blocked, part1_frames_2=titles2, part1_redacted=redacted)
                grab_obs(page, "part1_blocked")
                ok1 = ok1 and (blocked or SAMPLE)
                tag("#trace .trace.error >> nth=-1", "cm-blocked") if page.locator("#trace .trace.error").count() else tag("#reel-review .reel__frame >> nth=-1", "cm-blocked")
                bubble("p1_blocked", "#cm-blocked", prefer="left")
                page.evaluate("() => window.__cm.clear()")
                if not ok1:
                    log("WARNING: part 1 did not show the expected run (frames=%s redacted=%s blocked=%s); fix and retake" % (titles1, redacted, blocked))

                # ===================== Part 2: an agent in AWS (Custodian to AWS agent tab) =====================
                show_slide(SLIDES["part2"], extra=2.0, name="slide-part2", cap=30.0)
                page.click("#tab-aws"); page.wait_for_selector("#panel-aws:not([hidden])")
                page.wait_for_function("document.getElementById('aws-mode').textContent.length > 20", timeout=15000); page.wait_for_timeout(1200)
                mode = page.inner_text("#aws-mode").strip(); live = mode.startswith("LIVE")
                if not SAMPLE and not live:
                    raise RuntimeError(f"the take needs the LIVE route (route says {mode[:40]!r}); refusing to record a mock")
                log("route mode line:", mode)
                bubble("intro", "#panel-aws h2", prefer="below")
                bubble("custodian", "#aws-n-custodian", prefer="below")
                bubble("main_agent", "#aws-n-main", prefer="below")
                bubble("gateway", "#aws-n-gateway", prefer="below")
                bubble("aws_agent", "#aws-n-aws", prefer="below")
                if SAMPLE:   # the live takes say "this is a real run" once, on the opening slide; only the sample needs to say it is simulated
                    bubble("live_banner", "#aws-mode", prefer="below", lines=[first_sentence(mode)], sample_key="sample_live_banner")
                page.evaluate("() => window.__cm.clear()")
                show_slide(SLIDES["config_app"], extra=2.0, name="slide-config-app", cap=34.0)
                show_slide(SLIDES["config_agent"], extra=2.0, name="slide-config-agent", cap=40.0)
                show_slide(SLIDES["config_policy"], extra=2.0, name="slide-config-policy", cap=40.0)
                show_slide(SLIDES["spec"], extra=2.0, name="slide-spec", cap=50.0)
                show_slide(SLIDES["rfcs"], extra=2.0, name="slide-rfcs", cap=50.0)

                # ---- success 1: what tools do you have
                page.locator("#aws-input").scroll_into_view_if_needed()
                type_prompt("#aws-input", P2_Q1)
                bubble("pick_prompt", "#aws-input", prefer="below", lines=["asks: add 987654321 and 123456789"], secs=5.0)
                page.evaluate("() => window.__cm.clear()")
                page.keyboard.press("Enter")
                if not SAMPLE:
                    page.wait_for_selector(frame_sel("#aws-reel", "Get a token"), timeout=60000); page.wait_for_timeout(500)
                    tag(frame_sel("#aws-reel", "Get a token"), "cm-token-frame")
                    bubble("token_frame", "#cm-token-frame", prefer="below")
                    popout(frame_sel("#aws-reel", "Get a token"), "The token", "token_popout", scroll_after=6.0)
                page.wait_for_selector(frame_sel("#aws-reel", "Read the Agent Card"), timeout=60000); page.wait_for_timeout(500)
                tag(frame_sel("#aws-reel", "Read the Agent Card"), "cm-card-frame")
                bubble("card_frame", "#cm-card-frame", prefer="below")
                page.wait_for_selector(frame_sel("#aws-reel", "Send the message"), timeout=60000)
                popout(frame_sel("#aws-reel", "Send the message"), "The call", "message_popout")
                page.wait_for_function("!document.getElementById('aws-send').disabled", timeout=90000); page.wait_for_timeout(800)
                st1 = states(); answer = page.inner_text("#aws-answer").strip()
                has_result = page.locator("#aws-trace li[data-kind=result]").count() > 0
                err = "is-error" in (page.get_attribute("#aws-answer", "class") or "")
                log("flow states:", st1); log("answer 1:", answer[:200]); log("result step present:", has_result, "answer is error:", err)
                ok = (live or SAMPLE) and has_result and bool(answer) and not err and (SAMPLE or P2_SUM in answer.replace(',', ''))
                result.update(sum1_correct=P2_SUM in answer.replace(',', ''))
                result.update(ok=ok, live=live, states=st1, answer=answer[:300])
                grab_obs(page, "part2_allowed")
                if ok:
                    page.evaluate("() => document.getElementById('aws-reel').scrollIntoView({block: 'center'})")
                    bubble("result", "#aws-trace li[data-kind=result]", prefer="left", lines=[page.locator("#aws-trace li[data-kind=result] .aws__at").first.inner_text().strip() and ("answered in " + page.locator("#aws-trace li[data-kind=result] .aws__at").first.inner_text().strip())])
                    page.evaluate("() => window.__cm.clear()")
                    bubble("answer", "#aws-answer", prefer="below", lines=[" · ".join(st1)])
                else:
                    log("WARNING: this take does NOT show a live success (live=%s result=%s error=%s); fix the route and retake" % (live, has_result, err))
                page.evaluate("() => window.__cm.clear()")

                # ---- success 2: the tool question
                if ok:
                    page.locator("#aws-input").scroll_into_view_if_needed()
                    type_prompt("#aws-input", P2_Q2)
                    bubble("second_prompt", "#aws-input", prefer="below", lines=["asks: add 48,213 and 9,787; even or odd?"], secs=5.0)
                    page.evaluate("() => window.__cm.clear()")
                    page.keyboard.press("Enter")
                    page.wait_for_function("document.getElementById('aws-send').disabled === true", timeout=10000)
                    page.wait_for_function("!document.getElementById('aws-send').disabled", timeout=120000); page.wait_for_timeout(800)
                    answer2 = page.inner_text("#aws-answer").strip()
                    err2 = "is-error" in (page.get_attribute("#aws-answer", "class") or "")
                    right = P2_SUM2 in answer2.replace(",", "") and "even" in answer2.lower()
                    log("answer 2:", answer2[:240], "| error:", err2, "| sum correct:", right)
                    result.update(answer2=answer2[:300], sum_correct=right)
                    if SAMPLE or (right and not err2):
                        bubble("second_answer", "#aws-answer", prefer="below", lines=[first_sentence(answer2)])
                    else:
                        ok = False; log("WARNING: the second answer was missing or wrong; fix and retake")
                    page.evaluate("() => window.__cm.clear()")

                # ---- the refusal: the same question with a deliberately invalid credential; the lab's own button sends it
                refusal_ok = False
                if ok:
                    page.evaluate("() => document.getElementById('aws-refuse').scrollIntoView({block: 'center'})")
                    bubble("refuse_intro", "#aws-refuse", prefer="below")
                    page.evaluate("() => window.__cm.clear()")
                    stamp("part2_refused_call"); page.click("#aws-refuse")
                    page.wait_for_selector("#aws-trace li[data-kind=error]", timeout=90000)
                    page.wait_for_function("!document.getElementById('aws-send').disabled", timeout=90000); page.wait_for_timeout(1200)
                    ref_states = states(); ref_answer = page.inner_text("#aws-answer").strip()
                    ref_text = page.text_content("#aws-trace li[data-kind=error]") or ""
                    m = re.search(r"WWW-Authenticate:\s*([^\n]+)", ref_text)
                    challenge = m.group(1) if m else ""
                    params = re.findall(r"([A-Za-z_]+)=", challenge)
                    log("refusal states:", ref_states, "| answer:", ref_answer[:80], "| challenge params:", params)
                    gw_state = page.inner_text("#aws-s-gateway").strip(); aws_state = page.inner_text("#aws-s-aws").strip()
                    refusal_ok = ref_answer.startswith("HTTP 401") and ((gw_state.startswith("refused") and aws_state == "not reached") if not SAMPLE else aws_state.startswith("stopped"))
                    result.update(refusal_ok=refusal_ok, refusal_states=ref_states, challenge_params=params)
                    grab_obs(page, "part2_refused")
                    if refusal_ok:
                        page.evaluate("() => document.querySelector('ol.aws__flow').scrollIntoView({block: 'start'})")
                        bubble("refused_states", "ol.aws__flow", prefer="below", lines=[" · ".join(ref_states)], sample_key="sample_refused_states")
                        page.evaluate("() => window.__cm.clear()")
                        page.evaluate("() => document.getElementById('aws-reel').scrollIntoView({block: 'center'})")
                        popout(frame_sel("#aws-reel", "Refused"), "The challenge", "refused_popout")
                        if page.locator(frame_sel("#aws-reel", "Read the sign-in metadata")).count() and not SAMPLE and "resource_metadata" in params:
                            tag(frame_sel("#aws-reel", "Read the sign-in metadata"), "cm-meta-frame")
                            bubble("refused_metadata", "#cm-meta-frame", prefer="below")
                    else:
                        log("WARNING: the refusal did not look like a gateway 401 (states=%s answer=%s); fix and retake" % (ref_states, ref_answer[:80]))
                ok = ok and refusal_ok and ok1
                ok = ok and "window_moved_at" not in result
                result["ok"] = ok
                result["bubbles"] = count["n"]; result["bubbles_expected"] = TOTAL
                if count["n"] != TOTAL: log("NOTE: %d caption bubbles were shown but the counter says %d; set TOTAL to match" % (count["n"], TOTAL))
                page.evaluate("() => window.__cm.clear()")
                result["finished_utc"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
                if ok and SEGMENT == "all":
                    show_slide(SLIDES["protect"], extra=2.0, name="slide-protect", cap=54.0)   # "what else could it stop?"
                    show_slide(observability_slide(), extra=2.0, name="slide-observability", cap=40.0)   # what the run left behind, right before the closing
                    closing = dict(CLOSING_SLIDE)
                    if SAMPLE:   # the sample never claims a live run
                        closing["lead"] = STEPS["sample_closing_lead"]["text"]
                        closing["col_a_lines"] = [STEPS["sample_closing_bullet"]["text"], *CLOSING_SLIDE["col_a_lines"][1:]]
                    show_slide(closing, extra=3.0, name="closing", cap=48.0)
        finally:
            if MASK_SCRIPT:   # a public video: no real value may have been on the page at ANY point of this take (every segment), shown or hidden
                try: leaks = page.evaluate("() => window.__onscreenMaskLeaks ? window.__onscreenMaskLeaks() : -1")
                except Exception: leaks = -1
                result["mask_leaks"] = leaks; log("on-screen mask check: leaks =", leaks)
                if leaks != 0: result["ok"] = False; log("WARNING: real values reached the page (or the mask did not load): do not publish this take")
            log("stopping recording")
            if ff is not None:
                try: ff.send_signal(signal.SIGINT)
                except Exception: pass
                try: ff.wait(timeout=180)   # let the encoder flush and write the mp4 index; killing it early loses the whole recording
                except Exception: ff.kill()
            (WORK / "result.json").write_text(json.dumps(result, indent=1))
            (WORK / "done.flag").write_text("done")
        vpath = page.video.path() if RECORD_PW and page.video else None
        ctx.close()
        if vpath:
            out = WORK / ("sample.mp4" if SAMPLE else "take-headless.mp4")
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(vpath), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", str(out)], check=True)
            log("sample video:", out)

if __name__ == "__main__":
    main()
