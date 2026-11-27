import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderPage } from '../src/main-agent/ui.js';
import { AWS_INTRO, AWS_TAB_SCRIPT } from '../src/main-agent/awsTab.js';

const page = renderPage();
const promptsBlock = page.slice(page.indexOf('<div class="prompts"'), page.indexOf('<form id="form">'));

// The three A2A with remote agents prompts exactly as they were before the AWS prompt was added: this test is the "leave them alone" check.
const ORIGINAL_THREE = [
  '<button type="button" data-q="Review access on passenger-records-db"><span class="p-q">Review access on passenger-records-db</span><span class="p-proves"><b>Proves:</b> the A2A handoff end to end. The concierge hands the question to the analyst agent, which reads the data over MCP. Privilege checks each hop on its own key and shows any refusal in the trace. Expect a refusal on the data call here: the injection demo plants a hostile instruction in a record, and Privilege\'s AI Guard blocks that tool response (the last card says how to change that).</span></button>',
  '<button type="button" data-q="List all entitlements for Carol Nguyen"><span class="p-q">List all entitlements for Carol Nguyen</span><span class="p-proves"><b>Proves:</b> Privilege protecting data on the MCP leg. In gateway mode her personal data (her email) comes back redacted, so watch for [REDACTED:pii] in the trace.</span></button>',
  '<button type="button" data-q="Is Erin Walsh offboarding, and what access does she still hold?"><span class="p-q">Is Erin Walsh offboarding, and what access does she still hold?</span><span class="p-proves"><b>Proves:</b> the analyst, not the concierge, does the data work: it looks up Erin Walsh\'s entitlements over MCP, and the concierge reports only what the analyst returned. Expect her to be flagged as offboarding but still holding a standing grant on flight-manifest-exports.</span></button>',
];

test('the three existing A2A with remote agents prompts are unchanged, in the same order, and come first', () => {
  const at = ORIGINAL_THREE.map((markup) => promptsBlock.indexOf(markup));
  assert.ok(at.every((i) => i >= 0), 'each original button is present byte for byte');
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'in the original order');
  assert.equal(at[0], promptsBlock.indexOf('<button'), 'and they are still the first buttons');
});

test('a 4th prompt, just for the AWS agent, follows the three', () => {
  const buttons = [...promptsBlock.matchAll(/<button type="button"[^>]*>/g)];
  assert.equal(buttons.length, 5, 'three questions, the AWS question, and the how-to card');
  const fourth = promptsBlock.slice(buttons[3]?.index ?? 0);
  assert.match(fourth, /^<button type="button" class="p-aws" data-aws="1"/);
  assert.ok(fourth.includes(`data-q="${AWS_INTRO.q}"`), 'it asks the AWS introduction question');
  assert.ok(fourth.includes('<span class="p-tag">AWS agent</span>'), 'and says it is the AWS agent');
  assert.ok(fourth.includes(`<b>Proves:</b> ${AWS_INTRO.proves}`), 'with the same honest caption as the AWS tab');
  assert.ok(fourth.includes('It runs here; the Custodian to AWS agent tab shows the same path hop by hop.'));
  assert.ok(!fourth.includes('This opens the Custodian to AWS agent tab'), 'it no longer says it jumps to another tab');
});

test('the prompt list scrolls instead of wrapping, so the 4th prompt is not pushed into an off-screen second column', () => {
  const rule = page.match(/\.prompts\{flex-direction:column;([^}]*)\}/)?.[1] ?? '';
  assert.match(rule, /flex-wrap:nowrap/);
  assert.match(rule, /overflow:auto/);
});

test('the 4th prompt runs in place against /aws-agent, never against the main agent chat, and does not switch tabs', () => {
  assert.ok(page.includes("void submit(button.dataset.q||'',button.dataset.aws?'/aws-agent':'/chat')"));
  assert.ok(page.includes("fetch(endpoint||'/chat'"));
  assert.ok(!page.includes('aws-ask'), 'nothing asks the AWS tab to take over any more');
  assert.ok(!AWS_TAB_SCRIPT.includes('aws-ask'));
});

test('the prompt cards keep their size and the list scrolls, so no card is clipped or overlapped', () => {
  assert.match(page, /\.prompts button\{flex:none;/);
});

test('the AWS question is defined once, so the two tabs cannot drift apart', () => {
  assert.equal(page.split(AWS_INTRO.q).length - 1 >= 2, true, 'it appears on the A2A with remote agents button and on the AWS tab');
  assert.doesNotThrow(() => new Function(AWS_TAB_SCRIPT));
  for (const source of [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? '')) assert.doesNotThrow(() => new Function(source));
});
