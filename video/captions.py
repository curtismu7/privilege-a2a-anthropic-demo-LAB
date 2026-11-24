"""Loads the video's wording from the lab's GET /api/story into the shapes take.py uses: OPENING_SLIDE, CLOSING_SLIDE, SLIDES (a dict of slide key -> slide with
title/lead/col_a_heading/col_a_lines/col_b_heading/col_b_lines/verdict and optionally image and wide) and STEPS (a dict of step key -> {title, text}).

There is ONE parser of captions.md: the shared Story parser in the lab's server (server/src/story/captions.js, vendored from AI-DEMO-Standalone/shared/story). The live Story
and this video both read what it serves, so they cannot disagree about the wording. Edit captions.md (the format is described at its top), not this file. The lab must be
running (take.py runs against it anyway).
"""
import json, urllib.request

def _flat(slide):
    return {
        "image": slide.get("image"), "wide": bool(slide.get("wide")), "title": slide["title"], "lead": slide["lead"],
        "col_a_heading": slide["colA"]["heading"], "col_a_lines": list(slide["colA"]["lines"]),
        "col_b_heading": slide["colB"]["heading"], "col_b_lines": list(slide["colB"]["lines"]),
        "verdict": slide["verdict"],
    }

def from_story(story):
    """The /api/story document -> (opening, closing, steps, slides)."""
    for k in ("opening", "closing", "slides", "steps"):
        if k not in story:
            raise ValueError(f"/api/story: the wording has no '{k}'")
    return (_flat(story["opening"]), _flat(story["closing"]), {k: {"title": v["title"], "text": v["text"]} for k, v in story["steps"].items()},
            {k: _flat(v) for k, v in story["slides"].items()})

def load(app_url, timeout=15):
    """Fetch and convert the wording from the running lab."""
    with urllib.request.urlopen(app_url.rstrip("/") + "/api/story", timeout=timeout) as r:
        story = json.loads(r.read().decode())
    if "error" in story:
        raise ValueError(story["error"])
    return from_story(story)
