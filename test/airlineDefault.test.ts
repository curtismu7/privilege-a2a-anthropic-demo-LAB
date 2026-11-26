import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { INJECTION_PAYLOAD, RESOURCES, USERS, findUser, grants } from '../src/mcp-server/data.js';

// The default demo is an access review of Meridian Air, a fictional airline (spec: docs/specs/2026-11-25-airline-default.md).
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
  ['sharding', /sharding/],
];

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'specs', 'fixtures', 'top-menu', 'story', 'run-observability']);
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|js|jsx|mjs|md|py|json|yaml|yml|example|html)$/.test(name)) out.push(path);
  }
  return out;
}

test('no retired cloud-estate identifier is left in any shipped file (code, tests, docs, Story wording, video sources)', () => {
  const files = [
    ...walk(`${root}src`), ...walk(`${root}web/src`), ...walk(`${root}test`), ...walk(`${root}docs`), ...walk(`${root}video`), ...walk(`${root}k8s`),
    `${root}README.md`, `${root}CLAUDE.md`, `${root}config.example`,
  ].filter(f => !f.endsWith('airlineDefault.test.ts'));
  assert.ok(files.length > 40, `${files.length} files scanned`);
  const hits: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const [label, re] of RETIRED) if (re.test(text)) hits.push(`${relative(root, file)}: ${label}`);
  }
  assert.deepEqual(hits, [], 'retired identifiers found');
});

test('the airline world is the one in the spec: four resources with airline names, the six people re-homed to Meridian Air, no retired department or email domain', () => {
  assert.deepEqual(Object.keys(RESOURCES).sort(), ['fare-payments-api', 'flight-manifest-exports', 'ops-deploy-pipeline', 'passenger-records-db']);
  assert.match(RESOURCES['passenger-records-db'].description, /passenger records/i);
  assert.equal(RESOURCES['passenger-records-db'].tier, 'critical');
  assert.deepEqual(USERS.map(u => u.id), ['dana.olsen', 'alice.chen', 'bob.reyes', 'carol.nguyen', 'dave.okoro', 'erin.walsh'], 'the people keep their ids, so every question that names one keeps working');
  assert.deepEqual(USERS.map(u => u.department), ['Flight Operations Technology', 'Reservations Engineering', 'Revenue and Payments', 'Reservations Engineering', 'Security', 'Customer Support']);
  for (const u of USERS) assert.match(u.email, /@(contractor\.)?meridianair\.example$/, `${u.id} has a .example email`);
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

test('the default questions and the Story questions are the airline ones, the two agents work for Meridian Air, and the airlines vertical is untouched', () => {
  assert.ok(read('src/main-agent/ui.ts').includes('Review access on passenger-records-db'), 'the page default question');
  assert.ok(read('web/src/storyScript.js').includes("'Review access on passenger-records-db'"), 'the Story question');
  assert.ok(read('src/storyReplay.ts').includes("'Review access on passenger-records-db'"), 'the scripted blocked question');
  assert.ok(read('video/take.py').includes('Review access on passenger-records-db'), 'the video script question');
  assert.match(read('src/main-agent/prompts.ts'), /access-review concierge for Meridian Air, a fictional airline/);
  assert.match(read('src/worker-agent/index.ts'), /access-review analyst for Meridian Air, a fictional airline/);
  assert.match(read('src/mcp-server/verticals.ts'), /airlines: \{\s+specialistName: 'Passenger Records Specialist'/, 'the existing airlines vertical is unchanged');
  assert.ok(!/(united|delta|american airlines|lufthansa|emirates|ryanair|jetblue|southwest)/i.test(read('src/mcp-server/data.ts')), 'no real airline name in the data');
});

test('the simulated Story answer for Bob Reyes tells the same story as the seeded data (department, role, resource, grant date, manager)', () => {
  const bob = findUser('bob.reyes');
  const grant = grants(false).find(g => g.user === 'bob.reyes');
  assert.ok(bob && grant);
  const replay = read('src/storyReplay.ts');
  assert.ok(replay.includes(`department: '${bob.department}'`), 'the replayed user record has the seeded department');
  assert.ok(replay.includes(`manager: '${bob.manager}'`));
  assert.ok(replay.includes(`active ${bob.department} employee`), 'the answer text names the seeded department');
  for (const part of [grant.resource, grant.role, grant.grantedAt, grant.grantedBy, grant.lastUsed ?? '']) assert.ok(replay.includes(part), `the replay mentions ${part}`);
  assert.ok(!/\bFinance\b/.test(replay), 'no retired department');
});
