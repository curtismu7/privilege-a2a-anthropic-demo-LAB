"""On-screen masking for a PUBLIC video (owner, 2026-11-24): the recorded page must not show the real gateway or identity-provider hosts, the OAuth client id,
the token audience (it is a gateway URL) or the AWS runtime id. Nothing real is written into this repo: the values to hide are read at record time from the
lab's own .env, and the page gets a small script that rewrites matching text as it appears (MutationObserver), before anything is drawn.

  pairs = mask_pairs(env_file)      # [(regex, replacement), ...] most specific first; never print the regexes, they hold the real values
  page_script = mask_script(pairs)  # inject with context.add_init_script
"""
import json, re
from pathlib import Path
from urllib.parse import urlparse

GATEWAY, IDP, CLIENT, RUNTIME, OTHER = "gateway.example", "pingfederate.example", "aws-agent-client", "my-agent-runtime", "host.example"

def _env(env_file):
    out = {}
    for line in Path(env_file).read_text().splitlines():
        m = re.match(r"\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$", line)
        if m and not line.lstrip().startswith("#"):
            out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return out

def mask_pairs(env_file):
    env = _env(env_file)
    hosts_gateway, hosts_idp = set(), set()
    for k, v in env.items():
        if "://" not in v: continue
        h = (urlparse(v).hostname or "").lower()
        if not h or h in ("localhost", "127.0.0.1") or h.endswith((".example", ".invalid", ".internal")) or "." not in h: continue
        (hosts_idp if ("PF" in k or "TOKEN_URL" in k or "ISSUER" in k) else hosts_gateway).add(h)
    pairs = []
    for h in sorted(hosts_gateway | hosts_idp, key=len, reverse=True):
        pairs.append((re.escape(h), IDP if h in hosts_idp and h not in hosts_gateway else GATEWAY))
    # any other host in the same registrable domain (the last two labels of the hosts found): e.g. an issuer or a sibling gateway node
    for base in sorted({".".join(h.split(".")[-2:]) for h in hosts_gateway | hosts_idp}):
        pairs.append((r"\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\." + re.escape(base) + r"\b", OTHER))
    client = env.get("AWS_AGENT_PF_CLIENT_ID", "")
    if len(client) >= 6: pairs.append((re.escape(client), CLIENT))
    pairs.append((r"(/runtimes/)[^/\s\"'<>]+", r"\1" + RUNTIME))   # the AWS AgentCore runtime id in any path
    return pairs

def mask_script(pairs):
    """The page script. JS replacement strings use $1, so a Python \\1 is translated."""
    js_pairs = [[p, r.replace("\\1", "$1")] for p, r in pairs]
    return """;(() => {
  if (window.__onscreenMask) return; window.__onscreenMask = true;
  const RULES = %s.map(([p, r]) => [new RegExp(p, 'gi'), r]);
  const fix = (s) => { let t = s; for (const [re, r] of RULES) t = t.replace(re, r); return t; };
  const walk = (node) => {
    if (node.nodeType === 3) { const t = fix(node.nodeValue); if (t !== node.nodeValue) node.nodeValue = t; return; }
    if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return;
    if (node.nodeType === 1) { for (const a of ['title', 'value', 'href']) { const v = node.getAttribute && node.getAttribute(a); if (v) { const t = fix(v); if (t !== v) node.setAttribute(a, t); } } }
    for (const c of node.childNodes) walk(c);
  };
  new MutationObserver((ms) => { for (const m of ms) { if (m.type === 'characterData') walk(m.target); else m.addedNodes.forEach(walk); if (m.type === 'attributes') walk(m.target); } })
    .observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'value', 'href'] });
  document.addEventListener('DOMContentLoaded', () => walk(document));
  // The take's safety net: how many real values are anywhere in the page text, hidden pop-outs included (0 means nothing leaked).
  window.__onscreenMaskLeaks = () => { const all = document.documentElement ? document.documentElement.textContent : ''; let n = 0; for (const [re] of RULES) { const m = all.match(new RegExp(re.source, 'gi')); if (m) n += m.filter((x) => !/(gateway|pingfederate|host)\.example|aws-agent-client|my-agent-runtime/i.test(x)).length; } return n; };
})();
""" % json.dumps(js_pairs)
