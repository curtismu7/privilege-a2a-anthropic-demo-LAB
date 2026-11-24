import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { simulateBedrock, parseBedrockBody } from '../src/bedrockSim.js';
import { BEDROCK_SCENARIOS } from '../src/main-agent/bedrockTab.js';

// POST /bedrock on the real main agent: the body checks, the SSE stream for every scenario, and the same guards as /aws-agent (Host, same-origin writes,
// the BFF shared secret). The secret here is a test value, not a credential.
const root = fileURLToPath(new URL('..', import.meta.url));
const tsxCli = join(dirname(dirname(fileURLToPath(import.meta.url))), 'node_modules/tsx/dist/cli.mjs');
const SECRET = 'test-bff-shared-secret';
let child: ChildProcess | null = null;
let base = '';
let port = 0;

async function reservePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port: p } = server.address() as AddressInfo;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return p;
}

before(async () => {
  port = await reservePort();
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) if (/_KEY$|_TOKEN$|_PROVIDER$|BASE_URL$|^AWS_AGENT_/.test(key)) delete env[key];
  child = spawn(process.execPath, [tsxCli, 'src/main-agent/index.ts'], {
    cwd: root,
    env: { ...env, MAIN_AGENT_HOST: '127.0.0.1', MAIN_AGENT_PORT: String(port), AWS_MOCK_PORT: String(port + 1), A2A_BFF_SHARED_SECRET: SECRET },
    stdio: 'ignore',
  });
  base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* not up yet */ }
    await delay(200);
  }
  assert.fail('main agent did not become ready');
});

after(async () => {
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit').catch(() => undefined);
    child.kill('SIGTERM');
    await Promise.race([exited, delay(3000)]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
});

const post = (path: string, body: unknown, headers: Record<string, string> = { 'X-A2A-BFF-Secret': SECRET }): Promise<Response> =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

interface Sse { event: string; data: Record<string, unknown> }
async function sse(res: Response): Promise<Sse[]> {
  const text = await res.text();
  return text.split('\n\n').filter(Boolean).map((frame) => {
    const event = /^event: (.*)$/m.exec(frame)?.[1] ?? 'message';
    const data = JSON.parse(frame.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')) as Record<string, unknown>;
    return { event, data };
  });
}

test('a bad body is a 400 with a reason: an unknown enum value, a missing message, a message over 4000 characters', async () => {
  for (const body of [
    { message: 'hi', provider: 'sagemaker' }, { message: 'hi', identity: 'root' }, { message: 'hi', externalId: 'maybe' }, { message: 'hi', iam: 'on' },
    { message: 'hi', guard: { on: 1 } }, { message: 'hi', sessionName: 'bad name' }, {}, { message: '  ' }, { message: 'a'.repeat(4001) },
  ]) {
    const res = await post('/bedrock', body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
    assert.match(((await res.json()) as { error: string }).error, /must be|is required/);
  }
});

test('every scenario streams its trace events in order, then token and done (answered) or error (refused, or blocked: true)', async () => {
  await Promise.all(BEDROCK_SCENARIOS.map(async (s) => {
    const body = { message: s.q, provider: s.provider, iam: s.iam, identity: s.role || 'own', externalId: s.ext, sessionName: '', guard: { on: s.guard, failClosed: s.failClosed, reachable: s.reachable } };
    const res = await post('/bedrock', body);
    assert.equal(res.status, 200, s.id);
    assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
    const frames = await sse(res);
    const parsed = parseBedrockBody(body);
    assert.ok(parsed.ok);
    const expected = simulateBedrock(parsed.input);
    const traces = frames.filter((f) => f.event === 'trace');
    assert.deepEqual(traces.map((f) => f.data.step), expected.events.map((e) => e.step), s.id);
    for (const f of traces) assert.match(String(f.data.at), /^\d+\.\ds$/);
    const tail = frames.slice(traces.length).map((f) => f.event);
    if (expected.outcome === 'answered') {
      assert.deepEqual(tail, ['token', 'done'], s.id);
      assert.equal(frames.at(-2)?.data.text, expected.answer);
    } else {
      assert.deepEqual(tail, ['error'], s.id);
      assert.equal(frames.at(-1)?.data.error, expected.error);
      assert.equal(frames.at(-1)?.data.blocked, expected.outcome === 'blocked' ? true : undefined, s.id);
    }
  }));
});

test('in Real mode a Bedrock run is still recorded as Mock: its rows never read as measured ones and no product log is read for it (review)', async () => {
  const realPort = await reservePort();
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) if (/_KEY$|_TOKEN$|_PROVIDER$|BASE_URL$|^AWS_AGENT_/.test(key)) delete env[key];
  const real = spawn(process.execPath, [tsxCli, 'src/main-agent/index.ts'], {
    cwd: root, stdio: 'ignore',
    env: { ...env, MAIN_AGENT_HOST: '127.0.0.1', MAIN_AGENT_PORT: String(realPort), AWS_MOCK_PORT: String(realPort + 1), MAIN_AGENT_PROVIDER: 'anthropic', MAIN_AGENT_KEY: 'test-main-key', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' },
  });
  const realBase = `http://127.0.0.1:${realPort}`;
  try {
    let info: { source?: string } = {};
    for (let i = 0; i < 100 && info.source === undefined; i += 1) { try { info = await (await fetch(`${realBase}/api/info`)).json() as { source?: string }; } catch { await delay(200); } }
    assert.equal(info.source, 'real', 'the lab is in Real');
    await (await fetch(`${realBase}/bedrock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'hi', guard: { on: true } }) })).text();
    const body = await (await fetch(`${realBase}/api/run-observability`)).json() as { record?: unknown; message?: string };
    assert.equal(body.record ?? null, null);
    assert.match(body.message ?? '', /latest run was in Mock mode/);
  } finally {
    const exited = once(real, 'exit').catch(() => undefined);
    real.kill('SIGTERM'); await Promise.race([exited, delay(3000)]);
    if (real.exitCode === null) real.kill('SIGKILL');
  }
});

test('a Bedrock run is recorded for run observability, as simulated rows', async () => {
  await sse(await post('/bedrock', { message: 'hi', guard: { on: true } }));
  const body = await (await fetch(`${base}/api/run-observability`)).json() as { record?: unknown };
  assert.ok(body.record, 'the latest run is the Bedrock one');
  assert.match(JSON.stringify(body.record), /The Bedrock guardrail passed the prompt \(simulated\)/);
});

test('the guards are the same as /aws-agent\'s: the BFF secret, same-origin writes and the Host check', async () => {
  const cases: [string, Record<string, string>, number][] = [
    ['no BFF secret', {}, 401],
    ['a wrong BFF secret', { 'X-A2A-BFF-Secret': 'nope' }, 401],
    ['a foreign Origin', { 'X-A2A-BFF-Secret': SECRET, Origin: 'https://evil.example' }, 403],
    ['a cross-site fetch', { 'X-A2A-BFF-Secret': SECRET, 'Sec-Fetch-Site': 'cross-site' }, 403],
  ];
  for (const [name, headers, status] of cases) {
    const bedrock = await post('/bedrock', { message: 'hi' }, headers);
    const aws = await post('/aws-agent', { message: 'hi' }, headers);
    assert.equal(bedrock.status, status, `/bedrock: ${name}`);
    assert.equal(aws.status, status, `/aws-agent: ${name}`);
    await bedrock.body?.cancel(); await aws.body?.cancel();
  }
  // A foreign Host (DNS rebinding) is refused before routing, on both.
  const http = await import('node:http');
  const status = (path: string): Promise<number> => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers: { Host: 'evil.example', 'Content-Type': 'application/json', 'X-A2A-BFF-Secret': SECRET } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on('error', reject); req.end('{"message":"hi"}');
  });
  assert.equal(await status('/bedrock'), 421);
  assert.equal(await status('/aws-agent'), 421);
  // Same-origin from the page itself is accepted.
  const ok = await post('/bedrock', { message: 'hi' }, { 'X-A2A-BFF-Secret': SECRET, Origin: base });
  assert.equal(ok.status, 200);
  await ok.body?.cancel();
});
