import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { renderPage } from '../src/main-agent/ui.js';

const packageDirectory = fileURLToPath(new URL('..', import.meta.url));
const page = renderPage();

// Rule 19: the Mock / Real toggle is a Mode control in TopMenu row 1, its pressed state is the CURRENT mode (GET /api/info `source`),
// and switching goes through POST /api/mode. A toggle that only shows the launch mode does not meet it.

test('the Mock / Real toggle sits in TopMenu row 1, both sides unpressed until the page has read the mode', () => {
  const nav = page.slice(page.indexOf('<nav class="top-menu"'), page.indexOf('</nav>'));
  const firstRow = nav.slice(0, nav.indexOf('</div></div>') + 12);
  assert.match(firstRow, /class="top-menu__row"[^>]*>\s*<span[^>]*>Mode<\/span>\s*<div class="mode-toggle" role="group"/);
  assert.match(nav, /id="mode-mock" aria-pressed="false"/);
  assert.match(nav, /id="mode-real" aria-pressed="false"/);
  assert.ok(!/<div class="mode-toggle"[^>]*>[\s\S]*?<\/div><nav class="top-menu"/.test(page), 'the toggle is no longer a loose element before the menu');
});

test('the page paints the pressed side from /api/info source, and from the answer of POST /api/mode', () => {
  assert.match(page, /fetch\('\/api\/info'\)[^;]*paint\(i\.source\|\|i\.mode\)/);
  assert.match(page, /paint\(res\.d\.mode\|\|w\)/);
});

async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  return port;
}

async function withMainAgent<T>(realConfigured: boolean, run: (base: string) => Promise<T>): Promise<T> {
  const port = await freePort();
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) if (/_KEY$|_TOKEN$|_PROVIDER$|BASE_URL$|^AWS_AGENT_/.test(key)) delete env[key];
  if (realConfigured) { env.MAIN_AGENT_PROVIDER = 'anthropic'; env.ANTHROPIC_API_KEY = 'test-not-a-real-key'; }
  const child = spawn(process.execPath, [join(packageDirectory, 'node_modules/tsx/dist/cli.mjs'), 'src/main-agent/index.ts'], {
    cwd: packageDirectory,
    env: { ...env, MAIN_AGENT_PORT: String(port), AWS_MOCK_PORT: String(port + 1) },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 200; i += 1) {
      try { if ((await fetch(`${base}/api/info`)).ok) break; } catch { /* not up yet */ }
      await delay(100);
    }
    return await run(base);
  } finally {
    child.kill('SIGTERM');
  }
}

const getInfo = async (base: string): Promise<{ source?: string; mode?: string; realAvailable?: boolean }> => (await fetch(`${base}/api/info`)).json() as Promise<{ source?: string; mode?: string; realAvailable?: boolean }>;
const postMode = (base: string, body: unknown): Promise<Response> =>
  fetch(`${base}/api/mode`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('GET /api/info follows the switch in both directions (it reports the current mode, not the launch mode)', async () => {
  await withMainAgent(true, async (base) => {
    const start = await getInfo(base);
    assert.equal(start.source, 'real');
    assert.equal(start.realAvailable, true);
    assert.equal((await postMode(base, { source: 'mock' })).status, 200);
    assert.equal((await getInfo(base)).source, 'mock');
    assert.equal((await postMode(base, { source: 'real' })).status, 200);
    assert.equal((await getInfo(base)).source, 'real');
    assert.equal((await postMode(base, { source: 'nonsense' })).status, 400);
  });
});

test('with no model provider the lab starts in Mock, reports realAvailable false, and refuses Real with 409', async () => {
  await withMainAgent(false, async (base) => {
    const info = await getInfo(base);
    assert.equal(info.source, 'mock');
    assert.equal(info.realAvailable, false);
    const refused = await postMode(base, { source: 'real' });
    assert.equal(refused.status, 409);
    assert.equal((await getInfo(base)).source, 'mock');
  });
});
