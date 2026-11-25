import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// docs/PRIVILEGE-SETUP.md is the guide a newcomer follows to run the lab in Real mode. It must stay in step with the code: every environment
// variable it tells a reader to set must still exist in config.example, the README must point to it, and it must hold no secret or internal name.
const root = `${dirname(dirname(fileURLToPath(import.meta.url)))}/`;
const read = (f: string): string => readFileSync(`${root}${f}`, 'utf8');
const doc = read('docs/PRIVILEGE-SETUP.md');

// Names the guide mentions that are settings of the lab but are not in config.example on purpose (set by Compose or read only in the cluster manifest).
const NOT_IN_CONFIG_EXAMPLE = new Set(['WORKER_PUBLIC_URL']);

test('the guide: every variable in its dotenv block exists in config.example', () => {
  const blocks = [...doc.matchAll(/```dotenv\n([\s\S]*?)```/g)].map(m => m[1]);
  assert.ok(blocks.length >= 1, 'the guide has a dotenv block');
  const example = read('config.example');
  for (const block of blocks) {
    for (const line of block.split('\n')) {
      const name = /^\s*([A-Z][A-Z0-9_]+)=/.exec(line)?.[1];
      if (!name || NOT_IN_CONFIG_EXAMPLE.has(name)) continue;
      assert.ok(new RegExp(`^#?\\s*${name}=`, 'm').test(example), `${name} is in config.example`);
    }
  }
});

test('the guide: the lab variables it names in prose exist in config.example or the README', () => {
  const example = read('config.example') + read('README.md');
  const named = new Set([...doc.matchAll(/`((?:MAIN_AGENT|WORKER_AGENT|AWS_AGENT|ANTHROPIC|GEMINI|GROQ|MCP|WORKER|CHAIN)_[A-Z0-9_]+)`/g)].map(m => m[1]));
  assert.ok(named.size >= 8, 'the guide names the lab variables');
  for (const name of named) assert.ok(example.includes(name), `${name} appears in config.example or the README`);
});

test('the README and CLAUDE.md point to the guide', () => {
  assert.match(read('README.md'), /docs\/PRIVILEGE-SETUP\.md/);
  assert.match(read('CLAUDE.md'), /docs\/PRIVILEGE-SETUP\.md/);
});

test('the guide: covers the steps and holds no secret, tenant id or internal host', () => {
  for (const heading of ['## 1. What you are building', '## 2. Before you start', '## 3. Steps', '## 4. The AWS agent', '## 5. When it does not work']) {
    assert.ok(doc.includes(heading), `has ${heading}`);
  }
  assert.ok(!/sk-[a-z]+-[A-Za-z0-9]{6,}/.test(doc), 'no key');
  assert.ok(!/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(doc), 'no UUID (tenant or environment id)');
  assert.ok(!/ping-devops\.com|procyon\.ai|cmuir|pingcorp/i.test(doc), 'no internal host or name');
});
