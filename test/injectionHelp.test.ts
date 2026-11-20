import assert from 'node:assert/strict';
import { test } from 'node:test';

import { INJECTION_HELP_TEXT, renderPage } from '../src/main-agent/ui.js';

const page = renderPage();
const promptsBlock = page.slice(page.indexOf('<div class="prompts"'), page.indexOf('<form id="form">'));

test('the fifth card explains the injection demo and sends nothing to an agent', () => {
  const buttons = [...promptsBlock.matchAll(/<button type="button"[^>]*>/g)].map((m) => m[0]);
  assert.equal(buttons.length, 5);
  assert.match(buttons[4], /class="p-help" data-help="injection"/);
  assert.ok(!buttons[4].includes('data-q='), 'it carries no question to send');
  assert.ok(page.includes("if(button.dataset.help){bubble('agent',injectionHelp);return}void submit("), 'the help branch returns before submit');
});

test('the help text names the real switches and the real cause', () => {
  assert.match(INJECTION_HELP_TEXT, /mcpdemo/);
  assert.match(INJECTION_HELP_TEXT, /MCP_DEMO_INJECTION=true/);
  assert.match(INJECTION_HELP_TEXT, /kubectl --context us -n ping-devops-cmuir set env deploy\/mcpdemo MCP_DEMO_INJECTION=false/);
  assert.match(INJECTION_HELP_TEXT, /worker-agent key/);
  assert.match(INJECTION_HELP_TEXT, /Block to Alert/);
  assert.ok(page.includes('const injectionHelp=' + JSON.stringify(INJECTION_HELP_TEXT) + ';'), 'the page carries exactly that text');
  for (const source of [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? '')) assert.doesNotThrow(() => new Function(source));
});

test('the first card says a refusal is expected and points at the how-to card', () => {
  assert.ok(promptsBlock.includes('Expect a refusal on the data call here'));
  assert.ok(promptsBlock.includes('the last card says how to change that'));
});
