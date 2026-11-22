import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { renderPage } from '../src/main-agent/ui.js';

const packageDirectory = fileURLToPath(new URL('..', import.meta.url));
const page = renderPage();

// Rule 19: the Mock / Real control is the Mode dropdown of the shared TopMenu (vendored into web/src/top-menu, rendered by the React island in
// web/src/Shell.jsx). Its value is the CURRENT mode (GET /api/info `source`), and switching goes through POST /api/mode. The island's own tests
// (web/src/Shell.test.jsx) drive the dropdown, the 409 and the hint; these tests pin the page side and the server side.

test('the page carries a shell bar with a mount point for the top menu, and no hand-written Mock / Real buttons or old top-menu markup', () => {
  assert.match(page, /<header class="shell-bar"><span class="shell-brand">[\s\S]*?<h1>A2A with remote agents<\/h1><\/span><div id="top-menu-root"><\/div><\/header>/);
  assert.ok(page.includes('<link rel="stylesheet" href="/web/assets/topmenu.css">'));
  assert.ok(page.includes('<script type="module" src="/web/assets/topmenu.js"></script>'));
  for (const gone of ['id="mode-mock"', 'id="mode-real"', 'class="mode-toggle"', '<nav class="top-menu"', '.mode-toggle']) assert.ok(!page.includes(gone), gone);
  assert.equal(page.split('id="top-menu-root"').length - 1, 1);
});

test('the page script reads the mode from the paad:mode event the dropdown sends, and the chat still sends window.__uiMode()', () => {
  assert.ok(page.includes("window.addEventListener('paad:mode',function(e){uiMode=e.detail&&e.detail.mode==='real'?'real':'mock'})"));
  assert.ok(page.includes('window.__uiMode=function(){return uiMode}'));
  assert.ok(page.includes('mode:window.__uiMode?window.__uiMode():undefined'));
});

test('the island sends exactly { source } to POST /api/mode and paints the dropdown from GET /api/info source', () => {
  const shell = readFileSync(join(packageDirectory, 'web/src/Shell.jsx'), 'utf8');
  assert.match(shell, /fetch\("\/api\/info"/);
  assert.match(shell, /\(info\.source \|\| info\.mode\) === "real"/);
  assert.match(shell, /fetch\("\/api\/mode", \{ method: "POST"[^)]*JSON\.stringify\(\{ source: next \}\)/);
  assert.match(shell, /res\.status === 409/);
});

test('the page is named A2A with remote agents: title, heading and first tab; not Access Review', () => {
  assert.match(page, /<title>A2A with remote agents — Privilege A2A<\/title>/);
  assert.match(page, /id="tab-review"[^>]*>A2A with remote agents<\/button>/);
  assert.match(page, /id="tab-aws"[^>]*>Custodian to AWS agent<\/button>/);
  assert.ok(!/Access review/i.test(page.replace(/Review access on prod-db-primary|cloud access review/gi, '')), 'no Access review wording left');
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

test('the main agent serves the built island at /web/assets/ (script and stylesheet), and the page links exactly those', async () => {
  await withMainAgent(false, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    for (const [path, type] of [['/web/assets/topmenu.js', /javascript/], ['/web/assets/topmenu.css', /css/]] as const) {
      assert.ok(html.includes(path), path);
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 200, `${path}: run npm run build:web first (npm test does)`);
      assert.match(res.headers.get('content-type') ?? '', type);
      assert.equal(res.headers.get('cache-control'), 'no-cache');
    }
    const css = await (await fetch(`${base}/web/assets/topmenu.css`)).text();
    assert.ok(css.includes('.top-menu') && css.includes('.shell-bar'), 'the stylesheet carries the vendored top-menu.css and the shell bar css');
    assert.equal((await fetch(`${base}/web/assets/nope.js`)).status, 404);
  });
});
