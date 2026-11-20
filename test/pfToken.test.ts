import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPfTokenProvider } from '../src/main-agent/pfToken.js';

const SETTINGS = { tokenUrl: 'https://pf.example/as/token.oauth2', clientId: 'the-client', clientSecret: 'THE-SECRET-VALUE' };

function fakePf(replies: Array<{ status?: number; body: unknown }>) {
  const calls: Array<{ url: string; body: URLSearchParams }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: init.body as URLSearchParams });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    return new Response(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body), { status: reply.status ?? 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

test('asks PingFederate for a client-credentials token and returns it', async () => {
  const pf = fakePf([{ body: { access_token: 'tok-1', expires_in: 900 } }]);
  const token = await createPfTokenProvider(SETTINGS, { fetchImpl: pf.fetchImpl })();
  assert.equal(token, 'tok-1');
  assert.equal(pf.calls[0].url, SETTINGS.tokenUrl);
  assert.equal(pf.calls[0].body.get('grant_type'), 'client_credentials');
  assert.equal(pf.calls[0].body.get('client_id'), 'the-client');
  assert.equal(pf.calls[0].body.get('client_secret'), 'THE-SECRET-VALUE');
});

test('reuses the token until a minute before it expires, then asks again', async () => {
  const pf = fakePf([{ body: { access_token: 'tok-1', expires_in: 900 } }, { body: { access_token: 'tok-2', expires_in: 900 } }]);
  let clock = 1_000_000;
  const provider = createPfTokenProvider(SETTINGS, { fetchImpl: pf.fetchImpl, now: () => clock });
  assert.equal(await provider(), 'tok-1');
  clock += 800_000; // 13 min 20 s in: still more than a minute left
  assert.equal(await provider(), 'tok-1');
  assert.equal(pf.calls.length, 1);
  clock += 50_000; // 14 min 10 s in: inside the last minute
  assert.equal(await provider(), 'tok-2');
  assert.equal(pf.calls.length, 2);
});

test('two calls at once share one token request', async () => {
  const pf = fakePf([{ body: { access_token: 'tok-1', expires_in: 900 } }]);
  const provider = createPfTokenProvider(SETTINGS, { fetchImpl: pf.fetchImpl });
  const [a, b] = await Promise.all([provider(), provider()]);
  assert.equal(a, 'tok-1');
  assert.equal(b, 'tok-1');
  assert.equal(pf.calls.length, 1);
});

test('a token with no usable lifetime is not cached', async () => {
  const pf = fakePf([{ body: { access_token: 'tok-1' } }, { body: { access_token: 'tok-2' } }]);
  const provider = createPfTokenProvider(SETTINGS, { fetchImpl: pf.fetchImpl });
  assert.equal(await provider(), 'tok-1');
  assert.equal(await provider(), 'tok-2');
});

test('a refusal names the client and the error but never the secret, and the next call tries again', async () => {
  const pf = fakePf([{ status: 401, body: { error: 'invalid_client' } }, { body: { access_token: 'tok-ok', expires_in: 900 } }]);
  const provider = createPfTokenProvider(SETTINGS, { fetchImpl: pf.fetchImpl });
  await assert.rejects(provider(), (error: Error) => {
    assert.match(error.message, /the-client/);
    assert.match(error.message, /HTTP 401: invalid_client/);
    assert.ok(!error.message.includes('THE-SECRET-VALUE'));
    return true;
  });
  assert.equal(await provider(), 'tok-ok');
});

test('an answer without an access token is an error', async () => {
  const pf = fakePf([{ body: { token_type: 'Bearer' } }]);
  await assert.rejects(createPfTokenProvider(SETTINGS, { fetchImpl: pf.fetchImpl })(), /without an access token/);
});
