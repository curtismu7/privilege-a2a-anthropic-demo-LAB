import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { infoDocument } from '../src/health.js';

// The lab runs on its own: its page is served by the main agent, a docker-compose ships, and no AI-DEMO2
// front end (BFF, port 3001, https://localhost:4000) or shared env file is needed or documented.
const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const DOCS = ['README.md', 'config.example', 'docs/shelf-entry.json', 'docker-compose.yml', 'CLAUDE.md'];

test('docs, settings template and compose name no AI-DEMO2 front end, port or shared env file', () => {
  for (const f of DOCS) {
    const text = read(f);
    assert.doesNotMatch(text, /AI-DEMO2|ai-demo2|demo_api_server|privilege-mcp-client|AI Guard Client/, `${f}: AI-DEMO2 reference`);
    assert.doesNotMatch(text, /localhost:4000|BFF :3001|port `3001`|PRIVILEGE_A2A_(MAIN_URL|BFF_SECRET)/, `${f}: AI-DEMO2 BFF address`);
    assert.doesNotMatch(text, /~\/Development\/\.env|~\/Documents/, `${f}: shared env file`);
  }
});

test('docker-compose ships four loopback-only services (the AWS stand-in reads no .env), the rest reading the optional own .env', () => {
  const compose = read('docker-compose.yml');
  for (const name of ['mcp', 'worker', 'aws-agent', 'main']) assert.match(compose, new RegExp(`^  ${name}:$`, 'm'));
  const ports = [...compose.matchAll(/^\s+- "([^"]+:\d+:\d+)"$/gm)].map((m) => m[1]);
  assert.deepEqual(ports, ['127.0.0.1:6883:6883', '127.0.0.1:6882:6882', '127.0.0.1:6885:6885', '127.0.0.1:6881:6881']);
  assert.equal((compose.match(/env_file:\n\s+- path: \.env\n\s+required: false/g) ?? []).length, 3);
  assert.doesNotMatch(read('docs/shelf-entry.json'), /No docker-compose\.yml ships/);
});

test('the README documents the lab own page and Mock/Real from its own .env', () => {
  const readme = read('README.md');
  assert.match(readme, /own page is at <http:\/\/127\.0\.0\.1:6881>/);
  assert.match(readme, /^## Mock and Real$/m);
  assert.match(readme, /Unconfigured, the\s+Real option is disabled and `POST \/api\/mode \{"source":"real"\}` answers 409/);
  assert.match(readme, /UNVERIFIED/);
});

test('with no provider configured Real is not offered and the default is Mock', () => {
  const saved = { ...process.env };
  for (const k of Object.keys(process.env)) if (/_KEY$|_TOKEN$|_PROVIDER$|BASE_URL$/.test(k)) delete process.env[k];
  try { assert.deepEqual(infoDocument('MAIN_AGENT'), { source: 'mock', realAvailable: false }); } finally { process.env = saved; }
});
