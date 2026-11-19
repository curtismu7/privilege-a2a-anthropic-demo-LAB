import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const manifest = readFileSync(new URL('../k8s/deployment.yaml', import.meta.url), 'utf8');
const documents = manifest.split(/^---\s*$/m);
const mainAgent = documents.find((doc) => /kind: Deployment/.test(doc) && /name: mainagentdemo\b/.test(doc)) ?? '';

test('the main agent Deployment sets the AWS agent route, on a placeholder host', () => {
  assert.ok(mainAgent, 'the mainagentdemo Deployment is in the manifest');
  const match = mainAgent.match(/- name: AWS_AGENT_A2A_URL\s*\n\s*value: "([^"]+)"/);
  assert.ok(match, 'AWS_AGENT_A2A_URL is set on mainagentdemo');
  assert.match(match?.[1] ?? '', /^https:\/\/[a-z0-9.-]+\.invalid\//, 'a placeholder host, never a real gateway');
});

test('the AWS agent call carries the existing main agent key, so no new Secret value is introduced', () => {
  assert.match(mainAgent, /name: MAIN_AGENT_KEY/);
  assert.ok(!/AWS_AGENT_KEY/.test(manifest));
});

test('nothing in the manifest deploys the stand-in, and the header says so', () => {
  assert.ok(!/aws-agent-mock/.test(manifest.replace(/#.*$/gm, '')), 'no container runs the stand-in');
  assert.match(manifest, /Nothing in this file deploys\s+# that agent/);
});
