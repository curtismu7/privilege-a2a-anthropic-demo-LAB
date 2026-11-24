import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderPage } from '../src/main-agent/ui.js';
import { AWS_PANEL_HTML, TABS_SCRIPT } from '../src/main-agent/awsTab.js';
import { BEDROCK_DATA_SCRIPT, BEDROCK_PANEL_HTML, BEDROCK_SCENARIOS, BEDROCK_TAB_CSS, BEDROCK_TAB_SCRIPT } from '../src/main-agent/bedrockTab.js';

const page = renderPage();

test('the page has three tabs in order, the Bedrock panel hidden after the AWS one', () => {
  const tabs = [...page.matchAll(/role="tab" id="tab-([a-z]+)" aria-selected="(true|false)"/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(tabs, [['review', 'true'], ['aws', 'false'], ['bedrock', 'false']]);
  assert.match(page, /id="tab-bedrock"[^>]*aria-controls="panel-bedrock" tabindex="-1"[^>]*>Gateway to Bedrock \(IAM\)<\/button>/);
  assert.match(page, /<section id="panel-bedrock" class="aws bedrock" role="tabpanel" aria-labelledby="tab-bedrock" hidden/);
  assert.ok(page.indexOf('id="panel-aws"') < page.indexOf('id="panel-bedrock"'), 'after the AWS panel, so the video\'s first-match selectors still find the AWS tab');
  assert.ok(page.indexOf(TABS_SCRIPT) > 0 && page.indexOf(TABS_SCRIPT) < page.indexOf(BEDROCK_TAB_SCRIPT));
});

test('the tab bar handles three tabs: arrows wrap both ways, Home and End, and the #aws and #bedrock hashes', () => {
  assert.ok(TABS_SCRIPT.includes("var order=['review','aws','bedrock']"));
  assert.ok(TABS_SCRIPT.includes("order[(i+1)%n]") && TABS_SCRIPT.includes("order[(i+n-1)%n]") && TABS_SCRIPT.includes('e.preventDefault()'));
  assert.ok(TABS_SCRIPT.includes("location.hash==='#aws'||location.hash==='#bedrock'"));
  // (behaviour in a real DOM: web/src/bedrockTab.test.js)
});

test('the Bedrock tab: the simulated banner, the five flow nodes in order, and the answer, reel and trace', () => {
  assert.match(BEDROCK_PANEL_HTML, /id="bedrock-mode" role="note">SIMULATED, in Mock and in Real: nothing in Privilege or AWS is called\. A live run needs a gateway with an IAM role/);
  const order = ['main', 'gateway', 'sts', 'guard', 'model'].map((id) => BEDROCK_PANEL_HTML.indexOf(`id="bedrock-n-${id}"`));
  assert.ok(order.every((at) => at > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  for (const id of ['bedrock-answer', 'bedrock-reel', 'bedrock-trace', 'bedrock-iam', 'bedrock-input', 'bedrock-send']) assert.ok(BEDROCK_PANEL_HTML.includes(`id="${id}"`), id);
  assert.ok(BEDROCK_TAB_SCRIPT.includes("window.Reel.attach($('bedrock-reel'))"));
  assert.ok(!/class="[^"]*aws__flow/.test(BEDROCK_PANEL_HTML) && !BEDROCK_PANEL_HTML.includes('aws__prompts'), 'no class the AWS tab\'s script or the video selects by');
});

test('the key settings mirror the console: its labels and its IAM hint, the default session name, the bearer-token note', () => {
  const key = BEDROCK_PANEL_HTML.slice(BEDROCK_PANEL_HTML.indexOf('id="bedrock-key"'), BEDROCK_PANEL_HTML.indexOf('</fieldset>'));
  assert.match(key, /<legend>Model Access &amp; Limits/);
  for (const label of ['Provider', 'Region', 'Sign as this gateway (IAM)', 'Role ARN', 'External ID', 'Session Name', 'Upstream URL']) assert.ok(key.includes(`<span>${label}`) || key.includes(`">${label}`), label);
  assert.ok(key.includes("Authenticate with SigV4 as this gateway's own AWS identity instead of a Bedrock API key"));
  assert.ok(key.includes('<option value="runtime" selected>AWS Bedrock (Runtime)</option><option value="mantle">AWS Bedrock (Mantle)</option>'));
  assert.ok(key.includes('id="bedrock-session" value="privilege-ai-gateway" maxlength="64"'));
  assert.match(key, /id="bedrock-region" value="us-east-1" required/);
  assert.match(key, /the agent still sends its virtual key as a bearer token, and the gateway replaces it/);
  assert.ok(!/\b\d{12}\b/.test(BEDROCK_PANEL_HTML.replace(/111122223333|444455556666/g, '')), 'only the example accounts');
  for (const m of BEDROCK_PANEL_HTML.matchAll(/https?:\/\/([^/\s"<]+)/g)) assert.match(m[1] ?? '', /\.example$/);
});

test('nine scenario buttons with the ids Story presses, and the scenarios reach the script as data', () => {
  const ids = [...BEDROCK_PANEL_HTML.matchAll(/<button type="button" id="(bedrock-sc-[a-z-]+)" data-scenario="([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['apikey', 'own', 'mantle', 'same', 'cross', 'wrong-ext', 'denied', 'fail-closed', 'fail-open'].map((id) => `bedrock-sc-${id}`));
  assert.equal(BEDROCK_SCENARIOS.length, 9);
  assert.ok(!BEDROCK_DATA_SCRIPT.includes('</'));
  assert.doesNotThrow(() => new Function(BEDROCK_DATA_SCRIPT));
  assert.ok(page.includes(`<script>${BEDROCK_DATA_SCRIPT}${BEDROCK_TAB_SCRIPT}</script>`));
});

test('the permissions list follows the Provider, and names the IAM facts the spec asks for', () => {
  const iam = BEDROCK_PANEL_HTML.slice(BEDROCK_PANEL_HTML.indexOf('id="bedrock-iam"'));
  for (const [forWhat, perm] of [['runtime', 'bedrock:InvokeModel'], ['runtime', 'bedrock:InvokeModelWithResponseStream'], ['runtime', 'bedrock:CountTokens'],
    ['mantle', 'bedrock-mantle:CreateInference'], ['mantle', 'bedrock-mantle:DeleteInference'], ['mantle', 'bedrock-mantle:CountTokens'], ['guard', 'bedrock:ApplyGuardrail'], ['role', 'sts:AssumeRole']]) {
    assert.match(iam, new RegExp(`<li data-for="${forWhat}"><code>${perm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), perm);
  }
  for (const fact of ['sts:ExternalId condition', 'With Sign as this gateway (IAM) on, <code>bedrock:CallWithBearerToken</code> is not used', 'AWS Marketplace subscription', 'Model access not enabled', 'with <code>::</code>', 'cross-region inference profile', 'hop limit of 1']) assert.ok(iam.includes(fact), fact);
});

test('the Bedrock script compiles, builds no HTML from remote text, keeps its newline escapes, and announces its runs', () => {
  assert.doesNotThrow(() => new Function(BEDROCK_TAB_SCRIPT));
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write|outerHTML/.test(BEDROCK_TAB_SCRIPT));
  assert.ok(!BEDROCK_TAB_SCRIPT.includes('${'));
  assert.ok(BEDROCK_TAB_SCRIPT.includes("buf.indexOf('\\n\\n')"));
  assert.ok(BEDROCK_TAB_SCRIPT.includes("new CustomEvent('paad:run-start')") && BEDROCK_TAB_SCRIPT.includes("new CustomEvent('paad:run-end',{detail:{ok:!failed}})"));
  assert.ok(BEDROCK_TAB_SCRIPT.includes("fetch('/bedrock'"));
  for (const source of [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? '')) assert.doesNotThrow(() => new Function(source));
});

test('every id on the page is used once (the IAM checkbox once shared its id with the "What the IAM role needs" panel Story points at)', () => {
  const ids = [...page.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const twice = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(twice, []);
  assert.match(BEDROCK_PANEL_HTML, /<details id="bedrock-iam" class="aws__how">/);
  assert.ok(BEDROCK_TAB_SCRIPT.includes("iam:$('bedrock-sign')"));
});

test('the checkboxes keep their size: the page\'s own input rule (flex:1) once stretched them and pushed the IAM label off its box', () => {
  assert.match(page, /input\{flex:1;/, 'the rule this guards against');
  for (const cls of ['bedrock__toggle', 'bedrock__check']) assert.ok(BEDROCK_TAB_CSS.includes(`.bedrock .${cls} input[type=checkbox]{flex:none;`), cls);
  assert.match(BEDROCK_PANEL_HTML, /<div class="bedrock__toggle"><label><input type="checkbox" id="bedrock-sign"/);
});

test('the lede limits the no-AWS-key claim to IAM signing, since the stored-key scenario injects a Bedrock API key (review)', () => {
  assert.match(BEDROCK_PANEL_HTML, /With Sign as this gateway \(IAM\) on, no AWS key exists in the agent or in the gateway's settings/);
  assert.match(BEDROCK_PANEL_HTML, /With it off, the gateway injects a stored Bedrock API key instead\./);
  assert.ok(!BEDROCK_PANEL_HTML.includes("holds only its Privilege key. No AWS access key exists"));
});

test('no hint sits inside its label, so a screen reader reads it once, as the description (review, PR #64)', () => {
  const labels = [...BEDROCK_PANEL_HTML.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)].map((m) => m[1] ?? '');
  assert.ok(labels.length > 8);
  for (const l of labels) assert.ok(!l.includes('<small'), l.slice(0, 80));
  for (const id of ['bedrock-region-hint', 'bedrock-sign-hint', 'bedrock-session-hint', 'bedrock-upstream-hint']) {
    assert.ok(BEDROCK_PANEL_HTML.includes(`aria-describedby="${id}"`) && BEDROCK_PANEL_HTML.includes(`<small id="${id}">`), id);
  }
  for (const id of ['bedrock-region', 'bedrock-session', 'bedrock-upstream']) assert.ok(BEDROCK_PANEL_HTML.includes(`<label for="${id}">`), id);
});

test('the Role ARN field takes the whole row, so the role name is not cut off (review, PR #64)', () => {
  assert.match(BEDROCK_PANEL_HTML, /<label class="bedrock__field bedrock__field--wide"><span>Role ARN<\/span><select id="bedrock-role">/);
  assert.ok(BEDROCK_TAB_CSS.includes('.bedrock__field--wide{grid-column:1/-1}'));
});

test('CallWithBearerToken is qualified by the IAM setting, and the IAM-off case says what applies then (review, PR #64)', () => {
  assert.match(BEDROCK_PANEL_HTML, /<li data-for="iam">With Sign as this gateway \(IAM\) on, <code>bedrock:CallWithBearerToken<\/code> is not used/);
  assert.match(BEDROCK_PANEL_HTML, /<li data-for="noiam">With Sign as this gateway \(IAM\) off, the gateway sends the stored Bedrock API key as a bearer token/);
  assert.ok(!/<li><code>bedrock:CallWithBearerToken<\/code> is not used/.test(BEDROCK_PANEL_HTML));
  assert.ok(BEDROCK_TAB_SCRIPT.includes("#bedrock-iam li[data-for]") && BEDROCK_TAB_SCRIPT.includes("(f==='noiam'&&!iam)"));
});

test('the Bedrock tab text stays at 12px or more, and the markup has no inline style', () => {
  const sizes = [...BEDROCK_TAB_CSS.matchAll(/font-size:([\d.]+)rem/g)].map((m) => Number(m[1]) * 16);
  assert.ok(sizes.length > 0 && Math.min(...sizes) >= 12, `smallest is ${Math.min(...sizes)}px`);
  assert.ok(!/style=/.test(BEDROCK_PANEL_HTML));
});

test('the AWS tab panel is unchanged by the new tab', () => {
  assert.ok(page.includes(AWS_PANEL_HTML));
  assert.ok(!AWS_PANEL_HTML.includes('bedrock'));
});
