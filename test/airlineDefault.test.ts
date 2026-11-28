import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { dirname, join, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { INJECTION_PAYLOAD, RESOURCES, USERS, findUser, grants } from '../src/mcp-server/data.js';
import { TOOL_REPLY } from '../src/storyReplay.js';

// The default demo is an access review of AirGuard Airlines, a fictional airline (spec: docs/specs/2026-11-25-airline-default.md).
const root = `${dirname(dirname(fileURLToPath(import.meta.url)))}/`;
const read = (f: string): string => readFileSync(`${root}${f}`, 'utf8');

// What the demo used to be about. None of it may come back into a shipped file. `payments-api` is retired, but `fare-payments-api` (its replacement) contains it.
const RETIRED: Array<[string, RegExp]> = [
  ['prod-db', /prod-db/],
  ['payments-api (the old name)', /(?<![a-z-])payments-api/],
  ['s3-customer-exports', /s3-customer-exports/],
  ['jenkins-ci', /jenkins-ci/],
  ['exports-reader', /exports-reader/],
  ['ci-admin', /ci-admin/],
  ['acme.com', /acme\.com/],
  ['acme-access-tools', /acme-access-tools/],
  ['acme-tools', /acme-tools/],
  ['ACME_TOOLS', /ACME_TOOLS/],
  ['sharding', /sharding/],
];

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'specs', 'fixtures', 'top-menu', 'story', 'run-observability']);
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|js|jsx|mjs|md|py|json|yaml|yml|example|html|sh)$/.test(name)) out.push(path);
  }
  return out;
}

test('no retired cloud-estate identifier is left in any shipped file (code, tests, docs, Story wording, video sources)', () => {
  const files = [
    ...walk(`${root}src`), ...walk(`${root}web/src`), ...walk(`${root}test`), ...walk(`${root}docs`), ...walk(`${root}video`), ...walk(`${root}k8s`), ...walk(`${root}scripts`), ...walk(`${root}server`),
    `${root}README.md`, `${root}CLAUDE.md`, `${root}config.example`, `${root}Dockerfile`, `${root}docker-compose.yml`, `${root}package.json`,
  ].filter(f => !f.endsWith('airlineDefault.test.ts'));
  assert.ok(files.length > 40, `${files.length} files scanned`);
  const hits: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const [label, re] of RETIRED) if (re.test(text)) hits.push(`${relative(root, file)}: ${label}`);
  }
  assert.deepEqual(hits, [], 'retired identifiers found');
});

test('the airline world is the one in the spec: four resources with airline names, the six people re-homed to AirGuard Airlines, no retired department or email domain', () => {
  assert.deepEqual(Object.keys(RESOURCES).sort(), ['fare-payments-api', 'flight-manifest-exports', 'ops-deploy-pipeline', 'passenger-records-db']);
  assert.match(RESOURCES['passenger-records-db'].description, /passenger records/i);
  assert.equal(RESOURCES['passenger-records-db'].tier, 'critical');
  assert.deepEqual(USERS.map(u => u.id), ['dana.olsen', 'alice.chen', 'bob.reyes', 'carol.nguyen', 'dave.okoro', 'erin.walsh'], 'the people keep their ids, so every question that names one keeps working');
  assert.deepEqual(USERS.map(u => u.department), ['Flight Operations Technology', 'Reservations Engineering', 'Revenue and Payments', 'Reservations Engineering', 'Security', 'Customer Support']);
  for (const u of USERS) assert.match(u.email, /@(contractor\.)?airguard\.example$/, `${u.id} has a .example email`);
  assert.equal(findUser('carol.nguyen')?.employmentType, 'contractor');
  assert.equal(findUser('erin.walsh')?.status, 'offboarding');
});

test('the seeded data is internally consistent, with and without the injection', () => {
  const ids = new Set(USERS.map(u => u.id));
  for (const [name, r] of Object.entries(RESOURCES)) assert.ok(ids.has(r.owner), `${name} is owned by a seeded user`);
  for (const injection of [false, true]) {
    const all = grants(injection);
    assert.ok(all.length >= 7);
    for (const g of all) {
      assert.ok(ids.has(g.user), `grant user ${g.user} exists`);
      assert.ok(RESOURCES[g.resource], `grant resource ${g.resource} exists`);
      assert.ok(ids.has(g.grantedBy) || g.grantedBy === 'break-glass', `grantedBy ${g.grantedBy} is a user or break-glass`);
    }
  }
  assert.ok(grants(false).some(g => g.user === 'erin.walsh' && g.grantedBy === 'break-glass'), 'the break-glass grant is still seeded');
  assert.ok(grants(false).some(g => g.user === 'carol.nguyen' && g.expiresAt), 'the contractor with an expiring escalation is still seeded');
});

test('the hostile payload (the AI Guard demo) names a seeded user and the airline resource, and only appears when injection is on', () => {
  assert.match(INJECTION_PAYLOAD, /open_ticket/);
  assert.match(INJECTION_PAYLOAD, /"erin\.walsh"/);
  assert.match(INJECTION_PAYLOAD, /"passenger-records-db"/);
  assert.ok(grants(true).some(g => g.justification.includes('SYSTEM OVERRIDE')), 'injection on carries the payload');
  assert.ok(!grants(false).some(g => g.justification.includes('SYSTEM OVERRIDE')), 'injection off is benign');
});

test('the default questions and the Story questions are the airline ones, the two agents work for AirGuard Airlines, and the airlines vertical is untouched', () => {
  assert.ok(read('src/main-agent/ui.ts').includes('Review access on passenger-records-db'), 'the page default question');
  assert.ok(read('web/src/storyScript.js').includes("'Review access on passenger-records-db'"), 'the Story question');
  assert.ok(read('src/storyReplay.ts').includes("'Review access on passenger-records-db'"), 'the scripted blocked question');
  assert.ok(read('video/take.py').includes('Review access on passenger-records-db'), 'the video script question');
  assert.match(read('src/main-agent/prompts.ts'), /access-review concierge for AirGuard Airlines, a fictional airline/);
  assert.match(read('src/worker-agent/index.ts'), /access-review analyst for AirGuard Airlines, a fictional airline/);
  assert.match(read('src/mcp-server/verticals.ts'), /airlines: \{\s+specialistName: 'Passenger Records Specialist'/, 'the existing airlines vertical is unchanged');
  assert.ok(!/(united|delta|american airlines|lufthansa|emirates|ryanair|jetblue|southwest)/i.test(read('src/mcp-server/data.ts')), 'no real airline name in the data');
});

test('the simulated Story answer for Bob Reyes is exactly the seeded record (every field), and its text names the same facts', () => {
  const bob = findUser('bob.reyes');
  assert.ok(bob);
  assert.deepEqual(TOOL_REPLY.user, { ...bob, email: '[REDACTED:pii]' }, 'the replayed user is the seeded user with the email redacted');
  assert.deepEqual(TOOL_REPLY.entitlements, grants(false).filter(g => g.user === 'bob.reyes'), 'the replayed grants are the seeded grants, justification and expiry included');
  const replay = read('src/storyReplay.ts');
  const [grant] = TOOL_REPLY.entitlements;
  for (const part of [grant.resource, grant.role, `${grant.grantedAt} by ${grant.grantedBy}`, grant.lastUsed ?? '', `active ${bob.department} employee`]) assert.ok(replay.includes(part), `the answer text mentions ${part}`);
});

test('no real airline name appears in the code, docs or page text', () => {
  const REAL = /\b(american airlines|delta air|united airlines|lufthansa|emirates|ryanair|jetblue|southwest airlines|qantas|air france|british airways|klm|air canada|alaska airlines)\b/i;
  const files = [...walk(`${root}src`), ...walk(`${root}web/src`), ...walk(`${root}docs`), `${root}README.md`];
  const hits = files.filter(f => REAL.test(readFileSync(f, 'utf8'))).map(f => relative(root, f));
  assert.deepEqual(hits, [], 'a real airline is named');
});

async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  return port;
}

test('a question about a retired resource gets resource_not_found with the four real names, so the analyst can invent nothing (the MCP server, called for real)', async () => {
  const port = await freePort();
  const child = spawn(process.execPath, [join(root, 'node_modules/tsx/dist/cli.mjs'), 'src/mcp-server/index.ts'], {
    cwd: root,
    env: { ...process.env, MCP_SERVER_PORT: String(port), MCP_REQUIRE_BEARER: 'false', MCP_STATEFUL: 'false', MCP_JSON_RESPONSE: 'true' },
    stdio: 'ignore',
  });
  try {
    for (let i = 0; i < 150; i += 1) {
      try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) break; } catch { /* not up yet */ }
      await delay(100);
    }
    const client = new Client({ name: 'airline-default-test', version: '1' }, { capabilities: {} });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    const call = async (resource: string) => JSON.parse(((await client.callTool({ name: 'get_access_grants', arguments: { resource } })) as { content: Array<{ text: string }> }).content[0]!.text) as { error?: string; requested?: string; knownResources?: string[]; resource?: string; grants?: unknown[] };
    const retired = await call('prod-db-primary');
    assert.equal(retired.error, 'resource_not_found');
    assert.equal(retired.requested, 'prod-db-primary');
    assert.deepEqual([...(retired.knownResources ?? [])].sort(), ['fare-payments-api', 'flight-manifest-exports', 'ops-deploy-pipeline', 'passenger-records-db']);
    const real = await call('passenger-records-db');
    assert.equal(real.error, undefined);
    assert.equal(real.resource, 'passenger-records-db');
    assert.ok((real.grants ?? []).length >= 3, 'the airline resource has its grants');
    await client.close();
  } finally {
    child.kill('SIGTERM');
  }
});
