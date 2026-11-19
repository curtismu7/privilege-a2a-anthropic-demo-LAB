import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderPage } from '../src/main-agent/ui.js';
import { AWS_PANEL_HTML, AWS_PROMPTS, AWS_TAB_CSS, AWS_TAB_SCRIPT } from '../src/main-agent/awsTab.js';

const page = renderPage();

test('the page has two tabs, the access review selected and the AWS panel hidden', () => {
  assert.match(page, /role="tab" id="tab-review" aria-selected="true"/);
  assert.match(page, /role="tab" id="tab-aws" aria-selected="false"/);
  assert.match(page, /<main id="panel-review" role="tabpanel" aria-labelledby="tab-review">/);
  assert.match(page, /<section id="panel-aws" class="aws" role="tabpanel" aria-labelledby="tab-aws" hidden/);
  assert.ok(page.indexOf('id="panel-review"') < page.indexOf('id="panel-aws"'));
});

test('the path runs custodian, main agent, Privilege gateway, AWS agent, in that order', () => {
  const order = ['aws-n-custodian', 'aws-n-main', 'aws-n-gateway', 'aws-n-aws'].map((id) => AWS_PANEL_HTML.indexOf(`id="${id}"`));
  assert.ok(order.every((at) => at > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.equal([...AWS_PANEL_HTML.matchAll(/data-state="idle"/g)].length, 4);
});

test('every inline script in the page compiles, including the tab script', () => {
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? '');
  assert.ok(scripts.length >= 4);
  for (const source of scripts) assert.doesNotThrow(() => new Function(source));
  assert.doesNotThrow(() => new Function(AWS_TAB_SCRIPT));
});

test('the tab script keeps its newline escapes literal and builds no HTML from remote text', () => {
  assert.ok(AWS_TAB_SCRIPT.includes("indexOf('\\n\\n')"), 'the SSE frame split must survive as a backslash-n in the source');
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(AWS_TAB_SCRIPT));
  assert.ok(!AWS_TAB_SCRIPT.includes('${'), 'no template placeholder inside the script');
});

test('the text-size script waits for the page, so it does not look up its controls from the head before they exist', () => {
  const head = page.slice(0, page.indexOf('</head>'));
  const script = head.slice(head.lastIndexOf('<script>', head.indexOf('font-select')));
  assert.match(script, /^<script>\s*document\.addEventListener\("DOMContentLoaded",function\(\)\{var STEP=/);
  assert.ok(head.indexOf('font-select') < head.length, 'the script is in the head');
  assert.ok(page.indexOf('id="font-select"') > head.length, 'and the control is in the body');
});

test('the suggested questions are buttons and the markup has no inline style', () => {
  for (const prompt of AWS_PROMPTS) assert.ok(AWS_PANEL_HTML.includes(`<button type="button">${prompt}</button>`));
  assert.ok(!/style=/.test(AWS_PANEL_HTML));
});

test('the tab text stays at 12px or more', () => {
  const sizes = [...AWS_TAB_CSS.matchAll(/font-size:([\d.]+)rem/g)].map((m) => Number(m[1]) * 16);
  assert.ok(sizes.length > 0);
  assert.ok(Math.min(...sizes) >= 12, `smallest is ${Math.min(...sizes)}px`);
});

test('the page says what is simulated and what the tab cannot verify', () => {
  assert.match(AWS_PANEL_HTML, /cannot read it from Privilege/);
  assert.match(AWS_PANEL_HTML, /Simulated runs/);
});
