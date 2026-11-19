import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderPage } from '../src/main-agent/ui.js';
import { WIRING_HTML } from '../src/main-agent/wiringDiagram.js';

const page = renderPage();

test('the page carries the wiring diagram between the header and the main area, collapsed', () => {
  const at = page.indexOf('data-testid="wiring-diagram"');
  assert.ok(at > page.indexOf('</header>'), 'diagram comes after the header');
  assert.ok(at < page.indexOf('<main>'), 'diagram comes before main');
  assert.ok(!/<details class="wire"[^>]*\bopen\b/.test(page), 'collapsed by default so the chat keeps its room');
});

test('all four hops go through a numbered gateway box, with the routes on them', () => {
  const badges = [...WIRING_HTML.matchAll(/wire__badge" aria-hidden="true">(\d)</g)].map((m) => m[1]);
  assert.deepEqual(badges, ['1', '4', '2', '3']);
  for (const path of ['/analyst-agent/a2a', '/acme-tools/mcp', '/llm/google']) assert.ok(WIRING_HTML.includes(path), path);
});

test('names both agents, the MCP server and the no-provider-keys point, and one card per hop', () => {
  for (const text of ['Main agent', 'Worker agent', 'MCP server', 'no tools of its own', 'The agents hold no provider keys']) {
    assert.ok(WIRING_HTML.includes(text), text);
  }
  assert.equal([...WIRING_HTML.matchAll(/class="wire__hop"/g)].length, 4);
});

test('arrows are hidden from assistive tech and the markup has no inline style', () => {
  const links = [...WIRING_HTML.matchAll(/<span class="wire__link[^"]*"([^>]*)>/g)];
  assert.ok(links.length >= 10);
  for (const [, attrs] of links) assert.match(attrs, /aria-hidden="true"/);
  assert.ok(!/style=/.test(WIRING_HTML));
});

test('the diagram text stays at 12px or more, but for the 10px arrow tags', () => {
  const css = page.slice(page.indexOf('.wire{'), page.indexOf('</style>'));
  const sizes = [...css.matchAll(/font-size:([\d.]+)(rem|px)/g)].map((m) => (m[2] === 'rem' ? Number(m[1]) * 16 : Number(m[1])));
  assert.ok(sizes.length > 0);
  assert.ok(Math.min(...sizes) >= 10, 'nothing below the 10px floor');
});
