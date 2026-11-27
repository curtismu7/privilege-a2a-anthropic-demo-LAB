// "Before the demo: how it is wired": the two agents and the four gateway hops, as a collapsible panel under the header.
// Static markup and CSS only, no data and no script. The panel sets its own surface and ink from the shared tokens, so it reads in both
// themes even though the rest of this page is styled dark. Collapsed by default: the page is one full-height column and an open
// diagram would take the chat's room; the summary line stays visible.

const HOPS: ReadonlyArray<{ n: number; label: string; title: string; body: string }> = [
  { n: 1, label: 'Agent to agent', title: 'Delegation is authorized', body: "The worker is not directly reachable. The gateway checks the caller's scope and inspects the task and the findings returned." },
  { n: 2, label: 'Main to model', title: 'Prompts are governed', body: 'Key injection, rate and budget limits, token and cost accounting, and model policy, enforced before the request leaves.' },
  { n: 3, label: 'Worker to model', title: 'Metered per agent', body: 'Same controls, separate key. Spend, limits, and permitted models are attributed to the worker, not pooled with the main agent.' },
  { n: 4, label: 'Agent to tools', title: 'Tool access is scoped', body: 'Which tools this agent may call, and inspection of what the tools return, where hostile instructions hide inside data.' },
];

const gateway = (n: number, path: string, cls: string): string =>
  `<div class="wire__node wire__node--gw ${cls}"><span class="wire__badge" aria-hidden="true">${n}</span><span class="wire__kicker">AI Gateway</span><span class="wire__path">${path}</span></div>`;
const node = (name: string, sub: string, cls: string, mono = false, extra = ''): string =>
  `<div class="wire__node ${cls}"><span class="wire__name">${name}</span><span class="wire__sub${mono ? ' wire__sub--mono' : ''}">${sub}</span>${extra}</div>`;
const link = (cls: string, dir: 'h' | 'v' = 'h', tag = '', dashed = false): string =>
  `<span class="wire__link wire__link--${dir}${dashed ? ' is-dashed' : ''} ${cls}" aria-hidden="true">${tag ? `<span class="wire__tag">${tag}</span>` : ''}</span>`;

export const WIRING_HTML = `<details class="wire" data-testid="wiring-diagram">
<summary>Before the demo: how it is wired. Two agents, four hops, every one through the gateway.</summary>
<div class="wire__body">
<p class="wire__lede">The agents hold no provider keys and no policy logic. Each hop they make is intercepted, authenticated, inspected, and metered independently.</p>
<div class="wire__scroll"><div class="wire__grid">
${node('Browser', 'local only', 'wire__browser', true)}${link('wire__l-chat', 'h', 'chat', true)}${node('Main agent', 'concierge · owns the chat', 'wire__main', false, '<span class="wire__note">no tools of its own</span>')}${link('wire__l-a2a-in', 'h', 'A2A')}${gateway(1, '/analyst-agent/a2a', 'wire__gw1')}${link('wire__l-a2a-out')}${node('Worker agent', 'analyst · owns the tools', 'wire__worker')}${link('wire__l-mcp-in', 'h', 'MCP')}${gateway(4, '/lab-a2a-full/mcp', 'wire__gw4')}${link('wire__l-mcp-out')}${node('MCP server', 'Streamable HTTP', 'wire__mcp', true)}
${link('wire__l-main-llm', 'v', 'LLM')}${gateway(2, '/llm/google', 'wire__gw2')}${link('wire__l-main-model', 'v')}${node('Gemini', '3.6-flash', 'wire__model-main', true)}
${link('wire__l-worker-llm', 'v', 'LLM')}${gateway(3, '/llm/google', 'wire__gw3')}${link('wire__l-worker-model', 'v')}${node('Gemini', '3.5-flash-lite', 'wire__model-worker', true)}
<aside class="wire__keys"><span class="wire__kicker">The agents hold no provider keys</span><span class="wire__sub">Each agent presents only its own scoped key. The gateway strips it and injects the real credential on egress; it never reaches agent memory.</span></aside>
</div></div>
<ol class="wire__hops" aria-label="What the gateway does on each hop">${HOPS.map((h) => `<li class="wire__hop"><span class="wire__kicker">Hop ${h.n} · ${h.label}</span><b class="wire__hop-title">${h.title}</b><span class="wire__sub">${h.body}</span></li>`).join('')}</ol>
</div>
</details>`;

export const WIRING_CSS = `
/* Before the demo: how it is wired. Surface, line and ink come from the shared tokens; type is 12px or more. */
.wire{margin:0;background:var(--surface);color:var(--text-body);border-bottom:1px solid var(--border)}
.wire>summary{cursor:pointer;padding:.55rem 1.25rem;font-size:.8rem;font-weight:600;color:var(--text);list-style-position:inside}
.wire>summary:focus-visible{outline:3px solid var(--focus);outline-offset:-3px}
.wire__body{max-height:55vh;overflow:auto;padding:.25rem 1.25rem 1rem}
.wire__lede{margin:.25rem 0 .9rem;font-size:.8rem;line-height:1.5}
.wire__scroll{overflow-x:auto;padding:4px 0 8px}
.wire__grid{display:grid;grid-template-columns:minmax(80px,1fr) 44px minmax(170px,1.7fr) 44px minmax(150px,1.5fr) 44px minmax(170px,1.7fr) 44px minmax(140px,1.4fr) 44px minmax(110px,1.2fr);grid-template-rows:auto 30px auto 30px auto;align-items:center;min-width:960px}
.wire__node{position:relative;display:flex;flex-direction:column;gap:2px;align-self:stretch;justify-content:center;padding:10px 12px;border:1px solid var(--border);border-radius:6px;background:var(--surface-2);text-align:center}
.wire__node--gw{border-color:var(--status-warn)}
.wire__name{color:var(--text);font-size:.8rem;font-weight:600;text-transform:uppercase;letter-spacing:.02em}
.wire__sub{color:var(--text-body);font-size:.75rem;line-height:1.45}
.wire__sub--mono,.wire__path{font-family:var(--font-mono)}
.wire__note{color:var(--status-info);font-family:var(--font-mono);font-size:.75rem}
.wire__kicker{display:block;color:var(--status-warn);font-size:.75rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.wire__path{color:var(--text);font-size:.75rem;white-space:nowrap}
.wire__badge{position:absolute;top:-10px;left:-10px;display:grid;place-items:center;width:20px;height:20px;border:1px solid var(--status-warn);border-radius:50%;background:var(--surface);color:var(--status-warn);font-size:.75rem;font-weight:600}
.wire__link{position:relative;align-self:stretch;color:var(--muted)}
.wire__link::before,.wire__link::after{position:absolute;content:""}
.wire__link--h::before{top:50%;right:5px;left:0;border-top:2px solid currentcolor}
.wire__link--h.is-dashed::before{border-top-style:dashed}
.wire__link--h::after{top:50%;right:0;margin-top:-5px;border-top:5px solid transparent;border-bottom:5px solid transparent;border-left:7px solid currentcolor}
.wire__link--v::before{top:0;bottom:5px;left:50%;border-left:2px solid currentcolor}
.wire__link--v::after{bottom:0;left:50%;margin-left:-5px;border-top:7px solid currentcolor;border-right:5px solid transparent;border-left:5px solid transparent}
.wire__tag{position:absolute;color:var(--muted);font-size:10px;font-weight:600;letter-spacing:.06em;white-space:nowrap}
.wire__link--h .wire__tag{bottom:calc(50% + 6px);left:50%;transform:translateX(-50%)}
.wire__link--v .wire__tag{top:50%;left:calc(50% - 8px);transform:translate(-100%,-50%)}
.wire__browser{grid-column:1;grid-row:1}.wire__l-chat{grid-column:2;grid-row:1}.wire__main{grid-column:3;grid-row:1}.wire__l-a2a-in{grid-column:4;grid-row:1}
.wire__gw1{grid-column:5;grid-row:1}.wire__l-a2a-out{grid-column:6;grid-row:1}.wire__worker{grid-column:7;grid-row:1}.wire__l-mcp-in{grid-column:8;grid-row:1}
.wire__gw4{grid-column:9;grid-row:1}.wire__l-mcp-out{grid-column:10;grid-row:1}.wire__mcp{grid-column:11;grid-row:1}
.wire__l-main-llm{grid-column:3;grid-row:2}.wire__gw2{grid-column:3;grid-row:3}.wire__l-main-model{grid-column:3;grid-row:4}.wire__model-main{grid-column:3;grid-row:5}
.wire__l-worker-llm{grid-column:7;grid-row:2}.wire__gw3{grid-column:7;grid-row:3}.wire__l-worker-model{grid-column:7;grid-row:4}.wire__model-worker{grid-column:7;grid-row:5}
.wire__keys{display:flex;flex-direction:column;gap:4px;grid-column:9 / 12;grid-row:3 / 6;align-self:center;margin-left:12px;padding:10px 12px;border:1px dashed var(--border);border-radius:6px}
.wire__hops{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin:1.1rem 0 0;padding:0;list-style:none}
.wire__hop{display:flex;flex-direction:column;gap:4px;padding:12px 14px;border:1px solid var(--border);border-top:3px solid var(--status-warn);border-radius:6px;background:var(--surface-2)}
.wire__hop-title{color:var(--text);font-size:.95rem}
`;
