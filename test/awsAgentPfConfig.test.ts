import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import { mainAgentConfig } from '../src/config.js';

const KEYS = ['AWS_AGENT_PF_TOKEN_URL', 'AWS_AGENT_PF_CLIENT_ID', 'AWS_AGENT_PF_CLIENT_SECRET', 'LLAMACPP_API_KEY', 'MAIN_AGENT_PROVIDER'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of KEYS) { saved[key] = process.env[key]; delete process.env[key]; }
  process.env.LLAMACPP_API_KEY = 'l';
});
afterEach(() => {
  for (const key of KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
});

test('with none of the AWS_AGENT_PF_* settings the AWS call keeps using the main agent key', () => {
  assert.equal(mainAgentConfig().awsAgentPf, null);
});

test('with all three set the AWS call gets a PingFederate token client', () => {
  process.env.AWS_AGENT_PF_TOKEN_URL = 'https://pf.example/as/token.oauth2';
  process.env.AWS_AGENT_PF_CLIENT_ID = 'client-1';
  process.env.AWS_AGENT_PF_CLIENT_SECRET = 'secret-1';
  assert.deepEqual(mainAgentConfig().awsAgentPf, { tokenUrl: 'https://pf.example/as/token.oauth2', clientId: 'client-1', clientSecret: 'secret-1' });
});

test('a half-set trio is refused, not silently ignored', () => {
  process.env.AWS_AGENT_PF_CLIENT_ID = 'client-1';
  assert.throws(() => mainAgentConfig(), /all three of AWS_AGENT_PF_TOKEN_URL, AWS_AGENT_PF_CLIENT_ID and AWS_AGENT_PF_CLIENT_SECRET/);
});
