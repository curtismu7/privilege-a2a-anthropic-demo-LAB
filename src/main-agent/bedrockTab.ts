// The "Gateway to Bedrock (IAM)" tab: our agent's model call through the Privilege gateway to Amazon Bedrock, signed with an AWS identity instead of a
// stored key, with a Bedrock guardrail as AI Guard. SIMULATED in every mode (src/bedrockSim.ts, POST /bedrock). Static markup, CSS and a classic script,
// like awsTab.ts, whose look it reuses. The key settings carry the Privilege console's own labels. Everything the server sends is written with textContent.
// No imports: the web tests load this file into jsdom as it is.

export interface BedrockScenario {
  id: string;
  label: string;
  says: string;
  q: string;
  provider: 'runtime' | 'mantle';
  iam: boolean;
  /** The Role ARN choice: '' (blank: the gateway's own identity), 'same' or 'cross'. */
  role: '' | 'same' | 'cross';
  ext: 'match' | 'wrong' | 'missing';
  guard: boolean;
  failClosed: boolean;
  reachable: boolean;
}

export const CLEAN_Q = 'In two sentences, what makes a shared service account risky?';
export const DENIED_Q = 'Should I move my retirement savings into tech stocks this year?';
const base = { q: CLEAN_Q, provider: 'runtime', iam: true, role: '', ext: 'match', guard: false, failClosed: true, reachable: true } as const;

/** The scenario buttons, in page order. Each sets the settings above it and runs; Story presses them by id. */
export const BEDROCK_SCENARIOS: readonly BedrockScenario[] = [
  { ...base, id: 'apikey', label: 'Stored API key', says: 'Sign as this gateway (IAM) off: the gateway injects a stored Bedrock API key. No STS step.', iam: false },
  { ...base, id: 'own', label: 'Own role (A1)', says: 'Role ARN blank: the gateway signs with its own role.' },
  { ...base, id: 'mantle', label: 'Own role on Mantle', says: 'A1 on AWS Bedrock (Mantle): CreateInference, then DeleteInference.', provider: 'mantle' },
  { ...base, id: 'same', label: 'Same-account role (A2)', says: 'AssumeRole in the gateway\'s own account, with the matching External ID.', role: 'same' },
  { ...base, id: 'cross', label: 'Cross-account role (A3)', says: 'AssumeRole in another account, with the matching External ID.', role: 'cross' },
  { ...base, id: 'wrong-ext', label: 'Wrong External ID', says: 'A3 with a wrong External ID: AssumeRole is refused, and the caller gets a generic 502.', role: 'cross', ext: 'wrong' },
  { ...base, id: 'denied', label: 'Guardrail: denied topic', says: 'The guardrail screens a prompt asking for investment advice: blocked before the model.', q: DENIED_Q, guard: true },
  { ...base, id: 'fail-closed', label: 'Guardrail unreachable, Fail closed on', says: 'The guardrail role cannot be reached: the request is blocked.', guard: true, reachable: false },
  { ...base, id: 'fail-open', label: 'Guardrail unreachable, Fail closed off', says: 'The guardrail role cannot be reached: the prompt passes uninspected, with a warning.', guard: true, reachable: false, failClosed: false },
];

const scenarioButton = (s: BedrockScenario): string =>
  `<button type="button" id="bedrock-sc-${s.id}" data-scenario="${s.id}"><span class="bedrock__sc-q">${s.label}</span><span class="bedrock__sc-says">${s.says}</span></button>`;

const node = (id: string, kicker: string, name: string, sub: string): string =>
  `<li class="aws__node" id="bedrock-n-${id}" data-state="idle"><span class="aws__kicker">${kicker}</span><span class="aws__name">${name}</span><span class="aws__sub" id="bedrock-sub-${id}">${sub}</span><span class="aws__state" id="bedrock-s-${id}">waiting</span></li>`;

const perm = (forWhat: string, text: string): string => `<li data-for="${forWhat}"><code>${text}</code></li>`;

export const BEDROCK_PANEL_HTML = `<section id="panel-bedrock" class="aws bedrock" role="tabpanel" aria-labelledby="tab-bedrock" hidden data-testid="bedrock-panel">
<h2 class="aws__h">Gateway to Bedrock, signed with an IAM role</h2>
<p class="aws__lede">Our agent holds only its Privilege key. With Sign as this gateway (IAM) on, no AWS key exists in the agent or in the gateway's settings: the gateway calls Amazon Bedrock as an IAM role, its own or one it assumes. With it off, the gateway injects a stored Bedrock API key instead. A Bedrock guardrail can screen the prompt as AI Guard.</p>
<p class="aws__note" id="bedrock-mode" role="note">SIMULATED, in Mock and in Real: nothing in Privilege or AWS is called. A live run needs a gateway with an IAM role, which is not set up yet. Every request and reply below is what the simulation produced.</p>
<ol class="bedrock__flow" id="bedrock-flow" aria-label="Path from the main agent to the Bedrock model">
${node('main', 'Main agent', 'Main agent', 'Sends the prompt with its own virtual key, as a bearer token.')}
${node('gateway', 'Privilege gateway', 'AI gateway', 'Checks the key, replaces it, and signs the call to AWS.')}
${node('sts', 'AWS STS', 'Assume role', 'AssumeRole, only when a Role ARN is set. Not used for the gateway\'s own role.')}
${node('guard', 'Bedrock guardrail', 'AI Guard', 'ApplyGuardrail screens the prompt, when the guardrail is on.')}
${node('model', 'Bedrock model', 'Amazon Bedrock', 'Answers the prompt: Runtime (Converse) or Mantle (CreateInference).')}
</ol>
<fieldset id="bedrock-key" class="bedrock__key">
<legend>Model Access &amp; Limits <span class="bedrock__legend-note">(the agent key's settings, as the console shows them)</span></legend>
<div class="bedrock__fields">
<label class="bedrock__field"><span>Provider</span><select id="bedrock-provider"><option value="runtime" selected>AWS Bedrock (Runtime)</option><option value="mantle">AWS Bedrock (Mantle)</option></select></label>
<label class="bedrock__field"><span>Region <abbr title="required">*</abbr></span><input id="bedrock-region" value="us-east-1" required readonly aria-describedby="bedrock-region-hint"><small id="bedrock-region-hint">Required. Fixed in this simulation.</small></label>
<label class="bedrock__toggle"><input type="checkbox" id="bedrock-sign" checked aria-describedby="bedrock-sign-hint"><span>Sign as this gateway (IAM)</span><small id="bedrock-sign-hint">Authenticate with SigV4 as this gateway's own AWS identity instead of a Bedrock API key</small></label>
<label class="bedrock__field"><span>Role ARN</span><select id="bedrock-role"><option value="" selected>(blank: this gateway host's own identity)</option><option value="same">arn:aws:iam::111122223333:role/privilege-bedrock</option><option value="cross">arn:aws:iam::444455556666:role/privilege-bedrock</option></select></label>
<label class="bedrock__field"><span>External ID</span><select id="bedrock-ext"><option value="match" selected>matches the role's trust policy</option><option value="wrong">wrong</option><option value="missing">(blank)</option></select></label>
<label class="bedrock__field"><span>Session Name</span><input id="bedrock-session" value="privilege-ai-gateway" maxlength="64" pattern="[\\w+=,.@\\-]{2,64}" autocomplete="off" aria-describedby="bedrock-session-hint"><small id="bedrock-session-hint">Labels the assumed session in the target account's CloudTrail.</small></label>
<label class="bedrock__field"><span>Upstream URL</span><input id="bedrock-upstream" autocomplete="off" placeholder="https://bedrock-runtime.us-east-1.aws.example" aria-describedby="bedrock-upstream-hint"><small id="bedrock-upstream-hint">Optional. Display only: the simulation does not use it.</small></label>
</div>
<p class="bedrock__keynote">As the console says: the agent still sends its virtual key as a bearer token, and the gateway replaces it before the call leaves for AWS.</p>
</fieldset>
<form id="bedrock-form" class="aws__form">
<label for="bedrock-input" class="aws__label">Ask the model through the gateway</label>
<div class="aws__row"><input id="bedrock-input" autocomplete="off" maxlength="4000" placeholder="Ask a question"><button id="bedrock-send" type="submit">Send</button></div>
<fieldset class="bedrock__guard"><legend>Bedrock guardrail (AI Guard)</legend>
<label class="bedrock__check"><input type="checkbox" id="bedrock-guard"> Screen with a Bedrock guardrail</label>
<label class="bedrock__check"><input type="checkbox" id="bedrock-failclosed" checked> Fail closed</label>
<label class="bedrock__check"><input type="checkbox" id="bedrock-reachable" checked> Guardrail role reachable</label>
</fieldset>
</form>
<h3 class="aws__h3">Scenarios</h3>
<div class="bedrock__scenarios" role="group" aria-label="Scenarios: each sets the settings above and runs">${BEDROCK_SCENARIOS.map(scenarioButton).join('')}</div>
<div id="bedrock-answer" class="aws__answer" role="status" aria-live="polite"></div>
<h3 class="aws__h3">The API calls in this run</h3>
<ol id="bedrock-reel" class="aws__reel" aria-label="API calls in this run"></ol>
<h3 class="aws__h3">What crossed each hop</h3>
<ol id="bedrock-trace" class="aws__trace"><li class="aws__empty">Pick a scenario or send a question. Each step appears here, with what was sent and what came back.</li></ol>
<details id="bedrock-iam" class="aws__how"><summary>What the IAM role needs</summary>
<p>The identity the gateway signs with (its own role, or the role it assumes) needs these permissions for the chosen Provider. Account <code>111122223333</code> is an example.</p>
<ul id="bedrock-perms">
${perm('runtime', 'bedrock:InvokeModel')}${perm('runtime', 'bedrock:InvokeModelWithResponseStream')}${perm('runtime', 'bedrock:CountTokens')}
${perm('mantle', 'bedrock-mantle:CreateInference')}${perm('mantle', 'bedrock-mantle:DeleteInference')}${perm('mantle', 'bedrock-mantle:CountTokens')}
${perm('guard', 'bedrock:ApplyGuardrail (when the guardrail is on)')}
${perm('role', 'sts:AssumeRole on the Role ARN (on the gateway\'s own role), with a trust policy on the target role that names the gateway role and an sts:ExternalId condition')}
</ul>
<ul>
<li><code>bedrock:CallWithBearerToken</code> is not used: the gateway signs with SigV4. Third-party models also need their AWS Marketplace subscription in that account.</li>
<li><b>Common failures.</b> Model access not enabled in that account and region. An account id inside a foundation-model ARN: it must be <code>arn:aws:bedrock:us-east-1::foundation-model/…</code>, with <code>::</code>. A cross-region inference profile without the model ARNs of every destination region. An instance metadata (IMDS) hop limit of 1 when the gateway runs in Docker, so the container cannot reach the instance role.</li>
</ul></details>
</section>`;

export const BEDROCK_TAB_CSS = `
.tabs{overflow-x:auto}
.tabs [role=tab]{flex:none}
.bedrock__flow{display:flex;gap:2.25rem;margin:0 0 1.25rem;padding:0;list-style:none}
.bedrock .aws__node[data-state=blocked]{border-color:var(--danger-text)}
.bedrock .aws__node[data-state=blocked] .aws__state{border-color:var(--danger-text);color:var(--danger-text)}
.bedrock .aws__node[data-state=skipped]{border-style:dashed}
.bedrock .aws__node[data-state=skipped] .aws__state{border-style:dashed}
.bedrock__key,.bedrock__guard{max-width:60rem;margin:0 0 1rem;padding:.6rem .8rem .8rem;border:1px solid var(--border);border-radius:6px;background:var(--surface-2)}
.bedrock__key legend,.bedrock__guard legend{padding:0 .3rem;font-size:.85rem;font-weight:700;color:var(--text)}
.bedrock__legend-note{font-weight:400;color:var(--text-body)}
.bedrock__fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:.6rem .9rem}
.bedrock__field{display:flex;flex-direction:column;gap:.2rem;min-width:0;font-size:.8rem;font-weight:600;color:var(--text)}
.bedrock__field--wide{grid-column:1/-1}
.bedrock__field small{font-size:.75rem;font-weight:400;color:var(--text-body)}
.bedrock__field abbr{text-decoration:none;color:var(--danger-text)}
.bedrock__field select,.bedrock__field input:not([type=checkbox]){width:100%;min-width:0;padding:.4rem .6rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);font:inherit;font-size:.8rem;font-weight:400;min-height:2.25rem}
.bedrock__field input[readonly]{background:var(--surface-2)}
.bedrock__field :disabled{opacity:.6;cursor:not-allowed}
.bedrock__check{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem;font-size:.8rem;color:var(--text-body);cursor:pointer}
.bedrock__toggle{grid-column:1/-1;display:flex;flex-wrap:wrap;align-items:center;gap:.2rem .5rem;font-size:.8rem;font-weight:600;color:var(--text);cursor:pointer}
.bedrock__toggle small{flex-basis:100%;font-size:.75rem;font-weight:400;color:var(--text-body)}
.bedrock .bedrock__toggle input[type=checkbox]{flex:none;width:1rem;height:1rem;min-height:0;padding:0;margin:0}
.bedrock .bedrock__check input[type=checkbox]{flex:none;width:1rem;height:1rem;min-height:0;padding:0;margin:0}
.bedrock__guard{display:flex;flex-wrap:wrap;gap:.5rem 1.25rem;margin-top:.5rem}
.bedrock__keynote{margin:.6rem 0 0;font-size:.8rem;line-height:1.45}
.bedrock__scenarios{display:grid;grid-template-columns:repeat(auto-fill,minmax(15rem,1fr));gap:.4rem;max-width:60rem}
.bedrock__scenarios button{display:block;text-align:left;padding:.45rem .7rem;border:1px solid var(--border);border-radius:6px;background:var(--surface-2);color:var(--text);font:inherit;font-size:.8rem;line-height:1.35;cursor:pointer;min-height:0}
.bedrock__scenarios button:hover:not([disabled]){background:var(--surface);border-color:var(--text)}
.bedrock__sc-q{display:block;font-weight:700}
.bedrock__sc-says{display:block;margin-top:.15rem;font-size:.75rem;font-weight:400;color:var(--text-body)}
.bedrock input:focus-visible,.bedrock select:focus-visible,.bedrock button:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
.bedrock .aws__answer.is-blocked{padding:.4rem .7rem;border-left:4px solid var(--danger-text);background:var(--surface-2);color:var(--text)}
.bedrock .aws__how p{margin:.5rem 0 0}
.bedrock .aws__how code{font-family:var(--font-mono);font-size:.75rem;overflow-wrap:anywhere}
@media(max-width:850px){.bedrock__flow{flex-direction:column;gap:2rem}}
`;

// Classic script. No template literals inside: this string is itself a template literal in the page.
export const BEDROCK_TAB_SCRIPT = String.raw`(function(){
function $(id){return document.getElementById(id)}
var form=$('bedrock-form'),input=$('bedrock-input'),send=$('bedrock-send'),answer=$('bedrock-answer'),trace=$('bedrock-trace');
var c={provider:$('bedrock-provider'),iam:$('bedrock-sign'),role:$('bedrock-role'),ext:$('bedrock-ext'),session:$('bedrock-session'),upstream:$('bedrock-upstream'),guard:$('bedrock-guard'),failClosed:$('bedrock-failclosed'),reachable:$('bedrock-reachable')};
var buttons=document.querySelectorAll('#panel-bedrock [data-scenario]');
var SCENARIOS=window.BEDROCK_SCENARIOS||{};
var EMPTY=trace.textContent;
var WORDS={idle:'waiting',working:'working…',ok:'done',refused:'refused',blocked:'blocked',skipped:'skipped',error:'stopped'};
var IDS=['main','gateway','sts','guard','model'];
var UPSTREAM={runtime:'https://bedrock-runtime.us-east-1.aws.example',mantle:'https://bedrock-mantle.us-east-1.aws.example'};
function setState(id,state,word){var el=$('bedrock-n-'+id);if(!el)return;el.dataset.state=state;$('bedrock-s-'+id).textContent=word||WORDS[state]}
function resetFlow(){IDS.forEach(function(id){setState(id,'idle')})}
/* The fields that do not apply are off: no IAM, no Role ARN, External ID or Session Name; no Role ARN, no External ID or Session Name. The permissions follow. */
function sync(){
  var iam=c.iam.checked,role=c.role.value,p=c.provider.value;
  c.role.disabled=!iam;c.ext.disabled=!iam||!role;c.session.disabled=!iam||!role;
  c.upstream.placeholder=UPSTREAM[p]||'';
  document.querySelectorAll('#bedrock-perms li').forEach(function(li){var f=li.getAttribute('data-for');li.hidden=!(f===p||(f==='guard'&&c.guard.checked)||(f==='role'&&iam&&!!role))});
}
['provider','iam','role','guard'].forEach(function(k){c[k].addEventListener('change',sync)});
sync();
function wireBlock(label,body){
  var d=document.createElement('details');d.className='aws__wire';var s=document.createElement('summary');s.textContent=label;d.appendChild(s);
  var p=document.createElement('pre');p.textContent=body;d.appendChild(p);return d;
}
function addStep(t){
  var empty=trace.querySelector('.aws__empty');if(empty)empty.remove();
  var li=document.createElement('li');li.className='aws__step';li.dataset.kind=String(t.step||'');
  var head=document.createElement('div');head.className='aws__step-head';
  var chip=document.createElement('span');chip.className='aws__chip';chip.textContent=String(t.step||'step');head.appendChild(chip);
  var tx=document.createElement('span');tx.textContent=String(t.text||'');head.appendChild(tx);
  var at=document.createElement('span');at.className='aws__at';at.textContent=String(t.at||'');head.appendChild(at);
  li.appendChild(head);
  if(t.detail){var d=document.createElement('p');d.className='aws__detail';d.textContent=String(t.detail);li.appendChild(d)}
  if(t.request)li.appendChild(wireBlock('What was sent (keys masked)',String(t.request)));
  if(t.response)li.appendChild(wireBlock('What came back',String(t.response)));
  trace.appendChild(li);
}
var reel=window.Reel?window.Reel.attach($('bedrock-reel')):null;
function onTrace(t){
  addStep(t);
  if(reel)reel.add(t);
  var n=t.nodes||{};
  IDS.forEach(function(id){var v=n[id];if(Array.isArray(v)&&WORDS[v[0]])setState(id,v[0],String(v[1]||''))});
}
/* A field the settings turn off is not sent: a Session Name left in a disabled field must not fail a run that does not assume a role. */
function settings(text){
  return {message:text,provider:c.provider.value,iam:c.iam.checked,identity:c.role.value||'own',externalId:c.ext.value,sessionName:c.session.disabled?'':c.session.value.trim(),
    guard:{on:c.guard.checked,failClosed:c.failClosed.checked,reachable:c.reachable.checked}};
}
function clearView(){answer.textContent='';answer.className='aws__answer';trace.textContent='';if(reel)reel.clear();resetFlow()}
var inflight=null;
/* One request at a time: Send and the scenarios are off while a run is in flight, and run() refuses on its own. Reset aborts the run and empties the tab. */
function busy(on){send.disabled=on;buttons.forEach(function(b){b.disabled=on})}
async function run(text){
  text=String(text||'').trim();if(!text||inflight)return;
  var ctl=new AbortController();inflight=ctl;busy(true);
  var started=false,failed=false;
  window.dispatchEvent(new CustomEvent('paad:run-start'));
  clearView();setState('main','working','sending');
  try{
    var res=await fetch('/bedrock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(settings(text)),signal:ctl.signal});
    if(!res.ok||!res.body){var why='';try{why=(await res.json()).error||''}catch(e){}throw new Error('HTTP '+res.status+(why?': '+why:''))}
    started=true;
    var reader=res.body.getReader(),dec=new TextDecoder(),buf='';
    while(true){
      var part=await reader.read();if(part.done)break;
      buf+=dec.decode(part.value,{stream:true});
      var cut=buf.indexOf('\n\n');
      while(cut>=0){
        var frame=buf.slice(0,cut);buf=buf.slice(cut+2);
        var ev='message',data='';
        frame.split('\n').forEach(function(line){if(line.indexOf('event: ')===0)ev=line.slice(7);else if(line.indexOf('data: ')===0)data+=line.slice(6)});
        if(data){
          var p=JSON.parse(data);
          if(ev==='trace')onTrace(p);
          else if(ev==='token'){answer.textContent+=String(p.text||'')}
          else if(ev==='error'){answer.className='aws__answer '+(p.blocked?'is-blocked':'is-error');answer.textContent=String(p.error||'')}
        }
        cut=buf.indexOf('\n\n');
      }
    }
    if(!answer.textContent){answer.className='aws__answer is-error';answer.textContent='The run ended without an answer.'}
  }catch(err){
    failed=true;
    if(!ctl.signal.aborted){answer.className='aws__answer is-error';answer.textContent='Request failed: '+err.message;setState('main','error','stopped')}
  }finally{
    if(inflight===ctl){inflight=null;busy(false)}
    window.dispatchEvent(new CustomEvent('paad:run-end',{detail:{ok:!failed}}));
    if(started&&!ctl.signal.aborted)window.dispatchEvent(new CustomEvent('paad:run-done'));
  }
}
/* A scenario sets every setting it depends on, the Session Name back to its default included. Reset puts the defaults back. */
function apply(s){
  c.provider.value=s.provider;c.iam.checked=s.iam;c.role.value=s.role;c.ext.value=s.ext;c.session.value=c.session.defaultValue;
  c.guard.checked=s.guard;c.failClosed.checked=s.failClosed;c.reachable.checked=s.reachable;sync();
}
var DEFAULTS={provider:c.provider.value,iam:c.iam.checked,role:c.role.value,ext:c.ext.value,guard:c.guard.checked,failClosed:c.failClosed.checked,reachable:c.reachable.checked};
buttons.forEach(function(b){b.addEventListener('click',function(){var s=SCENARIOS[b.getAttribute('data-scenario')];if(!s||inflight)return;apply(s);run(s.q)})});
form.addEventListener('submit',function(e){e.preventDefault();if(inflight)return;var t=input.value;if(!t.trim())return;input.value='';run(t)});
window.addEventListener('paad:reset',function(){if(inflight){inflight.abort();inflight=null}busy(false);clearView();apply(DEFAULTS);c.upstream.value='';var li=document.createElement('li');li.className='aws__empty';li.textContent=EMPTY;trace.appendChild(li);input.value=''});
})();`;

/** The scenarios as page data, read by the script above (window.BEDROCK_SCENARIOS). `<` is escaped so the data cannot close its script element. */
export const BEDROCK_DATA_SCRIPT = `window.BEDROCK_SCENARIOS=${JSON.stringify(Object.fromEntries(BEDROCK_SCENARIOS.map(s => [s.id, s]))).replace(/</g, '\\u003c')};`;
