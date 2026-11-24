// Story wiring: the lab's own glue between the shared Story engine (web/src/story/, vendored) and this page. It turns the script (storyScript.js) into engine
// steps and gives the engine a `host` that reads and drives the page: the tabs, the question box, the run events, the reel pop-outs. It never edits the page's
// own markup; it clicks the page's own buttons with script-made events (isTrusted is false, so Play for me is not mistaken for the viewer's own input).
//
// The page script announces runs with paad:run-start and paad:run-end ({ ok }): ok is false only when the request itself failed. A question the gateway
// blocks completes normally (the block is in the trace), so it is a run that ended ok.

import { STEPS } from './storyScript.js';

const INPUTS = { review: { input: '#input', send: '#send' }, aws: { input: '#aws-input', send: '#aws-send' } };
const text = (el) => (el && el.textContent ? el.textContent.trim() : '');

/** The first sentence, never cut mid-word (the video's first_sentence). */
export function firstSentence(s, limit = 150) {
  let t = String(s || '').trim().split('\n')[0] || '';
  const cut = t.indexOf('. ');
  if (cut > 0) t = t.slice(0, cut + 1);
  if (t.length <= limit) return t;
  const head = t.slice(0, limit);
  const sp = head.lastIndexOf(' ');
  return `${sp > 0 ? head.slice(0, sp) : head}...`;
}

export function createHost({ win = window, doc = document, mode = () => 'mock', settleMs = 500 } = {}) {
  const runs = { starts: 0, ends: 0, lastOk: true };
  const waiters = new Set();
  const onStart = () => { runs.starts += 1; };
  const onEnd = (e) => {
    runs.ends += 1; runs.lastOk = e.detail ? e.detail.ok !== false : true;
    for (const w of [...waiters]) w(runs.lastOk);
  };
  win.addEventListener('paad:run-start', onStart);
  win.addEventListener('paad:run-end', onEnd);

  const q = (sel) => doc.querySelector(sel);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const click = (el) => { if (!el || el.disabled) throw new Error('the button is not available'); el.click(); };

  return {
    mode,
    query: q,
    mark: () => ({ starts: runs.starts, ends: runs.ends }),
    runStarted: (m) => runs.starts > m.starts,
    waitForRun(m, timeoutMs) {
      return new Promise((resolve) => {
        const done = (ok) => { clearTimeout(t); waiters.delete(check); resolve(ok ? { ok: true } : { ok: false, reason: 'The run failed. Press Next to carry on, or Exit.' }); };
        const check = (ok) => { if (runs.ends > m.ends) done(ok); };
        const t = setTimeout(() => { waiters.delete(check); resolve({ ok: false, reason: 'The run did not finish in time. Press Next to carry on, or Exit.' }); }, timeoutMs);
        if (runs.ends > m.ends) { done(runs.lastOk); return; }
        waiters.add(check);
      });
    },
    prefill(step) {
      if (!step.prompt || !step.prompt.text) return;
      const input = q(step.target);
      if (!input) return;
      input.value = step.prompt.text;
      input.dispatchEvent(new win.Event('input', { bubbles: true }));
    },
    send(step) {
      if (step.prompt && step.prompt.press) { click(q(step.prompt.press)); return; }
      click(q(INPUTS[step.tab || (q('#panel-aws:not([hidden])') ? 'aws' : 'review')].send));
    },
    switchTab(tab) {
      const el = q(`#tab-${tab}`);
      if (el && el.getAttribute('aria-selected') !== 'true') el.click();
    },
    assetUrl: () => null,   // no screenshot ships; a slide is text-only
    dispose() { win.removeEventListener('paad:run-start', onStart); win.removeEventListener('paad:run-end', onEnd); waiters.clear(); },
    _sleep: sleep, _settleMs: settleMs,
  };
}

// ---- finding what a bubble points at
const frameByTitle = (doc, root, title) => [...doc.querySelectorAll(`${root} .reel__frame`)].find((f) => text(f.querySelector('.reel__title')) === title) || null;
const lastOf = (doc, sel) => { const all = doc.querySelectorAll(sel); return all.length ? all[all.length - 1] : null; };
const BLOCKED = /content_blocked|blocked by security policy/i;   // the video's own test for "the gateway blocked it"

function targetFor(doc, t) {
  if (!t) return null;
  if (typeof t === 'string') return t;
  if (t.frame) return () => frameByTitle(doc, t.root, t.frame);
  if (t.selector) return () => { const e = doc.querySelector(t.selector); return e && !(t.unless && e.classList.contains(t.unless)) ? e : null; };
  if (t.last) {
    return () => {
      if (t.only === 'blocked' && !BLOCKED.test(text(doc.getElementById('trace')))) return null;   // do not call a failed run a block
      return lastOf(doc, t.last) || (t.fallback ? lastOf(doc, t.fallback) : null);
    };
  }
  return null;
}

// ---- the reel pop-outs: open a frame's detail, point at one section of it, close it again
function popoutHooks(doc, win, po, host) {
  let scrollTimer = null;
  const section = () => [...doc.querySelectorAll('.reel-sec')].find((s) => text(s.querySelector('h4')) === po.section) || doc.querySelector('.reel-dialog');
  return {
    target: () => section(),
    async before() {
      const frame = frameByTitle(doc, po.root, po.frame);
      if (!frame) return;   // this run has no such frame: the step is skipped quietly (its target is missing); only a frame that will not open is worth a warning
      frame.scrollIntoView({ block: 'nearest' }); frame.click();
      for (let i = 0; i < 30 && !doc.querySelector('.reel-dialog'); i += 1) await host._sleep(100);
      if (!doc.querySelector('.reel-dialog')) throw new Error('the pop-out did not open');
      await host._sleep(host._settleMs);
      if (po.scrollAfter) {   // a long table: scroll the pop-out while the bubble is up, so the rest is seen
        scrollTimer = setTimeout(() => { const b = doc.querySelector('.reel-dialog__body'); if (b && b.scrollTo) b.scrollTo({ top: b.scrollHeight, behavior: 'smooth' }); }, po.scrollAfter * 1000);
      }
    },
    after() { clearTimeout(scrollTimer); if (win.Reel && win.Reel.close) win.Reel.close(); },
  };
}

// ---- the live fact lines a bubble shows (what the video's take read from the page)
function linesFor(doc, step) {
  const agentAnswer = () => text(lastOf(doc, '#messages .message.agent'));
  const states = () => ['custodian', 'main', 'gateway', 'aws'].map((id) => `${id}: ${text(doc.getElementById(`aws-s-${id}`))}`).join(' · ');
  if (step.askLine) return () => [step.askLine];
  switch (step.lines) {
    case 'redacted': return () => (text(doc.getElementById('trace')).includes('REDACTED') ? ['the email came back as [REDACTED:pii]'] : []);
    case 'answer1': return () => [firstSentence(agentAnswer())];
    case 'routeMode': return () => [firstSentence(text(doc.getElementById('aws-mode')))];
    case 'answeredIn': return () => { const at = text(doc.querySelector('#aws-trace li[data-kind=result] .aws__at')); return at ? [`answered in ${at}`] : []; };
    case 'flowStates': return () => [states()];
    case 'answer2': return () => [firstSentence(text(doc.getElementById('aws-answer')))];
    default: return undefined;
  }
}

// ---- conditions
const CONDITIONS = {
  // The token and sign-in-metadata frames exist only on the live route (the video's own condition).
  awsLive: (doc) => () => text(doc.getElementById('aws-mode')).startsWith('LIVE'),
};

// Steps left out until their wording and wiring are checked in the browser (the next slice): the observability slide is the live panel, not a captured image.
export const NOT_YET = ['observability'];

/** The script as engine steps. `captions` is /api/story; it supplies the Mock closing slide's replacement lines. */
export function buildSteps({ captions, host, doc = document, win = window, script = STEPS, notYet = NOT_YET }) {
  return script.filter((s) => !notYet.includes(s.key)).map((s) => {
    const step = { key: s.key, type: s.type, trigger: s.trigger, modes: s.modes, sampleKey: s.sampleKey, prefer: s.prefer, place: s.place, fixedSecs: s.fixedSecs, frameTimeoutMs: s.frameTimeoutMs, tab: s.tab };
    if (s.prompt) step.prompt = s.prompt;
    if (s.when) step.when = CONDITIONS[s.when](doc);
    if (s.type === 'bubble') {
      if (s.popout) Object.assign(step, popoutHooks(doc, win, s.popout, host));
      else step.target = targetFor(doc, s.target);
      const lines = linesFor(doc, s);
      if (lines) step.lines = lines;
    }
    if (s.key === 'closing') {   // the simulated run never claims a live one: its two replaced lines come from the Mock wording
      step.transform = (slide, mode) => (mode === 'mock'
        ? { ...slide, lead: captions.steps.sample_closing_lead.text, colA: { ...slide.colA, lines: [captions.steps.sample_closing_bullet.text, ...slide.colA.lines.slice(1)] } }
        : slide);
    }
    return step;
  });
}
