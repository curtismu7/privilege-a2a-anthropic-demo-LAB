import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { shelfInfo } from '../src/shelfLink.js';
import { renderPage } from '../src/main-agent/ui.js';

const packageDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const tsxCli = join(packageDirectory, 'node_modules/tsx/dist/cli.mjs');

async function reservePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

test('shelfInfo trims the trailing slash and is null when nothing is configured', () => {
  assert.deepEqual(shelfInfo({ SHELF_URL: 'https://shelf.example:8443/' }), { shelfUrl: 'https://shelf.example:8443' });
  assert.deepEqual(shelfInfo({ HOME: '/nonexistent' }), { shelfUrl: null });
});

test('the page header builds the Shelf button from /api/shelf', () => {
  const html = renderPage();
  assert.match(html, /fetch\('\/api\/shelf'/);
  assert.match(html, /a\.className='top-menu__shelf top-menu__shelf--accent'/);
});

// Regression: the header "Shelf" button reads GET /api/shelf on the running main agent (the real process, no web build).
test('the main agent answers GET /api/shelf with SHELF_URL; POST is not 200', async () => {
  const port = await reservePort();
  const child = spawn(process.execPath, [tsxCli, 'src/main-agent/index.ts'], {
    cwd: packageDirectory,
    env: {
      ...process.env,
      SHELF_URL: 'https://shelf.example:8443/',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
      MAIN_AGENT_PROVIDER: 'anthropic',
      MAIN_AGENT_KEY: 'test-main-key',
      MAIN_AGENT_HOST: '127.0.0.1',
      MAIN_AGENT_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', chunk => { output += String(chunk); });
  child.stderr?.on('data', chunk => { output += String(chunk); });
  try {
    const deadline = Date.now() + 20_000;
    let ready = false;
    while (Date.now() < deadline && !ready) {
      if (child.exitCode !== null) assert.fail(`main agent exited early (code ${child.exitCode}):\n${output}`);
      try { ready = (await fetch(`http://127.0.0.1:${port}/api/health`)).status === 200; } catch { await delay(200); }
    }
    assert.ok(ready, `main agent did not become ready:\n${output}`);
    const response = await fetch(`http://127.0.0.1:${port}/api/shelf`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { shelfUrl: 'https://shelf.example:8443' });
    const post = await fetch(`http://127.0.0.1:${port}/api/shelf`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.notEqual(post.status, 200);
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, 'exit').catch(() => undefined);
      child.kill('SIGTERM');
      await Promise.race([exited, delay(3000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  }
});
