import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderPage } from '../src/main-agent/ui.js';

const page = renderPage();

test('the trace panel gets the wider share of the page and the chat is narrower, not full width', () => {
  assert.match(page, /main\{[^}]*grid-template-columns:minmax\(0,2fr\) minmax\(0,3fr\)\}/);
  assert.match(page, /\.message\{max-width:40rem;/);
  assert.ok(!page.includes('grid-template-columns:minmax(0,1fr) 25rem'), 'the old fixed 25rem panel is gone');
});

test('the trace text is at least 1rem, with a 0.9rem detail line (it was 0.82 and 0.75)', () => {
  assert.match(page, /\.trace\{[^}]*font-size:1rem/);
  assert.match(page, /\.trace-detail\{[^}]*font-size:\.9rem/);
  assert.match(page, /#tracePane h2\{font-size:\.95rem/);
});

test('the panel names the custodian and the subagent it calls, in a header block and on every delegate row', () => {
  assert.ok(page.includes('<div id="who"'), 'the header block exists above the trace');
  assert.ok(page.indexOf('id="who"') < page.indexOf('id="trace"'), 'and sits above it');
  assert.ok(page.includes("whoCard('cust','Custodian'"), 'custodian card');
  assert.ok(page.includes("whoCard('sub','Subagent'"), 'subagent card');
  assert.ok(page.includes("chip('cust','Custodian')") && page.includes("chip('sub','Subagent')"), 'chips on the delegate row');
  assert.ok(page.includes('The custodian and the subagent it calls appear here'), 'says what to expect before any handoff');
});

test('on a narrow screen the trace stacks under the chat instead of disappearing', () => {
  const m = page.match(/@media\(max-width:850px\)\{body\{[^}]*\}main\{([^}]*)\}/);
  assert.ok(m, 'the narrow rule exists');
  assert.match(m[1], /grid-template-columns:1fr/);
  assert.ok(!page.includes('#tracePane{display:none}'), 'the panel is no longer hidden');
  assert.match(page, /@media\(max-width:850px\)\{body\{height:auto;min-height:100vh\}/, 'the whole page scrolls, so the trace is not stuck below the fold inside an inner scroller');
  assert.match(page, /#messages\{min-height:11rem;max-height:60vh\}/, 'the chat reserves little height, so the trace follows it closely');
});

test('on a narrow screen the handoff scrolls the custodian and subagent block into view', () => {
  assert.ok(page.includes('function showHandoff()'));
  assert.ok(page.includes("renderWho();showHandoff()}"), 'called when a handoff starts');
  assert.ok(page.includes("scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'"), 'respects reduced motion');
});

test('the page script still parses with the new code', () => {
  for (const code of [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])) assert.doesNotThrow(() => new Function(code));
});
