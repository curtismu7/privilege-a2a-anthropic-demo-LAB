// demo: privilege-a2a-anthropic-demo-LAB src/main-agent/jsonPane.js
// Client-side port of the shared JsonPane (shared/json/JsonPane.jsx, rule 24) for this lab's
// server-rendered page: no React here, so this is a small vanilla-DOM renderer of the same
// Form | JSON toggle with the hybrid C+A Form view the owner approved (2026-11-19):
// top-level scalars inline; objects/arrays one collapsed section that opens to ONE flat
// dot-path list. Colors come from the same token names; strings are escaped before insertion.
// Re-vendor by copying the .jsx and porting; never hand-edit behavior here without the shared copy.

const JP_HOT = new Set(["sub", "act", "may_act", "aud", "scope", "client_id", "azp", "iss", "cnf", "grant_type", "subject_token", "actor_token", "access_token", "authorization"]);
const JP_ALERT = new Set(["error", "error_description", "detail_code", "outcome", "decision", "verdict", "reason", "note"]);
const JP_SPLIT = new Set(["scope", "aud", "scp"]);
const JP_MAX_CHARS = 150000;
const JP_MAX_DEPTH = 60;

function jpVisible(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function jpParse(text) {
  if (typeof text !== 'string') return undefined;
  const t = text.trim();
  if (!/^[[{]/.test(t)) return undefined;
  try { const v = JSON.parse(t); return (v && typeof v === 'object') ? v : undefined; } catch { return undefined; }
}

function jpPrim(v) { return v === null || typeof v !== 'object'; }
function jpHrefOnly(v) { return v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && typeof v.href === 'string'; }

function jpTime(v, key) {
  if (!/^iat$|^exp$|^nbf$|^auth_time$/.test(key)) return null;
  if (typeof v !== 'number' || v <= 1e9 || v >= 1e11) return null;
  try { return new Date(v * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'; } catch { return null; }
}

function jpKind(v, key) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') {
    if (key === 'scope' || key === 'aud' || key === 'scp') return 'chips';
    if (/^iat$|^exp$|^nbf$|^auth_time$/.test(key)) return 'time';
    if (/^https?:\/\//.test(v)) return 'url';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(v)) return 'id';
    return 'string';
  }
  return 'object';
}

function jpValue(v, key, hot) {
  const kind = jpKind(v, key);
  if (kind === 'null') return '<span class="jform__v jform__v--null">none</span>';
  if (kind === 'bool') return `<span class="jform__chip" data-on="${v ? 'true' : 'false'}">${v ? 'true' : 'false'}</span>`;
  if (kind === 'chips') {
    const items = String(v).trim().split(/\s+/).filter(Boolean);
    if (!items.length) return '<span class="jform__v jform__v--null">none</span>';
    return `<ul class="jform__chips${hot.has(key) ? '" data-hot="true' : ''}">${items.map((x) => `<li class="jform__chip">${jpVisible(x)}</li>`).join('')}</ul>`;
  }
  if (kind === 'time') {
    const d = jpTime(v, key);
    return `<span class="jform__v jform__v--time">${jpVisible(String(v))}${d ? `<span class="jform__sub"> ${d}</span>` : ''}</span>`;
  }
  const typed = typeof v === 'string' && /^(?:\{[\s\S]*\}|\[[\s\S]*\]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)$/.test(v.trim());
  return `<span class="jform__v jform__v--${kind}">${jpVisible(typed ? JSON.stringify(v) : String(v))}</span>`;
}

// Every leaf of a branch as flat dot-path rows (the A half).
function jpFlatRows(value, prefix, hot) {
  const rows = [];
  const walk = (v, p) => {
    if (Array.isArray(v)) {
      if (!v.length) { rows.push({ path: p, empty: '[ ] empty list' }); return; }
      v.forEach((x, i) => walk(x, `${p}[${i}]`));
      return;
    }
    if (v && typeof v === 'object') {
      const entries = Object.entries(v);
      if (!entries.length) { rows.push({ path: p, empty: '{ } no fields' }); return; }
      if (jpHrefOnly(v)) { rows.push({ path: p, v: v.href, k: p }); return; }
      for (const [k, x] of entries) walk(x, p ? `${p}.${k}` : k);
      return;
    }
    rows.push({ path: p, v, k: p });
  };
  walk(value, prefix);
  const base = prefix.split(/[.[]/)[0];
  return `<dl class="jform jform--flat" data-depth="1">${rows.map((r) => {
    const leafKey = r.k ? r.k.split(/[.[]/).pop().replace(/\]$/, '') : '';
    return `<div class="jform__row"${hot.has(base) || hot.has(leafKey) ? ' data-hot="true"' : ''}${JP_ALERT.has(leafKey) ? ' data-alert="true"' : ''}>` +
      `<dt class="jform__k">${jpVisible(r.path)}</dt>` +
      `<dd class="jform__d">${r.empty ? `<span class="jform__v jform__v--null">${r.empty}</span>` : jpValue(r.v, r.k, hot)}</dd></div>`;
  }).join('')}</dl>`;
}

function jpFirstLeaf(value, path = '') {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) { const f = jpFirstLeaf(value[i], `${path}[${i}]`); if (f) return f; }
    return undefined;
  }
  if (value && typeof value === 'object') {
    if (jpHrefOnly(value)) return { v: value.href, k: path };
    for (const [k, v] of Object.entries(value)) { const f = jpFirstLeaf(v, path ? `${path}.${k}` : k); if (f) return f; }
    return undefined;
  }
  return { v: value, k: path };
}

// The C half: a nested object/array is one collapsed line until opened.
function jpSection(value, name, hot) {
  const isArr = Array.isArray(value);
  const count = isArr ? value.length : Object.keys(value).length;
  const noun = isArr ? (count === 1 ? 'item' : 'items') : (count === 1 ? 'field' : 'fields');
  const preview = jpFirstLeaf(value);
  return `<details class="jsec"><summary class="jsec__head"><span class="jsec__caret">▸</span>` +
    `<span class="jsec__name">${jpVisible(name)}</span><span class="jsec__meta">${isArr ? 'array' : 'object'} · ${count} ${noun}</span></summary>` +
    (preview !== undefined && !JP_ALERT.has(name) ? `<span class="jsec__preview">${jpValue(preview.v, preview.k, hot)}</span>` : '') +
    `<div class="jsec__body">${jpFlatRows(value, name, hot)}</div></details>`;
}

function jpForm(value, hot) {
  const entries = Object.entries(value);
  if (!entries.length) return '<span class="jform__v jform__v--null">empty</span>';
  return `<dl class="jform" data-depth="0">${entries.map(([key, v]) => {
    const nested = !jpPrim(v) && !jpHrefOnly(v) && !(Array.isArray(v) && v.every(jpPrim));
    return `<div class="jform__row"${hot.has(key) ? ' data-hot="true"' : ''}${JP_ALERT.has(key) ? ' data-alert="true"' : ''}${nested ? ' data-nested="true"' : ''}>` +
      `<dt class="jform__k">${jpVisible(key)}</dt>` +
      `<dd class="jform__d">${jpPrim(v) ? jpValue(v, key, hot) : jpSection(v, key, hot)}</dd></div>`;
  }).join('')}</dl>`;
}

function jpRaw(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return `<pre class="json json--raw" tabindex="0">${jpVisible(text)}</pre>`;
}

// One pane: a Form | JSON toggle over the payload. Returns an element.
// `openOn` is the starting view ("form" or "json"); a JSON string payload is shown
// byte-for-byte in the JSON view (never re-serialized) and parsed in the Form view.
function jsonPane(value, label, openOn = 'form') {
  const fromText = typeof value === 'string' ? jpParse(value) : undefined;
  const data = fromText !== undefined ? fromText : value;
  const isJson = data && typeof data === 'object' && (typeof value !== 'string' || fromText !== undefined);
  const text = typeof value === 'string' ? value : JSON.stringify(data, null, 2);

  const box = document.createElement('div');
  box.className = 'jsonbox';
  if (text.length > JP_MAX_CHARS || !isJson) {
    box.innerHTML = jpRaw(value);
    return box;
  }
  const hot = new Set([...JP_HOT]);
  let view = openOn === 'json' ? 'json' : 'form';
  const body = () => {
    const wrap = document.createElement('div');
    wrap.className = 'json json--form';
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', label || 'JSON');
    if (view === 'form') wrap.innerHTML = jpForm(data, hot);
    else wrap.innerHTML = jpRaw(value);
    return wrap;
  };
  const toggle = document.createElement('span');
  toggle.className = 'jsonbox__toggle';
  toggle.setAttribute('role', 'group');
  toggle.setAttribute('aria-label', `${label || 'JSON'} view`);
  const formBtn = document.createElement('button');
  formBtn.type = 'button';
  formBtn.textContent = 'Form';
  const jsonBtn = document.createElement('button');
  jsonBtn.type = 'button';
  jsonBtn.textContent = 'JSON';
  const paint = () => {
    formBtn.setAttribute('aria-pressed', view === 'form' ? 'true' : 'false');
    jsonBtn.setAttribute('aria-pressed', view === 'json' ? 'true' : 'false');
    const old = box.querySelector('.json');
    if (old) old.remove();
    box.appendChild(body());
  };
  formBtn.addEventListener('click', () => { view = 'form'; paint(); });
  jsonBtn.addEventListener('click', () => { view = 'json'; paint(); });
  toggle.append(formBtn, jsonBtn);
  box.appendChild(toggle);
  paint();
  return box;
}

// Trace adapter: replace a <div class="trace-detail"> that holds JSON-looking text
// with a pane. Called after a trace line is appended.
function jsonPaneIfJson(detailEl) {
  var text = detailEl.textContent || '';
  var t = text.trim();
  if (!/^[[{]/.test(t)) return;
  var parsed; try { parsed = JSON.parse(t); } catch (e) { return; }
  if (!parsed || typeof parsed !== 'object') return;
  var pane = jsonPane(text, 'Trace detail', 'form');
  pane.classList.add('trace-detail-pane');
  detailEl.replaceWith(pane);
}
