import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderPage } from '../src/main-agent/ui.js';

const page = renderPage();

test('the example prompts sit behind a toggle that starts closed, so they are not in your face', () => {
  const toggle = page.indexOf('<button type="button" class="prompt-toggle" id="prompt-toggle" aria-expanded="false" aria-controls="prompts">');
  const list = page.indexOf('<div class="prompts" id="prompts"');
  assert.ok(toggle > 0 && list > toggle, 'the toggle comes first, then the list');
  assert.match(page.slice(list, page.indexOf('>', list)), /\shidden$/, 'the list starts hidden');
  assert.ok(page.includes('[hidden]{display:none!important}'), 'hidden really hides it');
});

test('opening and closing: the toggle flips aria-expanded, Escape closes it, and picking a prompt closes it so the answer gets the room', () => {
  assert.ok(page.includes("function setPrompts(open){promptList.hidden=!open;promptToggle.setAttribute('aria-expanded',String(open))}"));
  assert.ok(page.includes("promptToggle.addEventListener('click',()=>setPrompts(promptList.hidden))"));
  assert.ok(page.includes("if(event.key==='Escape'&&!promptList.hidden){setPrompts(false);promptToggle.focus()}"));
  assert.ok(page.includes("button.addEventListener('click',()=>{setPrompts(false);void submit("));
  for (const source of [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? '')) assert.doesNotThrow(() => new Function(source));
});

test('an empty chat says where the prompts went', () => {
  assert.match(page, /#messages:empty::before\{content:"Open Example prompts below, or type your own question\."/);
});
