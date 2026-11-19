import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// 6884 belongs to mcp-demo-client-privilege-LAB (it was already listening there when the mock was published on it, and the
// compose up failed). The mock lives on 6885, inside this lab's 6880-6889 range, and every place that names it must agree.
const PORT = '6885';

test('the mock AWS agent port agrees across compose, the health check, the code default and the example config', () => {
  const compose = read('docker-compose.yml');
  const svc = compose.slice(compose.indexOf('  aws-agent:'), compose.indexOf('  main:'));
  assert.ok(svc.includes(`"127.0.0.1:${PORT}:${PORT}"`), 'published on loopback, same port inside');
  assert.ok(svc.includes(`127.0.0.1:${PORT}/ping`), 'the health check probes that port');
  assert.ok(compose.includes(`aws-agent-1:${PORT}/`), 'main reaches it on that port');
  assert.ok(read('src/aws-agent-mock/index.ts').includes(`: ${PORT};`), 'the mock listens there by default');
  assert.ok(read('src/config.ts').includes(`'AWS_MOCK_PORT', ${PORT}`), 'the main agent looks for it there by default');
  assert.ok(read('config.example').includes(`AWS_MOCK_PORT=${PORT}`));
});

test('no file in this lab uses 6884 again', () => {
  for (const f of ['docker-compose.yml', 'config.example', 'README.md', 'src/config.ts', 'src/aws-agent-mock/index.ts', 'src/aws-agent-mock/app.ts']) {
    assert.ok(!read(f).includes('6884'), `${f} still names 6884`);
  }
});
