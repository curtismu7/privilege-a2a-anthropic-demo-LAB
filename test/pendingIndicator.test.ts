import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderPage } from '../src/main-agent/ui.js';

const page = renderPage();

test('a pending answer shows the dancing P logo and a seconds counter, not a plain text line', () => {
  assert.ok(page.includes("className='dancing-p'"), 'the pending bubble builds the logo');
  assert.ok(page.includes('data:image/png;base64,'), 'the logo is inline, so no outside fetch');
  assert.ok(page.includes('@keyframes dancing-p'));
  assert.ok(page.includes("'Working '+n+'s'"), 'seconds counter');
  assert.ok(page.includes('a model call can take 10 to 30 seconds'), 'slow-model hint');
  assert.ok(!page.includes('Waiting for response'));
});

test('the animation stops under reduced motion and the timer stops when the run ends', () => {
  assert.match(page, /prefers-reduced-motion:reduce\)\{\.dancing-p\{animation:none\}/);
  assert.match(page, /finally\{clearInterval\(wait\);send\.disabled=false/);
});

test('the page script still parses', () => {
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length > 0);
  for (const code of scripts) assert.doesNotThrow(() => new Function(code));
});
