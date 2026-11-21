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
  for (const { q, proves } of AWS_PROMPTS) {
    assert.ok(AWS_PANEL_HTML.includes(`data-q="${q}"`), q);
    if (!proves) assert.ok(AWS_PANEL_HTML.includes(`<button type="button" data-q="${q}">${q}</button>`), q);
  }
  assert.ok(!/style=/.test(AWS_PANEL_HTML));
});

test('the introduction prompt comes first, says what it proves, and is sent by its data-q, not by the caption text', () => {
  const first = AWS_PROMPTS[0];
  assert.equal(first?.q, 'Introduce yourself: which agent are you, and where do you run?');
  assert.match(first?.proves ?? '', /talks to the agent hosted in AWS \(Bedrock AgentCore\) through Privilege/);
  assert.match(first?.proves ?? '', /local stand-in answers and says so/, 'the caption is honest about the simulated case');
  const buttons = [...AWS_PANEL_HTML.matchAll(/<button type="button"[^>]*data-q="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(buttons[0], first?.q, 'it is the first suggested question');
  assert.equal(buttons.length, AWS_PROMPTS.length);
  assert.equal(AWS_PROMPTS.filter((p) => p.proves).length, 1, 'only the new prompt carries a caption');
  assert.ok(AWS_TAB_SCRIPT.includes("run(b.getAttribute('data-q')||'')"), 'the caption text is never sent as the question');
  assert.ok(!AWS_TAB_SCRIPT.includes("run(b.textContent"));
  // The Access Review tab styles .p-proves b white; on this tab's light panel that hides the label unless it is scoped here.
  assert.ok(AWS_TAB_CSS.includes('.aws__prompts .p-proves b{color:var(--text)'), 'the Proves label keeps its own ink');
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

test('the secrets-hub explainer is an off-by-default toggle, labelled display only, that shows a note and a chip', () => {
  assert.match(AWS_PANEL_HTML, /<input type="checkbox" id="aws-hub"(?![^>]*checked)/);
  assert.match(AWS_PANEL_HTML, /id="aws-hub-note"[^>]*hidden/);
  assert.match(AWS_PANEL_HTML, /id="aws-hub-chip" hidden/);
  assert.match(AWS_PANEL_HTML, /This run does not use a hub/);
  assert.ok(AWS_TAB_SCRIPT.includes("getElementById('aws-hub')"));
});

test('the refused-call button sends refusal:true, and the header banner only says SIMULATED until the status says the run is live', () => {
  assert.match(AWS_PANEL_HTML, /id="aws-refuse"/);
  assert.ok(AWS_TAB_SCRIPT.includes('refusal:true'));
  assert.match(page, /<span class="banner" role="note">SIMULATED:/, 'the static default stays honest for an offline run');
  assert.match(page, /if\(s\.viaGateway\)\{const b=document\.querySelector\('header \.banner'\)/);
  assert.match(page, /LIVE: model calls go through your Privilege gateway/);
});

test('the card step renders a readable Agent Card panel from the card summary, with text nodes only', () => {
  assert.ok(AWS_TAB_SCRIPT.includes('function cardBlock(c)'));
  assert.ok(AWS_TAB_SCRIPT.includes("row('securitySchemes',c.security)"));
  assert.ok(AWS_TAB_SCRIPT.includes("'not declared'"));
  assert.ok(AWS_TAB_CSS.includes('.aws__card'));
});
