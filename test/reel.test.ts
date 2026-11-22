import assert from 'node:assert/strict';
import { test } from 'node:test';

import { maskTokenView, runAwsAgent } from '../src/main-agent/awsAgent.js';
import type { ChainEvent } from '../src/main-agent/chain.js';
import { parseChallenge } from '../src/main-agent/challenge.js';
import { createPfTokenProvider } from '../src/main-agent/pfToken.js';
import { CHALLENGE_INFO, CLAIM_INFO, HEADER_INFO, REEL_REFS, usedRefIds } from '../src/main-agent/reelRefs.js';
import { REEL_CSS, REEL_DATA_SCRIPT, REEL_SCRIPT } from '../src/main-agent/reelUi.js';
import { AWS_PANEL_HTML, AWS_TAB_SCRIPT } from '../src/main-agent/awsTab.js';
import { describeToken } from '../src/main-agent/tokenView.js';
import { renderPage } from '../src/main-agent/ui.js';

const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
const NOW = 1_800_000_000;
const SIGNATURE = 'SIGNATUREMARKERxyz123';
const makeJwt = (claims: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid: 'k1', typ: 'at+jwt' }): string =>
  `${b64(header)}.${b64(claims)}.${SIGNATURE}`;

test('a JWT is decoded into header, claims and times, and the signature is never in the view', () => {
  const jwt = makeJwt({ iss: 'https://idp.example.invalid', sub: 'caller', aud: 'agent', exp: NOW + 900, iat: NOW, jti: 'j1', client_id: 'c1', scope: 'a2a' });
  const view = describeToken(jwt, NOW * 1000);
  assert.equal(view.kind, 'jwt');
  if (view.kind !== 'jwt') return;
  assert.deepEqual(view.header, { alg: 'RS256', kid: 'k1', typ: 'at+jwt' });
  assert.equal(view.claims.sub, 'caller');
  assert.equal(view.lifetimeSeconds, 900);
  assert.equal(view.expiresInSeconds, 900);
  assert.equal(view.signature, 'hidden');
  assert.equal(view.note, 'decoded here, signature not verified');
  const text = JSON.stringify(view);
  assert.ok(!text.includes(SIGNATURE) && !text.includes(jwt) && !text.includes(jwt.split('.')[1] ?? ''), 'no raw token or signature piece');
});

test('an expired token reports a negative time left; a nested act claim is kept', () => {
  const view = describeToken(makeJwt({ exp: NOW - 60, iat: NOW - 960, act: { sub: 'main', act: { sub: 'custodian' } } }), NOW * 1000);
  assert.equal(view.kind, 'jwt');
  if (view.kind !== 'jwt') return;
  assert.equal(view.expiresInSeconds, -60);
  assert.deepEqual(view.claims.act, { sub: 'main', act: { sub: 'custodian' } });
});

test('malformed or non-JWT input never throws and is described as opaque', () => {
  for (const input of ['', 'agent-key-123', 'a.b.c', 'only.two', `${b64({ x: 1 })}.${b64({ y: 2 })}.sig`, '....', 'é.é.é']) {
    const view = describeToken(input);
    assert.equal(view.kind, 'opaque', input);
    assert.ok(!JSON.stringify(view).includes(input) || input === '');
  }
  assert.equal(describeToken(undefined as unknown as string).kind, 'opaque');
});

test('oversized claim values are capped', () => {
  const view = describeToken(makeJwt({ exp: NOW + 1, iat: NOW, big: 'x'.repeat(5000) }), NOW * 1000);
  assert.equal(view.kind, 'jwt');
  if (view.kind === 'jwt') assert.ok(String(view.claims.big).length <= 301);
});

test('a WWW-Authenticate header is read into its scheme and parameters', () => {
  const challenge = parseChallenge('Bearer realm="x", error="invalid_token", resource_metadata="https://h.example/.well-known/oauth-protected-resource"');
  assert.equal(challenge?.scheme, 'Bearer');
  assert.equal(challenge?.params.error, 'invalid_token');
  assert.equal(challenge?.params.resource_metadata, 'https://h.example/.well-known/oauth-protected-resource');
  assert.equal(parseChallenge('Bearer')?.scheme, 'Bearer');
  assert.equal(parseChallenge(''), null);
});

test('every reference id the code uses resolves, and no text names an A2A version 0.3', () => {
  for (const id of usedRefIds()) assert.ok(REEL_REFS[id], `missing reference: ${id}`);
  for (const table of [CLAIM_INFO, HEADER_INFO, CHALLENGE_INFO]) for (const [name, entry] of Object.entries(table)) assert.ok(REEL_REFS[entry.ref], `${name} points at a missing reference`);
  const everything = [JSON.stringify(REEL_REFS), REEL_DATA_SCRIPT, REEL_SCRIPT, REEL_CSS, AWS_PANEL_HTML, AWS_TAB_SCRIPT].join('\n');
  assert.ok(!/0\.3(\.\d)?/.test(everything), 'no 0.3 anywhere in the reel text');
  for (const ref of Object.values(REEL_REFS)) assert.ok(ref.label && ref.says.length > 20 && ref.says.length < 300);
});

test('the reel data cannot close the script element it sits in', () => {
  assert.ok(!REEL_DATA_SCRIPT.includes('</'));
  assert.doesNotThrow(() => new Function(REEL_DATA_SCRIPT));
});

test('the reel script compiles, builds a labelled dialog, writes with textContent only, and keeps text at 14px or more', () => {
  assert.doesNotThrow(() => new Function(REEL_SCRIPT));
  assert.ok(REEL_SCRIPT.includes("setAttribute('role','dialog')") && REEL_SCRIPT.includes("setAttribute('aria-modal','true')") && REEL_SCRIPT.includes("'aria-labelledby'"));
  assert.ok(REEL_SCRIPT.includes("'Escape'") && REEL_SCRIPT.includes('mousedown'), 'Esc and the backdrop close it');
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(REEL_SCRIPT), 'event data is never written as HTML');
  assert.ok(!REEL_SCRIPT.includes('`'), 'no template literal inside the script');
  const sizes = [...REEL_CSS.matchAll(/font-size:([\d.]+)rem/g)].map((match) => Number(match[1]) * 16);
  assert.ok(sizes.length > 0 && Math.min(...sizes) >= 14, `smallest is ${Math.min(...sizes)}px`);
});

test('both tabs carry the reel: the AWS list, the review list, the data and the script', () => {
  const page = renderPage();
  assert.match(AWS_PANEL_HTML, /<ol id="aws-reel" class="aws__reel" aria-label="API calls in this run">/);
  assert.ok(page.includes('id="reel-review"'));
  assert.ok(page.includes('window.REEL_DATA=') && page.includes('window.Reel={'));
  assert.ok(page.indexOf('window.REEL_DATA=') < page.indexOf('window.Reel={'));
  assert.ok(AWS_TAB_SCRIPT.includes('Reel.attach') && AWS_TAB_SCRIPT.includes('reel.add(t)'));
  for (const source of [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? '')) assert.doesNotThrow(() => new Function(source));
});

// --- the sign-in metadata read (RFC 9728) ---

const RPC_OK = { jsonrpc: '2.0', id: 'x', result: { artifacts: [{ parts: [{ kind: 'text', text: 'ok' }] }] } };
function refusingFetch(metadataUrl: string, metadata: () => Response, seen: string[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push(`${init?.method ?? 'GET'} ${url} auth=${new Headers(init?.headers).get('authorization') ?? ''}`);
    if (url === metadataUrl) return metadata();
    if (url.endsWith('agent-card.json')) return new Response('nope', { status: 404 });
    return new Response('{"error":"unauthorized"}', { status: 401, headers: { 'WWW-Authenticate': `Bearer error="invalid_token", resource_metadata="${metadataUrl}"` } });
  }) as typeof fetch;
}
async function refused(route: string, metadataUrl: string, metadata: () => Response): Promise<{ events: ChainEvent[]; seen: string[] }> {
  const events: ChainEvent[] = [];
  const seen: string[] = [];
  await assert.rejects(runAwsAgent({ url: route, bearer: 'opaque-key', message: 'hi', emit: (event) => events.push(event), fetchImpl: refusingFetch(metadataUrl, metadata, seen) }), /HTTP 401/);
  return { events, seen };
}

test('a 401 that points at metadata on the same https host is read, with no credentials', async () => {
  const meta = 'https://gw.example.invalid/.well-known/oauth-protected-resource';
  const { events, seen } = await refused('https://gw.example.invalid/route', meta, () => new Response(JSON.stringify({ resource: 'https://gw.example.invalid/', authorization_servers: ['https://auth.example.invalid'] }), { status: 200 }));
  const metaEvent = events.find((event) => event.kind === 'metadata');
  assert.equal(metaEvent?.wire?.status, 200);
  assert.match(metaEvent?.detail ?? '', /auth\.example\.invalid/);
  assert.deepEqual(metaEvent?.refs?.includes('rfc9728-5.1'), true);
  assert.ok(seen.some((line) => line === `GET ${meta} auth=`), 'fetched without an Authorization header');
  const error = events.find((event) => event.kind === 'error');
  assert.equal(error?.challenge?.params.error, 'invalid_token');
  assert.ok(error?.refs?.includes('rfc9110-15.5.2'));
});

test('metadata on a different host, or over plain http, is skipped with a reason and is not fetched', async () => {
  for (const [route, meta, reason] of [
    ['https://gw.example.invalid/route', 'https://other.example.invalid/.well-known/oauth-protected-resource', /different host/],
    ['http://gw.example.invalid/route', 'http://gw.example.invalid/.well-known/oauth-protected-resource', /not https/],
  ] as const) {
    const { events, seen } = await refused(route, meta, () => new Response('{}', { status: 200 }));
    const metaEvent = events.find((event) => event.kind === 'metadata');
    assert.match(metaEvent?.detail ?? '', reason);
    assert.ok(!seen.some((line) => line.includes(meta)), 'never fetched');
  }
});

test('a failing metadata fetch is soft: an event says so and the run still ends with the original refusal', async () => {
  const meta = 'https://gw.example.invalid/.well-known/oauth-protected-resource';
  const { events } = await refused('https://gw.example.invalid/route', meta, () => { throw new Error('connection reset'); });
  const metaEvent = events.find((event) => event.kind === 'metadata');
  assert.match(metaEvent?.text ?? '', /could not be read/);
  assert.match(metaEvent?.detail ?? '', /connection reset/);
});

test('every call in a run carries the decoded token, and no event holds the raw token or signature', async () => {
  const jwt = makeJwt({ iss: 'https://idp.example.invalid', sub: 'caller', exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000) });
  const events: ChainEvent[] = [];
  const fetchImpl = (async (input: string | URL | Request) => String(input).endsWith('agent-card.json') ? new Response('nope', { status: 404 }) : new Response(JSON.stringify(RPC_OK), { status: 200 })) as typeof fetch;
  await runAwsAgent({ url: 'https://gw.example.invalid/route', bearer: jwt, message: 'hi', emit: (event) => events.push(event), fetchImpl });
  const everything = JSON.stringify(events);
  assert.ok(!everything.includes(jwt) && !everything.includes(SIGNATURE), 'no raw token, no signature');
  assert.equal(events.find((event) => event.kind === 'card')?.token?.kind, 'jwt');
  assert.equal(events.find((event) => event.kind === 'delegate')?.token?.kind, 'jwt');
});

// --- the PingFederate mint ---

test('the mint is described without the token or the secret, and a fresh request skips the cache', async () => {
  const secret = 'THE-CLIENT-SECRET-VALUE';
  const token = makeJwt({ iss: 'https://pf.example.invalid', sub: 'caller', client_id: 'the-client', exp: Math.floor(Date.now() / 1000) + 900, iat: Math.floor(Date.now() / 1000) });
  let calls = 0;
  const fetchImpl = (async () => { calls += 1; return new Response(JSON.stringify({ access_token: token, token_type: 'Bearer', expires_in: 900 }), { status: 200 }); }) as unknown as typeof fetch;
  const provider = createPfTokenProvider({ tokenUrl: 'https://pf.example.invalid/as/token.oauth2', clientId: 'the-client', clientSecret: secret }, { fetchImpl });
  assert.equal(provider.lastMint(), null);
  await provider();
  await provider();
  assert.equal(calls, 1, 'cached for ordinary callers');
  await provider({ fresh: true });
  assert.equal(calls, 2, 'fresh mints again');
  const mint = provider.lastMint();
  assert.ok(mint);
  const text = JSON.stringify(mint);
  assert.ok(!text.includes(secret) && !text.includes(token) && !text.includes(SIGNATURE), 'neither the secret nor the token is in the description');
  assert.match(mint?.request ?? '', /client_secret=\*{6}/);
  assert.match(mint?.request ?? '', /grant_type=client_credentials/);
  assert.equal(mint?.token.kind, 'jwt');
  assert.equal(mint?.status, 200);
});

test('an AWS account id inside a token claim is masked in the view', () => {
  const view = maskTokenView(describeToken(makeJwt({ exp: NOW + 60, iat: NOW, aud: 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/x' }), NOW * 1000));
  assert.ok(!JSON.stringify(view).includes('123456789012'));
  assert.match(JSON.stringify(view), /xxxxxxxxxxxx/);
});
