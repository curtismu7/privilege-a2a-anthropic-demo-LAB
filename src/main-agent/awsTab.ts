// The "Custodian to AWS agent" tab: the path from the person accountable for the main agent's key, through the Privilege gateway,
// to an agent running in AWS, lit up step by step from the run's trace. Static markup, CSS and a classic script, like wiringDiagram.ts.
// The panel sets its own surface and ink from the shared tokens, so it reads in both themes although the rest of the page is styled dark.
// Everything the remote side sends is written with textContent, never as HTML.

export interface AwsPrompt {
  /** The question that is sent. */
  q: string;
  /** What running it shows; the button carries it as a caption. Optional. */
  proves?: string;
}

export const AWS_PROMPTS: readonly AwsPrompt[] = [
  {
    q: 'Introduce yourself: which agent are you, and where do you run?',
    proves: 'our agent, running on this machine, talks to the agent hosted in AWS (Bedrock AgentCore) through Privilege, and its reply comes back here. With no gateway route set, a local stand-in answers and says so.',
  },
  { q: 'Review cloud access for the data platform' },
  { q: 'Which service accounts hold roles they have not used?' },
  { q: 'Is any storage bucket publicly readable?' },
];

const promptButton = ({ q, proves }: AwsPrompt): string =>
  proves
    ? `<button type="button" class="has-proves" data-q="${q}"><span class="p-q">${q}</span><span class="p-proves"><b>Proves:</b> ${proves}</span></button>`
    : `<button type="button" data-q="${q}">${q}</button>`;

export const AWS_TABS_HTML = `<div class="tabs" role="tablist" aria-label="Demo views">
<button type="button" role="tab" id="tab-review" aria-selected="true" aria-controls="panel-review" data-testid="tab-review">Access review</button>
<button type="button" role="tab" id="tab-aws" aria-selected="false" aria-controls="panel-aws" tabindex="-1" data-testid="tab-aws">Custodian to AWS agent</button>
</div>`;

const node = (id: string, kicker: string, name: string, sub: string): string =>
  `<li class="aws__node" id="aws-n-${id}" data-state="idle"><span class="aws__kicker">${kicker}</span><span class="aws__name" id="aws-name-${id}">${name}</span><span class="aws__sub" id="aws-sub-${id}">${sub}</span><span class="aws__state" id="aws-s-${id}">waiting</span></li>`;

export const AWS_PANEL_HTML = `<section id="panel-aws" class="aws" role="tabpanel" aria-labelledby="tab-aws" hidden data-testid="aws-panel">
<h2 class="aws__h">Custodian to AWS agent, through Privilege</h2>
<p class="aws__lede">A person is accountable for the main agent's key. The agent acts under that key, Privilege checks every call, and only then does it reach the agent running in AWS.</p>
<p class="aws__note" id="aws-mode" role="note">Checking the route…</p>
<ol class="aws__flow" aria-label="Path from the custodian to the AWS agent">
${node('custodian', 'Custodian', 'Sample custodian', "Owns the main agent's key in the Agent Registry. The key's grants are the custodian's.")}
${node('main', 'Main agent', 'Main agent', 'Acts for the custodian. Sends the A2A message with its own key, never the custodian\'s sign-in.')}
${node('gateway', 'Privilege gateway', 'AI gateway', 'Checks the key, the a2a scope and the Remote Agent grant, screens the message, then forwards it.')}
${node('aws', 'AWS agent', 'Agent on AWS', "Runs in AWS (Bedrock AgentCore). It never sees the main agent's key: the gateway sends its own credential.")}
</ol>
<form id="aws-form" class="aws__form">
<label for="aws-input" class="aws__label">Ask the AWS agent</label>
<div class="aws__row"><input id="aws-input" autocomplete="off" maxlength="4000" placeholder="Ask about cloud access"><button id="aws-send" type="submit">Send</button></div>
<div class="aws__prompts" role="group" aria-label="Suggested questions">${AWS_PROMPTS.map(promptButton).join('')}</div>
</form>
<div id="aws-answer" class="aws__answer" role="status" aria-live="polite"></div>
<h3 class="aws__h3">What crossed each hop</h3>
<ol id="aws-trace" class="aws__trace"><li class="aws__empty">Send a question. Each step appears here, with what was sent and what came back.</li></ol>
<details class="aws__how"><summary>How to read this</summary>
<ul>
<li><b>Custodian.</b> The person accountable for the agent key. In Privilege, Remote Agent grants follow the custodian. The name is set with AWS_AGENT_CUSTODIAN; this app cannot read it from Privilege.</li>
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
export const AWS_TAB_SCRIPT = String.raw`(function(){
var review=document.getElementById('tab-review'),aws=document.getElementById('tab-aws');
var panels={review:document.getElementById('panel-review'),aws:document.getElementById('panel-aws')};
var tabs={review:review,aws:aws};
function select(which,focus){
  Object.keys(tabs).forEach(function(k){var on=k===which;tabs[k].setAttribute('aria-selected',String(on));tabs[k].tabIndex=on?0:-1;panels[k].hidden=!on});
  if(focus)tabs[which].focus();
  try{history.replaceState(null,'',which==='aws'?'#aws':location.pathname+location.search)}catch(e){}
}
review.addEventListener('click',function(){select('review')});
aws.addEventListener('click',function(){select('aws')});
[review,aws].forEach(function(tab){tab.addEventListener('keydown',function(e){
  var order=['review','aws'],i=order.indexOf(tab===review?'review':'aws');
  if(e.key==='ArrowRight')select(order[(i+1)%2],true);
  else if(e.key==='ArrowLeft')select(order[(i+1)%2],true);
  else if(e.key==='Home')select('review',true);
  else if(e.key==='End')select('aws',true);
})});
if(location.hash==='#aws')select('aws');

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
  if(simulated)document.getElementById('aws-sub-gateway').textContent='Not in the path in this run: the stand-in is called directly. A live run goes through the gateway.';
}).catch(function(){document.getElementById('aws-mode').textContent='Could not read the route settings from the main agent.'});

var trace=document.getElementById('aws-trace'),answer=document.getElementById('aws-answer'),form=document.getElementById('aws-form'),input=document.getElementById('aws-input'),send=document.getElementById('aws-send');
function wireBlock(label,body){
  var d=document.createElement('details');d.className='aws__wire';var s=document.createElement('summary');s.textContent=label;d.appendChild(s);
  var p=document.createElement('pre');p.textContent=body;d.appendChild(p);return d;
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
  if(t.wire&&t.wire.status&&String(t.detail||'').indexOf('HTTP '+t.wire.status)<0){var w=document.createElement('p');w.className='aws__detail';w.textContent='HTTP '+t.wire.status+(t.wire.errorCode!==undefined?' · JSON-RPC '+t.wire.errorCode:'');li.appendChild(w)}
  if(t.request)li.appendChild(wireBlock('What was sent (key masked)',t.request));
  if(t.response)li.appendChild(wireBlock('What came back',t.response));
  trace.appendChild(li);
}
function onTrace(t){
  addStep(t);
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
async function run(text){
  text=text.trim();if(!text)return;
  resetFlow();setState('custodian','ok','acting');setState('main','working');
  answer.textContent='';answer.className='aws__answer';trace.textContent='';send.disabled=true;
  try{
    var res=await fetch('/aws-agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text})});
    if(!res.ok||!res.body)throw new Error('HTTP '+res.status);
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
    answer.className='aws__answer is-error';answer.textContent='Request failed: '+err.message;setState('main','error','stopped');
  }finally{send.disabled=false;input.focus()}
}
form.addEventListener('submit',function(e){e.preventDefault();var t=input.value;input.value='';run(t)});
document.querySelectorAll('.aws__prompts button').forEach(function(b){b.addEventListener('click',function(){run(b.getAttribute('data-q')||'')})});
})();`;
