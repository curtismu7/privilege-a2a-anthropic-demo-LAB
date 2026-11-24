#!/usr/bin/env python3
"""Tests for the public-video masking. Run: python3 video/test_onscreen_mask.py  (the browser checks run where Playwright and Chromium are installed).
All hosts here are under the reserved .test domain."""
import os, re, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import onscreen_mask as om

ENV = """# test values only
ANTHROPIC_BASE_URL=https://gw-lb.corp.test/llm/anthropic
WORKER_A2A_URL=https://gw-lb.corp.test/worker/a2a
export AWS_AGENT_A2A_URL=https://gw-node2.corp.test/aws-agent-worker
AWS_AGENT_PF_TOKEN_URL="https://someone-pf.corp.test/as/token.oauth2"
AWS_AGENT_PF_CLIENT_ID=demo-client-pass   # the PF client
AWS_AGENT_CUSTODIAN=owner.name@corp.test
LOCAL_GATEWAY_HOST=gw-local.corp.test
SHELF_URL=http://localhost:8443/shelf
MCP_URL=http://192.168.1.10:6883/mcp
"""
PAGE_TEXT = ("POST https://gw-lb.corp.test/worker/a2a/jsonrpc | iss https://someone-pf.corp.test | aud https://gw-node2.corp.test/aws-agent-worker "
             "| client_id demo-client-pass | https://gw-node3.corp.test/x | /runtimes/Real_Runtime-abc123/invocations | http://localhost:8443 ok "
             "| sibling cmuir-gw-lb.corp.test | bare https://corp.test/ | mail owner.name@corp.test and ops@corp.test "
             "| arn:aws:bedrock-agentcore:us-east-1:xxxxxxxxxxxx:runtime/Real_Runtime-abc123 | esc https:\\/\\/x\\/runtimes\\/Real_Runtime-abc123\\/inv "
             "| enc a%2Fruntimes%2FReal_Runtime-abc123%2Finv | version 2.1.10 | ip 192.168.1.10")
REAL = ("corp.test", "someone-pf", "gw-lb", "gw-node2", "gw-node3", "gw-local", "cmuir", "owner.name", "demo-client-pass", "Real_Runtime-abc123")

def apply(text, rules):
    for p, r in rules["pairs"]: text = re.sub(p, r, text, flags=re.I)
    return text

class Rules(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.TemporaryDirectory(); self.env = Path(self.d.name) / ".env"; self.env.write_text(ENV); self.rules = om.mask_rules(self.env)
    def tearDown(self): self.d.cleanup()

    def test_every_real_value_is_hidden_in_every_form_and_harmless_text_is_untouched(self):
        out = apply(PAGE_TEXT, self.rules)
        for real in REAL: self.assertNotIn(real, out, real)
        for want in ("https://gateway.example/worker/a2a/jsonrpc", "iss https://pingfederate.example", "https://gateway.example/aws-agent-worker",
                     "client_id aws-agent-client", "https://host.example/x", "/runtimes/my-agent-runtime/invocations", "http://localhost:8443",
                     "sibling host.example", "bare https://host.example/", "someone@example.com", ":runtime/my-agent-runtime",
                     "\\/runtimes\\/my-agent-runtime\\/", "%2Fruntimes%2Fmy-agent-runtime%2F", "version 2.1.10", "ip 192.168.1.10"):
            self.assertIn(want, out, want)
        left = sum(len(re.findall(p, out, flags=re.I)) for p in self.rules["detect"])
        self.assertEqual(left, 0, "the leak detectors find nothing after masking")

    def test_the_env_is_read_like_a_shell_would(self):
        env = om._env(self.env)
        self.assertEqual(env["AWS_AGENT_PF_CLIENT_ID"], "demo-client-pass")                  # inline comment dropped
        self.assertEqual(env["AWS_AGENT_A2A_URL"], "https://gw-node2.corp.test/aws-agent-worker")   # 'export' accepted
        self.assertEqual(env["AWS_AGENT_PF_TOKEN_URL"], "https://someone-pf.corp.test/as/token.oauth2")   # quotes removed

    def test_a_missing_env_or_one_without_hosts_or_with_a_tiny_client_id_is_refused(self):
        self.assertRaises(FileNotFoundError, om.mask_rules, Path(self.d.name) / "missing.env")
        bare = Path(self.d.name) / "bare.env"; bare.write_text("MCP_URL=http://127.0.0.1:6883/mcp\n")
        self.assertRaises(om.MaskConfigError, om.mask_rules, bare)
        tiny = Path(self.d.name) / "tiny.env"; tiny.write_text("WORKER_A2A_URL=https://gw.corp.test/a\nAWS_AGENT_PF_CLIENT_ID=ab\n")
        self.assertRaises(om.MaskConfigError, om.mask_rules, tiny)

    def test_a_shared_suffix_is_never_masked_as_a_whole_domain(self):
        aws = Path(self.d.name) / "aws.env"; aws.write_text("WORKER_A2A_URL=https://abc.execute-api.us-east-1.amazonaws.com/a\n")
        rules = om.mask_rules(aws)
        self.assertEqual(apply("docs https://docs.aws.amazon.com and https://other.amazonaws.com", rules), "docs https://docs.aws.amazon.com and https://other.amazonaws.com")

try:
    import playwright.sync_api as pw
    HAVE = True
except ImportError:
    HAVE = False

@unittest.skipUnless(HAVE, "playwright not installed")
class InABrowser(unittest.TestCase):
    def _page(self, rules):
        p = pw.sync_playwright().start(); self.addCleanup(p.stop)
        try: b = p.chromium.launch(headless=True)
        except Exception as e: self.skipTest(f"no Chromium ({str(e)[:60]})")
        self.addCleanup(b.close)
        page = b.new_page(); page.add_init_script(om.mask_script(rules)); page.goto("data:text/html,<title>t</title><div id=b></div>")
        return page

    def setUp(self):
        self.d = tempfile.TemporaryDirectory(); env = Path(self.d.name) / ".env"; env.write_text(ENV); self.rules = om.mask_rules(env)
    def tearDown(self): self.d.cleanup()

    def test_the_page_never_shows_a_real_value_even_text_added_or_changed_later(self):
        page = self._page(self.rules)
        page.evaluate("t => { const pre = document.createElement('pre'); pre.textContent = t; document.getElementById('b').append(pre); }", PAGE_TEXT)
        page.evaluate("() => { const t = document.createTextNode('x'); document.body.append(t); t.nodeValue = 'later https://gw-lb.corp.test/'; }")
        page.wait_for_timeout(80)
        body = page.inner_text("body")
        for real in REAL: self.assertNotIn(real, body, real)
        self.assertEqual(page.evaluate("() => window.__onscreenMaskLeaks()"), 0)

    def test_a_leak_is_counted_even_after_it_was_removed_from_the_page(self):
        partial = {"pairs": [], "detect": self.rules["detect"]}   # a mask that misses everything: the safety net must still notice
        page = self._page(partial)
        page.evaluate("() => { const p = document.createElement('p'); p.textContent = 'https://gw-lb.corp.test/'; document.body.append(p); }")
        page.wait_for_timeout(50); page.evaluate("() => document.querySelector('p').remove()")
        self.assertGreater(page.evaluate("() => window.__onscreenMaskLeaks()"), 0)

if __name__ == "__main__":
    unittest.main(verbosity=1)
