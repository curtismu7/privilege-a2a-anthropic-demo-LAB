import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import { renderPage, RETURN_LINK_APP, RETURN_LINK_SOURCE } from '../src/main-agent/ui.js';
// @ts-expect-error: the vendored file is plain JavaScript with no type declarations
import { returnLinkFor } from '../src/vendor/return-link/returnTargets.js';

const dir = join(dirname(dirname(fileURLToPath(import.meta.url))), 'src', 'vendor', 'return-link');

test('the vendored returnTargets.js matches its pinned hash and the pin names the parent commit', () => {
  const text = readFileSync(join(dir, 'return-link.sha256'), 'utf8');
  assert.match(text.split('\n')[0] ?? '', /^# vendored byte for byte from curtismu7\/AI-DEMO-Standalone shared\/return-link at [0-9a-f]{7,40}/);
  const pins = text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split(/\s+/));
  assert.deepEqual(pins.map(p => p[1]), ['returnTargets.js']);
  assert.equal(createHash('sha256').update(readFileSync(join(dir, 'returnTargets.js'))).digest('hex'), pins[0]?.[0]);
});

test('the page inlines the return-link logic without exports and builds the strip and the header button', () => {
  const html = renderPage();
  assert.ok(!/^export /m.test(RETURN_LINK_SOURCE));
  assert.ok(html.includes(RETURN_LINK_SOURCE));
  assert.match(html, /returnLinkFor\('privilege-a2a-anthropic-demo'\)/);
  assert.match(html, /return-link--strip/);
  assert.match(html, /return-link--header/);
  assert.match(html, /window\.location\.assign\(l\.href\)/);
  // Nothing in the inlined script can end the script element early or open an HTML comment, and all text is set with textContent.
  const start = html.lastIndexOf('<script>(function(){');
  const script = html.slice(start + '<script>'.length, html.indexOf('</script>', start));
  for (const src of [RETURN_LINK_SOURCE, script]) {
    assert.ok(!/<\/script/i.test(src), 'no </script');
    assert.ok(!src.includes('<!--'), 'no <!--');
  }
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(script), 'textContent only');
  assert.ok(!/<\/script>[^]*<\/script>[^]*returnLinkFor[^]*<\/script>[^]*<\/script>/.test(html.slice(html.indexOf(RETURN_LINK_SOURCE))), 'the inlined logic sits inside one script element');
});

test('Back goes only to the fixed Customer Agent LAB target (proxy path or loopback), never to a URL from the address bar', () => {
  const at = (search: string, pathname = '/privilege-a2a/') => ({ hostname: '127.0.0.1', pathname, search });
  assert.equal(returnLinkFor(RETURN_LINK_APP, at('?from=customer-agent&uc=UC47&vertical=banking')).href, '/customer-agent/?returned=privilege-a2a-anthropic-demo&uc=UC47');
  assert.equal(returnLinkFor(RETURN_LINK_APP, at('?from=customer-agent&uc=UC46A', '/')).href, 'http://127.0.0.1:5603/?returned=privilege-a2a-anthropic-demo&uc=UC46A');
  assert.equal(returnLinkFor(RETURN_LINK_APP, at('?from=customer-agent&uc=UC47&next=https://evil.example/')).href, '/customer-agent/?returned=privilege-a2a-anthropic-demo&uc=UC47');
  for (const q of ['', '?from=elsewhere&uc=UC47', '?from=customer-agent&uc=%3Cb%3E', '?from=https://evil.example&uc=UC47']) assert.equal(returnLinkFor(RETURN_LINK_APP, at(q)), null, q);
});

// Runs the page's return-link script against a tiny fake DOM: the strip goes right after the header (which holds the simulation banner),
// the button into the header, and a click navigates the same tab to the fixed target.
function runPageScript(search: string, pathname = '/privilege-a2a/') {
  const html = renderPage();
  const start = html.lastIndexOf('<script>(function(){');
  const code = html.slice(start + '<script>'.length, html.indexOf('</script>', start));
  type El = { tag: string; children: El[]; attrs: Record<string, string>; className?: string; textContent?: string; type?: string; title?: string; click?: () => void; appendChild(c: El): El; setAttribute(k: string, v: string): void; addEventListener(e: string, f: () => void): void };
  const el = (tag: string): El => ({ tag, children: [], attrs: {}, appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(_e, f) { this.click = f; } });
  const body = el('body'); const header = el('header'); const main = el('main'); body.children.push(header, main);
  Object.assign(header, { parentNode: body, get nextSibling() { return body.children[body.children.indexOf(header) + 1]; } });
  const assigned: string[] = [];
  Object.assign(body, { insertBefore(c: El, ref: El) { body.children.splice(body.children.indexOf(ref), 0, c); return c; } });
  const document = { body, createElement: el, querySelector: (s: string) => (s === 'header' ? header : null) };
  runInNewContext(code, { document, window: { location: { hostname: '127.0.0.1', pathname, search, assign: (u: string) => assigned.push(u) } }, URLSearchParams, Object });
  return { body, header, assigned };
}

test('the page script: strip right after the header (banner first), Back in the header, a click goes to the fixed target', () => {
  const { body, header, assigned } = runPageScript('?from=customer-agent&uc=UC47&vertical=banking');
  assert.equal(body.children[0], header);
  const strip = body.children[1];
  assert.equal(strip?.className, 'return-link return-link--strip');
  assert.equal(strip?.attrs.role, 'note');
  assert.equal(strip?.children[0]?.textContent, 'Opened from Customer Agent LAB \u00b7 UC47 \u00b7 banking');
  const hb = header.children[0];
  assert.equal(hb?.textContent, '\u2190 Back to Customer Agent LAB');
  hb?.click?.();
  strip?.children[1]?.click?.();
  assert.deepEqual(assigned, ['/customer-agent/?returned=privilege-a2a-anthropic-demo&uc=UC47', '/customer-agent/?returned=privilege-a2a-anthropic-demo&uc=UC47']);
});

test('the page script adds nothing without a known from', () => {
  for (const q of ['', '?from=elsewhere&uc=UC47', '?from=customer-agent&uc=a%20b']) {
    const { body, header } = runPageScript(q);
    assert.equal(body.children.length, 2, q);
    assert.equal(header.children.length, 0, q);
  }
});

test('served at its root (its own port) the page script sends Back to the direct URL', () => {
  const { header, assigned } = runPageScript('?from=customer-agent&uc=UC46', '/');
  header.children[0]?.click?.();
  assert.deepEqual(assigned, ['http://127.0.0.1:5603/?returned=privilege-a2a-anthropic-demo&uc=UC46']);
});
