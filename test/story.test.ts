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

import { createHash } from 'node:crypto';
import { CAPTIONS_PATH, captionsSha256, loadCaptions, resetCaptionsCache, storyResponse } from '../src/story.js';
// @ts-expect-error vendored plain JavaScript
import { parity } from '../server/src/story/captions.js';
// @ts-expect-error vendored plain JavaScript
import { checkPin } from '../scripts/story-checkPin.mjs';
// @ts-expect-error plain JavaScript data
import { EXTRA_SAMPLE_KEYS, P1_Q1, P1_Q2, P2_Q1, P2_Q2, P2_SUM, P2_SUM2, STEPS, STORY_ONLY, VIDEO_ONLY, scriptKeys } from '../web/src/storyScript.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const tsxCli = join(dirname(dirname(fileURLToPath(import.meta.url))), 'node_modules/tsx/dist/cli.mjs');
interface Step { key: string; type: 'bubble' | 'slide'; modes?: string[]; sampleKey?: string; prompt?: unknown; trigger: string; fixedSecs?: number; when?: string }
const steps = STEPS as Step[];

test('story: the vendored Story files match their pin (an edited copy fails CI)', () => {
  assert.deepEqual(checkPin(root), []);
});

test('story: every caption key has a step in the script and every step has wording (the parity test)', () => {
  const problems = parity(loadCaptions(), scriptKeys(), { allowUnused: VIDEO_ONLY });
  assert.deepEqual(problems, []);
});

test('story: the parity check really fails when the wording and the script drift', () => {
  const captions = loadCaptions();
  const missingWording = { ...captions, steps: Object.fromEntries(Object.entries(captions.steps).filter(([k]) => k !== 'p1_answer')) };
  assert.deepEqual(parity(missingWording, scriptKeys(), { allowUnused: VIDEO_ONLY }), ['the demo has step "p1_answer" but captions.md does not']);
  const extra = { ...scriptKeys(), steps: [...scriptKeys().steps, 'brand_new'] };
  assert.deepEqual(parity(captions, extra, { allowUnused: VIDEO_ONLY }), ['the demo has step "brand_new" but captions.md does not']);
});

test('story: the script has the same number of numbered bubbles as the recorded video (27 live, 25 simulated)', () => {
  const bubbles = (mode: string) => steps.filter(s => s.type === 'bubble' && !STORY_ONLY.includes(s.key) && (!s.modes || s.modes.includes(mode))).length;
  assert.equal(bubbles('real'), 27);   // the video's own scenes; Story adds its live observability bubble on top (STORY_ONLY)
  assert.equal(bubbles('mock'), 25);
  assert.deepEqual(STORY_ONLY, ['observability_panel', ...steps.filter(s => s.key.startsWith('b_')).map(s => s.key)], 'Story only: the live observability bubble and every Part 3 Bedrock bubble');
  const video = readFileSync(`${root}video/take.py`, 'utf8');
  assert.match(video, /TOTAL = 25 if SAMPLE else 27/);
});

test('story: the questions are the video\'s own', () => {
  const video = readFileSync(`${root}video/take.py`, 'utf8');
  for (const [name, text] of [['P1_Q1', P1_Q1], ['P1_Q2', P1_Q2], ['P2_Q1', P2_Q1], ['P2_Q2', P2_Q2]]) {
    assert.ok(video.includes(`${name} = "${text}"`), `${name} matches take.py`);
  }
  assert.ok(video.includes(`P2_SUM = "${P2_SUM}"; P2_SUM2 = "${P2_SUM2}"`), 'the sums the live answers are checked against are take.py\'s own');
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
  assert.deepEqual(steps.filter(s => s.type === 'bubble' && !STORY_ONLY.includes(s.key)).map(s => s.key), order);
  assert.deepEqual(steps.filter(s => s.modes?.includes('real') && !s.modes.includes('mock')).map(s => s.key), ['token_frame', 'token_popout', 'refused_metadata']);
  assert.deepEqual(steps.filter(s => s.modes?.includes('mock') && !s.modes.includes('real')).map(s => s.key), ['sample_note', 'live_banner']);
  assert.deepEqual(steps.filter(s => s.when === 'awsLive').map(s => s.key), ['token_frame', 'token_popout', 'refused_metadata']);
});

test('story: Part 3 (the Bedrock tab) is Story only, simulated, after the video\'s scenes and before the protect slide; take.py does not know it', () => {
  const keys = steps.map(s => s.key);
  const part3 = steps.filter(s => s.key === 'part3_bedrock' || s.key.startsWith('b_'));
  assert.ok(part3.length >= 13, 'the slide and its bubbles');
  assert.deepEqual(part3.map(s => keys.indexOf(s.key)), part3.map((_, i) => keys.indexOf('part3_bedrock') + i), 'one block, in order');
  assert.ok(keys.indexOf('part3_bedrock') > keys.indexOf('observability_panel') && keys.indexOf('b_iam') < keys.indexOf('protect'));
  for (const s of part3.filter(x => x.type === 'bubble')) assert.ok(STORY_ONLY.includes(s.key), `${s.key} is Story only`);
  const video = readFileSync(`${root}video/take.py`, 'utf8');
  assert.ok(!/part3_bedrock|"b_[a-z_]+"|bedrock-/.test(video), 'the recorded video has no Part 3 yet');
  const captions = loadCaptions() as unknown as { slides: Record<string, { verdict: string }>; steps: Record<string, { text: string }> };
  assert.match(captions.slides.part3_bedrock?.verdict ?? '', /^Simulated/);
  assert.match(captions.steps.b_intro?.text ?? '', /simulated/);
  // Review (PR #64): the 502 bubble says only what the source supports.
  assert.equal(captions.steps.b_wrong_502?.text, 'Today the gateway answers with a generic HTTP 502 upstream_unreachable. The caller is not told why.');
  for (const k of Object.keys(captions.steps).filter(k => k.startsWith('b_'))) assert.ok(!/network failure|gateway's log/i.test(captions.steps[k]?.text ?? ''), k);
  // Press steps name a scenario button the page has, and every result waits for the run.
  const presses = part3.filter(s => (s.prompt as { press?: string } | undefined)?.press);
  assert.deepEqual(presses.map(s => (s.prompt as { press: string }).press), ['#bedrock-sc-own', '#bedrock-sc-cross', '#bedrock-sc-wrong-ext', '#bedrock-sc-denied', '#bedrock-sc-fail-closed', '#bedrock-sc-fail-open']);
  for (const p of presses) assert.equal(steps[keys.indexOf(p.key) + 1]?.trigger, 'run-done', `${p.key} is followed by a step that waits for its run`);
});

test('story (rule 29): the first page the viewer sees, in Real and in Mock, has a header naming the demo', () => {
  const captions = loadCaptions() as unknown as { opening: { header: string | null }; slides: Record<string, { header: string | null }> };
  for (const mode of ['real', 'mock']) {
    const first = steps.find(s => !s.modes || s.modes.includes(mode))!;
    assert.equal(first.type, 'slide', `${mode}: the first page is a slide`);
    const slide = first.key === 'opening' ? captions.opening : captions.slides[first.key];
    assert.ok(slide && slide.header && slide.header.length > 3, `${mode}: "${first.key}" has a header`);
  }
  assert.equal(captions.opening.header, 'A2A, and A2A with an AWS agent');
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
  assert.equal((body as unknown as { sourceSha256: string }).sourceSha256, createHash('sha256').update(readFileSync(CAPTIONS_PATH)).digest('hex'), 'the wording says which bytes it came from');
  assert.equal(captionsSha256(), (body as unknown as { sourceSha256: string }).sourceSha256);
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
  const slide = (t: string) => `# Opening Slide\n\n## Header\nh\n\n## Title\n${t}\n\n## Lead\nl\n\n## Column A: a\n- x\n\n## Column B: b\n- y\n\n## Verdict\nv\n\n---\n\n`;
  const doc = (t: string) => slide(t) + slide('c').replace('# Opening Slide', '# Closing Slide');
  writeFileSync(file, doc('first'));
  assert.equal(loadCaptions(file).opening.title, 'first');
  writeFileSync(file, doc('second'));
  utimesSync(file, new Date(), new Date(Date.now() + 5000));
  assert.equal(loadCaptions(file).opening.title, 'second');
});

test('story: an edit that keeps the same timestamp still shows, and the served hash always matches the served wording (one read)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'story-'));
  const file = join(dir, 'captions.md');
  const slide = (t: string) => `# Opening Slide\n\n## Header\nh\n\n## Title\n${t}\n\n## Lead\nl\n\n## Column A: a\n- x\n\n## Column B: b\n- y\n\n## Verdict\nv\n\n---\n\n`;
  const doc = (t: string) => slide(t) + slide('c').replace('# Opening Slide', '# Closing Slide');
  writeFileSync(file, doc('first')); const when = new Date(Date.now() - 60_000); utimesSync(file, when, when);
  const a = storyResponse(file).body as unknown as { opening: { title: string }; sourceSha256: string };
  assert.equal(a.opening.title, 'first'); assert.equal(a.sourceSha256, createHash('sha256').update(readFileSync(file)).digest('hex'));
  writeFileSync(file, doc('other')); utimesSync(file, when, when);            // new bytes, the very same timestamp
  const b = storyResponse(file).body as unknown as { opening: { title: string }; sourceSha256: string };
  assert.equal(b.opening.title, 'other'); assert.notEqual(b.sourceSha256, a.sourceSha256);
});

test('story: no console screenshot is tracked, and the assets folder is ignored (the repo is public)', () => {
  assert.match(readFileSync(`${root}video/.gitignore`, 'utf8'), /^assets\/$/m);
  let tracked: string[] | null = null;
  try { tracked = execFileSync('git', ['ls-files', '--', 'video/assets', '*.jpg', '*.jpeg', '*.png'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean); } catch { /* no git here (the Air gets tracked files without .git): the ignore rule above still ran */ }
  if (tracked) assert.deepEqual(tracked, []);
});
