#!/usr/bin/env python3
"""Tests for the video's bridge to the shared Story code. Run: python3 video/test_story_bridge.py   (needs node; no browser, no Playwright)
The golden numbers are what take.py's own formulas gave before it moved to the shared hold.js (max(5.0, words*0.30+2.2) and min(10.0, max(6.0, words*0.25+3.0)))."""
import json, shutil, subprocess, sys, tempfile, threading, unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import captions, story_bridge

HAVE_NODE = shutil.which("node") is not None
W = lambda n: " ".join(f"w{i}" for i in range(n))

def node(code):
    r = subprocess.run(["node", "-e", code], capture_output=True, text=True, timeout=30)
    if r.returncode: raise AssertionError(r.stderr)
    return r.stdout.strip()

class Classic(unittest.TestCase):
    def test_the_vendored_modules_become_plain_scripts(self):
        for name in ("hold.js", "overlay.js"):
            out = story_bridge.classic(name)
            self.assertNotRegex(out, r"(?m)^\s*(export|import)\b")
            self.assertIn("function", out)

    def test_a_module_with_an_import_is_refused_not_silently_broken(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "x.js").write_text("import { a } from './a.js';\nexport const b = 1;\n")
            old = story_bridge.STORY_DIR; story_bridge.STORY_DIR = Path(d)
            try: self.assertRaises(ValueError, story_bridge.classic, "x.js")
            finally: story_bridge.STORY_DIR = old

    @unittest.skipUnless(HAVE_NODE, "node not available")
    def test_the_overlay_script_is_valid_javascript_that_defines_the_pieces_take_py_uses(self):
        script = story_bridge.overlay_script()
        self.assertIn("window.__cm", script); self.assertIn("window.__storyHold", script)
        out = node("const vm = require('vm'); new vm.Script(" + json.dumps(script) + "); console.log('ok')")
        self.assertEqual(out, "ok")

class Holds(unittest.TestCase):
    @unittest.skipUnless(HAVE_NODE, "node not available")
    def test_normal_speed_equals_the_numbers_take_py_always_produced(self):
        hold = story_bridge.classic("hold.js")
        code = hold + """
        const w = (n) => Array.from({ length: n }, (_, i) => 'w' + i).join(' ');
        const slide = (n) => ({ lead: w(n), colA: { lines: [] }, colB: { lines: [] }, verdict: 'v' });
        console.log(JSON.stringify({
          bubble: [1, 9, 10, 20, 60].map((n) => bubbleHold(w(n), [])),
          quirk: [bubbleHold(w(10), ['asks: a b c']), bubbleHold(w(20), ['one two', 'three'])],
          slide: [1, 12, 20, 40, 80].map((n) => slideHold(slide(n))),
        }));"""
        got = json.loads(node(code))
        self.assertEqual(got["bubble"], [5.0, 5.0, 5.2, 8.2, 20.2])
        self.assertEqual(got["quirk"], [6.1, 8.8])
        self.assertEqual(got["slide"], [6.0, 6.25, 8.25, 10.0, 10.0])

class Payload(unittest.TestCase):
    CFG = {"image": None, "wide": False, "title": "T", "lead": "L", "col_a_heading": "A", "col_a_lines": ["a1"], "col_b_heading": "B", "col_b_lines": ["b1", "b2"], "verdict": "V"}

    def test_a_captions_slide_in_the_shared_overlays_shape(self):
        p = story_bridge.slide_payload(self.CFG, "/nonexistent")
        self.assertEqual(p, {"image": None, "title": "T", "lead": "L", "verdict": "V", "wide": False, "colA": {"heading": "A", "lines": ["a1"]}, "colB": {"heading": "B", "lines": ["b1", "b2"]}})

    def test_an_image_comes_from_the_local_assets_folder_as_a_data_uri(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "shot.jpg").write_bytes(b"\xff\xd8\xff")
            p = story_bridge.slide_payload({**self.CFG, "image": "shot.jpg", "wide": True}, d)
        self.assertTrue(p["image"].startswith("data:image/jpeg;base64,")); self.assertTrue(p["wide"])

class Wording(unittest.TestCase):
    STORY = {
        "opening": {"title": "O", "lead": "l", "verdict": "v", "colA": {"heading": "a", "lines": ["x"]}, "colB": {"heading": "b", "lines": ["y"]}, "image": None, "wide": False},
        "closing": {"title": "C", "lead": "l", "verdict": "v", "colA": {"heading": "a", "lines": ["x"]}, "colB": {"heading": "b", "lines": ["y"]}, "image": None, "wide": False},
        "slides": {"part2": {"title": "P", "lead": "l", "verdict": "v", "colA": {"heading": "a", "lines": ["x", "z"]}, "colB": {"heading": "b", "lines": ["y"]}, "image": "console.jpg", "wide": True}},
        "steps": {"p1_intro": {"title": "Ask", "text": "Type."}},
    }

    def test_the_story_document_becomes_the_flat_shapes_take_py_uses(self):
        o, c, steps, slides = captions.from_story(self.STORY)
        self.assertEqual(o["col_a_lines"], ["x"]); self.assertEqual(c["title"], "C")
        self.assertEqual(slides["part2"]["image"], "console.jpg"); self.assertTrue(slides["part2"]["wide"]); self.assertEqual(slides["part2"]["col_a_lines"], ["x", "z"])
        self.assertEqual(steps, {"p1_intro": {"title": "Ask", "text": "Type."}})

    def test_a_document_missing_a_part_is_an_error(self):
        self.assertRaises(ValueError, captions.from_story, {"opening": {}})

    def test_load_reads_the_running_labs_api_story_and_an_error_document_is_an_error(self):
        body = {"doc": json.dumps(self.STORY)}
        class H(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body["doc"].encode())
            def log_message(self, *a): pass
        srv = HTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            url = f"http://127.0.0.1:{srv.server_address[1]}/"
            self.assertEqual(captions.load(url)[1]["title"], "C")
            body["doc"] = json.dumps({"error": "Story wording could not be read: x"})
            self.assertRaises(ValueError, captions.load, url)
        finally: srv.shutdown()

class TakePyHasNoCopyOfSharedLogic(unittest.TestCase):
    def test_take_py_uses_the_bridge_and_defines_no_overlay_or_hold_formula_of_its_own(self):
        src = (Path(__file__).resolve().parent / "take.py").read_text()
        self.assertIn("from story_bridge import", src); self.assertIn("captions.load(APP)", src)
        for gone in ('OVERLAY = r"""', "def hold(", "def hold_slide(", "* 0.30 + 2.2", "* 0.25 + 3.0", ".cm-slide .card"):
            self.assertNotIn(gone, src, f"take.py must not carry its own copy of shared logic ({gone!r})")

if __name__ == "__main__":
    unittest.main(verbosity=2)
