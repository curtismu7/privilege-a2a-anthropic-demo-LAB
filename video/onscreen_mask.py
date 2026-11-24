"""On-screen masking for a PUBLIC video (owner, 2026-11-24): the recorded page must not show the real gateway or identity-provider hosts, their private
domain, an email in it, the OAuth client id (also sub and act.sub in a decoded token), the token audience (a gateway URL), a personal custodian name, or
the AWS runtime id, in plain, JSON-escaped or URL-encoded form. Nothing real is written into this repo: the values are read at record time from the lab's
own .env, and the page gets a script that rewrites matching text as it appears (MutationObserver, before paint) and COUNTS every real value still present
after masking (window.__onscreenMaskLeaks(), kept across page loads in sessionStorage), so a take can refuse even if a leak was later cleared.

  rules = mask_rules(env_file)      # {'pairs': [(regex, replacement)], 'detect': [regex]}; never print them, they hold the real values
  page_script = mask_script(rules)  # inject with context.add_init_script, before anything else
"""
import ipaddress, json, re
from pathlib import Path
from urllib.parse import quote, unquote, urlparse

GATEWAY, IDP, CLIENT, RUNTIME, OTHER, EMAIL, PERSON = ("gateway.example", "pingfederate.example", "aws-agent-client", "my-agent-runtime",
                                                       "host.example", "someone@example.com", "the custodian")
SHARED_SUFFIXES = {"amazonaws.com", "cloudfront.net", "azurewebsites.net", "herokuapp.com", "github.io", "googleapis.com", "ngrok.io", "ngrok-free.app",
                   "vercel.app", "netlify.app", "pages.dev", "workers.dev"}
TWO_PART_SUFFIXES = {"co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.jp", "ne.jp", "com.br", "co.nz", "com.sg", "co.in", "co.za", "com.mx"}
# no host character to the left, except a URL-encoded '/', ':' or '@' (so a host inside an encoded URL is still matched whole)
NB = r"(?:(?<![a-z0-9.-])|(?<=%2f)|(?<=%3a)|(?<=%40))"
END = r"(?![a-z0-9-]|\.[a-z0-9])"   # no host character to the right (a trailing full stop is fine)


class MaskConfigError(Exception):
    pass


def _env(env_file):
    """KEY=value lines the way dotenv reads them: 'export' allowed; a quoted value ends at its closing quote (anything after, such as a comment, is
    dropped); an unquoted value ends before ' #'."""
    out = {}
    for line in Path(env_file).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"): continue
        m = re.match(r"(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*)$", line)
        if not m: continue
        raw = m.group(2).strip()
        if raw and raw[0] in "\"'`":   # (an empty value is just empty: '' is "in" every string)
            end = raw.find(raw[0], 1)
            v = raw[1:end] if end > 0 else raw[1:]
        else:
            v = re.sub(r"\s+#.*$", "", raw).strip()
        out[m.group(1)] = v
    return out


def _is_ip(h):
    try: ipaddress.ip_address(h); return True
    except ValueError: return False


def _keep(h, allow_reserved):
    reserved = h.endswith((".example", ".invalid", ".internal", ".localhost", ".test"))
    return bool(h) and "." in h and not _is_ip(h) and h != "localhost" and (allow_reserved or not reserved)


def _domain(h):
    labels = h.split(".")
    two = ".".join(labels[-2:])
    return ".".join(labels[-3:]) if two in TWO_PART_SUFFIXES and len(labels) >= 3 else two


def _hosts_in(key, value):
    v = re.sub(r"\$\{[^}]*\}", "", value)   # a ${VAR} reference is removed, the rest of the value is still read
    hosts = [(urlparse(u).hostname or "").lower() for u in re.findall(r"[a-z][a-z0-9+.-]*://[^\s,;\"'<>]+", v, re.I)]
    if key.endswith(("_HOST", "_HOSTS")) or key.endswith(("_ORIGINS", "_DOMAINS")):
        hosts += [t.lower() for t in re.split(r"[\s,;]+", v) if re.fullmatch(r"[A-Za-z0-9.-]+", t or "")]
    return hosts


def mask_rules(env_file, allow_reserved=False):
    env = _env(env_file)
    hosts_gateway, hosts_idp = set(), set()
    for k, v in env.items():
        for h in _hosts_in(k, v):
            if _keep(h, allow_reserved): (hosts_idp if ("PF" in k or "TOKEN_URL" in k or "ISSUER" in k) else hosts_gateway).add(h)
    if not (hosts_gateway or hosts_idp):
        raise MaskConfigError("no gateway or identity-provider host found in the .env")
    pairs, detect = [], []
    domains = sorted({_domain(h) for h in hosts_gateway | hosts_idp} - SHARED_SUFFIXES - TWO_PART_SUFFIXES)
    for d in domains:   # emails in a private domain first (the local part is often a person's name), plain or URL-encoded '@'
        p = r"[A-Za-z0-9._%+-]+(?:@|%40)(?:[a-z0-9-]+\.)*" + re.escape(d) + END
        pairs.append((p, EMAIL)); detect.append(p)
    for h in sorted(hosts_gateway | hosts_idp, key=len, reverse=True):
        p = NB + re.escape(h) + END
        pairs.append((p, IDP if h in hosts_idp and h not in hosts_gateway else GATEWAY)); detect.append(p)
    for d in domains:   # any other host in a private domain, and the bare domain itself
        p = NB + r"(?:[a-z0-9-]+\.)*" + re.escape(d) + END
        pairs.append((p, OTHER)); detect.append(p)
    client = env.get("AWS_AGENT_PF_CLIENT_ID", "")
    if client:
        if len(client) < 4: raise MaskConfigError("AWS_AGENT_PF_CLIENT_ID is set but too short to mask safely")
        p = r"(?<![A-Za-z0-9_.-])" + re.escape(client) + r"(?![A-Za-z0-9_-])"
        pairs.append((p, CLIENT)); detect.append(p)
    cust = env.get("AWS_AGENT_CUSTODIAN", "")
    if cust and not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", cust) and cust.lower() != "sample custodian":   # a person's name or email, not an object name
        for form in {cust, quote(cust, safe="")}:
            p = r"(?<![A-Za-z0-9_.-])" + re.escape(form) + r"(?![A-Za-z0-9_-])"
            pairs.append((p, EMAIL if "@" in cust else PERSON)); detect.append(p)
    # the AWS AgentCore runtime id: the literal id when the .env names it, and any id after runtime(s)/ in plain, escaped or (double) URL-encoded form
    a2a = unquote(unquote(env.get("AWS_AGENT_A2A_URL", "") + " " + env.get("AWS_AGENT_RUNTIME_ARN", "")))
    for rid in set(re.findall(r"runtimes?/([A-Za-z0-9_.-]{6,})", a2a)) - {RUNTIME}:
        for form in {rid, quote(rid, safe=""), quote(quote(rid, safe=""), safe="")}:
            p = re.escape(form); pairs.append((p, RUNTIME)); detect.append(p)
    # left boundary: not inside a word (so the placeholder 'my-agent-runtime/...' is never matched again), but an encoded ':' or '/' may precede it
    lb = r"(?:(?<![A-Za-z0-9_-])|(?<=%3a)|(?<=%253a)|(?<=%2f)|(?<=%252f))"
    rt = lb + r"(runtimes?(?:/|\\/|%2f|%252f))(?!" + RUNTIME + r")[A-Za-z0-9_.-]+"
    pairs.append((rt, r"\1" + RUNTIME)); detect.append(lb + r"runtimes?(?:/|\\/|%2f|%252f)(?!" + RUNTIME + r")[A-Za-z0-9_.-]+")
    return {"pairs": pairs, "detect": detect}


def mask_pairs(env_file):   # kept for callers that only need the replacements
    return mask_rules(env_file)["pairs"]


def mask_script(rules):
    """The page script. JS replacement strings use $1, so a Python \\1 is translated."""
    js_pairs = [[p, r.replace("\\1", "$1")] for p, r in rules["pairs"]]
    return """;(() => {
  if (window.__onscreenMask) return; window.__onscreenMask = true;
  const KEY = '__onscreenMaskSeen';
  const load = () => { try { return +sessionStorage.getItem(KEY) || 0; } catch { return 0; } };
  let seen = load();   // the count survives a page load within the take (sessionStorage), so a leak before a navigation is not forgotten
  const bump = (n) => { if (!n) return; seen += n; try { sessionStorage.setItem(KEY, String(seen)); } catch { /* storage blocked: the in-page count still holds */ } };
  const RULES = %s.map(([p, r]) => [new RegExp(p, 'gi'), r]);
  const DETECT = %s.map((p) => new RegExp(p, 'gi'));
  const count = (t) => { let n = 0; for (const re of DETECT) { re.lastIndex = 0; const m = t.match(re); if (m) n += m.length; } return n; };
  const fix = (s) => { let t = s; for (const [re, r] of RULES) t = t.replace(re, r); bump(count(t)); return t; };
  const ATTRS = ['title', 'value', 'href', 'placeholder', 'aria-label', 'alt'];
  const walk = (node) => {
    if (node.nodeType === 3) { const t = fix(node.nodeValue); if (t !== node.nodeValue) node.nodeValue = t; return; }
    if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return;
    if (node.nodeType === 1) {
      for (const a of ATTRS) { const v = node.getAttribute && node.getAttribute(a); if (v) { const t = fix(v); if (t !== v) node.setAttribute(a, t); } }
      if ((node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') && node.value) { const t = fix(node.value); if (t !== node.value) node.value = t; }
    }
    for (const c of node.childNodes) walk(c);
  };
  new MutationObserver((ms) => { for (const m of ms) { if (m.type === 'characterData' || m.type === 'attributes') walk(m.target); else m.addedNodes.forEach(walk); } })
    .observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  document.addEventListener('input', (e) => walk(e.target), true);
  document.addEventListener('DOMContentLoaded', () => { walk(document); document.title = fix(document.title); });
  // the take's safety net: real values anywhere in the page NOW (shown or hidden) plus every one counted after masking during the take, across page loads
  window.__onscreenMaskLeaks = () => count(document.documentElement ? document.documentElement.textContent + ' ' + document.title : '') + Math.max(seen, load());
  window.__onscreenMaskReset = () => { seen = 0; try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } };
})();
""" % (json.dumps(js_pairs), json.dumps(rules["detect"]))
