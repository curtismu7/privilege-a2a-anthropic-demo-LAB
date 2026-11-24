#!/usr/bin/env python3
"""Tests for the public-video masking. Run: python3 video/test_onscreen_mask.py  (the browser checks run where Playwright and Chromium are installed).
Every host here is under the reserved .invalid name (the lab's rule), so the rules are built with allow_reserved=True."""
import re, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import onscreen_mask as om

ENV = """# test values only
ANTHROPIC_BASE_URL=https://gw-lb.corp.invalid/llm/anthropic
WORKER_A2A_URL="https://gw-lb.corp.invalid/worker/a2a"  # quoted, then a comment
export AWS_AGENT_A2A_URL=https://gw-node2.corp.invalid/aws-agent-worker
AWS_AGENT_PF_TOKEN_URL=`https://someone-pf.corp.invalid/as/token.oauth2`
AWS_AGENT_PF_CLIENT_ID="demo-client-pass" # the PF client
AWS_AGENT_CUSTODIAN=Owner Person
LAB_ALLOWED_HOSTS=box1.priv.invalid,box2.priv.invalid
ALLOWED_ORIGINS=https://a.corp.invalid,https://b.other.invalid
WORKER_TRACE_URL=${BASE}https://gw-node4.corp.invalid/trace
SHELF_URL=http://localhost:8443/shelf
EMPTY_VALUE=
QUOTED_EMPTY=""
MCP_URL=http://192.168.1.10:6883/mcp
"""
PAGE = ("POST https://gw-lb.corp.invalid/worker/a2a/jsonrpc | iss https://someone-pf.corp.invalid | aud https://gw-node2.corp.invalid/aws-agent-worker "
        "| client_id demo-client-pass | https://gw-node3.corp.invalid/x | /runtimes/Real_Runtime-abc123/invocations | http://localhost:8443 ok "
        "| sibling cmuir-gw-lb.corp.invalid | bare https://corp.invalid/ | mail owner.name@corp.invalid | custodian Owner Person "
        "| Host box1.priv.invalid not allowed | origin https://b.other.invalid | trace https://gw-node4.corp.invalid/trace "
        "| arn:aws:bedrock-agentcore:us-east-1:xxxxxxxxxxxx:runtime/Real_Runtime-abc123 | esc https:\\/\\/x\\/runtimes\\/Real_Runtime-abc123\\/inv "
        "| enc resource=https%3A%2F%2Fgw-lb.corp.invalid%2Fruntimes%2Farn%253Aaws%253Aruntime%252FReal_Runtime-abc123%2Finv "
        "| hint=owner.name%40corp.invalid | version 2.1.10 | ip 192.168.1.10")
REAL = ("corp.invalid", "priv.invalid", "other.invalid", "someone-pf", "gw-lb", "gw-node", "cmuir", "owner.name", "Owner Person", "demo-client-pass",
        "Real_Runtime-abc123", "box1")

def build(text, allow=True):
    d = tempfile.TemporaryDirectory(); env = Path(d.name) / ".env"; env.write_text(text)
    try: return om.mask_rules(env, allow_reserved=allow)
    finally: d.cleanup()

def apply(text, rules):
    for p, r in rules["pairs"]: text = re.sub(p, r, text, flags=re.I)
    return text

def leaks(text, rules): return sum(len(re.findall(p, text, flags=re.I)) for p in rules["detect"])

class Rules(unittest.TestCase):
    def setUp(self): self.rules = build(ENV)

    def test_every_real_value_is_hidden_in_every_form_and_harmless_text_is_untouched(self):
        out = apply(PAGE, self.rules)
        for real in REAL: self.assertNotIn(real, out, real)
        for want in ("https://gateway.example/worker/a2a/jsonrpc", "iss https://pingfederate.example", "client_id aws-agent-client", "custodian the custodian",
                     "/runtimes/my-agent-runtime/invocations", "http://localhost:8443", "sibling host.example", "bare https://host.example/",
                     "someone@example.com", ":runtime/my-agent-runtime", "\\/runtimes\\/my-agent-runtime\\/", "version 2.1.10", "ip 192.168.1.10"):
            self.assertIn(want, out, want)
        self.assertEqual(leaks(out, self.rules), 0)
        self.assertEqual(apply(out, self.rules), out, 'masking twice changes nothing (the observer may see a node again)')

    def test_the_env_is_read_like_dotenv(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / ".env"; p.write_text(ENV); env = om._env(p)
        self.assertEqual(env["WORKER_A2A_URL"], "https://gw-lb.corp.invalid/worker/a2a")
        self.assertEqual(env["AWS_AGENT_PF_CLIENT_ID"], "demo-client-pass")
        self.assertEqual(env["AWS_AGENT_PF_TOKEN_URL"], "https://someone-pf.corp.invalid/as/token.oauth2")
        self.assertEqual(env["AWS_AGENT_A2A_URL"], "https://gw-node2.corp.invalid/aws-agent-worker")
        self.assertEqual(env["EMPTY_VALUE"], ""); self.assertEqual(env["QUOTED_EMPTY"], "")   # regression: an empty value crashed the reader

    def test_detectors_are_bounded_like_the_masks_so_a_good_take_is_not_blocked(self):
        r = build("WORKER_A2A_URL=https://gw.acme.invalid/a\nAWS_AGENT_PF_CLIENT_ID=aws-agent\n")
        out = apply("client_id aws-agent | path /aws-agent-worker | docs https://myacme.invalid/docs", r)
        self.assertIn("client_id aws-agent-client", out); self.assertIn("/aws-agent-worker", out); self.assertIn("myacme.invalid", out)
        self.assertEqual(leaks(out, r), 0)

    def test_an_object_name_custodian_is_kept_a_person_is_masked(self):
        self.assertIn("aws-agent-caller-identity", apply("aws-agent-caller-identity", build("WORKER_A2A_URL=https://gw.c.invalid/a\nAWS_AGENT_CUSTODIAN=aws-agent-caller-identity\n")))
        self.assertEqual(apply("by first.last%40mail.invalid", build("WORKER_A2A_URL=https://gw.c.invalid/a\nAWS_AGENT_CUSTODIAN=first.last@mail.invalid\n")), "by someone@example.com")

    def test_a_two_part_public_suffix_gives_the_private_domain(self):
        r = build("WORKER_A2A_URL=https://gw.corp.co.uk/a\n", allow=False)
        out = apply("https://gw2.corp.co.uk ops@corp.co.uk and https://bbc.co.uk", r)
        self.assertNotIn("corp.co.uk", out); self.assertIn("https://bbc.co.uk", out)

    def test_a_shared_suffix_is_never_masked_as_a_whole_domain_but_the_exact_host_is_even_when_encoded(self):
        r = build("WORKER_A2A_URL=https://abc123.execute-api.us-east-1.amazonaws.com/a\n", allow=False)
        out = apply("docs https://other.amazonaws.com | resource=https%3A%2F%2Fabc123.execute-api.us-east-1.amazonaws.com%2Fa", r)
        self.assertIn("https://other.amazonaws.com", out); self.assertNotIn("abc123", out); self.assertEqual(leaks(out, r), 0)

    def test_refusals(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertRaises(FileNotFoundError, om.mask_rules, Path(d) / "missing.env")
        self.assertRaises(om.MaskConfigError, build, "MCP_URL=http://127.0.0.1:6883/mcp\n")
        self.assertRaises(om.MaskConfigError, build, "WORKER_A2A_URL=https://gw.corp.invalid/a\nAWS_AGENT_PF_CLIENT_ID=ab\n")
        self.assertRaises(om.MaskConfigError, build, "WORKER_A2A_URL=https://gw.corp.invalid/a\n", False)   # reserved names are skipped outside tests

try:
    import playwright.sync_api as pw
    HAVE = True
except ImportError:
    HAVE = False

@unittest.skipUnless(HAVE, "playwright not installed")
class InABrowser(unittest.TestCase):
    def _page(self, rules, url="about:blank"):
        p = pw.sync_playwright().start(); self.addCleanup(p.stop)
        try: b = p.chromium.launch(headless=True)
        except Exception as e: self.skipTest(f"no Chromium ({str(e)[:60]})")
        self.addCleanup(b.close)
        page = b.new_page(); page.add_init_script(om.mask_script(rules)); page.goto(url)
        return page

    def test_the_page_never_shows_a_real_value_even_text_added_or_changed_later(self):
        page = self._page(build(ENV))
        page.evaluate("t => { const pre = document.createElement('pre'); pre.textContent = t; document.body.append(pre); }", PAGE)
        page.evaluate("() => { const t = document.createTextNode('x'); document.body.append(t); t.nodeValue = 'later https://gw-lb.corp.invalid/'; }")
        page.wait_for_timeout(80)
        body = page.inner_text("body")
        for real in REAL: self.assertNotIn(real, body, real)
        self.assertEqual(page.evaluate("() => window.__onscreenMaskLeaks()"), 0)

    def test_a_leak_is_counted_after_it_was_removed_and_across_a_page_load(self):
        import http.server, threading
        srv = http.server.HTTPServer(("127.0.0.1", 0), type("H", (http.server.SimpleHTTPRequestHandler,), {"log_message": lambda *a: None}))
        threading.Thread(target=srv.serve_forever, daemon=True).start(); self.addCleanup(srv.server_close); self.addCleanup(srv.shutdown)
        url = f"http://127.0.0.1:{srv.server_address[1]}/"
        partial = {"pairs": [], "detect": build(ENV)["detect"]}   # a mask that misses everything: the safety net must still notice
        page = self._page(partial, url)
        page.evaluate("() => { const p = document.createElement('p'); p.textContent = 'https://gw-lb.corp.invalid/'; document.body.append(p); }")
        page.wait_for_timeout(50); page.evaluate("() => document.querySelector('p').remove()")
        page.goto(url)   # a navigation, as the take does
        self.assertGreater(page.evaluate("() => window.__onscreenMaskLeaks()"), 0)

if __name__ == "__main__":
    unittest.main(verbosity=1)
