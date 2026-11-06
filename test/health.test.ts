import assert from 'node:assert/strict';
import { type Server } from 'node:net';
import { once } from 'node:events';
import express, { type Request, type Response } from 'express';
import { after, before, test } from 'node:test';

import { healthDocument, infoDocument } from '../src/health.js';

const clearCredentialEnv = (): (() => void) => {
  const saved = { ...process.env };
  for (const k of Object.keys(process.env)) {
    if (/_KEY$|_TOKEN$|API_KEY$|BASE_URL$/.test(k)) delete process.env[k];
  }
  process.env.MAIN_AGENT_PROVIDER = 'anthropic';
  return () => { process.env = saved; };
};

test('healthDocument returns demo-health/1 with a ready state when a provider key is set', () => {
  const doc = healthDocument('MAIN_AGENT');
  assert.equal(doc.schema, 'demo-health/1');
  assert.equal(typeof doc.at, 'string');
  assert.ok(['ready', 'needs-setup'].includes(doc.state));
  assert.ok(['live', 'offline'].includes(doc.runtime));
  assert.equal(doc.demo.id, 'privilege-a2a-anthropic-demo');
  assert.ok(doc.demo.name.length <= 80);
  assert.ok(doc.demo.version.length <= 32);
});

test('healthDocument reports needs-setup/offline with no provider key', () => {
  const restore = clearCredentialEnv();
  try {
    const doc = healthDocument('MAIN_AGENT');
    assert.equal(doc.state, 'needs-setup');
    assert.equal(doc.runtime, 'offline');
  } finally { restore(); }
});

test('infoDocument matches realAvailable and uses mock when unconfigured', () => {
  const restore = clearCredentialEnv();
  try {
    assert.deepEqual(infoDocument('MAIN_AGENT'), { source: 'mock', realAvailable: false });
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    assert.deepEqual(infoDocument('MAIN_AGENT'), { source: 'real', realAvailable: true });
  } finally { restore(); }
});

let server: Server;
let base: string;

before(async () => {
  const app = express();
  app.get('/api/health', (_req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    res.json(healthDocument('MAIN_AGENT'));
  });
  app.get('/api/info', (_req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    res.json(infoDocument('MAIN_AGENT'));
  });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});

after(() => server.close());

test('GET /api/health answers the contract with no-store', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.equal(body.schema, 'demo-health/1');
  assert.equal(body.demo.id, 'privilege-a2a-anthropic-demo');
});

test('GET /api/info answers the mode-toggle contract', async () => {
  const res = await fetch(`${base}/api/info`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.source === 'mock' || body.source === 'real');
  assert.equal(typeof body.realAvailable, 'boolean');
});
