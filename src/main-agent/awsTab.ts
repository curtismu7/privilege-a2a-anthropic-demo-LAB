// The "Custodian to AWS agent" tab: the path from the custodian of the main agent's key, through the Privilege gateway,
// to an agent running in AWS, lit up step by step from the run's trace. Static markup, CSS and a classic script, like wiringDiagram.ts.
// The panel sets its own surface and ink from the shared tokens, so it reads in both themes although the rest of the page is styled dark.
// Everything the remote side sends is written with textContent, never as HTML.

export interface AwsPrompt {
  /** The question that is sent. */
  q: string;
  /** What running it shows; the button carries it as a caption. Optional. */
  proves?: string;
}

/** The question that shows our agent, on this machine, talking to the AWS agent. Also offered as the 4th example prompt on the A2A with remote agents tab. */
export const AWS_INTRO: AwsPrompt = {
  q: 'Introduce yourself: which agent are you, and where do you run?',
  proves: 'our agent, running on this machine, talks to the agent hosted in AWS (Bedrock AgentCore) through Privilege, and its reply comes back here. With no gateway route set, a local stand-in answers and says so.',
};

export const AWS_PROMPTS: readonly AwsPrompt[] = [
  AWS_INTRO,
  { q: 'Review cloud access for the AirGuard Airlines booking platform' },
  { q: 'Which service accounts hold roles they have not used?' },
  { q: 'Is the flight manifest bucket publicly readable?' },
];

const promptButton = ({ q, proves }: AwsPrompt): string =>
  proves
    ? `<button type="button" class="has-proves" data-q="${q}"><span class="p-q">${q}</span><span class="p-proves"><b>Proves:</b> ${proves}</span></button>`
    : `<button type="button" data-q="${q}">${q}</button>`;

export const AWS_TABS_HTML = `<div class="tabs" role="tablist" aria-label="Demo views">
<button type="button" role="tab" id="tab-review" aria-selected="true" aria-controls="panel-review" data-testid="tab-review">A2A with remote agents</button>
<button type="button" role="tab" id="tab-aws" aria-selected="false" aria-controls="panel-aws" tabindex="-1" data-testid="tab-aws">Custodian to AWS agent</button>
<button type="button" role="tab" id="tab-bedrock" aria-selected="false" aria-controls="panel-bedrock" tabindex="-1" data-testid="tab-bedrock">Gateway to Bedrock (IAM)</button>
</div>`;

// The tab bar: click, the arrow keys (wrapping), Home and End move between the three tabs; the URL hash is #aws or #bedrock (none for the first tab), and
// a page opened with that hash starts on that tab. Classic script, no template literals inside.
export const TABS_SCRIPT = String.raw`(function(){
var order=['review','aws','bedrock'],tabs={},panels={};
order.forEach(function(k){tabs[k]=document.getElementById('tab-'+k);panels[k]=document.getElementById('panel-'+k)});
function select(which,focus){
  order.forEach(function(k){var on=k===which;tabs[k].setAttribute('aria-selected',String(on));tabs[k].tabIndex=on?0:-1;panels[k].hidden=!on});
  if(focus)tabs[which].focus();
  try{tabs[which].scrollIntoView({inline:'nearest',block:'nearest'})}catch(e){}
  try{history.replaceState(null,'',which==='review'?location.pathname+location.search:'#'+which)}catch(e){}
}
order.forEach(function(k,i){
  tabs[k].addEventListener('click',function(){select(k)});
  tabs[k].addEventListener('keydown',function(e){
    var n=order.length,to=e.key==='ArrowRight'?order[(i+1)%n]:e.key==='ArrowLeft'?order[(i+n-1)%n]:e.key==='Home'?order[0]:e.key==='End'?order[n-1]:null;
    if(!to)return;
    e.preventDefault();   /* the key moves between tabs only: without this the page also scrolls (Home and End jump it) */
    select(to,true);
  });
});
if(location.hash==='#aws'||location.hash==='#bedrock')select(location.hash.slice(1));
})();`;

const node = (id: string, kicker: string, name: string, sub: string, extra = ''): string =>
  `<li class="aws__node" id="aws-n-${id}" data-state="idle"><span class="aws__kicker">${kicker}</span><span class="aws__name" id="aws-name-${id}">${name}</span><span class="aws__sub" id="aws-sub-${id}">${sub}</span><span class="aws__state" id="aws-s-${id}">waiting</span>${extra}</li>`;

export const AWS_PANEL_HTML = `<section id="panel-aws" class="aws" role="tabpanel" aria-labelledby="tab-aws" hidden data-testid="aws-panel">
<h2 class="aws__h">Custodian to AWS agent, through Privilege</h2>
<p class="aws__lede">Every agent key has a custodian: the identity its actions are attributed to, a user or a federated identity. The agent acts under that key, Privilege checks every call, and only then does it reach the agent running in AWS.</p>
<p class="aws__note" id="aws-mode" role="note">Checking the route…</p>
<label class="aws__hubtoggle"><input type="checkbox" id="aws-hub" aria-controls="aws-hub-note" data-testid="aws-hub"> Explain: where a secrets hub fits (display only)</label>
<p class="aws__note aws__hubnote" id="aws-hub-note" role="note" hidden data-testid="aws-hub-note"><b>Explainer, display only. This run does not use a hub.</b> A Privilege secrets hub (AWS Secrets Manager, Azure Key Vault, Delinea Secret Server or GCP Secrets Manager) holds credentials outside the agent, and Privilege describes the AI gateway as injecting the credential a resource needs at request time. Ping's docs cover hubs for checking out secrets by policy; how a hub secret reaches an agent request is not documented, so this explainer shows where a hub would sit, not how it works. Where the credential for this AWS agent comes from is set in Privilege, and this app cannot read it.</p>
<ol class="aws__flow" aria-label="Path from the custodian to the AWS agent">
${node('custodian', 'Custodian', 'Sample custodian', "Whose identity the agent key's actions are attributed to: a user or a federated identity. Set in the Agent Registry.")}
${node('main', 'Main agent', 'Main agent', 'Acts for the custodian. Sends the A2A message with its own key, never the custodian\'s sign-in.')}
${node('gateway', 'Privilege gateway', 'AI gateway', 'Checks the key, the a2a scope and the Remote Agent grant, screens the message, then forwards it.', '<span class="aws__hubchip" id="aws-hub-chip" hidden>Explainer: credential from a secrets hub</span>')}
${node('aws', 'AWS agent', 'Agent on AWS', "Runs in AWS (Bedrock AgentCore). It never sees the main agent's key. What it receives is set on the gateway app: a credential the gateway injects, or the caller's own verified token.")}
</ol>
<form id="aws-form" class="aws__form">
<label for="aws-input" class="aws__label">Ask the AWS agent</label>
<div class="aws__row"><input id="aws-input" autocomplete="off" maxlength="4000" placeholder="Ask about cloud access"><button id="aws-send" type="submit">Send</button></div>
<div class="aws__prompts" role="group" aria-label="Suggested questions">${AWS_PROMPTS.map(promptButton).join('')}</div>
</form>
<div class="aws__refuse"><button type="button" id="aws-refuse" data-testid="aws-refuse">Try a refused call</button> <span class="aws__refuse-note" id="aws-refuse-note">Sends the first suggested question with a deliberately invalid credential, so you can see the gateway refuse it before it reaches AWS.</span></div>
<div id="aws-answer" class="aws__answer" role="status" aria-live="polite"></div>
<h3 class="aws__h3">The API calls in this run</h3>
<ol id="aws-reel" class="aws__reel" aria-label="API calls in this run"></ol>
<h3 class="aws__h3">What crossed each hop</h3>
<ol id="aws-trace" class="aws__trace"><li class="aws__empty">Send a question. Each step appears here, with what was sent and what came back.</li></ol>
<details class="aws__how"><summary>How to read this</summary>
<ul>
<li><b>Custodian.</b> The identity the agent key is registered to in the Agent Registry, a user or a federated identity. Privilege attributes the agent's actions to it. The name is set with AWS_AGENT_CUSTODIAN; this app cannot read it from Privilege.</li>
<li><b>Privilege gateway.</b> In a live run, a refusal (HTTP 400, 401, 403 or 429) is shown as refused at the gateway. This app sees only the status, so confirm the reason in the gateway log.</li>
<li><b>AWS agent.</b> Any other HTTP error, or a reply with no text, is shown as stopped at the AWS agent.</li>
<li><b>Simulated runs.</b> With no gateway route set, the AWS agent is a local stand-in and the gateway step is marked simulated: nothing in Privilege or AWS is called.</li>
</ul></details>
</section>`;

export const AWS_TAB_CSS = `
.tabs{display:flex;gap:.25rem;padding:.5rem 1.25rem 0;border-bottom:1px solid var(--border);background:var(--surface)}
.tabs [role=tab]{padding:.5rem .9rem;border:1px solid var(--border);border-bottom:0;border-radius:6px 6px 0 0;background:var(--surface-2);color:var(--text-body);font:inherit;font-size:.8rem;font-weight:600;cursor:pointer}
.tabs [role=tab][aria-selected=true]{background:var(--surface);color:var(--text);box-shadow:inset 0 3px 0 var(--accent)}
.tabs [role=tab]:focus-visible{outline:3px solid var(--focus);outline-offset:-3px}
[hidden]{display:none!important}
.aws{flex:1;min-height:0;overflow:auto;padding:1rem 1.25rem 1.5rem;background:var(--surface);color:var(--text-body)}
.aws__h{margin:0 0 .35rem;font-size:1rem;color:var(--text)}
.aws__h3{margin:1.25rem 0 .5rem;font-size:.85rem;color:var(--text)}
.aws__lede{margin:0 0 .6rem;font-size:.85rem;line-height:1.5;max-width:60rem}
.aws__card{display:grid;grid-template-columns:max-content 1fr;gap:.2rem .9rem;margin:.5rem 0;padding:.5rem .7rem;border:1px solid var(--border);border-radius:6px;background:var(--surface-2);font-size:.8rem}
.aws__card dt{font-weight:700}
.aws__card dd{margin:0;word-break:break-word}
.aws__refuse{margin:.2rem 0 .8rem;font-size:.8rem;color:var(--text-body)}
.aws__refuse-note{margin-left:.5rem}
.aws__hubtoggle{display:block;margin:-.4rem 0 .8rem;font-size:.8rem;color:var(--text-body);cursor:pointer}
.aws .aws__hubtoggle input[type=checkbox]{display:inline-block;width:1rem;height:1rem;min-height:0;padding:0;margin:0 .4rem 0 0;vertical-align:middle}
.aws__hubchip{display:inline-block;margin-top:.4rem;padding:.1rem .5rem;border:1px dashed var(--muted);border-radius:999px;font-size:.75rem;color:var(--text-body)}
.aws__hubnote{margin-top:-.4rem}
.aws__note{margin:0 0 1rem;padding:.45rem .7rem;border:1px solid var(--border);border-left:4px solid var(--status-info);border-radius:6px;font-size:.8rem;background:var(--surface-2);color:var(--text-body);max-width:60rem}
.aws__flow{display:flex;gap:2.25rem;margin:0 0 1.25rem;padding:0;list-style:none}
.aws__node{position:relative;flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:3px;padding:12px 14px;border:2px solid var(--border);border-radius:6px;background:var(--surface-2)}
.aws__node:not(:last-child)::after{content:"";position:absolute;top:50%;right:-1.9rem;width:1.6rem;border-top:2px solid var(--muted)}
.aws__node:not(:last-child)::before{content:"";position:absolute;top:50%;right:-2.15rem;margin-top:-5px;width:0;height:0;border-top:5px solid transparent;border-bottom:5px solid transparent;border-left:7px solid var(--muted)}
.aws__kicker{color:var(--status-warn);font-size:.75rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.aws__name{color:var(--text);font-size:.9rem;font-weight:600;overflow-wrap:anywhere}
.aws__sub{font-size:.75rem;line-height:1.45}
.aws__state{align-self:flex-start;margin-top:4px;padding:1px 8px;border:1px solid var(--border);border-radius:999px;font-size:.75rem;font-weight:600;color:var(--muted)}
.aws__node[data-state=working]{border-color:var(--status-info)}
.aws__node[data-state=working] .aws__state{border-color:var(--status-info);color:var(--status-info)}
.aws__node[data-state=ok]{border-color:var(--status-ok)}
.aws__node[data-state=ok] .aws__state{border-color:var(--status-ok);color:var(--status-ok)}
.aws__node[data-state=refused],.aws__node[data-state=error]{border-color:var(--danger-text)}
.aws__node[data-state=refused] .aws__state,.aws__node[data-state=error] .aws__state{border-color:var(--danger-text);color:var(--danger-text)}
.aws__form{display:flex;flex-direction:column;gap:.5rem;max-width:60rem}
.aws__label{font-size:.8rem;font-weight:600;color:var(--text)}
.aws__row{display:flex;gap:.5rem}
.aws__row input{flex:1;min-width:0;padding:.5rem .7rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);font:inherit;font-size:.85rem}
.aws__row button,.aws__prompts button{padding:.45rem .8rem;border:1px solid var(--border);border-radius:6px;background:var(--surface-2);color:var(--text);font:inherit;font-size:.8rem;cursor:pointer}
.aws__row button{background:var(--accent-gradient);color:var(--on-accent);border-color:var(--primary-edge);font-weight:600}
.aws__row button[disabled]{background:var(--accent-inactive-gradient);cursor:not-allowed}
.aws__prompts{display:flex;flex-wrap:wrap;gap:.4rem}
.aws input:focus-visible,.aws button:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
.aws__answer{margin:1rem 0 0;max-width:60rem;white-space:pre-wrap;overflow-wrap:anywhere;font-size:.85rem;line-height:1.5;color:var(--text)}
.aws__answer.is-error{color:var(--danger-text)}
.aws__trace{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:.5rem;max-width:60rem}
.aws__empty{font-size:.8rem}
.aws__step{padding:.55rem .75rem;border:1px solid var(--border);border-left:4px solid var(--muted);border-radius:6px;background:var(--surface-2)}
.aws__step[data-kind=delegate]{border-left-color:var(--status-info)}
.aws__step[data-kind=result]{border-left-color:var(--status-ok)}
.aws__step[data-kind=error]{border-left-color:var(--danger-text)}
.aws__step-head{display:flex;flex-wrap:wrap;gap:.5rem;align-items:baseline;font-size:.8rem;color:var(--text)}
.aws__chip{padding:0 7px;border:1px solid var(--border);border-radius:999px;font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.aws__at{margin-left:auto;font-size:.75rem;color:var(--muted);font-variant-numeric:tabular-nums}
.aws__detail{margin:.3rem 0 0;font-size:.8rem;white-space:pre-wrap;overflow-wrap:anywhere}
.aws__wire{margin-top:.35rem;font-size:.75rem}
.aws__wire pre{margin:.3rem 0 0;padding:.5rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text-body);font-family:var(--font-mono);font-size:.75rem;white-space:pre-wrap;overflow-wrap:anywhere;max-height:16rem;overflow:auto}
.aws__how{margin-top:1.25rem;max-width:60rem;font-size:.8rem}
.aws__how summary{cursor:pointer;font-weight:600;color:var(--text)}
.aws__how ul{margin:.5rem 0 0;padding-left:1.1rem;line-height:1.5}
.aws__row button:hover:not([disabled]){filter:brightness(1.08)}
.aws__prompts button:hover{background:var(--surface);border-color:var(--text)}
.aws__prompts button{text-align:left}
.aws__prompts .has-proves{flex:1 1 100%;display:block;line-height:1.4}
.aws__prompts .p-q{display:block;font-weight:700}
.aws__prompts .p-proves{display:block;margin-top:.2rem;font-size:.75rem;font-weight:400;color:var(--text-body)}
.aws__prompts .p-proves b{color:var(--text);font-weight:700}
@media(max-width:850px){.aws__flow{flex-direction:column;gap:2rem}.aws__node:not(:last-child)::after{top:auto;right:auto;bottom:-1.6rem;left:50%;width:0;height:1.2rem;border-top:0;border-left:2px solid var(--muted)}.aws__node:not(:last-child)::before{top:auto;right:auto;bottom:-1.85rem;left:50%;margin:0 0 0 -5px;border-left:5px solid transparent;border-right:5px solid transparent;border-top:7px solid var(--muted);border-bottom:0}}
`;

// Classic script. No template literals inside: this string is itself a template literal in the page.
// The tab bar's own handling is TABS_SCRIPT above.
export const AWS_TAB_SCRIPT = String.raw`(function(){
var hub=document.getElementById('aws-hub'),hubNote=document.getElementById('aws-hub-note'),hubChip=document.getElementById('aws-hub-chip');
hub.addEventListener('change',function(){hubNote.hidden=!hub.checked;hubChip.hidden=!hub.checked});
var WORDS={idle:'waiting',working:'working…',ok:'done',refused:'refused',error:'stopped'};
var IDS=['custodian','main','gateway','aws'];
var simulated=false;
function setState(id,state,word){
  var el=document.getElementById('aws-n-'+id);if(!el)return;
  el.dataset.state=state;document.getElementById('aws-s-'+id).textContent=word||WORDS[state];
}
function resetFlow(){IDS.forEach(function(id){setState(id,'idle')})}
fetch('/status').then(function(r){return r.json()}).then(function(s){
  var info=s.awsAgent||{};simulated=Boolean(info.simulated);
  document.getElementById('aws-name-custodian').textContent=info.custodian||'Custodian';
  document.getElementById('aws-mode').textContent=simulated
    ?'SIMULATED: no Privilege gateway and no AWS in this run. The AWS agent is a local stand-in. Set AWS_AGENT_A2A_URL to your gateway route to go live.'
    :'LIVE route: the call goes to your Privilege gateway, which forwards it to the AWS agent. The answer is the AWS agent\'s own.';
  if(simulated)document.getElementById('aws-refuse-note').textContent='Sends the first suggested question with a deliberately invalid credential. In this simulated run the local stand-in refuses it, not a gateway.';
  if(simulated)document.getElementById('aws-sub-gateway').textContent='Not in the path in this run: the stand-in is called directly. A live run goes through the gateway.';
}).catch(function(){document.getElementById('aws-mode').textContent='Could not read the route settings from the main agent.'});

var trace=document.getElementById('aws-trace'),answer=document.getElementById('aws-answer'),form=document.getElementById('aws-form'),input=document.getElementById('aws-input'),send=document.getElementById('aws-send');
function wireBlock(label,body){
  var d=document.createElement('details');d.className='aws__wire';var s=document.createElement('summary');s.textContent=label;d.appendChild(s);
  var p=document.createElement('pre');p.textContent=body;d.appendChild(p);return d;
}
function cardBlock(c){
  var dl=document.createElement('dl');dl.className='aws__card';dl.setAttribute('aria-label','Agent Card fields');
  function row(k,v){
    if(Array.isArray(v))v=v.join(', ');
    var dt=document.createElement('dt');dt.textContent=k;var dd=document.createElement('dd');dd.textContent=v||'not declared';
    dl.appendChild(dt);dl.appendChild(dd);
  }
  row('name',c.name);row('description',c.description);row('protocolVersion',c.protocolVersion);row('preferredTransport',c.preferredTransport);
  row('url',c.url);row('skills',c.skills);row('capabilities',c.capabilities);
  var ins=(c.inputModes||[]).join(', '),outs=(c.outputModes||[]).join(', ');
  row('input / output modes',[ins&&'in: '+ins,outs&&'out: '+outs].filter(Boolean).join(' · '));row('securitySchemes',c.security);
  return dl;
}
function addStep(t){
  var empty=trace.querySelector('.aws__empty');if(empty)empty.remove();
  var li=document.createElement('li');li.className='aws__step';li.dataset.kind=t.kind||'';
  var head=document.createElement('div');head.className='aws__step-head';
  var chip=document.createElement('span');chip.className='aws__chip';chip.textContent=t.kind||'step';head.appendChild(chip);
  var tx=document.createElement('span');tx.textContent=t.text||'';head.appendChild(tx);
  var at=document.createElement('span');at.className='aws__at';at.textContent=t.at||'';head.appendChild(at);
  li.appendChild(head);
  if(t.detail){var d=document.createElement('p');d.className='aws__detail';d.textContent=t.detail;li.appendChild(d)}
  if(t.card)li.appendChild(cardBlock(t.card));
  if(t.wire&&t.wire.status&&String(t.detail||'').indexOf('HTTP '+t.wire.status)<0){var w=document.createElement('p');w.className='aws__detail';w.textContent='HTTP '+t.wire.status+(t.wire.errorCode!==undefined?' · JSON-RPC '+t.wire.errorCode:'');li.appendChild(w)}
  if(t.request)li.appendChild(wireBlock('What was sent (key masked)',t.request));
  if(t.response)li.appendChild(wireBlock('What came back',t.response));
  trace.appendChild(li);
}
var reel=window.Reel?window.Reel.attach(document.getElementById('aws-reel')):null;
function onTrace(t){
  addStep(t);
  if(reel)reel.add(t);
  if(t.kind==='card'){setState('gateway',simulated?'ok':'working',simulated?'simulated':undefined)}
  else if(t.kind==='delegate'){setState('main','ok','sent');setState('gateway',simulated?'ok':'working',simulated?'simulated':undefined);setState('aws','working')}
  else if(t.kind==='result'){setState('gateway','ok',simulated?'simulated':undefined);setState('aws','ok','replied')}
  else if(t.kind==='error'){
    var status=t.wire&&t.wire.status;setState('main','ok','sent');
    if(!simulated&&(status===400||status===401||status===403||status===429)){setState('gateway','refused','refused (HTTP '+status+')');setState('aws','idle','not reached')}
    else if(!status){setState('gateway',simulated?'ok':'error',simulated?'simulated':'unreachable');setState('aws','error','not reached')}
    else{setState('gateway','ok',simulated?'simulated':'passed');setState('aws','error','stopped (HTTP '+status+')')}
  }
}
async function run(text,refusal){
  var started=false,failed=false;
  text=text.trim();if(!text||send.disabled)return;
  window.dispatchEvent(new CustomEvent('paad:run-start'));
  resetFlow();setState('custodian','ok','acting');setState('main','working');
  answer.textContent='';answer.className='aws__answer';trace.textContent='';if(reel)reel.clear();busy(true);
  try{
    var res=await fetch('/aws-agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(refusal?{message:text,refusal:true}:{message:text})});
    if(!res.ok||!res.body)throw new Error('HTTP '+res.status);started=true;
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
          else if(ev==='token'){answer.textContent+=p.text}
          else if(ev==='error'){answer.className='aws__answer is-error';answer.textContent=p.error}
        }
        cut=buf.indexOf('\n\n');
      }
    }
    if(!answer.textContent){answer.className='aws__answer is-error';answer.textContent='The run ended without an answer.'}
  }catch(err){
    answer.className='aws__answer is-error';answer.textContent='Request failed: '+err.message;setState('main','error','stopped');failed=true;
  }finally{busy(false);input.focus();window.dispatchEvent(new CustomEvent('paad:run-end',{detail:{ok:!failed}}));if(started)window.dispatchEvent(new CustomEvent('paad:run-done'))}
}
/* One request at a time: Send and the suggested questions are off while a run is in flight, and run() refuses on its own. */
function busy(on){send.disabled=on;document.querySelectorAll('.aws__prompts button').forEach(function(b){b.disabled=on});refuse.disabled=on}
var refuse=document.getElementById('aws-refuse');
refuse.addEventListener('click',function(){var first=document.querySelector('.aws__prompts button');run(first?first.getAttribute('data-q')||'':'',true)});
form.addEventListener('submit',function(e){e.preventDefault();if(send.disabled)return;var t=input.value;input.value='';run(t)});
document.querySelectorAll('.aws__prompts button').forEach(function(b){b.addEventListener('click',function(){run(b.getAttribute('data-q')||'')})});
})();`;
