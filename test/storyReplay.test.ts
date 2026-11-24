import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { notesFor } from '../src/runObs.js';
import { playSimulated, simulatedRun } from '../src/storyReplay.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tsxCli = join(root, 'node_modules/tsx/dist/cli.mjs');
const BOB = 'What can Bob Reyes reach?';
const BLOCKED = 'Review access on prod-db-primary';

test('story replay: only the two scripted questions get a simulated run', () => {
  assert.equal(simulatedRun(BOB)?.kind, 'allowed');
  assert.equal(simulatedRun(BLOCKED)?.kind, 'blocked');
  assert.equal(simulatedRun('who is Carol Nguyen?'), null);
  assert.equal(simulatedRun(''), null);
});

test('story replay: the events have the shape of a live run, in order, and the blocked one has no tool result', () => {
  const kinds = (q: string) => simulatedRun(q)!.steps.map(s => `${s.event}:${String((s.payload as { kind?: string }).kind ?? '')}`);
  assert.deepEqual(kinds(BOB), ['trace:model', 'trace:delegate', 'trace:model', 'trace:mcp-call', 'trace:mcp-result', 'trace:model', 'trace:result', 'token:']);
  assert.deepEqual(kinds(BLOCKED), ['trace:model', 'trace:delegate', 'trace:model', 'trace:mcp-call', 'trace:error', 'trace:model', 'trace:result', 'token:']);
  const blocked = simulatedRun(BLOCKED)!.steps.find(s => (s.payload as { kind?: string }).kind === 'error')!;
  assert.match(String((blocked.payload as { detail: string }).detail), /content_blocked/);
});

test('story replay: every event says it is simulated or is plainly synthetic, and nothing in it is a real host, key, id or email', () => {
  for (const q of [BOB, BLOCKED]) {
    const text = JSON.stringify(simulatedRun(q));
    assert.equal(/ping-devops|procyon|\.local\b|sk-ant|sk-orion|@acme|mcpgw|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text), false, 'public-safe');
    assert.match(text, /gateway\.example/);
    assert.match(text, /simulated/);
  }
  assert.match(JSON.stringify(simulatedRun(BOB)), /\[REDACTED:pii\]/);
});

test('story replay: the run observability panel reads a simulated run like a live one (a block is a block, an answer is allowed)', () => {
  const notes = (q: string) => simulatedRun(q)!.steps.filter(s => s.event === 'trace').flatMap(s => notesFor(s.payload as never, 0).map(n => `${n.layer}:${n.outcome}`));
  assert.ok(notes(BLOCKED).includes('privilege:blocked'));
  assert.ok(notes(BOB).includes('resource:allowed'));
  assert.equal(notes(BOB).some(n => n.endsWith(':blocked')), false);
});

test('story replay: playSimulated sends the session first and done last with the run\'s pauses; a closed connection stops it at once', async () => {
  const run = simulatedRun(BOB)!;
  const sent: string[] = []; const slept: number[] = [];
  await playSimulated(run, '12345678-aaaa', (e, p) => sent.push(`${e}:${String((p as { kind?: string }).kind ?? '')}`), () => false, async ms => { slept.push(ms); });
  assert.equal(sent[0], 'trace:session'); assert.equal(sent.at(-1), 'done:'); assert.equal(sent.length, run.steps.length + 2);
  assert.equal(slept.reduce((a, b) => a + b, 0), run.steps.reduce((a, s) => a + s.delayMs, 0));
  const some: string[] = []; let closed = false;
  const ok = await playSimulated(run, 'x', e => some.push(e), () => closed, async () => { closed = true; });
  assert.equal(ok, false); assert.equal(some.includes('done'), false);
});

async function reservePort(): Promise<number> {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const { port } = server.address() as AddressInfo; await new Promise<void>(r => server.close(() => r())); return port;
}

test('story replay: over HTTP, only a Story-on question gets the simulated run; the same question without it takes the normal path (Demo unchanged)', async () => {
  const port = await reservePort();
  const env: NodeJS.ProcessEnv = { ...process.env, MAIN_AGENT_HOST: '127.0.0.1', MAIN_AGENT_PORT: String(port) };
  for (const k of Object.keys(env)) if (/_KEY$|_TOKEN$|_PROVIDER$|BASE_URL$|API_KEY$/.test(k)) delete env[k];
  const child = spawn(process.execPath, [tsxCli, 'src/main-agent/index.ts'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout?.on('data', c => { output += String(c); }); child.stderr?.on('data', c => { output += String(c); });
  const post = (body: unknown) => fetch(`http://127.0.0.1:${port}/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const deadline = Date.now() + 20_000; let ready = false;
    while (Date.now() < deadline && !ready) {
      if (child.exitCode !== null) assert.fail(`main agent exited early (code ${child.exitCode}):\n${output}`);
      try { ready = (await fetch(`http://127.0.0.1:${port}/api/health`)).status === 200; } catch { await delay(200); }
    }
    assert.ok(ready, `main agent did not become ready:\n${output}`);
    assert.equal(((await (await fetch(`http://127.0.0.1:${port}/api/info`)).json()) as { source: string }).source, 'mock');
    const story = await (await post({ message: BOB, mode: 'mock', story: true })).text();
    assert.match(story, /simulated \(no model call\)/); assert.match(story, /event: done/); assert.match(story, /REDACTED:pii/);
    const demo = await (await post({ message: BOB, mode: 'mock' })).text();
    assert.equal(/simulated/i.test(demo), false, 'without story: true nothing is simulated');
    assert.match(demo, /Model not configured|error/i);
    const other = await (await post({ message: 'who is Carol Nguyen?', mode: 'mock', story: true })).text();
    assert.equal(/simulated \(no model call\)/.test(other), false, 'an unscripted question is not simulated');
  } finally {
    if (child.exitCode === null) { const exited = once(child, 'exit').catch(() => undefined); child.kill('SIGTERM'); await Promise.race([exited, delay(3000)]); if (child.exitCode === null) child.kill('SIGKILL'); }
  }
});
