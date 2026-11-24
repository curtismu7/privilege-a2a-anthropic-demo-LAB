"""On-screen masking for a PUBLIC video (owner, 2026-11-24): the recorded page must not show the real gateway or identity-provider hosts, their domain,
an email in that domain, the OAuth client id, the token audience (a gateway URL) or the AWS runtime id. Nothing real is written into this repo: the values
are read at record time from the lab's own .env, and the page gets a small script that rewrites matching text as it appears (MutationObserver), before it
is painted, and COUNTS every real value it ever sees after masking (window.__onscreenMaskSeen), so a take can refuse even if the leak was later cleared.

  rules = mask_rules(env_file)      # {'pairs': [(regex, replacement)], 'detect': [regex]}; never print them, they hold the real values
  page_script = mask_script(rules)  # inject with context.add_init_script, before anything else
"""
import ipaddress, json, re
from pathlib import Path
from urllib.parse import urlparse

GATEWAY, IDP, CLIENT, RUNTIME, OTHER, EMAIL = "gateway.example", "pingfederate.example", "aws-agent-client", "my-agent-runtime", "host.example", "someone@example.com"
SHARED_SUFFIXES = {"amazonaws.com", "cloudfront.net", "azurewebsites.net", "herokuapp.com", "co.uk", "com.au", "github.io", "googleapis.com", "ngrok.io", "ngrok-free.app"}
NB = r"(?<![a-z0-9.-])"   # no left neighbour: a host is matched whole, never as the tail of a longer host


class MaskConfigError(Exception):
    pass


def _env(env_file):
    out = {}
    for line in Path(env_file).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"): continue
        line = re.sub(r"^export\s+", "", line)
        m = re.match(r"([A-Z0-9_]+)\s*=\s*(.*)$", line)
        if not m: continue
        v = m.group(2).strip()
        if v[:1] in "\"'" and v[-1:] == v[:1] and len(v) >= 2: v = v[1:-1]
        else: v = re.sub(r"\s+#.*$", "", v).strip()   # an inline comment is not part of the value
        out[m.group(1)] = v
    return out


def _is_ip(h):
    try: ipaddress.ip_address(h); return True
    except ValueError: return False


def _keep(h):
    return bool(h) and "." in h and not _is_ip(h) and h not in ("localhost",) and not h.endswith((".example", ".invalid", ".internal", ".localhost"))


def mask_rules(env_file):
    env = _env(env_file)
    hosts_gateway, hosts_idp = set(), set()
    for k, v in env.items():
        if "${" in v: continue
        hosts = []
        if "://" in v: hosts.append((urlparse(v).hostname or "").lower())
        elif k.endswith("_HOST") and re.fullmatch(r"[A-Za-z0-9.-]+", v): hosts.append(v.lower())
        for h in hosts:
            if _keep(h): (hosts_idp if ("PF" in k or "TOKEN_URL" in k or "ISSUER" in k) else hosts_gateway).add(h)
    if not (hosts_gateway or hosts_idp):
        raise MaskConfigError("no gateway or identity-provider host found in the .env")
    pairs, detect = [], []
    bases = sorted({".".join(h.split(".")[-2:]) for h in hosts_gateway | hosts_idp} - SHARED_SUFFIXES)
    # emails in the private domains first (the local part is often a person's name)
    for base in bases:
        pairs.append((r"[A-Za-z0-9._%+-]+@(?:[a-z0-9-]+\.)*" + re.escape(base) + r"\b", EMAIL))
    for h in sorted(hosts_gateway | hosts_idp, key=len, reverse=True):
        pairs.append((NB + re.escape(h) + r"\b", IDP if h in hosts_idp and h not in hosts_gateway else GATEWAY))
        detect.append(re.escape(h))
    for base in bases:   # any other host in a private domain, and the bare domain itself
        pairs.append((NB + r"(?:[a-z0-9-]+\.)*" + re.escape(base) + r"\b", OTHER))
        detect.append(re.escape(base))
    client = env.get("AWS_AGENT_PF_CLIENT_ID", "")
    if client:
        if len(client) < 4: raise MaskConfigError("AWS_AGENT_PF_CLIENT_ID is set but too short to mask safely")
        pairs.append((NB + re.escape(client) + r"(?![A-Za-z0-9_-])", CLIENT)); detect.append(re.escape(client))
    cust = env.get("AWS_AGENT_CUSTODIAN", "")
    if "@" in cust:
        pairs.append((re.escape(cust), EMAIL)); detect.append(re.escape(cust))
    # the AWS AgentCore runtime id, in a path, an ARN, a JSON-escaped path and a URL-encoded path
    pairs += [(r"(/runtimes/)(?!" + RUNTIME + r")[^/\s\"'<>\\?&]+", r"\1" + RUNTIME),
              (r"(\\/runtimes\\/)(?!" + RUNTIME + r")[^/\s\"'<>\\?&]+", r"\1" + RUNTIME),
              (r"(%2Fruntimes%2F)(?!" + RUNTIME + r")[^%/\s\"'<>&]+", r"\1" + RUNTIME),
              (r"(:runtime/)(?!" + RUNTIME + r")[^/\s\"'<>\\?&]+", r"\1" + RUNTIME)]
    detect += [r"/runtimes/(?!" + RUNTIME + r")[^/\s\"'<>\\?&]+", r":runtime/(?!" + RUNTIME + r")[^/\s\"'<>\\?&]+"]
    return {"pairs": pairs, "detect": detect}


def mask_pairs(env_file):   # kept for callers that only need the replacements
    return mask_rules(env_file)["pairs"]


def mask_script(rules):
    """The page script. JS replacement strings use $1, so a Python \\1 is translated."""
    js_pairs = [[p, r.replace("\\1", "$1")] for p, r in rules["pairs"]]
    return """;(() => {
  if (window.__onscreenMask) return; window.__onscreenMask = true; window.__onscreenMaskSeen = 0;
  const RULES = %s.map(([p, r]) => [new RegExp(p, 'gi'), r]);
  const DETECT = %s.map((p) => new RegExp(p, 'gi'));
  const count = (t) => { let n = 0; for (const re of DETECT) { const m = t.match(re); if (m) n += m.length; } return n; };
  const fix = (s) => { let t = s; for (const [re, r] of RULES) t = t.replace(re, r); window.__onscreenMaskSeen += count(t); return t; };
  const walk = (node) => {
    if (node.nodeType === 3) { const t = fix(node.nodeValue); if (t !== node.nodeValue) node.nodeValue = t; return; }
    if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return;
    if (node.nodeType === 1) { for (const a of ['title', 'value', 'href', 'placeholder', 'aria-label']) { const v = node.getAttribute && node.getAttribute(a); if (v) { const t = fix(v); if (t !== v) node.setAttribute(a, t); } } }
    for (const c of node.childNodes) walk(c);
  };
  new MutationObserver((ms) => { for (const m of ms) { if (m.type === 'characterData' || m.type === 'attributes') walk(m.target); else m.addedNodes.forEach(walk); } })
    .observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'value', 'href', 'placeholder', 'aria-label'] });
  document.addEventListener('DOMContentLoaded', () => { walk(document); document.title = fix(document.title); });
  // the take's safety net: real values anywhere in the page NOW (shown or hidden) plus every one seen after masking during the take
  window.__onscreenMaskLeaks = () => count(document.documentElement ? document.documentElement.textContent + ' ' + document.title : '') + window.__onscreenMaskSeen;
})();
""" % (json.dumps(js_pairs), json.dumps(rules["detect"]))
