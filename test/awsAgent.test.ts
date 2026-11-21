import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';

import { createAwsAgentMockApp } from '../src/aws-agent-mock/app.js';
import { AWS_AGENT, answerFrom, cardUrlFor, maskAccountIds, runAwsAgent } from '../src/main-agent/awsAgent.js';
import type { ChainEvent } from '../src/main-agent/chain.js';
import { REFUSAL_DEMO_CREDENTIAL } from '../src/aws-refusal.js';

const KEY = 'agent-key-0123456789-SECRET-TAIL';

async function withMock<T>(options: Parameters<typeof createAwsAgentMockApp>[0], run: (url: string) => Promise<T>): Promise<T> {
  const server = createAwsAgentMockApp(options).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    return await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const collect = (): { events: ChainEvent[]; emit: (event: ChainEvent) => void } => {
  const events: ChainEvent[] = [];
  return { events, emit: (event) => events.push(event) };
};

const jsonResponse = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('a run against the simulated AWS agent reads the card, sends the message and returns the artifact text', async () => {
  await withMock({}, async (url) => {
    const { events, emit } = collect();
    const answer = await runAwsAgent({ url, bearer: KEY, message: 'Review cloud access', emit, simulated: true });
    assert.match(answer, /SIMULATED reply from the AWS agent/);
    assert.match(answer, /Review cloud access/);
    assert.deepEqual(events.map((event) => event.kind), ['card', 'delegate', 'result']);
    assert.equal(events[0]?.card?.name, 'Cloud Access Agent (simulated)');
    assert.equal(events[1]?.to, AWS_AGENT);
    assert.equal(events[1]?.toLabel, 'AWS agent (simulated stand-in)');
    assert.equal(events[2]?.from, AWS_AGENT);
    assert.equal(events[2]?.wire?.status, 200);
  });
});

test('asked to introduce itself, the stand-in says what it is and that it is simulated', async () => {
  await withMock({}, async (url) => {
    const { emit } = collect();
    const answer = await runAwsAgent({ url, bearer: KEY, message: 'Introduce yourself: which agent are you, and where do you run?', emit, simulated: true });
    assert.match(answer, /SIMULATED reply from the AWS agent/);
    assert.match(answer, /Cloud Access Agent/);
    assert.match(answer, /Amazon Bedrock AgentCore/);
    assert.ok(!/Cloud access review \(sample data\)/.test(answer), 'not the canned review');
  });
});

test('the agent key is sent as a Bearer header but never appears unmasked in an event', async () => {
  let seen = '';
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (String(input).endsWith('agent-card.json')) return new Response('nope', { status: 404 });
    seen = new Headers(init?.headers).get('authorization') ?? '';
    return jsonResponse(200, { jsonrpc: '2.0', id: 'x', result: { artifacts: [{ parts: [{ kind: 'text', text: 'ok' }] }] } });
  };
  const { events, emit } = collect();
  await runAwsAgent({ url: 'https://gateway.example/aws-agent/a2a', bearer: KEY, message: 'hi', emit, fetchImpl: fetchImpl as typeof fetch });
  assert.equal(seen, `Bearer ${KEY}`);
  assert.ok(!JSON.stringify(events).includes(KEY), 'the full key must not be in any event');
  assert.ok(events.some((event) => event.credential?.endsWith('(masked)')));
});

test('a refusal keeps its HTTP status and JSON-RPC code, and the run fails with the reason', async () => {
  const fetchImpl = async (input: string | URL | Request): Promise<Response> =>
    String(input).endsWith('agent-card.json')
      ? new Response('', { status: 403 })
      : jsonResponse(403, { jsonrpc: '2.0', id: 'x', error: { code: -32052, message: 'Access denied' } });
  const { events, emit } = collect();
  await assert.rejects(
    runAwsAgent({ url: 'https://gateway.example/aws-agent/a2a', bearer: KEY, message: 'hi', emit, fetchImpl: fetchImpl as typeof fetch }),
    /HTTP 403 · JSON-RPC -32052: Access denied/,
  );
  const last = events[events.length - 1];
  assert.equal(last?.kind, 'error');
  assert.equal(last?.wire?.status, 403);
  assert.equal(last?.wire?.errorCode, -32052);
});

test('an OAuth-style runtime that wants a Bearer answers 401, and the card step says it was unreadable', async () => {
  await withMock({ requireBearer: true }, async (url) => {
    const { events, emit } = collect();
    await assert.rejects(runAwsAgent({ url, bearer: '', message: 'hi', emit }), /HTTP 401/);
    assert.equal(events[0]?.kind, 'card');
    assert.match(events[0]?.text ?? '', /No readable Agent Card/);
    assert.equal(events[events.length - 1]?.wire?.status, 401);
  });
  await withMock({ requireBearer: true }, async (url) => {
    const { emit } = collect();
    assert.match(await runAwsAgent({ url, bearer: KEY, message: 'hi', emit }), /SIMULATED/);
  });
});

test('an invalid request gets AgentCore\'s documented 400 with code -32052 from the stand-in', async () => {
  await withMock({}, async (url) => {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'nope' }) });
    assert.equal(response.status, 400);
    const body = await response.json() as { error: { code: number } };
    assert.equal(body.error.code, -32052);
  });
});

test('the reply text is read from artifacts, a task status message or a plain message', () => {
  assert.equal(answerFrom({ artifacts: [{ parts: [{ kind: 'text', text: 'one' }] }, { parts: [{ kind: 'text', text: 'two' }] }] }), 'one\n\ntwo');
  assert.equal(answerFrom({ status: { state: 'completed', message: { parts: [{ kind: 'text', text: 'from status' }] } } }), 'from status');
  assert.equal(answerFrom({ kind: 'message', parts: [{ kind: 'text', text: 'plain' }] }), 'plain');
  assert.equal(answerFrom({ artifacts: [{ parts: [{ kind: 'file', file: {} }] }] }), '');
  assert.equal(answerFrom({}), '');
});

test('a failed task, an unfinished task and an empty reply are errors, not blank answers', async () => {
  const cases: Array<[unknown, RegExp]> = [
    [{ status: { state: 'failed', message: { parts: [{ kind: 'text', text: 'boom' }] } } }, /ended failed: boom/],
    [{ status: { state: 'working' } }, /task is working and returned no text/],
    [{}, /replied with no text/],
  ];
  for (const [result, expected] of cases) {
    const fetchImpl = async (input: string | URL | Request): Promise<Response> =>
      String(input).endsWith('agent-card.json') ? new Response('', { status: 404 }) : jsonResponse(200, { jsonrpc: '2.0', id: 'x', result });
    const { events, emit } = collect();
    await assert.rejects(runAwsAgent({ url: 'https://gateway.example/a/a2a', bearer: KEY, message: 'hi', emit, fetchImpl: fetchImpl as typeof fetch }), expected);
    assert.equal(events[events.length - 1]?.kind, 'error');
  }
});

test('a reply that is not JSON is an error that keeps the status', async () => {
  const fetchImpl = async (input: string | URL | Request): Promise<Response> =>
    String(input).endsWith('agent-card.json') ? new Response('', { status: 404 }) : new Response('<html>bad gateway</html>', { status: 200 });
  const { events, emit } = collect();
  await assert.rejects(runAwsAgent({ url: 'https://gateway.example/a/a2a', bearer: KEY, message: 'hi', emit, fetchImpl: fetchImpl as typeof fetch }), /reply was not JSON/);
  assert.equal(events[events.length - 1]?.wire?.status, 200);
});

test('an unreachable route is an error with no HTTP status', async () => {
  const { events, emit } = collect();
  await assert.rejects(runAwsAgent({ url: 'http://127.0.0.1:1/', bearer: KEY, message: 'hi', emit, timeoutMs: 5000 }), /Could not reach the AWS agent route/);
  const last = events[events.length - 1];
  assert.equal(last?.kind, 'error');
  assert.equal(last?.wire, undefined);
});

test('a callee that never answers ends at the deadline, and a cancel stops the run', async () => {
  const hang = (_input: string | URL | Request, init?: RequestInit): Promise<Response> =>
    new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
  const slow = collect();
  await assert.rejects(runAwsAgent({ url: 'https://gateway.example/a/a2a', bearer: KEY, message: 'hi', emit: slow.emit, fetchImpl: hang as typeof fetch, timeoutMs: 50 }), /did not answer in time/);

  const controller = new AbortController();
  const cancelled = collect();
  const pending = runAwsAgent({ url: 'https://gateway.example/a/a2a', bearer: KEY, message: 'hi', emit: cancelled.emit, fetchImpl: hang as typeof fetch, signal: controller.signal });
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(pending, /cancelled/);
});

test('the Agent Card is read next to the route, with or without a trailing slash', () => {
  assert.equal(cardUrlFor('https://gateway.example/aws-agent/a2a'), 'https://gateway.example/aws-agent/a2a/.well-known/agent-card.json');
  assert.equal(cardUrlFor('http://127.0.0.1:6885/'), 'http://127.0.0.1:6885/.well-known/agent-card.json');
});

test('the Agent Card read keeps the route\'s query string (AgentCore needs ?accountId= on the card read too)', () => {
  assert.equal(
    cardUrlFor('https://gateway.example/aws-agent/runtimes/Rt-abc123/invocations/?accountId=111122223333'),
    'https://gateway.example/aws-agent/runtimes/Rt-abc123/invocations/.well-known/agent-card.json?accountId=111122223333',
  );
  assert.equal(cardUrlFor('https://gateway.example/a/invocations?accountId=1'), 'https://gateway.example/a/invocations/.well-known/agent-card.json?accountId=1');
});

test('the trace never shows the AWS account id: a query string or an ARN has it masked', () => {
  assert.equal(maskAccountIds('https://gw.example/aws-agent/runtimes/Rt-abc/invocations/?accountId=111122223333'), 'https://gw.example/aws-agent/runtimes/Rt-abc/invocations/?accountId=xxxxxxxxxxxx');
  assert.equal(maskAccountIds('arn:aws:bedrock-agentcore:us-east-1:111122223333:runtime/Rt-abc'), 'arn:aws:bedrock-agentcore:us-east-1:xxxxxxxxxxxx:runtime/Rt-abc');
  assert.equal(maskAccountIds('https://x/runtimes/arn%3Aaws%3Abedrock-agentcore%3Aus-east-1%3A111122223333%3Aruntime%2FRt-abc/'), 'https://x/runtimes/arn%3Aaws%3Abedrock-agentcore%3Aus-east-1%3Axxxxxxxxxxxx%3Aruntime%2FRt-abc/');
  assert.equal(maskAccountIds('arn%253Aaws%253Abedrock-agentcore%253Aus-east-1%253A111122223333%253Aruntime'), 'arn%253Aaws%253Abedrock-agentcore%253Aus-east-1%253Axxxxxxxxxxxx%253Aruntime');
  assert.equal(maskAccountIds('https://gw.example/a?x=1234'), 'https://gw.example/a?x=1234');
});

test('the refused-call demo: an invalid credential is refused with a 401, the challenge header is shown, and the trace says so', async () => {
  await withMock({}, async (url) => {
    const { events, emit } = collect();
    await assert.rejects(runAwsAgent({ url, bearer: REFUSAL_DEMO_CREDENTIAL, message: 'hi', emit, refusalDemo: true }), /HTTP 401/);
    const delegate = events.find((event) => event.kind === 'delegate');
    assert.match(delegate?.text ?? '', /deliberately invalid credential/);
    const last = events[events.length - 1];
    assert.equal(last?.kind, 'error');
    assert.equal(last?.wire?.status, 401);
    assert.match(last?.response ?? '', /WWW-Authenticate: Bearer error="invalid_token"/);
  });
});

test('a normal run never says its credential is invalid', async () => {
  await withMock({}, async (url) => {
    const { events, emit } = collect();
    await runAwsAgent({ url, bearer: KEY, message: 'hi', emit });
    assert.ok(!events.some((event) => /invalid credential/.test(event.text ?? '')));
  });
});

test('masking happens before truncation, so a cut inside an account id cannot leave a partial id on screen', async () => {
  const filler = 'x'.repeat(3990);
  const body = JSON.stringify({ jsonrpc: '2.0', id: 'x', error: { code: -32052, message: `${filler} accountId=111122223333 tail` } });
  const fetchImpl = async (input: string | URL | Request): Promise<Response> =>
    String(input).endsWith('agent-card.json') ? new Response('', { status: 404 }) : new Response(body, { status: 400, headers: { 'Content-Type': 'application/json' } });
  const { events, emit } = collect();
  await assert.rejects(runAwsAgent({ url: 'https://gw.example/a/', bearer: KEY, message: 'hi', emit, fetchImpl: fetchImpl as typeof fetch }));
  assert.ok(!/\d{6,}/.test(JSON.stringify(events)), 'no run of six or more digits may reach an event');
});
