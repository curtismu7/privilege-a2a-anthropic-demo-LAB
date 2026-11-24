import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CROSS_ROLE, DEFAULT_SESSION_NAME, MAX_BEDROCK_MESSAGE, PERMISSIONS, SAME_ROLE, isDeniedTopic, parseBedrockBody, simulateBedrock, type BedrockInput, type BedrockRun } from '../src/bedrockSim.js';
import { BEDROCK_SCENARIOS, CLEAN_Q, DENIED_Q } from '../src/main-agent/bedrockTab.js';
import { notesFor } from '../src/runObs.js';

/** The input a scenario button sends (the page's settings() for that scenario). */
function inputFor(id: string, provider?: 'runtime' | 'mantle'): BedrockInput {
  const s = BEDROCK_SCENARIOS.find((x) => x.id === id);
  assert.ok(s, id);
  const parsed = parseBedrockBody({ message: s.q, provider: provider ?? s.provider, iam: s.iam, identity: s.role || 'own', externalId: s.ext, sessionName: '', guard: { on: s.guard, failClosed: s.failClosed, reachable: s.reachable } });
  assert.ok(parsed.ok, id);
  return parsed.input;
}
const run = (id: string, provider?: 'runtime' | 'mantle'): BedrockRun => simulateBedrock(inputFor(id, provider));
const steps = (r: BedrockRun): string[] => r.events.map((e) => e.step);
const titles = (r: BedrockRun): string[] => r.events.flatMap((e) => (e.reel ? [e.reel.title] : []));
/** The flow nodes as the page shows them after the whole run (each event's `nodes` applied in order). */
function finalNodes(r: BedrockRun): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of r.events) for (const [id, v] of Object.entries(e.nodes)) if (v) out[id] = `${v[0]}:${v[1]}`;
  return out;
}

test('the nine scenarios are exactly the spec table, with the button ids Story presses', () => {
  assert.deepEqual(BEDROCK_SCENARIOS.map((s) => s.id), ['apikey', 'own', 'mantle', 'same', 'cross', 'wrong-ext', 'denied', 'fail-closed', 'fail-open']);
});

test('apikey: IAM off, a stored Bedrock API key is injected, no STS step, the model answers', () => {
  const r = run('apikey');
  assert.equal(r.outcome, 'answered');
  assert.deepEqual(steps(r), ['send', 'identity', 'model']);
  assert.deepEqual(titles(r), ['Send the prompt', 'Call the model']);
  assert.match(r.events[1]?.detail ?? '', /stored on the agent key \(the Real Provider Key\)/);
  const model = r.events.at(-1);
  assert.match(model?.request ?? '', /Authorization: Bearer \(the stored Bedrock API key, masked\)/);
  assert.ok(!/AWS4-HMAC-SHA256/.test(model?.request ?? ''), 'not SigV4-signed');
  assert.equal(finalNodes(r).sts, 'skipped:not used (stored key)');
  assert.equal(finalNodes(r).gateway, 'ok:key injected');
  assert.match(r.answer ?? '', /^SIMULATED answer: no Bedrock model was called/);
});

test('own (A1): signed with the gateway\'s own role, no STS step, the model answers on Runtime (Converse)', () => {
  const r = run('own');
  assert.equal(r.outcome, 'answered');
  assert.deepEqual(steps(r), ['send', 'identity', 'model']);
  assert.match(r.events[1]?.detail ?? '', /EC2 instance role arn:aws:iam::111122223333:role\/privilege-gateway, read from the instance metadata service \(IMDS\)/);
  const model = r.events.at(-1);
  assert.match(model?.request ?? '', /^POST https:\/\/bedrock-runtime\.us-east-1\.aws\.example\/model\/[^/]+\/converse\n/);
  assert.match(model?.request ?? '', /AWS4-HMAC-SHA256 Credential=ASIA…EXAMPLE \(masked\)\/<yyyymmdd>\/us-east-1\/bedrock\/aws4_request/);
  assert.deepEqual(finalNodes(r), { main: 'ok:sent', gateway: 'ok:signed and forwarded', sts: 'skipped:not used (own role)', guard: 'skipped:off', model: 'ok:answered' });
});

test('mantle (A1 on Mantle): CreateInference, then always DeleteInference; the model answers', () => {
  const r = run('mantle');
  assert.equal(r.outcome, 'answered');
  const model = r.events.at(-1);
  assert.equal(model?.reel?.what, 'CreateInference + DeleteInference');
  const req = model?.request ?? '';
  assert.ok(req.indexOf('(CreateInference') > 0 && req.indexOf('(DeleteInference)') > req.indexOf('(CreateInference'), 'create, then delete');
  assert.match(req, /bedrock-mantle\/aws4_request/);
  assert.match(model?.response ?? '', /DeleteInference: the inference is released/);
  assert.match(r.answer ?? '', /AWS Bedrock \(Mantle\)/);
  // The same case on Runtime has no Mantle call in it.
  assert.ok(!/Inference/.test(run('own').events.at(-1)?.request ?? ''));
});

test('same (A2) and cross (A3): AssumeRole with the matching External ID succeeds in that account, then the model answers', () => {
  for (const [id, arn, account] of [['same', SAME_ROLE, '111122223333'], ['cross', CROSS_ROLE, '444455556666']] as const) {
    for (const provider of ['runtime', 'mantle'] as const) {
      const r = run(id, provider);
      assert.equal(r.outcome, 'answered', `${id} ${provider}`);
      assert.deepEqual(steps(r), ['send', 'sts', 'model']);
      assert.deepEqual(titles(r), ['Send the prompt', 'Assume the role', 'Call the model']);
      const sts = r.events[1];
      assert.equal(sts?.wire?.status, 200);
      assert.match(sts?.request ?? '', new RegExp(`RoleArn=${arn.replace(/[/:]/g, (c) => `\\${c}`)}&RoleSessionName=${DEFAULT_SESSION_NAME}&ExternalId=\\(the agreed External ID, masked\\)`));
      assert.match(sts?.response ?? '', new RegExp(`arn:aws:sts::${account}:assumed-role/privilege-bedrock/${DEFAULT_SESSION_NAME}`));
      assert.equal(finalNodes(r).sts, 'ok:role assumed');
      assert.equal(finalNodes(r).model, 'ok:answered');
    }
  }
});

test('wrong-ext (A3, wrong External ID): AssumeRole denied, then a generic 502 upstream_unreachable that does not say why', () => {
  const r = run('wrong-ext');
  assert.equal(r.outcome, 'refused');
  assert.deepEqual(steps(r), ['send', 'sts', 'refused']);
  assert.deepEqual(titles(r), ['Send the prompt', 'Assume the role', 'Refused']);
  assert.match(r.events[1]?.request ?? '', /ExternalId=not-the-agreed-value/);
  assert.equal(r.events[1]?.wire?.status, 403);
  assert.match(r.events[1]?.response ?? '', /<Code>AccessDenied<\/Code>/);
  const refused = r.events[2];
  assert.equal(refused?.wire?.status, 502);
  assert.match(refused?.response ?? '', /"error": "upstream_unreachable"/);
  assert.ok(!/ExternalId|AccessDenied|AssumeRole/.test(refused?.response ?? ''), 'the caller\'s answer carries no reason');
  assert.match(refused?.detail ?? '', /cannot tell/);
  assert.match(r.error ?? '', /^HTTP 502 · \{"error":"upstream_unreachable"\}/);
  assert.equal(r.answer, undefined);
  assert.deepEqual(finalNodes(r), { main: 'ok:sent', gateway: 'error:502 to the caller', sts: 'refused:refused (AccessDenied)', guard: 'skipped:off', model: 'skipped:not reached' });
});

test('a missing External ID is refused the same way, and no ExternalId is sent', () => {
  const p = parseBedrockBody({ message: CLEAN_Q, identity: 'cross', externalId: 'missing' });
  assert.ok(p.ok);
  const r = simulateBedrock(p.input);
  assert.equal(r.outcome, 'refused');
  assert.ok(!/ExternalId=/.test(r.events[1]?.request ?? ''));
  assert.match(r.events[1]?.detail ?? '', /no External ID was sent/);
});

test('denied: the guardrail intervenes on investment advice and the model is never called', () => {
  const r = run('denied');
  assert.equal(r.outcome, 'blocked');
  assert.deepEqual(steps(r), ['send', 'identity', 'guard', 'blocked']);
  assert.deepEqual(titles(r), ['Send the prompt', 'Check the guardrail', 'Blocked']);
  assert.match(r.events[2]?.request ?? '', /\/guardrail\/[^/]+\/version\/1\/apply/);
  assert.match(r.events[2]?.response ?? '', /GUARDRAIL_INTERVENED/);
  assert.ok(!steps(r).includes('model'));
  assert.equal(finalNodes(r).guard, 'blocked:blocked (denied topic)');
  assert.equal(finalNodes(r).model, 'skipped:not called');
  assert.match(r.error ?? '', /investment advice/);
  // The same prompt with the guardrail off reaches the model; a clean prompt with it on passes.
  assert.equal(simulateBedrock({ ...inputFor('denied'), guard: { on: false, failClosed: true, reachable: true } }).outcome, 'answered');
  const clean = simulateBedrock({ ...inputFor('denied'), message: CLEAN_Q });
  assert.equal(clean.outcome, 'answered');
  assert.equal(finalNodes(clean).guard, 'ok:passed');
});

test('fail-closed: the guardrail role is unreachable and the request is blocked', () => {
  const r = run('fail-closed');
  assert.equal(r.outcome, 'blocked');
  assert.deepEqual(steps(r), ['send', 'identity', 'guard', 'blocked']);
  assert.match(r.events[2]?.response ?? '', /could not be reached/);
  assert.equal(finalNodes(r).guard, 'blocked:unreachable: blocked (Fail closed)');
  assert.equal(finalNodes(r).model, 'skipped:not called');
});

test('fail-open: the guardrail role is unreachable, the prompt passes uninspected with a warning, and the model answers', () => {
  const r = run('fail-open');
  assert.equal(r.outcome, 'answered');
  assert.deepEqual(steps(r), ['send', 'identity', 'guard', 'model']);
  assert.equal(r.events[2]?.reel?.status, 'note');
  assert.match(r.events[2]?.detail ?? '', /^Warning: .*uninspected/);
  assert.equal(finalNodes(r).guard, 'skipped:not inspected (warning)');
  assert.equal(finalNodes(r).model, 'ok:answered');
});

test('every string the simulation emits uses only .example hosts and the two example accounts, and no key is shown raw', () => {
  const all: string[] = [];
  for (const s of BEDROCK_SCENARIOS) for (const provider of ['runtime', 'mantle'] as const) {
    const r = run(s.id, provider);
    all.push(JSON.stringify(r));
    const p = parseBedrockBody({ message: s.q, provider, identity: 'cross', externalId: 'missing', guard: { on: true, reachable: s.reachable, failClosed: s.failClosed } });
    if (p.ok) all.push(JSON.stringify(simulateBedrock(p.input)));
  }
  const text = all.join('\n');
  const hosts = new Set([...text.matchAll(/https?:\/\/([^/\s"\\)]+)/g)].map((m) => m[1]));
  assert.ok(hosts.size > 0);
  for (const h of hosts) assert.match(h ?? '', /\.example$/, `host ${h}`);
  const accounts = new Set([...text.matchAll(/(?<!\d)\d{12}(?!\d)/g)].map((m) => m[0]));
  assert.deepEqual([...accounts].sort(), ['111122223333', '444455556666']);
  assert.ok(!/AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}/.test(text), 'no access key id shape');
  assert.ok(!/\.amazonaws\.com/.test(text));
});

test('the session name is the default unless set, and it shows in the AssumeRole call and the assumed session', () => {
  const p = parseBedrockBody({ message: CLEAN_Q, identity: 'same', sessionName: 'ops@team.example' });
  assert.ok(p.ok);
  const r = simulateBedrock(p.input);
  assert.match(r.events[1]?.request ?? '', /RoleSessionName=ops@team\.example/);
  assert.match(r.events[1]?.response ?? '', /assumed-role\/privilege-bedrock\/ops@team\.example/);
});

test('body validation: an unknown enum value, a non-boolean, a bad session name, or a missing or too long message is refused', () => {
  const ok = { message: 'hi' };
  for (const bad of [
    { ...ok, provider: 'sagemaker' }, { ...ok, identity: 'root' }, { ...ok, externalId: 'maybe' }, { ...ok, iam: 'yes' },
    { ...ok, guard: { on: 'true' } }, { ...ok, guard: [] }, { ...ok, guard: null }, { ...ok, sessionName: 'has space' }, { ...ok, sessionName: 'x' },
    { ...ok, sessionName: 'a'.repeat(65) }, { ...ok, sessionName: 42 },
    {}, { message: '   ' }, { message: 7 }, { message: 'a'.repeat(MAX_BEDROCK_MESSAGE + 1) }, null, 'text',
  ]) assert.equal(parseBedrockBody(bad).ok, false, JSON.stringify(bad)?.slice(0, 80));
  const p = parseBedrockBody({ message: '  a question  ' });
  assert.ok(p.ok);
  assert.deepEqual(p.input, { message: 'a question', provider: 'runtime', iam: true, identity: 'own', externalId: 'match', sessionName: DEFAULT_SESSION_NAME, guard: { on: false, failClosed: true, reachable: true } });
  assert.ok(parseBedrockBody({ message: 'a'.repeat(MAX_BEDROCK_MESSAGE), sessionName: 'a'.repeat(64) }).ok, 'the limits themselves are allowed');
});

test('the denied topic is found by keyword, and the two scenario questions fall on the right side of it', () => {
  assert.ok(isDeniedTopic(DENIED_Q));
  assert.ok(!isDeniedTopic(CLEAN_Q));
  assert.ok(isDeniedTopic('Is bitcoin a good investment?'));
  assert.ok(!isDeniedTopic('Which roles can invoke the model?'));
});

test('the permissions follow the type', () => {
  assert.deepEqual(PERMISSIONS.runtime, ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream', 'bedrock:CountTokens']);
  assert.deepEqual(PERMISSIONS.mantle, ['bedrock-mantle:CreateInference', 'bedrock-mantle:DeleteInference', 'bedrock-mantle:CountTokens']);
});

test('each simulated step becomes one run-observability row in its own layer, labelled simulated', () => {
  const r = run('denied');
  const rows = r.events.flatMap((e) => notesFor(e, 1));
  assert.equal(rows.length, r.events.length);
  assert.deepEqual(rows.map((n) => [n.layer, n.outcome]), [['agent', 'info'], ['gateway', 'info'], ['privilege', 'blocked'], ['gateway', 'blocked']]);
  for (const n of rows) assert.match(n.message, /\(simulated\)$/);
  assert.deepEqual(notesFor({ kind: 'bedrock', obs: { layer: 'nowhere', outcome: 'allowed', message: 'x' } }, 1), [], 'an unknown layer is dropped');
  assert.deepEqual(notesFor({ kind: 'bedrock' }, 1), []);
});
