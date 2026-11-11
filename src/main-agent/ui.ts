import { readFileSync } from 'node:fs';

// The way back to Customer Agent LAB (?from=customer-agent&uc=&vertical=): the vendored shared return-link logic (src/vendor/return-link,
// copied to dist by `npm run build`), inlined as a classic script with its `export` keywords removed. The target comes only from its fixed
// list, never from the address bar. UC46, UC46A and UC47 route here; the page has no scenario or vertical picker, so it shows the strip
// and the header button only (no preselect).
export const RETURN_LINK_APP = 'privilege-a2a-anthropic-demo';
export const RETURN_LINK_SOURCE = readFileSync(new URL('../vendor/return-link/returnTargets.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const RETURN_LINK_SCRIPT = `(function(){${RETURN_LINK_SOURCE}
var l=returnLinkFor('${RETURN_LINK_APP}');if(!l)return;
function back(cls){var b=document.createElement('button');b.type='button';b.className=cls;b.textContent='\u2190 Back to '+l.label;b.title='Back to '+l.label+' (use case '+l.uc+')';b.addEventListener('click',function(){window.location.assign(l.href)});return b}
var s=document.createElement('div');s.className='return-link return-link--strip';s.setAttribute('role','note');s.setAttribute('aria-label','Opened from '+l.label);
var x=document.createElement('span');x.textContent='Opened from '+l.label+' \u00b7 '+l.uc+(l.vertical?' \u00b7 '+l.vertical:'');s.appendChild(x);s.appendChild(back('return-link-back'));
var h=document.querySelector('header');h.parentNode.insertBefore(s,h.nextSibling);h.appendChild(back('return-link return-link--header'));})();`;

export function renderPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Access Review — Privilege A2A</title>
<style>
/* vendored shared standard (standalone-ui.css, inlined: the UI is one server-rendered document) */
/*
  standalone-ui.css: the shared UI standard for every -LAB app.
  Canonical copy lives in AI-DEMO-Standalone/shared/. Each app vendors an identical copy
  (check with scripts/check-ui-standard.sh). Do not edit a vendored copy; change this file.

  Tokens come from the Ping brand palette.
  Light is the default. Dark follows the system setting unless data-theme is set.
  Montserrat for text, IBM Plex Mono for code. Emphasis is heavier weight, never italics.
  Every unselected control has a visible border at 3:1 or more in both themes.
*/

:root {
  color-scheme: light;
  --bg: #fcfcfc;
  --surface: #ffffff;
  --surface-2: #eff0f1;
  --text: #051727;
  --text-body: #263746;
  --muted: #556070;            /* 6.4:1 on surface */
  --border: #556070;           /* 6.4:1 on surface (needs 3:1) */
  --accent: #d20e0f;           /* white text on it: 5.5:1 */
  --accent-deep: #aa0005;
  --on-accent: #ffffff;
  --accent-soft: #fde8e8;
  --focus: #12538d;
  --danger-text: #aa0005;
  --accent-gradient: linear-gradient(90deg, #d20e0f 55%, #aa0005);
  --status-ok: #1d7a43;              /* semantic green: status dots */
  --on-accent-border: rgba(255, 255, 255, 0.35); /* thin border or spinner ring drawn on the accent */
  --primary-edge: transparent;       /* edge of button.primary; dark themes set it so the deep red end meets 3:1 */
  --bg-lab: var(--bg);               /* per-app page background; apps use background: var(--bg-lab), never a colour */
  --status-warn: #8a5a00;            /* semantic amber: pending, slow, expired. 5.9:1 on --surface */
  --status-info: #12538d;            /* semantic blue: informational. 8:1 on --surface */
  --shadow-ink: rgba(5, 23, 39, 0.16); /* neutral ink for box shadows */
  --box-dark: #051727;               /* diagram box fills: dark in BOTH themes, with --on-box text */
  --box-blue: #12538d;
  --box-grey: #3e4f60;
  --box-red: #aa0005;
  --on-box: #fcfcfc;
  --font-primary: "Montserrat", -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, Menlo, monospace;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --bg: #051727;
    --surface: #172033;
    --surface-2: #0f2236;
    --text: #fcfcfc;
    --text-body: #e0e2e4;
    --muted: #909ea4;          /* 5.9:1 on surface */
    --border: #909ea4;         /* 5.9:1 on surface */
    --primary-edge: #909ea4;
    --status-warn: #f0b34c;
    --status-info: #8fbcff;
    --shadow-ink: rgba(0, 0, 0, 0.5);
    --accent-soft: #3a1213;
    --focus: #fcfcfc;
    --danger-text: #fca5a5;
    --status-ok: #7fd1a0;
  }
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #051727;
  --surface: #172033;
  --surface-2: #0f2236;
  --text: #fcfcfc;
  --text-body: #e0e2e4;
  --muted: #909ea4;
  --border: #909ea4;
  --primary-edge: #909ea4;
  --status-warn: #f0b34c;
  --status-info: #8fbcff;
  --shadow-ink: rgba(0, 0, 0, 0.5);
  --accent-soft: #3a1213;
  --focus: #fcfcfc;
  --danger-text: #fca5a5;
  --status-ok: #7fd1a0;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg-lab);
  color: var(--text-body);
  font-family: var(--font-primary);
  font-size: 14px;
  line-height: 1.5;
  padding-left: max(16px, env(safe-area-inset-left, 0px));
  padding-right: max(16px, env(safe-area-inset-right, 0px));
}

h1, h2, h3 {
  color: var(--text);
  font-weight: 700;
}

code,
pre,
.mono {
  font-family: var(--font-mono);
}

[hidden] {
  display: none !important;
}

/* Simulation or status banner, shown on every page. */
.banner {
  margin: 12px 0 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-left: 4px solid var(--accent);
  border-radius: 8px;
  background: var(--surface-2);
  color: var(--text);
  font-size: 13px;
}

/* Live mode: the banner edge changes colour so a live page never looks simulated. */
.banner[data-state="live"] {
  border-left-color: var(--focus);
}

/* Controls: every unselected control has a visible border. */
input,
textarea,
select,
button {
  max-width: 100%;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  font: inherit;
  font-weight: 600;
  min-height: 40px;
}

input::placeholder,
textarea::placeholder {
  color: var(--muted);
  font-weight: 400;
}

button {
  cursor: pointer;
}

button:disabled {
  opacity: 0.75;
  cursor: not-allowed;
}

/* A disabled primary keeps its label readable: white text on the faded red stays at 4.5:1 or more. */
button.primary:disabled {
  opacity: 0.88;
}

/* Primary action: the Ping Red gradient, white text. Add class="primary". */
button.primary {
  background: var(--accent-gradient);
  color: var(--on-accent);
  border-color: var(--primary-edge);
}

/* Selected tab or toggle: filled accent. Set aria-selected="true" or aria-pressed="true". */
button[aria-selected="true"],
button[aria-pressed="true"] {
  background: var(--accent);
  color: var(--on-accent);
  border-color: var(--accent);
}

:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 2px;
}

/* Phone width: no horizontal scroll. Layout grids drop to one column. */
@media (max-width: 600px) {
  body {
    font-size: 14px;
  }
}

@media (prefers-reduced-motion: reduce) {
  * {
    transition: none !important;
    animation: none !important;
  }
}

/* ===== Diagrams (owner-approved 2026-11-03, mock: shared/device-diagram-color-mock.html) =====
   The outline + stripe box look, shared by every lab's ReactFlow diagrams (rule 17/5).
   Roles: dark = lab/neutral, blue = PingOne/IAM, green = person/success, red = Ping Red
   (active/deny), amber = warning, grey = external. Layout stays in each app's stylesheet;
   this file owns the colors. Dark stripes use saturated brand colors (--dg-*), never
   the near-white --text/--focus. */
:root {
  --dg-dark: var(--text);
  --dg-blue: var(--focus);
  --dg-green: var(--status-ok);
  --dg-red: var(--accent);
  --dg-grey: var(--muted);
  --dg-amber: var(--status-warn);
  --dg-stripe: 10px;
}
:root[data-theme="dark"],
:root:not([data-theme="light"]) {
  --dg-dark: var(--box-blue);
  --dg-blue: var(--status-info);
  --dg-green: #4cc26b;
  --dg-red: var(--accent);
  --dg-grey: var(--muted);
  --dg-amber: var(--status-warn);
}
.dg-node {
  padding: 8px 12px 8px 12px;
  border-radius: 4px;
  background: var(--surface);
  color: var(--text);
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 2px solid var(--border);
  border-left-width: var(--dg-stripe);
}
.dg-node strong { font-weight: 700; }
.dg-node span { font-size: 12px; overflow-wrap: anywhere; color: var(--text-body); }
.dg-node.hot { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.dg-dark  { border-left-color: var(--dg-dark); }
.dg-blue  { border-left-color: var(--dg-blue); }
.dg-green { border-left-color: var(--dg-green); }
.dg-red   { border-left-color: var(--dg-red); }
.dg-grey  { border-left-color: var(--dg-grey); }
.dg-amber { border-left-color: var(--dg-amber); }
.dg-now {
  background: var(--surface-2);
  color: var(--text);
  border-left: 4px solid var(--accent);
  padding: 6px 10px;
}
.dg-now b { color: var(--accent); }
.edge-on .react-flow__edge-path { stroke: var(--accent); }
.react-flow__edge.edge-dim { opacity: 0.3; }

/* ===== Shelf link (owner request 2026-11-05): the "Shelf" button in every app's header =====
   Opens the launcher (demo shelf) in a new tab. The URL comes from GET /api/shelf, which
   reads SHELF_URL from the shared settings file written by scripts/bootstrap.sh. */
.shelf-link {
  display: inline-flex;
  align-items: center;
  min-height: 40px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-weight: 600;
  text-decoration: none;
}
.shelf-link:hover { border-color: var(--accent); }
.shelf-link:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }

*{box-sizing:border-box}body{margin:0;height:100vh;display:flex;flex-direction:column;background:#10131b;color:#e8eaf0;font:1rem system-ui,sans-serif}
header{display:flex;align-items:center;gap:.7rem;padding:1rem 1.25rem;border-bottom:1px solid #34394a;flex-wrap:wrap}h1{font-size:1.15rem;margin:0;color:#c4b5fd}header .banner{font-size:.72rem;padding:.35rem .6rem;border:1px solid #4a5063;border-left:3px solid #8976ef;border-radius:.5rem;color:#e8eaf0;background:#171b25;max-width:34rem;text-align:left}.pill{font-size:.78rem;padding:.25rem .65rem;border:1px solid #4a5063;border-radius:2rem;color:#e8eaf0}.pill.gw{border-color:#287451;color:#a7f3d0}.pill.direct{border-color:#9a6b13;color:#fde68a}
main{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) 25rem}#chat{display:flex;flex-direction:column;min-height:0}#messages{flex:1;overflow:auto;padding:1.25rem;display:flex;flex-direction:column;gap:.8rem}.message{max-width:52rem;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5;padding:.75rem 1rem;border-radius:.8rem}.user{align-self:flex-end;background:#33347c}.agent{align-self:flex-start;background:#202434;border:1px solid #41475a}.error{align-self:flex-start;background:#421f24;border:1px solid #aa515c}.prompts{display:flex;gap:.5rem;flex-wrap:wrap;padding:.75rem 1.25rem;border-top:1px solid #34394a}.prompts button,form button{border:1px solid #6254ba;border-radius:.5rem;background:#3d3285;color:#fff;padding:.6rem .8rem;cursor:pointer;font:inherit}.prompts button:hover,form button:hover{background:#5243a9}form{display:flex;gap:.6rem;padding:1rem 1.25rem;border-top:1px solid #34394a}input{flex:1;min-width:0;border:1px solid #4a5063;border-radius:.5rem;background:#171b25;color:#fff;padding:.7rem .8rem;font:inherit}input:focus{outline:2px solid #8976ef}button:disabled{opacity:.6;cursor:wait}#tracePane{display:flex;flex-direction:column;min-height:0;border-left:1px solid #34394a;background:#0d1017}#tracePane h2{font-size:.8rem;letter-spacing:.08em;text-transform:uppercase;margin:0;padding:1rem;border-bottom:1px solid #34394a;color:#ddd6fe}#trace{flex:1;overflow:auto;padding:.8rem;display:flex;flex-direction:column;gap:.55rem}.trace{border-left:2px solid #555c70;padding:.25rem .5rem;color:#e8eaf0;font-size:.82rem}.trace.delegate{border-color:#9888ff}.trace.mcp-call{border-color:#28b8d3}.trace.mcp-result,.trace.result{border-color:#35a87b}.trace.error{border-color:#e36a6a}.trace-detail{margin-top:.2rem;color:#d7dbe5;font-family:ui-monospace,monospace;font-size:.75rem;white-space:pre-wrap;overflow-wrap:anywhere}.trace-at{float:right;color:#b8bfd0;font-variant-numeric:tabular-nums}
.trace-separator{width:100%;border:0;border-top:1px solid #34394a}
@media(max-width:850px){main{grid-template-columns:1fr}#tracePane{display:none}}
shell-theme select{border:1px solid #4a5063;border-radius:.5rem;background:#171b25;color:#fff;padding:.25rem .4rem;font:inherit;font-size:.78rem}
/* Just the dancing P while an answer is pending: the same small lift and tilt as the main app's loading mark. */
.dancing-p{width:40px;height:40px;vertical-align:middle;animation:dancing-p 1.4s ease-in-out infinite}
.wait-secs{margin-left:10px;color:var(--text-muted,inherit);font-variant-numeric:tabular-nums}
@keyframes dancing-p{0%,100%{transform:translate(0,0) rotate(0deg) scale(1)}18%{transform:translate(-2px,-3px) rotate(-5deg) scale(1.02)}36%{transform:translate(2px,1px) rotate(4deg) scale(.98)}55%{transform:translate(-1px,-2px) rotate(0deg) scale(1.01)}74%{transform:translate(2px,0) rotate(4deg) scale(.99)}}
@media (prefers-reduced-motion:reduce){.dancing-p{animation:none}}
.return-link--strip{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin:0;padding:8px 12px;border:1px solid var(--border);border-left:4px solid var(--focus);background:var(--surface);color:var(--text);font-size:13px;overflow-wrap:anywhere}
</style>
<script>(function(){var t=localStorage.getItem('paad.theme');if(t&&t!=='auto')document.documentElement.dataset.theme=t;})();</script>
</head>
<body>
<header><h1>Access Review</h1><span class="banner" role="note">SIMULATED: agents, A2A handoff and the MCP hop are a local simulation; nothing here is a real tenant.</span><span class="pill" id="mode">Connecting</span><span class="pill" id="model"></span><span class="pill" id="worker"></span><div class="mode-toggle" role="group" aria-label="Mode: Mock (heuristics) or Real (model call)"><button type="button" id="mode-mock" aria-pressed="true" data-testid="mode-mock">Mock</button><button type="button" id="mode-real" aria-pressed="false" data-testid="mode-real" title="Real sends every question to the configured model provider. Mock answers with the built-in heuristics: no model call.">Real</button></div><label class="shell-theme">Theme <select id="theme-select"><option value="auto">Auto</option><option value="light">Light</option><option value="dark">Dark</option></select></label></header>
<main><section id="chat"><div id="messages"></div><div class="prompts"><button type="button">Review access on prod-db-primary</button><button type="button">List all entitlements for Carol Nguyen</button><button type="button">Who is offboarding and still has active access?</button></div><form id="form"><input id="input" autocomplete="off" placeholder="Ask who has access to what"><button id="send" type="submit">Send</button></form></section><aside id="tracePane"><h2>Request trace</h2><div id="trace"></div></aside></main>
<script>
const messages=document.getElementById('messages');const trace=document.getElementById('trace');const form=document.getElementById('form');const input=document.getElementById('input');const send=document.getElementById('send');let sessionId='';
function bubble(cls,text){const el=document.createElement('div');el.className='message '+cls;el.textContent=text;messages.appendChild(el);messages.scrollTop=messages.scrollHeight;return el}
function traceLine(t){const el=document.createElement('div');el.className='trace '+(t.kind||'');const head=document.createElement('div');head.textContent=t.text||'';const at=document.createElement('span');at.className='trace-at';at.textContent=t.at||'';head.appendChild(at);el.appendChild(head);if(t.detail){const d=document.createElement('div');d.className='trace-detail';d.textContent=t.detail;el.appendChild(d)}trace.appendChild(el);trace.scrollTop=trace.scrollHeight}
fetch('/api/shelf',{credentials:'omit',headers:{Accept:'application/json'}}).then(r=>r.ok?r.json():null).then(d=>{if(!d||!d.shelfUrl)return;const a=document.createElement('a');a.className='shelf-link';a.href=d.shelfUrl;a.target='_blank';a.rel='noreferrer';a.title='Open the demo shelf (launcher)';a.textContent='Shelf';document.querySelector('header').appendChild(a)}).catch(()=>{});
fetch('/status').then(r=>r.json()).then(s=>{const mode=document.getElementById('mode');mode.textContent=s.viaGateway?'via Privilege':s.mode;mode.className='pill '+(s.viaGateway?'gw':'direct');document.getElementById('model').textContent=s.mainModel;document.getElementById('worker').textContent='A2A '+(s.bearerOnA2A?'Bearer configured':'local')}).catch(()=>{});
// Rule 19: Mock/Real switch. Mock = heuristics (no model call); Real = the model provider. The server switches at runtime (POST /api/mode).
(function(){var mk=document.getElementById('mode-mock'),rk=document.getElementById('mode-real');var uiMode='mock';
function paint(m){uiMode=m;mk.setAttribute('aria-pressed',String(m==='mock'));rk.setAttribute('aria-pressed',String(m==='real'))}
fetch('/api/info').then(r=>r.json()).then(i=>{paint(i.mode);if(i.realAvailable===false){rk.disabled=true;rk.title=i.realReason||rk.title}}).catch(function(){});
function choose(w){fetch('/api/mode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:w})}).then(r=>r.json().then(d=>({ok:r.ok,d:d}))).then(res=>{if(res.ok)paint(res.d.mode);else alert(res.d.message||res.d.error||'The mode was not changed.')}).catch(e=>alert('Could not switch mode: '+e.message))}
mk.addEventListener('click',function(){choose('mock')});rk.addEventListener('click',function(){choose('real')});
window.__uiMode=function(){return uiMode}})();
function startWait(el){const started=Date.now();const img=document.createElement('img');img.className='dancing-p';img.alt='';img.setAttribute('aria-hidden','true');img.src='data:image/png;base64,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';const secs=document.createElement('span');secs.className='wait-secs';secs.setAttribute('role','status');el.textContent='';el.appendChild(img);el.appendChild(secs);const tick=()=>{const n=Math.floor((Date.now()-started)/1000);secs.textContent='Working '+n+'s'+(n>=15?' - a model call can take 10 to 30 seconds':'')};tick();return setInterval(tick,1000)}
async function submit(text){if(!text.trim())return;send.disabled=true;bubble('user',text);const pending=bubble('agent','');const wait=startWait(pending);if(trace.children.length){const sep=document.createElement('hr');sep.className='trace-separator';trace.appendChild(sep)}let answer='';try{const response=await fetch('/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,sessionId,mode:window.__uiMode?window.__uiMode():undefined})});if(!response.ok||!response.body)throw new Error('HTTP '+response.status);const reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';while(true){const part=await reader.read();if(part.done)break;buffer+=decoder.decode(part.value,{stream:true});let split=buffer.indexOf('\\n\\n');while(split>=0){const frame=buffer.slice(0,split);buffer=buffer.slice(split+2);let event='message';let data='';for(const line of frame.split('\\n')){if(line.startsWith('event: '))event=line.slice(7);else if(line.startsWith('data: '))data+=line.slice(6)}if(data){const payload=JSON.parse(data);if(event==='token'){answer+=payload.text;pending.textContent=answer}else if(event==='trace'){traceLine(payload)}else if(event==='done'){sessionId=payload.sessionId}else if(event==='error'){pending.className='message error';pending.textContent=payload.error;answer='error'}}split=buffer.indexOf('\\n\\n')}}if(!answer&&pending.className==='message agent')pending.textContent='The request completed without a text reply.'}catch(error){pending.className='message error';pending.textContent='Request failed: '+error.message}finally{clearInterval(wait);send.disabled=false;input.focus()}}
form.addEventListener('submit',event=>{event.preventDefault();const text=input.value.trim();input.value='';void submit(text)});document.querySelectorAll('.prompts button').forEach(button=>button.addEventListener('click',()=>void submit(button.textContent||'')));
var themeSel=document.getElementById('theme-select');themeSel.value=localStorage.getItem('paad.theme')||'auto';themeSel.addEventListener('change',function(){var v=themeSel.value;if(v==='auto')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=v;localStorage.setItem('paad.theme',v)});
</script>
<script>${RETURN_LINK_SCRIPT}</script>
</body>
</html>`;
}
