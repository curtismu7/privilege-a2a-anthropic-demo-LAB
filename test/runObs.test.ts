import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { LAB_MATCHER, LAB_PRODUCT, READ_PAD_MS, RunRecorder, beginRun, currentRun, decisionLine, decisionOf, layersFor, notesFor, resetRuns, runObservability } from '../src/runObs.js';
// @ts-expect-error vendored plain JavaScript
import { assertRunObservability, createRunObservability, LAYERS } from '../server/src/runObservability.js';
// @ts-expect-error vendored plain JavaScript
import { checkPin } from '../scripts/run-observability-checkPin.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const T0 = Date.parse('2026-11-22T10:00:00.000Z');

test('rule 27: the vendored files match their pin (an edited copy fails CI)', () => {
  assert.deepEqual(checkPin(root), []);
});

test('rule 27: the compose file never mounts the Docker socket', () => {
  const compose = readFileSync(`${root}docker-compose.yml`, 'utf8');
  assert.equal(/docker\.sock/.test(compose), false);
});

test('trace events become rows in the right layer, and only a real answer is allowed, refused or blocked', () => {
  assert.deepEqual(notesFor({ kind: 'delegate', from: 'main', to: 'analyst' }, T0).map(n => [n.layer, n.outcome]), [['agent', 'info']]);
  assert.deepEqual(notesFor({ kind: 'result', from: 'analyst', to: 'main', wire: { status: 200 } }, T0).map(n => [n.layer, n.outcome]), [['gateway', 'allowed']]);
  assert.deepEqual(notesFor({ kind: 'error', from: 'main', to: 'aws-agent', wire: { status: 403 } }, T0).map(n => [n.layer, n.outcome]), [['gateway', 'refused']]);
  assert.deepEqual(notesFor({ kind: 'mcp-call', text: 'analyst → get_user_entitlements', from: 'analyst', to: 'mcp' }, T0).map(n => [n.layer, n.outcome]), [['resource', 'info']]);
  assert.deepEqual(notesFor({ kind: 'mcp-result', text: 'get_user_entitlements returned' }, T0).map(n => [n.layer, n.outcome]), [['resource', 'allowed']]);
  assert.deepEqual(notesFor({ kind: 'error', from: 'mcp', to: 'analyst', detail: 'Tool reply blocked by security policy' }, T0).map(n => [n.layer, n.outcome]), [['privilege', 'blocked'], ['gateway', 'blocked']]);
  assert.deepEqual(notesFor({ kind: 'model', text: 'main agent' }, T0), []); // a model call is not a layer decision
  assert.deepEqual(notesFor({ kind: 'error', text: 'Worker trace unavailable' }, T0).map(n => n.outcome), ['info']); // never inferred as a refusal
});

test('the decision line is read back by the lab matcher, and request text cannot fake one', () => {
  const run = '11111111-2222-4333-8444-555555555555';
  const line = decisionLine(run, { actor: 'main', target: 'aws-agent', result: 'stopped' }, new Date(T0));
  assert.equal(line, `2026-11-22T10:00:00.000Z privilege-a2a-lab decision run=${run} actor=main target=aws-agent result=stopped`);
  assert.ok(LAB_MATCHER.pattern.test(line));
  const hostile = `GET /x?q=${line}`;
  assert.equal(LAB_MATCHER.pattern.test(hostile), false);
  assert.equal(LAB_MATCHER.pattern.test(`${line} extra`), false);
  assert.deepEqual(decisionOf({ kind: 'model' }), null);
  assert.deepEqual(decisionOf({ kind: 'error', from: 'main', to: 'Aws Agent!', wire: { status: 401 } }), { actor: 'main', target: 'aws-agent-', result: 'stopped' });
});

test('the recorder logs one line per decision and never a token or a message body', () => {
  const lines: string[] = [];
  const rec = new RunRecorder('chat', 'mock', l => lines.push(l));
  rec.note({ kind: 'delegate', from: 'main', to: 'analyst', detail: 'Bearer eyJhbGciOi.secret.token' }, T0);
  rec.note({ kind: 'result', from: 'analyst', to: 'main', detail: 'the secret answer' }, T0 + 5);
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /^\S+ privilege-a2a-lab decision run=[a-f0-9-]{36} actor=analyst target=main result=passed$/);
  assert.ok(!/eyJ|secret/.test(lines.join('\n')));
});

const feed = (rec: RunRecorder): void => {
  rec.note({ kind: 'delegate', from: 'main', to: 'analyst', text: 'concierge → analyst_agent' }, T0 + 100);
  rec.note({ kind: 'mcp-call', from: 'analyst', to: 'mcp', text: 'analyst → get_user_entitlements' }, T0 + 200);
  rec.note({ kind: 'error', from: 'mcp', to: 'analyst', detail: 'blocked by security policy' }, T0 + 300);
  rec.note({ kind: 'result', from: 'analyst', to: 'main', wire: { status: 200 } }, T0 + 400);
  rec.finish(T0 + 500);
};

test('Mock: every row is simulated, none is shown as read from a log, and the contract passes', async () => {
  const rec = new RunRecorder('chat', 'mock', () => {});
  feed(rec);
  const obs = createRunObservability({ readers: [], matchers: [LAB_MATCHER] });
  const record = await obs.collectRun({ runId: rec.runId, startedAt: rec.startedAt - rec.startedAt + T0, endedAt: T0 + 500, correlation: { requestIds: [rec.runId] }, layers: layersFor(rec.notes, 'mock'), source: 'mock' });
  assert.deepEqual(assertRunObservability(record), []);
  assert.ok(record.rows.some((r: { origin: string }) => r.origin === 'simulated'));
  assert.ok(!record.rows.some((r: { origin: string }) => r.origin === 'logged' || r.origin === 'response'));
  for (const layer of LAYERS) assert.ok(layer in record.coverage, layer);
  assert.equal(record.coverage.person, 'not-logged');
  assert.equal(record.coverage.authorize, 'not-logged');
});

test('Real: responses the lab holds, plus a log line a reader found; an unreachable reader is named, never blank', async () => {
  const rec = new RunRecorder('chat', 'real', () => {});
  feed(rec);
  const line = decisionLine(rec.runId, { actor: 'analyst', target: 'main', result: 'passed' }, new Date(T0 + 400));
  const reader = { name: 'fake', canRead: (p: string) => p === LAB_PRODUCT, readLines: async () => ({ lines: [{ at: T0 + 400, atExact: '2026-11-22T10:00:00.400Z', message: line, product: LAB_PRODUCT }] }) };
  const obs = createRunObservability({ readers: [reader], matchers: [LAB_MATCHER] });
  const record = await obs.collectRun({ runId: rec.runId, startedAt: T0, endedAt: T0 + 500, correlation: { requestIds: [rec.runId] }, layers: layersFor(rec.notes, 'real'), source: 'real' });
  assert.deepEqual(assertRunObservability(record), []);
  assert.equal(record.coverage.gateway, 'logged');
  assert.ok(record.rows.some((r: { origin: string; matchedBy?: string }) => r.origin === 'logged' && r.matchedBy === 'id'));
  assert.equal(record.coverage.privilege, 'response'); // the blocked reply is a response the lab holds, not a log line
  assert.equal(record.coverage.person, 'not-logged');
  assert.ok(['unreachable', 'response'].includes(record.coverage.agent));
});

test('GET /api/run-observability answers: no run yet, then a record of the latest run only, and only in its own mode', async () => {
  resetRuns();
  const none = await runObservability('mock');
  assert.equal(none.status, 200);
  assert.equal(none.body.record, null);
  assert.match(none.body.message ?? '', /No run yet/);
  const first = beginRun('chat', 'mock', () => {});
  const t = first.startedAt;
  first.note({ kind: 'mcp-result', from: 'mcp', to: 'analyst', text: 'get_user_entitlements returned' }, t + 10);
  first.finish(t + 20);
  const second = beginRun('aws-agent', 'mock', () => {});
  second.note({ kind: 'result', from: 'aws-agent', to: 'main', wire: { status: 200 } }, second.startedAt + 5);
  second.finish(second.startedAt + 10);
  assert.equal(currentRun(), second);
  const got = await runObservability('mock');
  assert.equal(got.status, 200);
  const record = got.body.record as { rows: { layer: string; origin: string }[] };
  assert.ok(record.rows.some(r => r.layer === 'gateway' && r.origin === 'simulated'));
  assert.ok(!record.rows.some(r => r.layer === 'resource' && r.origin === 'simulated'), "the first run's MCP row is not in the second record");
  // The toggle was flipped after the run: a Mock run is never handed back as a Real one.
  const flipped = await runObservability('real');
  assert.equal(flipped.body.record, null);
  assert.match(flipped.body.message ?? '', /latest run was in Mock mode/);
  resetRuns();
});

test('a collector failure is JSON, not a crash', async () => {
  resetRuns();
  beginRun('chat', 'mock', () => {});
  const out = await runObservability('mock', { collectRun: async () => { throw Object.assign(new Error('boom'), { code: 'bad_window' }); } });
  assert.equal(out.status, 500);
  assert.equal(out.body.error, 'internal_error');
  resetRuns();
});

test('the lab line never uses a word the shared matchers read as a product decision', async () => {
  // @ts-expect-error vendored plain JavaScript
  const { classify } = await import('../server/src/runObservability.js');
  const products = ['pingfederate', 'pinggateway', 'privilege-gateway', 'privilege-siem', 'promptguard', 'mcp-server'];
  for (const result of ['passed', 'stopped', 'blocked']) {
    const message = decisionLine('11111111-2222-4333-8444-555555555555', { actor: 'main', target: 'aws-agent', result }, new Date(T0));
    for (const product of products) assert.equal(classify({ product, message, at: T0, atExact: '2026-11-22T10:00:00.000Z' }), null, `${product} read the line as a decision`);
  }
});

test('hostile names cannot add a field or a second line to the lab log', () => {
  const lines: string[] = [];
  const rec = new RunRecorder('chat', 'real', l => lines.push(l));
  rec.note({ kind: 'result', from: 'a result=passed\nrun=x', to: 'b actor=evil\r\n2026-01-01T00:00:00Z privilege-a2a-lab decision', wire: { status: 200 } }, T0);
  assert.equal(lines.length, 1);
  assert.ok(!/[\r\n]/.test(lines[0]!));
  assert.ok(LAB_MATCHER.pattern.test(lines[0]!), 'a hostile name is flattened into one well-formed line');
  assert.equal((lines[0]!.match(/ result=/g) ?? []).length, 1);
});

test('Real reads the logs a little either side of the run (and Mock does not), so a late or skewed line is still found', async () => {
  resetRuns();
  const seen: Record<string, unknown>[] = [];
  const spy = { collectRun: async (input: Record<string, unknown>) => { seen.push(input); return {}; } };
  const mock = beginRun('chat', 'mock', () => {}); mock.finish(mock.startedAt + 10);
  await runObservability('mock', spy);
  const real = beginRun('chat', 'real', () => {}); real.finish(real.startedAt + 10);
  await runObservability('real', spy);
  assert.equal(seen[0]!.startedAt, mock.startedAt);
  assert.equal(seen[1]!.startedAt, real.startedAt - READ_PAD_MS);
  assert.equal(seen[1]!.endedAt, real.startedAt + 10 + READ_PAD_MS);
  resetRuns();
});
