import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import express from 'express';

import { hostAllowed, labAllowedHosts, sameOriginGuard, writeAllowed } from '../src/originGuard.js';

// Example names only (.example); the real lab-proxy name lives in docker-compose.yml.
const LAB = 'lab.example';
const PROXY = 'front.example:8443';
const names = labAllowedHosts(` ${LAB.toUpperCase()}, bad name, http://x.example `);

test('LAB_ALLOWED_HOSTS keeps bare DNS names only', () => {
  assert.deepEqual([...names], [LAB]);
});

test('Host check: loopback on any port, the lab name only on the main port, nothing else', () => {
  for (const h of ['localhost', '127.0.0.1:1', '[::1]:6881', 'LOCALHOST:6881', `${LAB}:6881`]) assert.ok(hostAllowed(h, names, 6881), h);
  for (const h of [`${LAB}:6882`, LAB, 'evil.example:6881', `x.${LAB}:6881`, 'front.example:6881', '', undefined, 'a b', '0.0.0.0:6881']) {
    assert.ok(!hostAllowed(h, names, 6881), String(h));
  }
});

const proxied = { host: `${LAB}:6881`, 'x-forwarded-host': PROXY, 'x-forwarded-proto': 'https' };
const ok = (headers: Record<string, string | undefined>, method = 'POST') => writeAllowed(method, headers, names, 6881);

test('writes: launcher, loopback and no-Origin (server-to-server) accepted; reads always pass', () => {
  assert.ok(ok({ ...proxied, origin: `https://${PROXY}` }));
  assert.ok(ok({ host: '127.0.0.1:6881', origin: 'http://127.0.0.1:6881' }));
  assert.ok(ok({ host: 'localhost:6881', origin: 'http://localhost:6881' }));
  assert.ok(ok({ host: '127.0.0.1:6881' }));
  assert.ok(ok({ host: '127.0.0.1:6881', origin: 'https://evil.example' }, 'GET'));
});

test('writes: foreign or mismatched Origin refused; forwarded headers count only on the lab Host', () => {
  assert.ok(!ok({ ...proxied, origin: 'https://evil.example' }));
  assert.ok(!ok({ host: '127.0.0.1:6881', origin: 'https://evil.example' }));
  assert.ok(!ok({ host: '127.0.0.1:6881', origin: 'http://127.0.0.1:9999' }));
  assert.ok(!ok({ host: '127.0.0.1:6881', origin: 'null' }));
  assert.ok(!ok({ host: '127.0.0.1:6881', 'x-forwarded-host': PROXY, 'x-forwarded-proto': 'https', origin: `https://${PROXY}` }));
  assert.ok(!ok({ host: `${LAB}:6881`, origin: `https://${PROXY}` }));
  assert.ok(!ok({ ...proxied, 'x-forwarded-proto': 'ftp', origin: `ftp://${PROXY}` }));
  assert.ok(!ok({ ...proxied, 'x-forwarded-proto': undefined, origin: `https://${PROXY}` }));
  assert.ok(!ok({ ...proxied, origin: `http://${PROXY}` }));
  assert.ok(!ok({ host: '127.0.0.1:6881', 'sec-fetch-site': 'cross-site' }));
});

const send = (port: number, method: string, headers: Record<string, string>): Promise<number> => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port, method, path: '/chat', headers: { 'content-type': 'application/json', ...headers } }, (res) => {
    res.resume(); res.on('end', () => resolve(res.statusCode ?? 0));
  });
  r.on('error', reject);
  r.end(method === 'POST' ? '{}' : undefined);
});

test('middleware: 421 for a foreign Host, 403 for a foreign Origin, otherwise the route runs', async () => {
  const app = express();
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  app.use(sameOriginGuard(names, port));
  app.all('/chat', (_req, res) => { res.status(200).end(); });
  try {
    const lab = { host: `${LAB}:${port}`, 'x-forwarded-host': PROXY, 'x-forwarded-proto': 'https' };
    const loop = { host: `127.0.0.1:${port}` };
    assert.equal(await send(port, 'POST', { ...lab, origin: `https://${PROXY}` }), 200);
    assert.equal(await send(port, 'POST', { ...loop, origin: `http://127.0.0.1:${port}` }), 200);
    assert.equal(await send(port, 'POST', loop), 200); // a BFF / server-to-server call carries no Origin
    assert.equal(await send(port, 'POST', { ...lab, origin: 'https://evil.example' }), 403);
    assert.equal(await send(port, 'POST', { ...loop, origin: 'https://evil.example' }), 403);
    assert.equal(await send(port, 'POST', { ...loop, 'x-forwarded-host': PROXY, 'x-forwarded-proto': 'https', origin: `https://${PROXY}` }), 403);
    assert.equal(await send(port, 'GET', { host: `evil.example:${port}` }), 421);
  } finally {
    server.close();
  }
});
