#!/usr/bin/env python3
"""Tests for the public-video masking. Run: python3 video/test_onscreen_mask.py  (the browser checks run where Playwright and Chromium are installed)."""
import sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import onscreen_mask as om

ENV = """# test values only
ANTHROPIC_BASE_URL=https://gw-lb.corp-example.net/llm/anthropic
WORKER_A2A_URL=https://gw-lb.corp-example.net/worker/a2a
AWS_AGENT_A2A_URL=https://gw-node2.corp-example.net/aws-agent-worker
AWS_AGENT_PF_TOKEN_URL=https://someone-pf.corp-example.net/as/token.oauth2
AWS_AGENT_PF_CLIENT_ID=demo-client-pass
SHELF_URL=http://localhost:8443/shelf
MCP_URL=http://127.0.0.1:6883/mcp
"""
PAGE_TEXT = ("POST https://gw-lb.corp-example.net/worker/a2a/jsonrpc | iss https://someone-pf.corp-example.net | aud https://gw-node2.corp-example.net/aws-agent-worker "
             "| client_id demo-client-pass | https://gw-node3.corp-example.net/x | /runtimes/Real_Runtime-abc123/invocations | http://localhost:8443 ok")

def masked(text, pairs):
    import re
    for p, r in pairs: text = re.sub(p, r, text, flags=re.I)
    return text

class Pairs(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.TemporaryDirectory(); self.env = Path(self.d.name) / ".env"; self.env.write_text(ENV); self.pairs = om.mask_pairs(self.env)
    def tearDown(self): self.d.cleanup()

    def test_every_real_value_is_hidden_and_local_addresses_are_left_alone(self):
        out = masked(PAGE_TEXT, self.pairs)
        for real in ("corp-example.net", "someone-pf", "gw-lb", "gw-node2", "gw-node3", "demo-client-pass", "Real_Runtime-abc123"):
            self.assertNotIn(real, out, real)
        for want in ("https://gateway.example/worker/a2a/jsonrpc", "https://pingfederate.example", "https://gateway.example/aws-agent-worker",
                     "client_id aws-agent-client", "https://host.example/x", "/runtimes/my-agent-runtime/invocations", "http://localhost:8443"):
            self.assertIn(want, out, want)

    def test_no_env_file_means_no_masks_and_the_take_must_refuse(self):
        self.assertRaises(FileNotFoundError, om.mask_pairs, Path(self.d.name) / "missing.env")

try:
    import playwright.sync_api as pw
    HAVE = True
except ImportError:
    HAVE = False

@unittest.skipUnless(HAVE, "playwright not installed")
class InABrowser(unittest.TestCase):
    def test_the_page_never_shows_a_real_value_even_text_added_later(self):
        with tempfile.TemporaryDirectory() as d:
            env = Path(d) / ".env"; env.write_text(ENV); script = om.mask_script(om.mask_pairs(env))
        p = pw.sync_playwright().start(); self.addCleanup(p.stop)
        try: b = p.chromium.launch(headless=True)
        except Exception as e: self.skipTest(f"no Chromium ({str(e)[:60]})")
        self.addCleanup(b.close)
        page = b.new_page(); page.add_init_script(script)
        page.goto("data:text/html,<p id=a>" + PAGE_TEXT.replace(" ", "%20").replace("#", "%23") + "</p><div id=b></div>")
        page.evaluate("t => { const pre = document.createElement('pre'); pre.textContent = t; document.getElementById('b').append(pre); }", PAGE_TEXT)   # added after load, like a run's trace
        page.wait_for_timeout(100)
        body = page.inner_text("body")
        for real in ("corp-example.net", "demo-client-pass", "Real_Runtime-abc123"): self.assertNotIn(real, body)
        self.assertIn("gateway.example", body); self.assertIn("/runtimes/my-agent-runtime/", body)
        self.assertEqual(page.evaluate("() => window.__onscreenMaskLeaks()"), 0)                     # the take's safety net agrees
        page.evaluate("() => { const s = document.createElement('span'); s.hidden = true; document.body.append(s); }")
        page.evaluate("() => { const t = document.createTextNode('x'); document.body.append(t); t.nodeValue = 'leak gw-lb.corp-example.net'; }")   # a change to an existing text node is masked too
        page.wait_for_timeout(50); self.assertEqual(page.evaluate("() => window.__onscreenMaskLeaks()"), 0)

if __name__ == "__main__":
    unittest.main(verbosity=1)
