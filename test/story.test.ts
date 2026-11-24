import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { CAPTIONS_PATH, loadCaptions, resetCaptionsCache, storyResponse } from '../src/story.js';
// @ts-expect-error vendored plain JavaScript
import { parity } from '../server/src/story/captions.js';
// @ts-expect-error vendored plain JavaScript
import { checkPin } from '../scripts/story-checkPin.mjs';
// @ts-expect-error plain JavaScript data
import { EXTRA_SAMPLE_KEYS, P1_Q1, P1_Q2, P2_Q1, P2_Q2, STEPS, scriptKeys } from '../web/src/storyScript.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const tsxCli = join(dirname(dirname(fileURLToPath(import.meta.url))), 'node_modules/tsx/dist/cli.mjs');
interface Step { key: string; type: 'bubble' | 'slide'; modes?: string[]; sampleKey?: string; prompt?: unknown; trigger: string; fixedSecs?: number; when?: string }
const steps = STEPS as Step[];

test('story: the vendored Story files match their pin (an edited copy fails CI)', () => {
  assert.deepEqual(checkPin(root), []);
});

test('story: every caption key has a step in the script and every step has wording (the parity test)', () => {
  const problems = parity(loadCaptions(), scriptKeys(), { allowUnused: ['sample_intro'] });
  assert.deepEqual(problems, []);
});

test('story: the parity check really fails when the wording and the script drift', () => {
  const captions = loadCaptions();
  const missingWording = { ...captions, steps: Object.fromEntries(Object.entries(captions.steps).filter(([k]) => k !== 'p1_answer')) };
  assert.deepEqual(parity(missingWording, scriptKeys(), { allowUnused: ['sample_intro'] }), ['the demo has step "p1_answer" but captions.md does not']);
  const extra = { ...scriptKeys(), steps: [...scriptKeys().steps, 'brand_new'] };
  assert.deepEqual(parity(captions, extra, { allowUnused: ['sample_intro'] }), ['the demo has step "brand_new" but captions.md does not']);
});

test('story: the script has the same number of numbered bubbles as the recorded video (27 live, 25 simulated)', () => {
  const bubbles = (mode: string) => steps.filter(s => s.type === 'bubble' && (!s.modes || s.modes.includes(mode))).length;
  assert.equal(bubbles('real'), 27);
  assert.equal(bubbles('mock'), 25);
  const video = readFileSync(`${root}video/take.py`, 'utf8');
  assert.match(video, /TOTAL = 25 if SAMPLE else 27/);
});

test('story: the questions are the video\'s own', () => {
  const video = readFileSync(`${root}video/take.py`, 'utf8');
  for (const [name, text] of [['P1_Q1', P1_Q1], ['P1_Q2', P1_Q2], ['P2_Q1', P2_Q1], ['P2_Q2', P2_Q2]]) {
    assert.ok(video.includes(`${name} = "${text}"`), `${name} matches take.py`);
  }
});

test('story: the fixed holds are the video\'s own, read from take.py (a step the video gives no secs has none)', () => {
  const video = readFileSync(`${root}video/take.py`, 'utf8');
  const fromVideo: Record<string, number> = {};
  for (const m of video.matchAll(/bubble\("([a-z0-9_]+)"[^\n]*?\bsecs=([0-9.]+)/g)) fromVideo[m[1] as string] = Number(m[2]);
  const fromScript = Object.fromEntries(steps.filter(s => s.fixedSecs !== undefined).map(s => [s.key, s.fixedSecs]));
  assert.deepEqual(fromScript, fromVideo);
  assert.deepEqual(Object.keys(fromVideo).sort(), ['p1_prompt', 'p1_refuse_prompt', 'pick_prompt', 'second_prompt']);
});

test('story: the bubbles come in the same order as in take.py, and the mode flags sit on the same steps', () => {
  const video = readFileSync(`${root}video/take.py`, 'utf8');
  const order = [...video.matchAll(/(?:\bbubble\("([a-z0-9_]+)"|\bpopout\(frame_sel\([^)]*\), "[^"]*", "([a-z0-9_]+)")/g)].map(m => (m[1] ?? m[2]) as string);
  assert.deepEqual(steps.filter(s => s.type === 'bubble').map(s => s.key), order);
  assert.deepEqual(steps.filter(s => s.modes?.includes('real') && !s.modes.includes('mock')).map(s => s.key), ['token_frame', 'token_popout', 'refused_metadata']);
  assert.deepEqual(steps.filter(s => s.modes?.includes('mock') && !s.modes.includes('real')).map(s => s.key), ['sample_note', 'live_banner']);
  assert.deepEqual(steps.filter(s => s.when === 'awsLive').map(s => s.key), ['token_frame', 'token_popout', 'refused_metadata']);
});

test('story: every step is well formed (a known trigger and type, Mock wording that exists, no twin keys)', () => {
  const captions = loadCaptions();
  const keys = steps.map(s => s.key);
  assert.equal(new Set(keys).size, keys.length, 'no key twice');
  for (const s of steps) {
    assert.ok(['load', 'run-done', 'frame'].includes(s.trigger), `${s.key}: trigger`);
    assert.ok(['bubble', 'slide'].includes(s.type), `${s.key}: type`);
    if (s.sampleKey) assert.ok(captions.steps[s.sampleKey], `${s.key}: Mock wording "${s.sampleKey}" exists`);
  }
  for (const k of EXTRA_SAMPLE_KEYS as string[]) assert.ok(captions.steps[k], `${k} exists`);
});

test('story: captions.md and the script are public-safe (no internal host, tenant id, key or screenshot data)', () => {
  const text = readFileSync(CAPTIONS_PATH, 'utf8') + readFileSync(`${root}web/src/storyScript.js`, 'utf8');
  assert.equal(/ping-devops|procyon|\.local\b|sk-ant|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text), false);
});

test('story: storyResponse serves the parsed wording, and a broken file is a 500 that names the problem (never a crash)', () => {
  const ok = storyResponse();
  assert.equal(ok.status, 200);
  const body = ok.body as { opening: { title: string }; steps: Record<string, unknown> };
  assert.ok(body.opening.title && body.steps.p1_intro);
  const dir = mkdtempSync(join(tmpdir(), 'story-'));
  const bad = join(dir, 'captions.md');
  writeFileSync(bad, '# Step: x\n\n## Title\nonly a title\n');
  const broken = storyResponse(bad);
  assert.equal(broken.status, 500);
  assert.match((broken.body as { error: string }).error, /^Story wording could not be read: captions\.md: step "x" needs both a "## Title" and a "## Text" section$/);
  const missing = storyResponse(join(dir, 'missing.md'));
  assert.equal(missing.status, 500);
  assert.equal((missing.body as { error: string }).error, 'Story wording could not be read: the wording file is missing or unreadable.');
  assert.equal(JSON.stringify(missing.body).includes(dir), false, 'the 500 never carries a server path');
  resetCaptionsCache();
});

async function reservePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

test('story: the main agent answers GET /api/story with the wording; the page itself is unchanged by Story', async () => {
  const port = await reservePort();
  const child = spawn(process.execPath, [tsxCli, 'src/main-agent/index.ts'], {
    cwd: root,
    env: { ...process.env, ANTHROPIC_BASE_URL: 'http://127.0.0.1:9', MAIN_AGENT_PROVIDER: 'anthropic', MAIN_AGENT_KEY: 'test-main-key', MAIN_AGENT_HOST: '127.0.0.1', MAIN_AGENT_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', c => { output += String(c); });
  child.stderr?.on('data', c => { output += String(c); });
  try {
    const deadline = Date.now() + 20_000;
    let ready = false;
    while (Date.now() < deadline && !ready) {
      if (child.exitCode !== null) assert.fail(`main agent exited early (code ${child.exitCode}):\n${output}`);
      try { ready = (await fetch(`http://127.0.0.1:${port}/api/health`)).status === 200; } catch { await delay(200); }
    }
    assert.ok(ready, `main agent did not become ready:\n${output}`);
    const res = await fetch(`http://127.0.0.1:${port}/api/story`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-cache');
    const body = await res.json() as { steps: Record<string, { title: string }>; slides: Record<string, unknown> };
    assert.ok(body.steps.p1_prompt?.title && body.slides.part2);
    const page = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    assert.equal(/api\/story|storyScript|story-bar/i.test(page), false, 'Demo mode: the served page does not mention Story');
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, 'exit').catch(() => undefined);
      child.kill('SIGTERM');
      await Promise.race([exited, delay(3000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  }
});

test('story: a fix to captions.md shows without a restart (the wording is read again when the file changes)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'story-'));
  const file = join(dir, 'captions.md');
  const slide = (t: string) => `# Opening Slide\n\n## Title\n${t}\n\n## Lead\nl\n\n## Column A: a\n- x\n\n## Column B: b\n- y\n\n## Verdict\nv\n\n---\n\n`;
  const doc = (t: string) => slide(t) + slide('c').replace('# Opening Slide', '# Closing Slide');
  writeFileSync(file, doc('first'));
  assert.equal(loadCaptions(file).opening.title, 'first');
  writeFileSync(file, doc('second'));
  utimesSync(file, new Date(), new Date(Date.now() + 5000));
  assert.equal(loadCaptions(file).opening.title, 'second');
});

test('story: no console screenshot is tracked, and the assets folder is ignored (the repo is public)', () => {
  assert.match(readFileSync(`${root}video/.gitignore`, 'utf8'), /^assets\/$/m);
  let tracked: string[] | null = null;
  try { tracked = execFileSync('git', ['ls-files', '--', 'video/assets', '*.jpg', '*.jpeg', '*.png'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean); } catch { /* no git here (the Air gets tracked files without .git): the ignore rule above still ran */ }
  if (tracked) assert.deepEqual(tracked, []);
});
