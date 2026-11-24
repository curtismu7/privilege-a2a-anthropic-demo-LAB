// Story wiring: the lab's own glue between the shared Story engine (web/src/story/, vendored) and this page. It turns the script (storyScript.js) into engine
// steps and gives the engine a `host` that reads and drives the page: the tabs, the question box, the run events, the reel pop-outs. It never edits the page's
// own markup; it clicks the page's own buttons with script-made events (isTrusted is false, so Play for me is not mistaken for the viewer's own input).
//
// The page script announces runs with paad:run-start and paad:run-end ({ ok }): ok is false only when the request itself failed. A question the gateway
// blocks completes normally (the block is in the trace), so it is a run that ended ok.

import { STEPS, P2_SUM, P2_SUM2 } from './storyScript.js';

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
  const waiters = new Set();   // each is (ok, reason) => void
  const timers = new Set();
  const watchers = new Set();  // onRun subscribers: told when a run starts or ends, so the bar can say whose turn it is
  const onStart = () => { runs.starts += 1; watchers.forEach((f) => f()); };
  const onEnd = (e) => {
    runs.ends += 1; runs.lastOk = e.detail ? e.detail.ok !== false : true;
    for (const w of [...waiters]) w(runs.lastOk);
    watchers.forEach((f) => f());
  };
  // A Reset empties the page: a step waiting for a run is told so (and the run's own end, which follows, finds nobody waiting).
  const onReset = () => { for (const w of [...waiters]) w(false, 'The page was reset. Press Next to carry on, or Exit.'); };
  win.addEventListener('paad:run-start', onStart);
  win.addEventListener('paad:run-end', onEnd);
  win.addEventListener('paad:reset', onReset);

  const q = (sel) => doc.querySelector(sel);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const click = (el) => { if (!el || el.disabled) throw new Error('the button is not available'); el.click(); };

  return {
    mode,
    query: q,
    mark: () => ({ starts: runs.starts, ends: runs.ends }),
    runStarted: (m) => runs.starts > m.starts,
    runInFlight: () => runs.starts > runs.ends,
    onRun: (cb) => { watchers.add(cb); return () => watchers.delete(cb); },
    waitForRun(m, timeoutMs) {
      return new Promise((resolve) => {
        const finish = (r) => { clearTimeout(t); timers.delete(t); waiters.delete(check); resolve(r); };
        const done = (ok, reason) => finish(ok ? { ok: true } : { ok: false, reason: reason || 'The run failed. Press Next to carry on, or Exit.' });
        const check = (ok, reason) => { if (reason || runs.ends > m.ends) done(ok, reason); };
        const t = setTimeout(() => finish({ ok: false, reason: 'The run did not finish in time. Press Next to carry on, or Exit.' }), timeoutMs);
        timers.add(t);
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
    dispose() { win.removeEventListener('paad:run-start', onStart); win.removeEventListener('paad:run-end', onEnd); win.removeEventListener('paad:reset', onReset); timers.forEach(clearTimeout); timers.clear(); waiters.clear(); watchers.clear(); },
    _sleep: sleep, _settleMs: settleMs,
  };
}

// ---- finding what a bubble points at
const frameByTitle = (doc, root, title) => [...doc.querySelectorAll(`${root} .reel__frame`)].find((f) => text(f.querySelector('.reel__title')) === title) || null;
const lastOf = (doc, sel) => { const all = doc.querySelectorAll(sel); return all.length ? all[all.length - 1] : null; };
const BLOCKED = /content_blocked|blocked by security policy/i;   // the video's own test for "the gateway blocked it"

// The page-state checks take.py makes before it claims a result. Mock skips the sum checks (its stand-in answers in its own words), as the video's sample does.
function checks(doc, host) {
  const answer = () => text(doc.getElementById('aws-answer'));
  const state = (id) => text(doc.getElementById(`aws-s-${id}`));
  return {
    sum1: () => host.mode() === 'mock' || answer().replace(/,/g, '').includes(P2_SUM),
    sum2: () => host.mode() === 'mock' || (answer().replace(/,/g, '').includes(P2_SUM2) && /even/i.test(answer())),
    refusal: () => answer().startsWith('HTTP 401') && (host.mode() === 'mock' ? state('aws').startsWith('stopped') : state('gateway').startsWith('refused') && state('aws') === 'not reached'),
  };
}

function targetFor(doc, t, host) {
  if (!t) return null;
  if (typeof t === 'string') return t;
  if (t.frame) return () => frameByTitle(doc, t.root, t.frame);
  if (t.lastMessage) {   // the newest chat message, and only if it is an answer: a failed run leaves an error message there
    return () => { const e = lastOf(doc, '#messages .message'); return e && e.classList.contains(t.lastMessage) ? e : null; };
  }
  if (t.selector) {
    const check = t.check ? checks(doc, host)[t.check] : null;
    return () => { const e = doc.querySelector(t.selector); return e && !(t.unless && e.classList.contains(t.unless)) && (!check || check()) ? e : null; };
  }
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
  // The page's Reel builds its dialog once and only hides it on close, so a dialog in the DOM is not an open one.
  const openDialog = () => { const d = doc.querySelector('.reel-dialog'); const bd = d && d.closest('.reel-backdrop'); return d && !(bd && bd.hidden) ? d : null; };
  const section = (dlg) => [...dlg.querySelectorAll('.reel-sec')].find((s) => text(s.querySelector('h4')) === po.section) || dlg;
  return {
    // No such frame in this run: null (the step is skipped). Frame there, pop-out not open yet: the frame itself (the engine's wait for the step ends, then before() opens it).
    target: () => { if (!frameByTitle(doc, po.root, po.frame)) return null; const dlg = openDialog(); return dlg ? section(dlg) : frameByTitle(doc, po.root, po.frame); },
    async before() {
      const frame = frameByTitle(doc, po.root, po.frame);
      if (!frame) return;   // this run has no such frame: the step is skipped quietly; only a frame that will not open is worth a warning
      frame.scrollIntoView({ block: 'nearest' }); frame.click();
      for (let i = 0; i < 30 && !openDialog(); i += 1) await host._sleep(100);
      if (!openDialog()) throw new Error('the pop-out did not open');
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
  const agentAnswer = () => { const e = lastOf(doc, '#messages .message'); return e && e.classList.contains('agent') ? text(e) : ''; };
  const states = () => ['custodian', 'main', 'gateway', 'aws'].map((id) => `${id}: ${text(doc.getElementById(`aws-s-${id}`))}`).join(' · ');
  if (step.askLine) return () => [step.askLine];
  switch (step.lines) {
    case 'redacted': return () => { const t = text(doc.getElementById('trace')); if (!t.includes('REDACTED')) return []; return t.includes('simulated (no model call)') ? ['the recorded shape shows the email as [REDACTED:pii]'] : ['the email came back as [REDACTED:pii]']; };
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

// Steps left out of the walk-through. None now: the observability scene is the live panel (a Story-only bubble), and the video's captured slide is not in the script.
export const NOT_YET = [];

/** The script as engine steps. `captions` is /api/story; it supplies the Mock closing slide's replacement lines. */
export function buildSteps({ captions, host, doc = document, win = window, script = STEPS, notYet = NOT_YET }) {
  let tab;   // a step with no tab of its own belongs to the last tab named before it, so Back always shows the right panel
  return script.filter((s) => !notYet.includes(s.key)).map((s) => {
    if (s.tab) tab = s.tab;
    const step = { key: s.key, type: s.type, trigger: s.trigger, modes: s.modes, sampleKey: s.sampleKey, prefer: s.prefer, place: s.place, fixedSecs: s.fixedSecs, frameTimeoutMs: s.frameTimeoutMs, tab };
    if (s.prompt) step.prompt = s.prompt;
    if (s.when) step.when = CONDITIONS[s.when](doc);
    if (s.type === 'bubble') {
      if (s.target && s.target.open) {   // a <details> to open first (the observability drawer); nothing to close afterwards
        step.before = async () => { const d = doc.querySelector(s.target.open); if (d) d.open = true; await host._sleep(150); };
      }
      if (s.popout) Object.assign(step, popoutHooks(doc, win, s.popout, host));
      else step.target = targetFor(doc, s.target, host);
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
