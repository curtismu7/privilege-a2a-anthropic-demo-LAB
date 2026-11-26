import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

// @ts-expect-error plain JavaScript
import * as lib from '../scripts/setup-lib.mjs';

// npm run setup (scripts/setup.mjs, logic in scripts/setup-lib.mjs). Spec: docs/specs/2026-11-25-setup-script-v1.md.
// The canary keys below must never appear in any output, file name, error or result the tool produces.
const root = `${dirname(dirname(fileURLToPath(import.meta.url)))}/`;
const read = (f: string): string => readFileSync(`${root}${f}`, 'utf8');
const MAIN = 'canary-main-key-0123456789abcdef-xyz';
const WORKER = 'canary-worker-key-fedcba9876543210-uvw';
const WRONG = 'a-wrong-worker-key-0123456789abcdef';
const tmp = (): string => mkdtempSync(join(tmpdir(), 'setup-test-'));
type Problem = { level: string; message: string };
const errs = (list: Problem[]): string => list.filter(p => p.level === 'error').map(p => p.message).join(' | ');

// ------------------------------------------------------------------------------------------------ pure pieces
test('arguments: flags, inline values, and every bad input is refused with a reason that never echoes a value', () => {
  const o = lib.parseArgs(['--apply', '--gateway', 'gw.example', '--provider=google', '--wait', '5', '--path', 'A', '--no-prompt']);
  assert.deepEqual([o.apply, o.gateway, o.provider, o.wait, o.path, o.noPrompt], [true, 'gw.example', 'google', 5, 'a', true]);
  assert.throws(() => lib.parseArgs(['--nope']), /unknown option --nope/);
  assert.throws(() => lib.parseArgs(['stray']), /unexpected argument/);
  assert.throws(() => lib.parseArgs(['--gateway']), /needs a value/);
  assert.throws(() => lib.parseArgs(['--gateway', '--apply']), /needs a value/);
  assert.throws(() => lib.parseArgs(['--apply=1']), /takes no value/);
  assert.throws(() => lib.parseArgs(['--path', 'c']), /--path must be a or b/);
  assert.throws(() => lib.parseArgs(['--wait', '99']), /0 to 30/);
  assert.equal(lib.parseArgs([]).path, 'b');
  for (const typed of [`--MAIN_AGENT_KEY=${MAIN}`, MAIN, `--main-key=${MAIN}`, `--apply=${MAIN}`]) {
    let message = '';
    try { lib.parseArgs([typed]); } catch (e) { message = (e as Error).message; }
    assert.ok(message && !message.includes(MAIN), `a key typed as an argument is echoed: ${message}`);
  }
});

test('.env merge: replaces in place, turns on only an exact commented default, appends the rest under one header, keeps everything else, and is idempotent', () => {
  const text = '# keep this comment\nUNRELATED=1\nMAIN_AGENT_MODEL=\n# WORKER_AGENT_MODEL=old\nMAIN_AGENT_KEY=\n';
  const a = lib.mergeEnv(text, { MAIN_AGENT_MODEL: 'm1', WORKER_AGENT_MODEL: 'm2', MAIN_AGENT_KEY: MAIN, NEW_ONE: 'x' });
  assert.equal(a.text, `# keep this comment\nUNRELATED=1\nMAIN_AGENT_MODEL=m1\nWORKER_AGENT_MODEL=m2\nMAIN_AGENT_KEY=${MAIN}\n\n# Set by npm run setup\nNEW_ONE=x\n`);
  const b = lib.mergeEnv(a.text, { MAIN_AGENT_MODEL: 'm1', WORKER_AGENT_MODEL: 'm2', MAIN_AGENT_KEY: MAIN, NEW_ONE: 'x' });
  assert.equal(b.text, a.text, 'a second run changes nothing');
  assert.ok(b.changes.every((c: { action: string }) => c.action === 'unchanged'));
  assert.match(lib.mergeEnv('A=1\r\nB=2\r\n', { B: '3' }).text, /^A=1\r\nB=3\r\n$/, 'CRLF is kept');
  assert.equal(lib.mergeEnv('', { X: '1' }).text, '# Set by npm run setup\nX=1\n');
  assert.equal(lib.mergeEnv('MAIN_AGENT_KEY_2=keep\nMAIN_AGENT_KEY=old\n', { MAIN_AGENT_KEY: 'new' }).text, 'MAIN_AGENT_KEY_2=keep\nMAIN_AGENT_KEY=new\n', 'a name that is a prefix of another is not touched');
});

test('.env merge: a prose comment that mentions NAME= is not switched on, a duplicate is updated everywhere (the loader takes the last), and "export" lines are replaced', () => {
  assert.equal(lib.mergeEnv("# Groq: set NAME=x here (the gateway's lane)\n# NAME=\n", { NAME: 'v' }).text, "# Groq: set NAME=x here (the gateway's lane)\nNAME=v\n");
  const dup = lib.mergeEnv('A=1\nB=2\nA=3\n', { A: '9' });
  assert.equal(dup.text, 'A=9\nB=2\nA=9\n');
  assert.equal(parseEnv(dup.text).A, '9', 'the value the loader sees is the new one');
  assert.equal(dup.changes[0].duplicates, true);
  assert.equal(lib.mergeEnv('export A=1\n', { A: '2' }).text, 'A=2\n');
  const ex = lib.mergeEnv(read('config.example'), { MAIN_AGENT_MODEL: 'model-x' });
  assert.match(ex.text, /^MAIN_AGENT_MODEL=model-x$/m);
  assert.equal((ex.text.match(/^MAIN_AGENT_MODEL=/gm) ?? []).length, 1, 'the real config.example gets exactly one active model line');
});

test('.env merge refuses a value the loader would misread, and our reader is Node\'s own parser', () => {
  for (const bad of ['a#b', 'say "hi"', "it's", 'back`tick', ' lead', 'trail ', 'two\nlines']) assert.throws(() => lib.mergeEnv('', { X: bad }), /loader would misread|line break/, JSON.stringify(bad));
  const tricky = 'A="x" # note\nB=plain#cut\nexport C=3\nD = 4\n';
  assert.deepEqual(lib.envMap(tricky), parseEnv(tricky), 'the tool reads .env exactly as the lab does');
  assert.equal(lib.envMap(tricky).A, 'x');
});

test('a secret is described only by its length, never its value', () => {
  assert.equal(lib.describeChange({ name: 'MAIN_AGENT_KEY', action: 'set' }, MAIN).includes(MAIN), false);
  assert.match(lib.describeChange({ name: 'MAIN_AGENT_KEY', action: 'set' }, MAIN), /set \(\d+ characters\)/);
  assert.match(lib.describeChange({ name: 'WORKER_AGENT_KEY', action: 'unchanged' }, WORKER), /unchanged \(\d+ characters\)/);
  assert.match(lib.describeChange({ name: 'MCP_URL', action: 'set' }, 'https://gw/mcpdemo/mcp'), /https:\/\/gw\/mcpdemo\/mcp/);
});

test('gateway input: a bare host or an origin is accepted; paths, spaces, http (off loopback) and junk are refused', () => {
  assert.equal(lib.normaliseGateway('gw.example').origin, 'https://gw.example');
  assert.equal(lib.normaliseGateway('https://gw.example:8623/').origin, 'https://gw.example:8623');
  assert.equal(lib.normaliseGateway('http://127.0.0.1:9').origin, 'http://127.0.0.1:9');
  for (const bad of ['', 'gw .example', 'https://gw.example/llm/anthropic', 'http://gw.example', 'ftp://gw.example', 'https://u:p@gw.example']) assert.ok(lib.normaliseGateway(bad).error, `"${bad}" is refused`);
});

test('the lines written follow the provider and Path A writes model lines only (Anthropic and Google; Groq is not supported)', () => {
  const base = { origin: 'https://gw.example', mainModel: 'm1', workerModel: 'm2', workerApp: 'workeragentdemo', mcpApp: 'mcpdemo', path: 'b' };
  const a = lib.envUpdates({ ...base, provider: 'anthropic' }, { main: MAIN, worker: WORKER });
  assert.equal(a.ANTHROPIC_BASE_URL, 'https://gw.example/llm/anthropic');
  assert.equal(a.MAIN_AGENT_KEY, MAIN);
  assert.equal(a.WORKER_A2A_URL, 'https://gw.example/workeragentdemo/a2a');
  assert.equal(a.WORKER_TRACE_URL, 'https://gw.example/workeragentdemo/trace');
  assert.equal(a.MCP_URL, 'https://gw.example/mcpdemo/mcp');
  const g = lib.envUpdates({ ...base, provider: 'google', awsApp: 'aws-agent' }, { main: MAIN });
  assert.equal(g.GEMINI_BASE_URL, 'https://gw.example/llm/google');
  assert.equal(g.MAIN_AGENT_KEY, MAIN);
  assert.equal(g.AWS_AGENT_A2A_URL, 'https://gw.example/aws-agent/a2a');
  const onlyModels = lib.envUpdates({ ...base, provider: 'anthropic', path: 'a' }, {});
  assert.ok(!('WORKER_A2A_URL' in onlyModels) && !('MCP_URL' in onlyModels) && !('MAIN_AGENT_KEY' in onlyModels));
  assert.deepEqual([...lib.PROVIDERS], ['anthropic', 'google']);
  const back = lib.settingsFromEnv(lib.envMap(lib.mergeEnv('', { ...a, AWS_AGENT_A2A_URL: 'https://gw.example/aws-agent/a2a' }).text));
  assert.deepEqual([back.provider, back.origin, back.workerApp, back.mcpApp, back.awsApp], ['anthropic', 'https://gw.example', 'workeragentdemo', 'mcpdemo', 'aws-agent']);
});

test('settings read back from .env follow the app: case and spaces in the provider, a trailing slash on an app URL, and an unset or unsupported provider is not defaulted', () => {
  const s = lib.settingsFromEnv({ MAIN_AGENT_PROVIDER: ' Google ', GEMINI_BASE_URL: 'https://gw.example/llm/google', WORKER_A2A_URL: 'https://gw.example/my-worker/a2a/', MCP_URL: 'https://gw.example/my-mcp/mcp/' });
  assert.deepEqual([s.provider, s.origin, s.workerApp, s.mcpApp], ['google', 'https://gw.example', 'my-worker', 'my-mcp']);
  assert.equal(lib.settingsFromEnv({}).provider, '', 'unset stays unset (the app would treat it as llamacpp)');
  assert.match(errs(lib.validate(lib.settingsFromEnv({ MAIN_AGENT_PROVIDER: 'llamacpp' }), {}, {})), /"llamacpp" is not supported/);
  assert.match(errs(lib.validate(lib.settingsFromEnv({ MAIN_AGENT_PROVIDER: 'groq' }), {}, {})), /"groq" is not supported/);
  assert.match(errs(lib.validate(lib.settingsFromEnv({}), {}, {})), /"\(not set\)" is not supported/);
});

test('validation catches the mistakes that cost time, before any write or call', () => {
  const ok = { provider: 'anthropic', origin: 'https://gw.example', mainModel: 'm1', workerModel: 'm2', workerApp: 'workeragentdemo', mcpApp: 'mcpdemo' };
  assert.equal(errs(lib.validate(ok, { main: MAIN, worker: WORKER }, {})), '');
  assert.match(errs(lib.validate(ok, { main: `${MAIN}${MAIN}` }, {})), /pasted twice/);
  assert.match(errs(lib.validate(ok, { main: 'abc def ghi jkl mno pqr stu' }, {})), /space or line break/);
  assert.match(errs(lib.validate(ok, { main: 'abcdefghij#klmnopqrstuvwxyz' }, {})), /# or a quote/);
  assert.match(errs(lib.validate(ok, { worker: 'short' }, {})), /only 5 characters/);
  assert.match(errs(lib.validate({ ...ok, mainModel: '' }, {}, {})), /main model is not set/);
  assert.match(errs(lib.validate({ ...ok, provider: 'cohere' }, {}, {})), /not supported/);
  assert.match(errs(lib.validate({ ...ok, workerApp: 'Worker App' }, {}, {})), /lower-case/);
  assert.match(errs(lib.validate(ok, {}, { AWS_AGENT_PF_TOKEN_URL: 'https://pf.example/as/token.oauth2' })), /all three/);
  assert.equal(errs(lib.validate(ok, {}, { AWS_AGENT_PF_TOKEN_URL: 'a', AWS_AGENT_PF_CLIENT_ID: 'b', AWS_AGENT_PF_CLIENT_SECRET: 'c' })), '');
  assert.match(errs(lib.validate(ok, {}, { WORKER_AGENT_PROVIDER: 'google' })), /WORKER_AGENT_PROVIDER is "google"/);
  assert.equal(errs(lib.validate(ok, {}, { WORKER_AGENT_PROVIDER: 'Anthropic' })), '', 'same provider, different case');
  assert.ok(lib.validate({ ...ok, mainModel: 'claude-latest' }, {}, {}).some((p: Problem) => p.level === 'warn' && /alias/.test(p.message)));
  assert.ok(lib.validate(ok, { main: MAIN, worker: MAIN }, {}).some((p: Problem) => p.level === 'warn'), 'identical keys warn');
  assert.ok(lib.validate(ok, {}, { ANTHROPIC_AUTH_TOKEN: 'x' }).some((p: Problem) => p.level === 'warn' && /ANTHROPIC_AUTH_TOKEN/.test(p.message)));
});

test('where a key may be sent: every checked URL must be https (loopback http excepted), have no credentials, and be on the gateway origin', () => {
  const origin = 'https://gw.example';
  const good = { MCP_URL: 'https://gw.example/mcpdemo/mcp', WORKER_A2A_URL: 'https://gw.example/workeragentdemo/a2a' };
  assert.equal(errs(lib.validateUrls(good, origin, 'b')), '');
  assert.match(errs(lib.validateUrls({ ...good, MCP_URL: 'https://evil.example/mcp' }, origin, 'b')), /MCP_URL points at https:\/\/evil\.example, not the gateway/);
  assert.match(errs(lib.validateUrls({ ...good, WORKER_A2A_URL: 'http://gw.example/x/a2a' }, origin, 'b')), /must be an https address/);
  assert.match(errs(lib.validateUrls({ ...good, MCP_URL: 'https://user:pw@gw.example/mcp' }, origin, 'b')), /user name or password/);
  assert.match(errs(lib.validateUrls({ ...good, MCP_URL: 'not a url' }, origin, 'b')), /not a URL/);
  assert.match(errs(lib.validateUrls({ WORKER_A2A_URL: good.WORKER_A2A_URL }, origin, 'b')), /MCP_URL is not set/);
  assert.match(errs(lib.validateUrls({ ...good, AWS_AGENT_A2A_URL: 'https://elsewhere.example/aws/a2a' }, origin, 'b')), /AWS_AGENT_A2A_URL points at/);
  assert.match(errs(lib.validateUrls({ MCP_URL: 'http://127.0.0.1:6883/mcp', WORKER_A2A_URL: 'http://127.0.0.1:6882/a2a' }, origin, 'b')), /not the gateway/, 'the local mock URLs of a fresh config.example are refused on Path B');
  assert.equal(errs(lib.validateUrls({ MCP_URL: 'http://127.0.0.1:6883/mcp' }, origin, 'a')), '', 'Path A calls only the model route');
  assert.equal(errs(lib.validateUrls({ MCP_URL: 'http://127.0.0.1:9/mcp', WORKER_A2A_URL: 'http://127.0.0.1:9/a/a2a' }, 'http://127.0.0.1:9', 'b')), '', 'a loopback gateway may use http');
});

test('runVerify sends no key anywhere when a checked URL is off the gateway: it refuses and makes zero calls', async () => {
  let calls = 0;
  const counting = async () => { calls += 1; return new Response('{}', { status: 200 }); };
  const env = { MAIN_AGENT_PROVIDER: 'anthropic', ANTHROPIC_BASE_URL: 'https://gw.example/llm/anthropic', MAIN_AGENT_MODEL: 'm1', WORKER_AGENT_MODEL: 'm2', MAIN_AGENT_KEY: MAIN, WORKER_AGENT_KEY: WORKER, MCP_URL: 'http://evil.invalid/mcp', WORKER_A2A_URL: 'https://gw.example/workeragentdemo/a2a' };
  await assert.rejects(() => lib.runVerify(env, { fetchImpl: counting }), /not sending any key:.*MCP_URL points at http:\/\/evil\.invalid/);
  await assert.rejects(() => lib.runVerify({ ...env, MCP_URL: 'https://gw.example/mcpdemo/mcp', MAIN_AGENT_PROVIDER: 'groq' }, { fetchImpl: counting }), /not supported/);
  assert.equal(calls, 0, 'no request was made');
});

test('scrub removes keys, Bearer tokens and key headers from any text, even with no key list', () => {
  const text = `failed with Authorization: Bearer ${MAIN} and x-goog-api-key: ${WORKER} and raw ${MAIN}`;
  const clean = lib.scrub(text, [MAIN, WORKER]);
  assert.ok(!clean.includes(MAIN) && !clean.includes(WORKER), clean);
  assert.equal(lib.scrub(`Bearer ${MAIN}`, []), 'Bearer [key]');
  assert.equal(lib.scrub(`x-api-key: ${MAIN}`, ['short']), 'x-api-key: [key]');
  assert.equal(lib.scrub('x-goog-api-key=abc123', []), 'x-goog-api-key: [key]');
  assert.equal(lib.scrub('nothing secret here', [MAIN]), 'nothing secret here');
});

test('the checklist matches the repo: app names, entry paths and the tool names are the ones in the manifest and the MCP server', () => {
  const k8s = read('k8s/deployment.yaml');
  assert.deepEqual(lib.DEFAULT_APPS, { worker: 'workeragentdemo', mcp: 'mcpdemo' });
  for (const name of Object.values(lib.DEFAULT_APPS)) assert.match(k8s, new RegExp(`^  name: ${name}$`, 'm'), `${name} is a Deployment in the manifest`);
  assert.match(k8s, /workeragentdemo\s+Remote Agent\s+http:\/\/workeragentdemo\.\S+\s+entry path \/a2a/);
  assert.match(k8s, /mcpdemo\s+MCP\s+http:\/\/mcpdemo\.\S+\s+entry path \/mcp/);
  // Only the tools registered unconditionally (two-space indent). Flag-gated extras such as transfer_funds sit inside an `if` and are not in the checklist.
  const registered = [...read('src/mcp-server/index.ts').matchAll(/^ {2}server\.registerTool\(\s*'([a-z_]+)'/gm)].map(m => m[1]);
  assert.deepEqual(registered, lib.CORE_TOOLS, 'the checklist names exactly the four tools the server registers by name');
  const both = lib.checklist({});
  for (const needle of ['workeragentdemo', 'mcpdemo', '/a2a', '/mcp', 'llm, mcp', 'llm, a2a', ...lib.CORE_TOOLS]) assert.ok(both.includes(needle), `checklist names ${needle}`);
  const a = lib.checklist({ path: 'a' });
  assert.ok(!a.includes('Register two apps') && !a.includes('mcpdemo') && a.includes('scopes: llm'), 'Path A leaves out the apps');
  assert.ok(!/sk-[a-z]+-[A-Za-z0-9]{6,}/.test(both), 'no key in the checklist');
});

// ------------------------------------------------------------------------------------------------ a fake gateway that behaves like the real one where we have seen it
interface Knobs {
  calls: number; emptyModel?: boolean; modelError?: boolean; rpcError?: boolean; a2aEmpty?: boolean; grantAfter?: number; model429?: boolean;
  noTools?: boolean; partialTools?: boolean; toolsError?: boolean; toolsHtml?: boolean; mainHasMcp?: boolean; scopeStatus?: number; scopeBody?: string;
  acceptUnknown?: number; sse?: 'one' | 'multi' | 'crlf'; initSse?: boolean; stateless?: boolean; redirect?: boolean; hang?: boolean; echo?: boolean;
}
interface Hit { method: string; url: string; key: string; model?: string; session?: string; rpc?: string }
async function fakeGateway(knobs: Knobs): Promise<{ origin: string; close: () => Promise<void>; hits: Hit[] }> {
  const hits: Hit[] = [];
  const allowed: Record<string, string> = { [MAIN]: 'model-main', [WORKER]: 'model-worker' };
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c as Buffer));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const bearer = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1];
      const key = bearer ?? String(req.headers['x-goog-api-key'] ?? '');
      let body: { model?: string; method?: string; id?: number } = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { /* not json */ }
      const url = String(req.url);
      const googleModel = /^\/llm\/google\/v1beta\/models\/([^:]+):generateContent$/.exec(url)?.[1];
      hits.push({ method: String(req.method), url, key, model: googleModel ?? body.model, session: req.headers['mcp-session-id'] as string | undefined, rpc: body.method });
      // with `echo` on, error bodies repeat what the caller sent, as a careless gateway might
      const echo = knobs.echo ? { received: String(req.headers.authorization ?? req.headers['x-goog-api-key'] ?? ''), key, again: key } : {};
      const send = (status: number, payload: string | object, headers: Record<string, string> = {}): void => {
        const text = typeof payload === 'string' ? (knobs.echo && payload ? `${payload} ${JSON.stringify(echo)}` : payload) : JSON.stringify(knobs.echo ? { ...payload, ...echo } : payload);
        res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(text);
      };
      if (knobs.hang && (url.startsWith('/llm/') || url.includes('/mcp'))) return; // never answers
      if (knobs.redirect) { res.writeHead(302, { Location: 'https://elsewhere.example/' }); res.end(); return; }
      const modelPath = url === '/llm/anthropic/v1/messages' || googleModel !== undefined;
      if (!allowed[key]) {
        if (modelPath && knobs.acceptUnknown) { send(knobs.acceptUnknown, knobs.acceptUnknown === 200 ? { content: [{ type: 'text', text: 'OK' }] } : { error: 'forbidden' }); return; }
        send(401, { error: 'invalid virtual key' }); return;
      }
      if (modelPath) {
        knobs.calls += 1;
        const model = googleModel ?? body.model;
        if (knobs.grantAfter && knobs.calls <= knobs.grantAfter) { send(403, { error: 'app not selected' }); return; }
        if (knobs.model429) { send(429, { error: 'tokens_rate_limit_exceeded' }); return; }
        if (model !== allowed[key]) { send(403, { error: `model "${model}" not allowed for this key` }); return; }
        if (knobs.emptyModel) { send(200, ''); return; }
        if (knobs.modelError) { send(200, { type: 'error', error: { message: 'model not allowed' } }); return; }
        send(200, googleModel !== undefined ? { candidates: [{ content: { parts: [{ text: 'OK' }] } }] } : { content: [{ type: 'text', text: 'OK' }] }); return;
      }
      if (url === '/mcpdemo/mcp') {
        const accept = String(req.headers.accept ?? '');
        if (!accept.includes('application/json') || !accept.includes('text/event-stream')) { send(406, 'Not Acceptable'); return; }
        if (key === MAIN && !knobs.mainHasMcp) { send(knobs.scopeStatus ?? 403, knobs.scopeBody ?? 'key not scoped for mcp access'); return; }
        const reply = (id: number, result: object): string => JSON.stringify({ jsonrpc: '2.0', id, result });
        if (body.method === 'initialize') {
          const headers: Record<string, string> = knobs.stateless ? {} : { 'Mcp-Session-Id': 'sess-1' };
          if (knobs.initSse) { send(200, `event: message\ndata: ${reply(1, { protocolVersion: '2025-06-18' })}\n\n`, { ...headers, 'Content-Type': 'text/event-stream' }); return; }
          send(200, reply(1, { protocolVersion: '2025-06-18' }), headers); return;
        }
        if (!knobs.stateless && req.headers['mcp-session-id'] !== 'sess-1') { send(400, 'missing or unknown session'); return; }
        if (body.id === undefined) { send(202, ''); return; }
        if (body.method === 'tools/list') {
          if (knobs.toolsHtml) { send(200, '<html><body>maintenance</body></html>', { 'Content-Type': 'text/html' }); return; }
          if (knobs.toolsError) { send(200, JSON.stringify({ jsonrpc: '2.0', id: 2, error: { code: -32000, message: 'backend unavailable' } })); return; }
          const names = knobs.noTools ? [] : knobs.partialTools ? lib.CORE_TOOLS.slice(0, 2) : lib.CORE_TOOLS;
          const payload = reply(2, { tools: names.map((name: string) => ({ name })) });
          const note = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info' } });
          if (knobs.sse === 'one') { send(200, `event: message\ndata: ${payload}\n\n`, { 'Content-Type': 'text/event-stream' }); return; }
          if (knobs.sse === 'multi') { send(200, `event: message\ndata: ${note}\n\nevent: message\ndata: ${payload}\n\n`, { 'Content-Type': 'text/event-stream' }); return; }
          if (knobs.sse === 'crlf') { send(200, `event: message\r\ndata: ${note}\r\n\r\nevent: message\r\ndata: ${payload}\r\n\r\n`, { 'Content-Type': 'text/event-stream' }); return; }
          send(200, payload); return;
        }
      }
      if (url === '/workeragentdemo/a2a/jsonrpc') {
        if (key !== MAIN) { send(403, 'Forbidden'); return; }
        if (knobs.a2aEmpty) { send(200, ''); return; }
        if (knobs.rpcError) { send(200, { jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'request blocked by security policy' } }); return; }
        send(200, { jsonrpc: '2.0', id: 1, result: { kind: 'message' } }); return;
      }
      send(404, 'not found');
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, hits, close: () => new Promise<void>(r => { server.close(() => r()); server.closeAllConnections(); }) };
}

const envFor = (origin: string, extra: Record<string, string> = {}): Record<string, string> => ({
  MAIN_AGENT_PROVIDER: 'anthropic', WORKER_AGENT_PROVIDER: 'anthropic', ANTHROPIC_BASE_URL: `${origin}/llm/anthropic`,
  MAIN_AGENT_MODEL: 'model-main', WORKER_AGENT_MODEL: 'model-worker', MAIN_AGENT_KEY: MAIN, WORKER_AGENT_KEY: WORKER,
  WORKER_A2A_URL: `${origin}/workeragentdemo/a2a`, MCP_URL: `${origin}/mcpdemo/mcp`, ...extra,
});
type R = { id: string; ok: boolean; status?: number; reason: string; attempts: number };
// 8s: the fake gateway answers in ms, but under full-suite parallel load on a busy
// machine one 3s exchange occasionally breaches; the dedicated hang test uses its
// own 300ms timeout, so the hang behaviour is still covered.
const verify = async (env: Record<string, string>, o: object = {}): Promise<R[]> => lib.runVerify(env, { timeoutMs: 8000, ...o });
const byId = (rs: R[], id: string): R => rs.find(r => r.id === id) as R;
const ids = (rs: R[]): Array<[string, boolean]> => rs.map(r => [r.id, r.ok]);
const ALL_PASS: Array<[string, boolean]> = [['worker-model', true], ['main-model', true], ['unknown-key', true], ['mcp-tools', true], ['scope-refused', true], ['a2a', true]];

test('verify: a correct gateway passes all six checks, each key calling with its own model, and the MCP handshake is done in order', async () => {
  const gw = await fakeGateway({ calls: 0 });
  try {
    const rs = await verify(envFor(gw.origin));
    assert.deepEqual(ids(rs), ALL_PASS, JSON.stringify(rs));
    assert.match(byId(rs, 'mcp-tools').reason, /list_entitlements/);
    const model = gw.hits.filter(h => h.url === '/llm/anthropic/v1/messages');
    assert.deepEqual([model[0].key, model[0].model], [WORKER, 'model-worker'], 'the worker check used the worker key and model');
    assert.deepEqual([model[1].key, model[1].model], [MAIN, 'model-main'], 'the main check used the main key and model');
    assert.deepEqual(gw.hits.filter(h => h.key === WORKER && h.url === '/mcpdemo/mcp').map(h => h.rpc), ['initialize', 'notifications/initialized', 'tools/list'], 'initialize, then initialized, then tools/list');
    assert.equal(gw.hits.filter(h => h.rpc === 'tools/list')[0].session, 'sess-1', 'the session id from initialize is sent back');
  } finally { await gw.close(); }
});

test('verify: a key may only use its own model, so a swapped or wrong model is caught', async () => {
  const gw = await fakeGateway({ calls: 0 });
  try {
    const rs = await verify(envFor(gw.origin, { MAIN_AGENT_MODEL: 'model-worker' }));
    assert.equal(byId(rs, 'main-model').ok, false);
    assert.equal(byId(rs, 'main-model').status, 403);
    assert.match(byId(rs, 'main-model').reason, /refused/);
    assert.equal(byId(rs, 'worker-model').ok, true, 'the other key is unaffected');
  } finally { await gw.close(); }
});

test('verify: the tool list is read from plain JSON, one event, several events (a notification first) and CRLF-separated events; an SSE initialize reply works; a stateless server works', async () => {
  for (const knobs of [{ sse: 'one' as const }, { sse: 'multi' as const }, { sse: 'crlf' as const }, { initSse: true, sse: 'multi' as const }, { stateless: true }]) {
    const gw = await fakeGateway({ calls: 0, ...knobs });
    try {
      assert.deepEqual(ids(await verify(envFor(gw.origin))), ALL_PASS, JSON.stringify(knobs));
    } finally { await gw.close(); }
  }
});

test('verify: Google is checked through its own route and header, and its own failure modes', async () => {
  const gw = await fakeGateway({ calls: 0 });
  try {
    const env = envFor(gw.origin, { MAIN_AGENT_PROVIDER: 'google', WORKER_AGENT_PROVIDER: 'google', GEMINI_BASE_URL: `${gw.origin}/llm/google` });
    delete (env as Record<string, string | undefined>).ANTHROPIC_BASE_URL;
    const rs = await verify(env, { path: 'a' });
    assert.deepEqual(ids(rs), [['worker-model', true], ['main-model', true], ['unknown-key', true]], JSON.stringify(rs));
    const google = gw.hits.filter(h => h.url.startsWith('/llm/google/'));
    assert.equal(google[0].url, '/llm/google/v1beta/models/model-worker:generateContent');
    assert.equal(google[0].key, WORKER, 'the key goes in x-goog-api-key');
  } finally { await gw.close(); }
  const bad = await fakeGateway({ calls: 0, emptyModel: true });
  try {
    const env = envFor(bad.origin, { MAIN_AGENT_PROVIDER: 'google', WORKER_AGENT_PROVIDER: 'google', GEMINI_BASE_URL: `${bad.origin}/llm/google` });
    delete (env as Record<string, string | undefined>).ANTHROPIC_BASE_URL;
    assert.match(byId(await verify(env, { path: 'a' }), 'worker-model').reason, /empty body/);
  } finally { await bad.close(); }
});

test('verify: Path A runs only the three model-side checks and calls nothing else', async () => {
  const gw = await fakeGateway({ calls: 0 });
  try {
    const rs = await verify(envFor(gw.origin), { path: 'a' });
    assert.deepEqual(rs.map(r => r.id), ['worker-model', 'main-model', 'unknown-key']);
    assert.ok(!gw.hits.some(h => h.url.includes('/mcpdemo/') || h.url.includes('/workeragentdemo/')), 'no tool or A2A call is made on Path A');
  } finally { await gw.close(); }
});

test('verify: a 200 with an empty body, an error body, a JSON-RPC error, an HTML page, a partial or an empty tool list is a FAIL, never a PASS', async () => {
  const gw = await fakeGateway({ calls: 0, emptyModel: true, a2aEmpty: true });
  try {
    const rs = await verify(envFor(gw.origin));
    assert.match(byId(rs, 'worker-model').reason, /empty body/); assert.equal(byId(rs, 'worker-model').ok, false);
    assert.match(byId(rs, 'a2a').reason, /empty body/); assert.equal(byId(rs, 'a2a').ok, false);
  } finally { await gw.close(); }
  const gw2 = await fakeGateway({ calls: 0, modelError: true, rpcError: true, toolsHtml: true });
  try {
    const rs = await verify(envFor(gw2.origin));
    assert.match(byId(rs, 'main-model').reason, /body is an error/);
    assert.match(byId(rs, 'a2a').reason, /JSON-RPC error/); assert.equal(byId(rs, 'a2a').status, 200);
    assert.equal(byId(rs, 'mcp-tools').ok, false); assert.match(byId(rs, 'mcp-tools').reason, /empty or unreadable body/);
  } finally { await gw2.close(); }
  const gw3 = await fakeGateway({ calls: 0, toolsError: true });
  try { assert.match(byId(await verify(envFor(gw3.origin)), 'mcp-tools').reason, /returned an error/); } finally { await gw3.close(); }
  const gw4 = await fakeGateway({ calls: 0, noTools: true });
  try { assert.match(byId(await verify(envFor(gw4.origin)), 'mcp-tools').reason, /tool list is empty/); } finally { await gw4.close(); }
  const gw5 = await fakeGateway({ calls: 0, partialTools: true });
  try { const r = byId(await verify(envFor(gw5.origin)), 'mcp-tools'); assert.equal(r.ok, false); assert.match(r.reason, /who_has_role|get_access_grants|open_ticket/); } finally { await gw5.close(); }
});

test('verify: the refusal checks FAIL when the gateway does not refuse (unknown key accepted, main key holding mcp), and pass for 401 or 403 with a scope message', async () => {
  for (const acceptUnknown of [200, 403]) {
    const gw = await fakeGateway({ calls: 0, acceptUnknown });
    try {
      const r = byId(await verify(envFor(gw.origin)), 'unknown-key');
      assert.equal(r.ok, false, `acceptUnknown ${acceptUnknown}`); assert.equal(r.status, acceptUnknown); assert.match(r.reason, /not 401/);
    } finally { await gw.close(); }
  }
  const open = await fakeGateway({ calls: 0, mainHasMcp: true });
  try { const r = byId(await verify(envFor(open.origin)), 'scope-refused'); assert.equal(r.ok, false); assert.equal(r.status, 200); assert.match(r.reason, /has the mcp scope/); } finally { await open.close(); }
  for (const [scopeStatus, scopeBody, expectOk] of [[403, 'key not scoped for mcp access', true], [401, 'virtual key not scoped for mcp access', true], [401, 'invalid virtual key', false], [403, 'Forbidden', false]] as Array<[number, string, boolean]>) {
    const gw = await fakeGateway({ calls: 0, scopeStatus, scopeBody });
    try {
      const r = byId(await verify(envFor(gw.origin)), 'scope-refused');
      assert.equal(r.ok, expectOk, `${scopeStatus} ${scopeBody}`);
      if (!expectOk) assert.match(r.reason, /not with a scope message/);
    } finally { await gw.close(); }
  }
});

test('verify: every status gets its own plain advice, with the status shown and a retry only where waiting can help (400, 401 plain and scoped, 403, 404, 429, 500, 502, 302)', async () => {
  const stub = (status: number, body: string) => async () => new Response(body, { status });
  const cases: Array<[number, string, RegExp, boolean]> = [
    [400, '{"error":"bad"}', /rejected/, false], [401, '{"error":"invalid virtual key"}', /does not know this key/, true],
    [401, '{"error":{"message":"virtual key not scoped for llm access"}}', /missing a scope/, true], [403, 'Forbidden', /app is not selected/, true],
    [404, 'nope', /no such route/, true], [429, '{"error":"cap"}', /rate or budget cap/, false], [500, 'oops', /gateway or the backend failed/, true],
    [502, 'bad gateway', /gateway or the backend failed/, true], [302, '', /unexpected status 302/, false],
  ];
  for (const [status, body, advice, retry] of cases) {
    let clock = 0;
    const rs = await verify(envFor('http://127.0.0.1:1'), { fetchImpl: stub(status, body), waitMinutes: 2, sleep: async (ms: number) => { clock += ms; }, now: () => clock });
    for (const id of ['worker-model', 'a2a', 'mcp-tools']) {
      const r = byId(rs, id);
      assert.equal(r.ok, false, `${id} ${status}`);
      assert.equal(r.status, status, `${id} reports ${status}`);
      assert.match(r.reason, advice, `${id} ${status}`);
      if (id === 'worker-model') assert.equal(r.attempts > 1, retry, `${status}: retried=${retry}`); // the wait budget is shared, so only the first check always has it all
    }
  }
});

test('verify --wait: a grant that arrives late is retried until it passes, with a growing pause and a bounded total time; without --wait it is one try', async () => {
  const gw = await fakeGateway({ calls: 0, grantAfter: 3 });
  try {
    let clock = 0; const pauses: number[] = [];
    const rs = await verify(envFor(gw.origin), { waitMinutes: 6, sleep: async (ms: number) => { pauses.push(ms); clock += ms; }, now: () => clock });
    assert.equal(byId(rs, 'worker-model').ok, true);
    assert.equal(byId(rs, 'worker-model').attempts, 4);
    assert.deepEqual(pauses, [15000, 30000, 60000]);
  } finally { await gw.close(); }
  const gw2 = await fakeGateway({ calls: 0, grantAfter: 1000 });
  try {
    let clock = 0; let last = 0;
    const rs = await verify(envFor(gw2.origin), { waitMinutes: 2, sleep: async (ms: number) => { clock += ms; last = ms; }, now: () => clock });
    assert.equal(byId(rs, 'worker-model').ok, false);
    assert.ok(byId(rs, 'worker-model').attempts > 1, 'it did retry');
    assert.ok(clock <= 120000, `waited ${clock} ms, not past two minutes`);
    assert.ok(last <= 60000);
    const once = await verify(envFor(gw2.origin));
    assert.equal(byId(once, 'worker-model').attempts, 1, 'no wait means one try');
  } finally { await gw2.close(); }
});

test('verify: an unreachable gateway, a hanging one, a redirect, a bad certificate, a name that does not resolve and a missing setting fail with a reason, within the time limit', async () => {
  const closed = await fakeGateway({ calls: 0 }); const origin = closed.origin; await closed.close();
  const rs = await verify(envFor(origin));
  assert.ok(rs.every(r => !r.ok), 'every check fails when nothing is listening');
  assert.match(byId(rs, 'worker-model').reason, /connection refused/);
  const hang = await fakeGateway({ calls: 0, hang: true });
  try {
    const started = Date.now();
    const r = byId(await verify(envFor(hang.origin), { timeoutMs: 300, path: 'a' }), 'worker-model');
    assert.equal(r.ok, false); assert.match(r.reason, /no answer within the time limit/);
    assert.ok(Date.now() - started < 3000, 'a hanging gateway does not hang the tool');
  } finally { await hang.close(); }
  const gw = await fakeGateway({ calls: 0, redirect: true });
  try {
    const r = byId(await verify(envFor(gw.origin)), 'worker-model');
    assert.equal(r.status, 302); assert.equal(r.ok, false);
    assert.ok(!gw.hits.some(h => h.url.startsWith('/elsewhere')), 'a redirect is not followed');
  } finally { await gw.close(); }
  const tls = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' } }); };
  assert.match(byId(await verify(envFor('http://127.0.0.1:1'), { fetchImpl: tls, path: 'a' }), 'worker-model').reason, /certificate is not trusted.*LOCAL_GATEWAY_CA/);
  const dns = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); };
  assert.match(byId(await verify(envFor('http://127.0.0.1:1'), { fetchImpl: dns, path: 'a' }), 'worker-model').reason, /did not resolve/);
  const none = await verify({ MAIN_AGENT_PROVIDER: 'anthropic', ANTHROPIC_BASE_URL: 'https://gw.example/llm/anthropic', MAIN_AGENT_MODEL: 'a', WORKER_AGENT_MODEL: 'b' }, { path: 'a', fetchImpl: async () => new Response('{}', { status: 401 }) });
  assert.match(byId(none, 'worker-model').reason, /WORKER_AGENT_KEY is not set in \.env/);
});

test('verify never puts a key in any result, even when the gateway echoes the key in every body', async () => {
  for (const knobs of [{ echo: true, rpcError: true, modelError: true }, { echo: true, emptyModel: true, a2aEmpty: true }, { echo: true, model429: true, noTools: true }, { echo: true, toolsError: true, scopeBody: 'not scoped' }]) {
    const gw = await fakeGateway({ calls: 0, ...knobs });
    try {
      const results = await verify(envFor(gw.origin, { WORKER_AGENT_KEY: WRONG }));
      const text = JSON.stringify(results);
      assert.ok(!text.includes(MAIN) && !text.includes(WORKER), `a key is in a result: ${JSON.stringify(knobs)}`);
      assert.ok(!text.includes(WRONG), 'the wrong key is not echoed either');
      assert.ok(results.some(r => !r.ok && r.reason.length > 0), 'and the failures still say what happened');
    } finally { await gw.close(); }
  }
});

// ------------------------------------------------------------------------------------------------ the command line
interface Run { code: number | null; stdout: string; stderr: string }
async function cli(args: string[], env: Record<string, string> = {}): Promise<Run> {
  const clean: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME };
  const child = spawn(process.execPath, [join(root, 'scripts/setup.mjs'), ...args], { cwd: root, env: { ...clean, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', d => { stdout += String(d); }); child.stderr.on('data', d => { stderr += String(d); });
  const [code] = await once(child, 'close');
  return { code, stdout, stderr };
}
const noKey = (r: Run): void => { for (const k of [MAIN, WORKER]) assert.ok(!r.stdout.includes(k) && !r.stderr.includes(k), 'a key was printed'); };

test('plan mode (the default) writes nothing, creates no file, leaves an existing .env byte-for-byte alone, and prints the checklist', async () => {
  const dir = tmp(); const file = join(dir, '.env');
  const r = await cli(['--file', file, '--no-prompt', '--gateway', 'gw.example', '--main-model', 'm1', '--worker-model', 'm2'], { MAIN_AGENT_KEY: MAIN, WORKER_AGENT_KEY: WORKER });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(!existsSync(file), 'no .env was created');
  assert.deepEqual(readdirSync(dir), []);
  assert.match(r.stdout, /Plan for/); assert.match(r.stdout, /MAIN_AGENT_KEY\s+set \(\d+ characters\)/); assert.match(r.stdout, /Nothing was written/); assert.match(r.stdout, /Console checklist/);
  assert.match(r.stdout, /path B \(the full four hops/);
  noKey(r);
  const bare = await cli(['--file', file, '--no-prompt']);
  assert.equal(bare.code, 0); assert.match(bare.stdout, /Console checklist/); assert.ok(!existsSync(file));
  writeFileSync(file, 'MAIN_AGENT_MODEL=old\n', { mode: 0o644 });
  const when = new Date('2020-01-01T00:00:00Z'); utimesSync(file, when, when);
  const snapshot = (): unknown[] => [readFileSync(file, 'utf8'), statSync(file).mtimeMs, statSync(file).mode & 0o777, readdirSync(dir).join(',')];
  const before = snapshot();
  const again = await cli(['--file', file, '--no-prompt', '--gateway', 'gw.example', '--main-model', 'm1', '--worker-model', 'm2'], { MAIN_AGENT_KEY: MAIN });
  assert.equal(again.code, 0, again.stderr);
  assert.deepEqual(snapshot(), before, 'plan mode touched the existing file or its folder');
  noKey(again);
  const pathA = await cli(['--file', file, '--no-prompt', '--path', 'a', '--gateway', 'gw.example', '--main-model', 'm1', '--worker-model', 'm2']);
  assert.match(pathA.stdout, /path A \(model calls only/); assert.ok(!/WORKER_A2A_URL/.test(pathA.stdout.split('Console checklist')[0]));
});

test('--apply writes a mode-600 .env from config.example, keeps other lines, backs up the old file, and a second run changes nothing', async () => {
  const dir = tmp(); const file = join(dir, '.env');
  const args = ['--apply', '--file', file, '--no-prompt', '--gateway', 'https://gw.example', '--main-model', 'm1', '--worker-model', 'm2'];
  const first = await cli(args, { MAIN_AGENT_KEY: MAIN, WORKER_AGENT_KEY: WORKER });
  assert.equal(first.code, 0, first.stderr);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const text = readFileSync(file, 'utf8');
  assert.match(text, /^ANTHROPIC_BASE_URL=https:\/\/gw\.example\/llm\/anthropic$/m);
  assert.match(text, new RegExp(`^MAIN_AGENT_KEY=${MAIN}$`, 'm'));
  assert.match(text, /^MCP_URL=https:\/\/gw\.example\/mcpdemo\/mcp$/m);
  assert.ok(text.includes('# Process ports.'), 'config.example comments are kept');
  assert.match(first.stdout, /Save these keys in your password manager/);
  noKey(first);
  assert.deepEqual(readdirSync(dir), ['.env'], 'a new file needs no backup');
  const second = await cli(args, { MAIN_AGENT_KEY: MAIN, WORKER_AGENT_KEY: WORKER });
  assert.equal(second.code, 0); assert.match(second.stdout, /No changes/); assert.equal(readFileSync(file, 'utf8'), text); assert.deepEqual(readdirSync(dir), ['.env'], 'an unchanged run writes no backup');
  chmodSync(file, 0o644); // a world-readable file must end at 600, and so must its backup
  const third = await cli(['--apply', '--file', file, '--no-prompt', '--gateway', 'https://gw.example', '--main-model', 'm9', '--worker-model', 'm2']);
  assert.equal(third.code, 0, third.stderr);
  const files = readdirSync(dir).sort();
  const backup = files.find(f => f.startsWith('.env.bak-')) as string;
  assert.equal(files.length, 2); assert.ok(backup, 'a backup was written');
  assert.equal(statSync(join(dir, backup)).mode & 0o777, 0o600, 'the backup is private');
  assert.equal(statSync(file).mode & 0o777, 0o600, 'a 644 file ends at 600');
  assert.equal(readFileSync(join(dir, backup), 'utf8'), text, 'the backup is the file as it was');
  assert.match(readFileSync(file, 'utf8'), /^MAIN_AGENT_MODEL=m9$/m);
  assert.match(readFileSync(file, 'utf8'), new RegExp(`^MAIN_AGENT_KEY=${MAIN}$`, 'm'), 'keys already in .env are kept when none is given');
  noKey(third);
});

test('--apply refuses, writes nothing and names the problem: doubled key, short key, a # in a key, no model, unsupported provider, partial PingFederate trio, a path in the gateway, a symlinked .env', async () => {
  const dir = tmp(); const file = join(dir, '.env');
  const base = ['--apply', '--file', file, '--no-prompt', '--gateway', 'gw.example', '--main-model', 'm1', '--worker-model', 'm2'];
  const cases: Array<[string[], Record<string, string>, RegExp]> = [
    [base, { MAIN_AGENT_KEY: `${MAIN}${MAIN}` }, /pasted twice/],
    [base, { WORKER_AGENT_KEY: 'tiny' }, /only 4 characters/],
    [base, { WORKER_AGENT_KEY: 'abcdefghij#klmnopqrstuvwxyz' }, /# or a quote/],
    [['--apply', '--file', file, '--no-prompt', '--gateway', 'gw.example'], {}, /main model is not set/],
    [[...base, '--provider', 'groq'], {}, /"groq" is not supported/],
    [['--apply', '--file', file, '--no-prompt', '--gateway', 'https://gw.example/llm/anthropic', '--main-model', 'm1', '--worker-model', 'm2'], {}, /gateway host only/],
    [['--apply', '--file', file, '--no-prompt', '--gateway', 'http://gw.example', '--main-model', 'm1', '--worker-model', 'm2'], {}, /must be https/],
  ];
  for (const [args, env, re] of cases) {
    const r = await cli(args, env);
    assert.equal(r.code, 2, `${re}: ${r.stdout}${r.stderr}`); assert.match(r.stderr, re); assert.ok(!existsSync(file), 'nothing was written'); noKey(r);
  }
  writeFileSync(file, 'AWS_AGENT_PF_TOKEN_URL=https://pf.example/as/token.oauth2\n');
  const partial = await cli(base);
  assert.equal(partial.code, 2); assert.match(partial.stderr, /all three/); assert.equal(readFileSync(file, 'utf8'), 'AWS_AGENT_PF_TOKEN_URL=https://pf.example/as/token.oauth2\n');
  writeFileSync(file, 'MAIN_AGENT_PROVIDER=llamacpp\n');
  const llama = await cli(['--apply', '--file', file, '--no-prompt', '--gateway', 'gw.example', '--main-model', 'm1', '--worker-model', 'm2']);
  assert.equal(llama.code, 2); assert.match(llama.stderr, /"llamacpp" is not supported/); assert.equal(readFileSync(file, 'utf8'), 'MAIN_AGENT_PROVIDER=llamacpp\n', 'an unsupported provider is not silently overwritten');
  const link = join(dir, 'linked.env'); symlinkSync(file, link);
  const viaLink = await cli(['--apply', '--file', link, '--no-prompt', '--gateway', 'gw.example', '--main-model', 'm1', '--worker-model', 'm2']);
  assert.equal(viaLink.code, 2); assert.match(viaLink.stderr, /symbolic link/);
});

test('--apply in a read-only folder fails cleanly and leaves no partial file', async () => {
  const dir = tmp(); chmodSync(dir, 0o500);
  try {
    const r = await cli(['--apply', '--file', join(dir, '.env'), '--no-prompt', '--gateway', 'gw.example', '--main-model', 'm1', '--worker-model', 'm2'], { MAIN_AGENT_KEY: MAIN });
    assert.notEqual(r.code, 0); assert.deepEqual(readdirSync(dir), []); noKey(r);
  } finally { chmodSync(dir, 0o700); }
});

test('--verify from the command line: passes (exit 0), fails on a wrong key (exit 1), warns about mode and a shell override, and prints no key even when the gateway echoes it', async () => {
  const gw = await fakeGateway({ calls: 0 });
  try {
    const dir = tmp(); const file = join(dir, '.env');
    writeFileSync(file, lib.mergeEnv('', envFor(gw.origin)).text, { mode: 0o600 });
    const good = await cli(['--verify', '--file', file, '--no-prompt']);
    assert.equal(good.code, 0, good.stdout + good.stderr); assert.match(good.stdout, /All 6 checks passed/); assert.equal((good.stdout.match(/^PASS /gm) ?? []).length, 6); noKey(good);
    writeFileSync(file, lib.mergeEnv('', envFor(gw.origin, { WORKER_AGENT_KEY: WRONG })).text, { mode: 0o600 });
    const bad = await cli(['--verify', '--file', file, '--no-prompt']);
    assert.equal(bad.code, 1); assert.match(bad.stdout, /FAIL {2}Worker key reaches its model {2}\[401\]/); assert.match(bad.stdout, /checks failed/); noKey(bad);
    const a = await cli(['--verify', '--path', 'a', '--file', file, '--no-prompt']);
    assert.match(a.stdout, /Path A checks only/);
    const missing = await cli(['--verify', '--file', join(dir, 'nope.env'), '--no-prompt']);
    assert.equal(missing.code, 2); assert.match(missing.stderr, /does not exist/);
    writeFileSync(file, lib.mergeEnv('', envFor(gw.origin)).text); chmodSync(file, 0o644); // world-readable: a warning before the first call
    const loose = await cli(['--verify', '--file', file, '--no-prompt']);
    assert.match(loose.stderr, /is mode 644; run chmod 600/);
    const shell = await cli(['--verify', '--file', file, '--no-prompt'], { MAIN_AGENT_KEY: 'a-different-shell-key-0123456789abcd' }); // exported in the shell and different: warned, by name only
    assert.match(shell.stderr, /your shell sets MAIN_AGENT_KEY to a different value/); assert.ok(!shell.stderr.includes('a-different-shell-key'));
  } finally { await gw.close(); }
  const echoing = await fakeGateway({ calls: 0, echo: true, rpcError: true, modelError: true });
  try {
    const dir = tmp(); const file = join(dir, '.env');
    writeFileSync(file, lib.mergeEnv('', envFor(echoing.origin, { WORKER_AGENT_KEY: WRONG })).text, { mode: 0o600 });
    const r = await cli(['--verify', '--file', file, '--no-prompt']);
    assert.equal(r.code, 1); noKey(r); assert.ok(!r.stdout.includes(WRONG) && !r.stderr.includes(WRONG));
  } finally { await echoing.close(); }
});

test('--verify on Path B refuses, before sending any key, when the .env still has the local mock URLs or another host (a fresh config.example, or a stale file)', async () => {
  const gw = await fakeGateway({ calls: 0 });
  try {
    const dir = tmp(); const file = join(dir, '.env');
    writeFileSync(file, lib.mergeEnv('', envFor(gw.origin, { MCP_URL: 'http://127.0.0.1:6883/mcp', WORKER_A2A_URL: 'http://stale.example/workeragentdemo/a2a' })).text, { mode: 0o600 });
    const r = await cli(['--verify', '--file', file, '--no-prompt']);
    assert.equal(r.code, 2); assert.match(r.stderr, /MCP_URL points at http:\/\/127\.0\.0\.1:6883, not the gateway/); assert.match(r.stderr, /WORKER_A2A_URL must be an https address/);
    assert.equal(gw.hits.length, 0, 'the gateway received no request, so no key left this machine'); noKey(r);
    const onlyModels = await cli(['--verify', '--path', 'a', '--file', file, '--no-prompt']);
    assert.equal(onlyModels.code, 0, onlyModels.stdout + onlyModels.stderr); assert.match(onlyModels.stdout, /All 3 checks passed/);
  } finally { await gw.close(); }
});

test('the guide, README and help document every option and the three modes, and the guide no longer says there is no setup script', () => {
  const guide = read('docs/PRIVILEGE-SETUP.md');
  assert.match(guide, /npm run setup/);
  assert.ok(!/There is \*\*no setup script\*\*/.test(guide), 'the old "no setup script" sentence is gone');
  for (const needle of ['--apply', '--verify', '--wait', '--path a', '--checklist', 'never prints a key', 'Anthropic or Google', 'is not the gateway']) assert.ok(guide.includes(needle), `the guide mentions ${needle}`);
  assert.match(read('README.md'), /npm run setup -- --apply/);
  assert.match(read('CLAUDE.md'), /scripts\/setup\.mjs/);
  assert.equal(JSON.parse(read('package.json')).scripts.setup, 'node scripts/setup.mjs');
  const help = spawnSync(process.execPath, [join(root, 'scripts/setup.mjs'), '--help'], { encoding: 'utf8' }).stdout;
  const source = read('scripts/setup-lib.mjs');
  const flags = ['VALUE_FLAGS', 'BOOL_FLAGS'].flatMap(name => [...(new RegExp(`${name} = new Set\\(\\[([^\\]]+)\\]`).exec(source)?.[1] ?? '').matchAll(/'([a-z-]+)'/g)].map(m => m[1]));
  assert.ok(flags.length >= 12, `found ${flags.length} flags`);
  for (const flag of flags) assert.ok(help.includes(`--${flag}`), `--help documents --${flag}`);
  const row = guide.split('\n').find(l => l.startsWith('| A missing scope is refused')) as string;
  assert.equal(row.split('|').length - 2, 4, 'the Step 9 scope row has four columns (an edit once corrupted it)');
  assert.equal(guide.split('\n').filter(l => l.startsWith('| `401 virtual key not scoped for llm access`')).length, 1, 'the new refusal row is in the troubleshooting table, once');
});
