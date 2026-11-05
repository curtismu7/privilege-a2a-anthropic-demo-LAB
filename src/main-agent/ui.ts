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
</style>
</head>
<body>
<header><h1>Access Review</h1><span class="banner" role="note">SIMULATED: agents, A2A handoff and the MCP hop are a local simulation; nothing here is a real tenant.</span><span class="pill" id="mode">Connecting</span><span class="pill" id="model"></span><span class="pill" id="worker"></span></header>
<main><section id="chat"><div id="messages"></div><div class="prompts"><button type="button">Review access on prod-db-primary</button><button type="button">List all entitlements for Carol Nguyen</button><button type="button">Who is offboarding and still has active access?</button></div><form id="form"><input id="input" autocomplete="off" placeholder="Ask who has access to what"><button id="send" type="submit">Send</button></form></section><aside id="tracePane"><h2>Request trace</h2><div id="trace"></div></aside></main>
<script>
const messages=document.getElementById('messages');const trace=document.getElementById('trace');const form=document.getElementById('form');const input=document.getElementById('input');const send=document.getElementById('send');let sessionId='';
function bubble(cls,text){const el=document.createElement('div');el.className='message '+cls;el.textContent=text;messages.appendChild(el);messages.scrollTop=messages.scrollHeight;return el}
function traceLine(t){const el=document.createElement('div');el.className='trace '+(t.kind||'');const head=document.createElement('div');head.textContent=t.text||'';const at=document.createElement('span');at.className='trace-at';at.textContent=t.at||'';head.appendChild(at);el.appendChild(head);if(t.detail){const d=document.createElement('div');d.className='trace-detail';d.textContent=t.detail;el.appendChild(d)}trace.appendChild(el);trace.scrollTop=trace.scrollHeight}
fetch('/status').then(r=>r.json()).then(s=>{const mode=document.getElementById('mode');mode.textContent=s.viaGateway?'via Privilege':s.mode;mode.className='pill '+(s.viaGateway?'gw':'direct');document.getElementById('model').textContent=s.mainModel;document.getElementById('worker').textContent='A2A '+(s.bearerOnA2A?'Bearer configured':'local')}).catch(()=>{});
async function submit(text){if(!text.trim())return;send.disabled=true;bubble('user',text);const pending=bubble('agent','Waiting for response');if(trace.children.length){const sep=document.createElement('hr');sep.className='trace-separator';trace.appendChild(sep)}let answer='';try{const response=await fetch('/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,sessionId})});if(!response.ok||!response.body)throw new Error('HTTP '+response.status);const reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';while(true){const part=await reader.read();if(part.done)break;buffer+=decoder.decode(part.value,{stream:true});let split=buffer.indexOf('\\n\\n');while(split>=0){const frame=buffer.slice(0,split);buffer=buffer.slice(split+2);let event='message';let data='';for(const line of frame.split('\\n')){if(line.startsWith('event: '))event=line.slice(7);else if(line.startsWith('data: '))data+=line.slice(6)}if(data){const payload=JSON.parse(data);if(event==='token'){answer+=payload.text;pending.textContent=answer}else if(event==='trace'){traceLine(payload)}else if(event==='done'){sessionId=payload.sessionId}else if(event==='error'){pending.className='message error';pending.textContent=payload.error;answer='error'}}split=buffer.indexOf('\\n\\n')}}if(!answer&&pending.className==='message agent')pending.textContent='The request completed without a text reply.'}catch(error){pending.className='message error';pending.textContent='Request failed: '+error.message}finally{send.disabled=false;input.focus()}}
form.addEventListener('submit',event=>{event.preventDefault();const text=input.value.trim();input.value='';void submit(text)});document.querySelectorAll('.prompts button').forEach(button=>button.addEventListener('click',()=>void submit(button.textContent||'')));
</script>
</body>
</html>`;
}
