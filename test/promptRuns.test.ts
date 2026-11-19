import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderPage } from '../src/main-agent/ui.js';
import { AWS_TAB_SCRIPT } from '../src/main-agent/awsTab.js';

const page = renderPage();

test('the form has a Reset button next to Send, wired to resetAll', () => {
  assert.match(page, /<button id="send" type="submit">Send<\/button><button id="reset" type="button"[^>]*data-testid="reset">Reset<\/button><\/form>/);
  assert.ok(page.includes("document.getElementById('reset').addEventListener('click',resetAll)"));
});

test('Reset stops a run in flight and clears the conversation, trace, handoff panel and session', () => {
  const reset = page.slice(page.indexOf('function resetAll(){'), page.indexOf('function lock(on)'));
  for (const part of ['inflight.abort()', "messages.textContent=''", "trace.textContent=''", 'runs=0', 'runBody=null', 'hops=[]', 'models={}', "sessionId=''", "input.value=''", 'lock(false)', 'renderWho()']) {
    assert.ok(reset.includes(part), part);
  }
});

test('each prompt gets a numbered divider on the left and a numbered trace card on the right', () => {
  const start = page.slice(page.indexOf('function startRun(text){'), page.indexOf('function resetAll(){'));
  assert.ok(start.includes("lab.className='turn-label'") && start.includes("lab.textContent='Prompt '+runs"));
  assert.ok(start.includes("sec.className='run'") && start.includes("n.textContent='Prompt '+runs") && start.includes('q.textContent=text'));
  assert.ok(start.includes('trace.appendChild(sec)'));
  assert.ok(page.includes('(runBody||trace).appendChild(el)'), 'trace lines go into the current prompt card');
  assert.ok(!page.includes('trace-separator'), 'the bare rule between runs is gone');
  const submit = page.slice(page.indexOf('async function submit(text){'));
  assert.ok(submit.indexOf('startRun(text)') < submit.indexOf("bubble('user',text)"), 'the divider comes before the prompt bubble');
  assert.match(page, /\.run-h\{position:sticky;top:0/, 'the prompt header stays visible while its trace scrolls');
});

test('while a run is in flight no second request starts: submit, the form and the example prompts all refuse', () => {
  assert.ok(page.includes('async function submit(text){if(inflight||!text.trim())return;lock(true);'));
  assert.ok(page.includes("if(inflight)return;const text=input.value.trim();"), 'Enter does not clear the typed text while busy');
  assert.ok(page.includes("function lock(on){send.disabled=on;document.querySelectorAll('.prompts button').forEach(function(b){b.disabled=on})}"));
  assert.ok(page.includes('signal:ctl.signal'), 'the request can be aborted');
  assert.ok(page.includes('if(ctl.signal.aborted)return;'), 'an aborted run does not report an error');
  assert.ok(page.includes('if(inflight===ctl){inflight=null;lock(false);input.focus()}'), 'a stale run cannot unlock a newer one');
});

test('the AWS tab also refuses a second request while one is running', () => {
  assert.ok(AWS_TAB_SCRIPT.includes('if(!text||send.disabled)return;'));
  assert.ok(AWS_TAB_SCRIPT.includes("function busy(on){send.disabled=on;document.querySelectorAll('.aws__prompts button')"));
  assert.ok(AWS_TAB_SCRIPT.includes('e.preventDefault();if(send.disabled)return;'));
  assert.doesNotThrow(() => new Function(AWS_TAB_SCRIPT));
});

test('every inline script in the page still compiles', () => {
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? '');
  for (const source of scripts) assert.doesNotThrow(() => new Function(source));
});
