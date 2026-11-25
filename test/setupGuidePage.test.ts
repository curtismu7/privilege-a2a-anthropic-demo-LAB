import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, readdirSync } from 'node:fs';
import { request } from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

// @ts-expect-error plain JavaScript build script
import { buildGuide } from '../scripts/build-setup-guide.mjs';

// docs/setup-guide/ is the styled page of docs/PRIVILEGE-SETUP.md (npm run build:guide), served by the main agent at /setup/.
// Spec: docs/specs/2026-11-25-setup-guide-page.md.
const root = `${dirname(dirname(fileURLToPath(import.meta.url)))}/`;
const read = (f: string): string => readFileSync(`${root}${f}`, 'utf8');
const page = read('docs/setup-guide/index.html');

test('the committed page is exactly what the build makes from the guide (a guide edit needs `npm run build:guide`)', () => {
  assert.equal(page, buildGuide(read('docs/PRIVILEGE-SETUP.md')), 'docs/setup-guide/index.html is stale: run npm run build:guide and commit the result');
  assert.equal(read('docs/setup-guide/PRIVILEGE-SETUP.md'), read('docs/PRIVILEGE-SETUP.md'), 'the downloadable markdown is stale: run npm run build:guide');
});

test('every section has a unique id, every ToC and in-page link resolves, tables scroll on a phone, no stale "section N", no banner', () => {
  const ids = [...page.matchAll(/<h2 id="([^"]+)"/g)].map(m => m[1]);
  assert.ok(ids.length >= 12, `${ids.length} sections`);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  const toc = [...page.matchAll(/<a href="#([^"]+)" class="toc-h2"/g)].map(m => m[1]);
  assert.deepEqual(toc, ids, 'the ToC lists every section in order');
  const all = new Set([...page.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  for (const href of [...page.matchAll(/href="#([^"]+)"/g)].map(m => m[1])) assert.ok(all.has(href), `#${href} resolves`);
  const text = page.replace(/<[^>]+>/g, '');
  assert.ok(!/\b[Ss]ection \d\b/.test(text), 'no numbered section reference is left');
  assert.equal(page.split('<table>').length, page.split('<div class="table-wrap"><table>').length, 'every table is wrapped');
  assert.ok(!/state-banner|Mock:/.test(page), 'no preview banner');
  for (const step of [1, 2, 3, 4, 5, 6, 7, 8, 9]) assert.ok(new RegExp(`<h2 id="step-${step}-`).test(page), `Step ${step} is a section`);
});

test('the build fails loudly when the guide is renumbered or its mapped wording changes (a stale "section N" can never ship)', () => {
  const md = read('docs/PRIVILEGE-SETUP.md');
  const renumbered = md.replace('## 5. When it does not work', '## 5. Costs\n\nText.\n\n## 6. When it does not work');
  assert.throws(() => buildGuide(renumbered), /section 5 is "Costs"/);
  assert.throws(() => buildGuide(md.replace('## 1. What you are building', '## 1. What this is')), /section 1 is "What this is"/);
  assert.throws(() => buildGuide(md.replace('All of section 3', 'All of them')), /no longer contains "All of section 3"/);
  assert.throws(() => buildGuide(md.replace(/^### Step (\d+)\./gm, '### Part $1.')), /no "### Step N\." headings/);
  assert.throws(() => buildGuide(md.replace('## 7. What a script', '## 5. What a script')), /duplicate heading id|section 5/);
  assert.equal(typeof buildGuide(md), 'string');
});

test('the page and every shipped asset hold no key, UUID, internal host or name, and need no icon font or external script', () => {
  const dir = `${root}docs/setup-guide/assets/`;
  const files = [['docs/setup-guide/index.html', page], ...readdirSync(dir).map(f => [`docs/setup-guide/assets/${f}`, read(`docs/setup-guide/assets/${f}`)])];
  for (const [name, body] of files) {
    assert.ok(!/sk-[a-z]+-[A-Za-z0-9]{6,}/.test(body), `${name}: no key`);
    assert.ok(!/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(body), `${name}: no UUID`);
    assert.ok(!/ping-devops|i4ai|procyon|cmuir|pingcorp|pingidentity/i.test(body), `${name}: no internal host or name`);
  }
  assert.ok(!/Material Symbols|chrome-extension:/.test(page), 'no icon font and no extension leftovers');
  const scripts = [...page.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(scripts, ['assets/site.js', 'assets/lab.js'], 'only the two local scripts');
});

test('the Dockerfile carries docs/setup-guide into the runtime image, and the build script is wired', () => {
  const docker = read('Dockerfile');
  assert.match(docker, /^COPY docs\/setup-guide \.\/docs\/setup-guide$/m);
  assert.match(docker, /^COPY --from=build \/app\/docs \.\/docs$/m);
  assert.equal(JSON.parse(read('package.json')).scripts['build:guide'], 'node scripts/build-setup-guide.mjs');
});

async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  return port;
}

async function withMainAgent<T>(run: (port: number) => Promise<T>): Promise<T> {
  const port = await freePort();
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) if (/_KEY$|_TOKEN$|_PROVIDER$|BASE_URL$|^AWS_AGENT_/.test(key)) delete env[key];
  const child = spawn(process.execPath, [join(root, 'node_modules/tsx/dist/cli.mjs'), 'src/main-agent/index.ts'], {
    cwd: root,
    env: { ...env, MAIN_AGENT_PORT: String(port), AWS_MOCK_PORT: String(port + 1) },
    stdio: 'ignore',
  });
  try {
    for (let i = 0; i < 200; i += 1) {
      try { if ((await fetch(`http://127.0.0.1:${port}/api/info`)).ok) break; } catch { /* not up yet */ }
      await delay(100);
    }
    return await run(port);
  } finally {
    child.kill('SIGTERM');
  }
}

/** A raw GET: the path and Host are sent exactly as given (fetch would tidy `..` and cannot set Host). */
function rawGet(port: number, path: string, host = `127.0.0.1:${port}`): Promise<{ status: number; type: string; location: string; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers: { Host: host } }, res => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c as Buffer));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), location: String(res.headers.location ?? ''), body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('the main agent serves the guide: /setup redirects to /setup/, the page, its stylesheet and the markdown download answer 200', async () => {
  await withMainAgent(async port => {
    const bare = await rawGet(port, '/setup');
    assert.equal(bare.status, 301);
    assert.equal(bare.location, '/setup/');
    const index = await rawGet(port, '/setup/');
    assert.equal(index.status, 200);
    assert.match(index.type, /text\/html/);
    assert.equal(index.body, page);
    assert.match(index.body, /<title>Setting up PingOne Privilege for this lab - Privilege A2A lab<\/title>/);
    const css = await rawGet(port, '/setup/assets/site.css');
    assert.equal(css.status, 200);
    assert.match(css.type, /text\/css/);
    const js = await rawGet(port, '/setup/assets/lab.js');
    assert.equal(js.status, 200);
    const md = await rawGet(port, '/setup/PRIVILEGE-SETUP.md');
    assert.equal(md.status, 200);
    assert.equal(md.body, read('docs/PRIVILEGE-SETUP.md'));
  });
});

test('a file that is not there is a plain 404 (no stack trace, no listing), and no path reaches a file outside docs/setup-guide', async () => {
  await withMainAgent(async port => {
    const missing = await rawGet(port, '/setup/nope.html');
    assert.equal(missing.status, 404);
    assert.ok(!/at .*\.(ts|js):\d+|node_modules/.test(missing.body), 'no stack trace');
    const dir = await rawGet(port, '/setup/assets/');
    assert.ok(!/site\.css/.test(dir.body), 'no directory listing');
    for (const path of ['/setup/..%2f..%2fpackage.json', '/setup/%2e%2e/%2e%2e/package.json', '/setup/../package.json', '/setup/assets/../../../package.json', '/setup/..%2fPRIVILEGE-SETUP.md', '/setup/.%2e/Dockerfile']) {
      const res = await rawGet(port, path);
      assert.ok(!/"name": "privilege-a2a-anthropic-demo"/.test(res.body) && !/^FROM node/m.test(res.body) && res.body !== read('docs/PRIVILEGE-SETUP.md'), `${path} leaked a file outside the folder`);
      assert.notEqual(res.status, 200, `${path} answered 200`);
    }
  });
});

test('the host guard still covers /setup/: a foreign Host is refused with 421, like every other route', async () => {
  await withMainAgent(async port => {
    assert.equal((await rawGet(port, '/setup/', 'evil.example')).status, 421);
    assert.equal((await rawGet(port, '/setup/', `evil.example:${port}`)).status, 421);
    assert.equal((await rawGet(port, '/setup/')).status, 200);
  });
});
