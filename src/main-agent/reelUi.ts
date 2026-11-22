// The API call reel, shared by both tabs: a strip of numbered frames, one per API call in a run, each with the call, its status,
// one fact and the specs that govern it. A frame opens a pop-out with the request, the reply, the decoded token and the spec lines.
// One classic script defines window.Reel; the reference table reaches it as data (REEL_DATA_SCRIPT). Everything that comes from a
// trace event is written with textContent, never as HTML. No template literals inside the script: it sits in a template literal.
import { CHALLENGE_INFO, CLAIM_INFO, HEADER_INFO, KIND_REFS, REEL_REFS } from './reelRefs.js';

/** The reference table as the page needs it. `<` is escaped so the data can never close the script element. */
export const REEL_DATA_SCRIPT = `window.REEL_DATA=${JSON.stringify({
  refs: REEL_REFS, claims: CLAIM_INFO, header: HEADER_INFO, challenge: CHALLENGE_INFO, kinds: KIND_REFS,
}).replace(/</g, '\\u003c')};`;

// Colour is never the only signal: every frame also says its status in words and a shape. Sizes are generous because the reel
// is meant to be read in a screen recording: frame text is 14px or more, the pop-out body 15px or more.
export const REEL_CSS = `
.reel__hint{margin:0 0 .4rem;font-size:.875rem;color:var(--text-body)}
.reel{display:flex;gap:.75rem;margin:0 0 1.25rem;padding:0 0 .6rem;list-style:none;overflow-x:auto;scrollbar-width:auto;scrollbar-color:var(--muted) var(--surface-2)}
.reel::-webkit-scrollbar{height:12px}
.reel::-webkit-scrollbar-track{background:var(--surface-2);border-radius:6px}
.reel::-webkit-scrollbar-thumb{background:var(--muted);border-radius:6px}
.reel__item{flex:0 0 auto;width:16.5rem;display:flex}
.reel__frame{flex:1;display:flex;flex-direction:column;gap:.35rem;align-items:flex-start;text-align:left;padding:.7rem .8rem;border:1px solid var(--border);border-top:6px solid var(--muted);border-radius:8px;background:var(--surface-2);color:var(--text);font:inherit;font-size:.875rem;line-height:1.4;cursor:pointer}
.reel__frame:hover{border-color:var(--text);filter:brightness(1.04)}
.reel__frame:focus-visible,.reel-close:focus-visible,.reel-dialog:focus-visible,.reel-dialog__body:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
.reel__frame[data-status=ok]{border-top-color:var(--status-ok)}
.reel__frame[data-status=note]{border-top-color:var(--status-warn)}
.reel__frame[data-status=refused],.reel__frame[data-status=error]{border-top-color:var(--danger-text)}
.reel__top{display:flex;align-items:center;gap:.5rem;width:100%}
.reel__num{display:inline-flex;align-items:center;justify-content:center;min-width:1.75rem;height:1.75rem;border-radius:999px;background:var(--text);color:var(--surface);font-weight:700;font-size:.875rem}
.reel__status{margin-left:auto;padding:0 .5rem;border:1px solid currentColor;border-radius:999px;font-size:.875rem;font-weight:700;white-space:nowrap}
.reel__frame[data-status=ok] .reel__status{color:var(--status-ok)}
.reel__frame[data-status=note] .reel__status{color:var(--status-warn)}
.reel__frame[data-status=refused] .reel__status,.reel__frame[data-status=error] .reel__status{color:var(--danger-text)}
.reel__title{font-size:1rem;font-weight:700;color:var(--text)}
.reel__line{font-family:var(--font-mono);font-size:.875rem;color:var(--text-body);overflow-wrap:anywhere}
.reel__fact{color:var(--text);overflow-wrap:anywhere}
.reel__chips{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:auto}
.reel__chip{padding:0 .5rem;border:1px solid var(--border);border-radius:999px;font-size:.875rem;color:var(--text-body);background:var(--surface)}
.reel-backdrop{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;padding:1rem;background:rgba(0,0,0,.6)}
.reel-dialog{display:flex;flex-direction:column;width:min(58rem,100%);max-height:calc(100vh - 2rem);border:2px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text-body);font-size:.9375rem;line-height:1.5}
.reel-dialog__head{display:flex;align-items:center;gap:.75rem;padding:.8rem 1rem;border-bottom:1px solid var(--border)}
.reel-dialog__title{flex:1;margin:0;font-size:1.125rem;color:var(--text);overflow-wrap:anywhere}
.reel-close{padding:.4rem .9rem;border:1px solid var(--border);border-radius:6px;background:var(--surface-2);color:var(--text);font:inherit;font-size:.9375rem;font-weight:600;cursor:pointer}
.reel-dialog__body{flex:1;overflow:auto;padding:.9rem 1rem 1.1rem}
.reel-sec{margin:0 0 1.1rem}
.reel-sec__h{margin:0 0 .4rem;font-size:1rem;color:var(--text)}
.reel__p{margin:0 0 .4rem;font-size:.9375rem}
.reel__pre{margin:0;padding:.6rem .7rem;border:1px solid var(--border);border-radius:6px;background:var(--surface-2);color:var(--text);font-family:var(--font-mono);font-size:.9375rem;white-space:pre-wrap;overflow-wrap:anywhere;max-height:18rem;overflow:auto}
.reel__table{width:100%;border-collapse:collapse;font-size:.9375rem}
.reel__table th,.reel__table td{padding:.4rem .6rem;border:1px solid var(--border);text-align:left;vertical-align:top}
.reel__table th{background:var(--surface-2);color:var(--text);font-weight:700}
.reel__table td:first-child{width:38%}
.reel__name{font-family:var(--font-mono);font-weight:700;color:var(--text)}
.reel__says{display:block;font-size:.9375rem}
.reel__val{display:block;font-family:var(--font-mono);white-space:pre-wrap;overflow-wrap:anywhere;color:var(--text)}
.reel__tag{display:inline-block;margin-top:.2rem;padding:0 .5rem;border:1px solid var(--border);border-radius:999px;font-size:.875rem;color:var(--text-body);background:var(--surface-2)}
.reel__specs{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:.5rem}
.reel__specs b{color:var(--text)}
@media(max-width:600px){.reel__item{width:14.5rem}.reel-backdrop{padding:.5rem}.reel-dialog{max-height:calc(100vh - 1rem)}.reel__table td:first-child{width:auto}}
@media(prefers-reduced-motion:no-preference){.reel__frame{transition:border-color .15s}}
`;

export const REEL_SCRIPT = String.raw`(function(){
var D=window.REEL_DATA||{refs:{},claims:{},header:{},challenge:{},kinds:{}};
function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined&&text!==null)e.textContent=String(text);return e}
function clip(s,n){s=String(s||'').replace(/\s+/g,' ').trim();return s.length>n?s.slice(0,n-1)+'…':s}
function minutes(sec){if(sec===undefined||sec===null||isNaN(sec))return '';var a=Math.abs(sec);return a>=120?Math.round(a/60)+' min':Math.round(a)+' s'}
function refIds(t){var ids=(t.refs&&t.refs.length)?t.refs:(t.kind==='error'&&t.from==='mcp'?['mcp-call']:null)||D.kinds[t.kind]||[];return ids.filter(function(id){return D.refs[id]})}
var TITLES={token:'Get a token',card:'Read the Agent Card',delegate:'Send the message',result:'Answer',metadata:'Read the sign-in metadata','mcp-call':'Call the tool','mcp-result':'Tool result'};
var WHAT={token:'token endpoint',card:'Agent Card',delegate:'A2A message',metadata:'sign-in metadata','mcp-call':'MCP tool call','mcp-result':'MCP tool reply',result:'reply',error:'A2A message'};
function code(t){return t.wire&&t.wire.status}
function isRefusal(t){var s=code(t);return Boolean(t.challenge)||s===400||s===401||s===403||s===429}
function blocked(t){return t.kind==='error'&&t.from==='mcp'&&/blocked|security policy|denied|forbidden/i.test(t.detail||'')}
function title(t){
  if(t.kind==='error'){
    if(blocked(t))return 'Tool reply blocked';
    if(isRefusal(t))return 'Refused';
    return (t.wire||t.from==='mcp'||/A2A|unreachable|AWS agent/.test(t.text||''))?'Stopped':'';
  }
  return TITLES[t.kind]||'';
}
function status(t){
  var s=code(t);
  if(t.kind==='error')return (isRefusal(t)||blocked(t))?'refused':'error';
  if(t.kind==='metadata')return (s&&s<400)?'ok':'note';
  if(t.kind==='card')return (s&&s>=400)||!s&&/No readable/.test(t.text||'')?'note':'ok';
  return 'ok';
}
var SYMBOL={ok:'✓',note:'!',refused:'✕',error:'!'};
var WORD={ok:'OK',note:'Note',refused:'Refused',error:'Stopped'};
function line(t){
  var first=String(t.request||'').split('\n')[0],m=/^(GET|POST|PUT|DELETE)\s/.exec(first),s=code(t);
  return (m?m[1]+' ':'')+(t.kind==='error'&&t.from==='mcp'?'MCP tool reply':(WHAT[t.kind]||t.kind))+(s?' → '+s:'');
}
function fact(t){
  var tk=t.token;
  if(t.kind==='token')return tk&&tk.kind==='jwt'&&tk.lifetimeSeconds!==undefined?'Token lives '+minutes(tk.lifetimeSeconds):clip(t.detail,90);
  if(t.kind==='card')return t.card&&t.card.name?'Agent: '+t.card.name:clip(t.detail,90);
  if(t.kind==='delegate'){
    if(tk&&tk.kind==='jwt')return 'Sends the token'+(tk.expiresInSeconds!==undefined?(tk.expiresInSeconds>0?', '+minutes(tk.expiresInSeconds)+' left':', already expired'):'');
    if(tk&&tk.kind==='opaque')return 'Sends an opaque key, shown masked';
    return clip(t.detail,90);
  }
  if(t.kind==='error'){var p=t.challenge&&t.challenge.params;return p&&p.error?'error="'+p.error+'"':clip(t.detail,90)}
  if(t.kind==='result')return t.elapsedMs?'Answered in '+(t.elapsedMs/1000).toFixed(1)+' s':clip(t.detail,90);
  if(t.kind==='mcp-result')return /REDACTED/.test(t.detail||'')?'Personal data redacted':clip(t.detail,90);
  return clip(t.detail,90);
}

function section(heading){var s=el('section','reel-sec');s.appendChild(el('h4','reel-sec__h',heading));return s}
function pre(text){return el('pre','reel__pre',text)}
function refTag(id){var r=D.refs[id];return r?el('span','reel__tag',r.label):null}
function valueText(k,v){
  if(v!==null&&typeof v==='object')return JSON.stringify(v,null,2);
  if((k==='exp'||k==='iat'||k==='nbf')&&typeof v==='number'){var d=new Date(v*1000);return isNaN(d.getTime())?String(v):String(v)+'  ('+d.toISOString()+')'}
  if(v==='')return '(empty)';
  return String(v);
}
function rowFor(name,value,info){
  var tr=document.createElement('tr'),a=el('td'),b=el('td');
  a.appendChild(el('span','reel__name',name));
  if(info)a.appendChild(el('span','reel__says',info.says));
  b.appendChild(el('span','reel__val',value));
  if(info){var tag=refTag(info.ref);if(tag)b.appendChild(tag)}
  tr.appendChild(a);tr.appendChild(b);return tr;
}
function tokenSection(tk){
  var s=section('The token');
  if(tk.kind!=='jwt'){s.appendChild(el('p','reel__p','An opaque key, shown masked. It is not a JWT, so there is nothing to decode ('+tk.length+' characters).'));return s}
  var table=el('table','reel__table'),head=document.createElement('thead'),hr=document.createElement('tr');
  hr.appendChild(el('th',null,'Field'));hr.appendChild(el('th',null,'Value'));head.appendChild(hr);table.appendChild(head);
  var body=document.createElement('tbody');
  Object.keys(tk.header||{}).forEach(function(k){body.appendChild(rowFor('header.'+k,tk.header[k],D.header[k]))});
  Object.keys(tk.claims||{}).forEach(function(k){body.appendChild(rowFor(k,valueText(k,tk.claims[k]),D.claims[k]))});
  table.appendChild(body);s.appendChild(table);
  var life=[];
  if(tk.lifetimeSeconds!==undefined)life.push('Valid for '+minutes(tk.lifetimeSeconds)+' when issued.');
  if(tk.expiresInSeconds!==undefined)life.push(tk.expiresInSeconds>0?'It had '+minutes(tk.expiresInSeconds)+' left when this call was made.':'It had already expired when this call was made.');
  if(life.length)s.appendChild(el('p','reel__p',life.join(' ')));
  s.appendChild(el('p','reel__p','Signature: hidden. This token was '+tk.note+'.'));
  return s;
}
function challengeSection(ch){
  var s=section('The challenge'),table=el('table','reel__table'),body=document.createElement('tbody');
  body.appendChild(rowFor('scheme',ch.scheme,D.challenge.scheme));
  Object.keys(ch.params||{}).forEach(function(k){body.appendChild(rowFor(k,ch.params[k],D.challenge[k]))});
  table.appendChild(body);s.appendChild(table);return s;
}

var backdrop=null,dialog=null,titleEl=null,bodyEl=null,closeBtn=null,opener=null;
function close(){
  if(!backdrop||backdrop.hidden)return;
  backdrop.hidden=true;
  var back=opener;opener=null;if(back&&document.contains(back))back.focus();
}
function onKey(e){
  if(!backdrop||backdrop.hidden)return;
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();return}
  if(e.key==='Tab'){
    var stops=[closeBtn,bodyEl],i=stops.indexOf(document.activeElement);
    if(e.shiftKey){if(i<=0){e.preventDefault();stops[stops.length-1].focus()}}
    else if(i<0||i===stops.length-1){e.preventDefault();stops[0].focus()}
  }
}
function ensureDialog(){
  if(backdrop)return;
  backdrop=el('div','reel-backdrop');backdrop.hidden=true;
  dialog=el('div','reel-dialog');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','reel-dialog-title');dialog.tabIndex=-1;
  var head=el('div','reel-dialog__head');titleEl=el('h3','reel-dialog__title');titleEl.id='reel-dialog-title';
  closeBtn=el('button','reel-close','Close');closeBtn.type='button';closeBtn.setAttribute('aria-label','Close the details');
  head.appendChild(titleEl);head.appendChild(closeBtn);
  bodyEl=el('div','reel-dialog__body');bodyEl.tabIndex=0;
  dialog.appendChild(head);dialog.appendChild(bodyEl);backdrop.appendChild(dialog);document.body.appendChild(backdrop);
  closeBtn.addEventListener('click',close);
  backdrop.addEventListener('mousedown',function(e){if(e.target===backdrop)close()});
  document.addEventListener('keydown',onKey,true);
}
function open(t,n,opener0){
  ensureDialog();opener=opener0;
  titleEl.textContent=n+'. '+title(t)+' ('+line(t)+')';
  bodyEl.textContent='';
  var call=section('The call');
  call.appendChild(t.request?pre(t.request):el('p','reel__p',t.text||'No request text for this step.'));
  bodyEl.appendChild(call);
  var back=section('What came back');
  if(t.response)back.appendChild(pre(t.response));
  else back.appendChild(el('p','reel__p',t.kind==='delegate'?'The reply is not part of this call: it arrives as a later frame.':(t.detail||(code(t)?'HTTP '+code(t):'Nothing was returned for this step.'))));
  bodyEl.appendChild(back);
  if(t.token)bodyEl.appendChild(tokenSection(t.token));
  if(t.challenge)bodyEl.appendChild(challengeSection(t.challenge));
  var ids=refIds(t);
  if(ids.length){
    var sp=section('What the specs say'),ul=el('ul','reel__specs');
    ids.forEach(function(id){var li=document.createElement('li');li.appendChild(el('b',null,D.refs[id].label+': '));li.appendChild(document.createTextNode(D.refs[id].says));ul.appendChild(li)});
    sp.appendChild(ul);bodyEl.appendChild(sp);
  }
  backdrop.hidden=false;bodyEl.scrollTop=0;closeBtn.focus();
}

function attach(ol){
  ol.classList.add('reel');ol.hidden=true;
  var hint=el('p','reel__hint','API calls in this run. Select a call for the request, the reply, the decoded token and the specs behind it.');hint.hidden=true;
  ol.parentNode.insertBefore(hint,ol);
  var sent=null,sentMcp=null;
  return {
    add:function(t){
      // A refusal has no request of its own: it is the answer to the message that was just sent, so show that message as its call.
      if(t.kind==='delegate')sent=t;
      else if(t.kind==='mcp-call')sentMcp=t;
      else if(t.kind==='error'&&!t.request&&t.from==='mcp'&&sentMcp){var m={};Object.keys(t).forEach(function(k){m[k]=t[k]});m.request=(sentMcp.text||'MCP tool call')+'\n'+(sentMcp.detail||'');t=m}
      else if(t.kind==='error'&&!t.request&&sent){var c={};Object.keys(t).forEach(function(k){c[k]=t[k]});c.request=sent.request;if(!c.token&&sent.token)c.token=sent.token;t=c}
      var ttl=title(t);if(!ttl)return;
      var n=ol.children.length+1,st=status(t);
      var li=el('li','reel__item'),b=el('button','reel__frame');b.type='button';b.dataset.status=st;
      b.setAttribute('aria-haspopup','dialog');
      var top=el('span','reel__top');top.appendChild(el('span','reel__num',n));
      top.appendChild(el('span','reel__status',SYMBOL[st]+' '+(code(t)&&st==='ok'?code(t):(st==='refused'&&blocked(t)?'Blocked':WORD[st]))));
      b.appendChild(top);b.appendChild(el('span','reel__title',ttl));b.appendChild(el('span','reel__line',line(t)));
      var f=fact(t);if(f)b.appendChild(el('span','reel__fact',f));
      var ids=refIds(t);
      if(ids.length){
        var chips=el('span','reel__chips');
        ids.slice(0,3).forEach(function(id){chips.appendChild(el('span','reel__chip',D.refs[id].label))});
        if(ids.length>3)chips.appendChild(el('span','reel__chip','+'+(ids.length-3)+' more'));
        b.appendChild(chips);
      }
      b.addEventListener('click',function(){open(t,n,b)});
      li.appendChild(b);ol.appendChild(li);ol.hidden=false;hint.hidden=false;
      try{li.scrollIntoView({block:'nearest',inline:'nearest'})}catch(e){}
    },
    clear:function(){ol.textContent='';ol.hidden=true;hint.hidden=true;sent=null;sentMcp=null}
  };
}
window.Reel={attach:attach,close:close};
})();`;
