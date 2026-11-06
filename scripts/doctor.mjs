#!/usr/bin/env node
// Checks that this app is ready and running. Prints one line per check. Exit 1 if any check fails.
// Offline checks first (Node, build, settings), then the running main agent's /api/health.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.MAIN_AGENT_PORT || '6881';
let failed = false;
const line = (ok, label, detail = '') => {
  if (!ok) failed = true;
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? ` (${detail})` : ''}`);
};

line(Number(process.versions.node.split('.')[0]) >= 26, 'Node 26 or newer', process.version);

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  const mode = fs.statSync(envFile).mode & 0o777;
  line(mode === 0o600, '.env is mode 600', mode === 0o600 ? envFile : `chmod 600 ${envFile}`);
  const needed = ['ANTHROPIC_API_KEY', 'MAIN_AGENT_PORT', 'WORKER_AGENT_PORT', 'MCP_SERVER_PORT'];
  const text = fs.readFileSync(envFile, 'utf8');
  const set = needed.filter((n) => new RegExp(`^${n}=.+`, 'm').test(text));
  line(set.length > 0, '.env has at least one setting', `${set.length} of ${needed.length} recognized keys`);
} else {
  line(false, '.env present', `copy config.example to ${envFile}`);
}

line(fs.existsSync(path.join(ROOT, 'dist', 'main-agent', 'index.js')), 'build output present', 'run npm run build if this fails');

try {
  const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(3000) });
  const body = await res.json();
  line(body.schema === 'demo-health/1' && (body.state === 'ready' || body.state === 'needs-setup'), 'app answers /api/health', `port ${port}, state ${body.state}, runtime ${body.runtime}`);
} catch {
  line(false, 'app answers /api/health', `nothing on port ${port}; run npm run dev`);
}
process.exit(failed ? 1 : 0);
