import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mainAgentConfig, workerAgentConfig } from '../src/config.js';

// A fresh clone has no .env: both agents must still build their config (so the
// processes boot offline), and a model call must report "not configured".
const withoutCredentials = (fn: () => void): void => {
  const saved = { ...process.env };
  for (const k of Object.keys(process.env)) {
    if (/_KEY$|_TOKEN$|_PROVIDER$|BASE_URL$/.test(k)) delete process.env[k];
  }
  try { fn(); } finally { process.env = saved; }
};

test('main and worker config build with no provider credentials', () => {
  withoutCredentials(() => {
    assert.doesNotThrow(() => mainAgentConfig());
    assert.doesNotThrow(() => workerAgentConfig());
  });
});

test('a model call without credentials fails with a not-configured message', () => {
  withoutCredentials(() => {
    const { anthropic } = workerAgentConfig();
    assert.throws(
      () => anthropic.messages.create({ model: 'x', max_tokens: 1, messages: [] }),
      /Model not configured for WORKER_AGENT: Set WORKER_AGENT_LLAMACPP_KEY/,
    );
    const main = mainAgentConfig();
    assert.throws(() => main.anthropic.messages.stream({ model: 'x', max_tokens: 1, messages: [] }), /Model not configured for MAIN_AGENT/);
  });
});

test('a configured provider still gets a real client', () => {
  withoutCredentials(() => {
    process.env.MAIN_AGENT_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'test-not-a-real-key';
    const { anthropic } = mainAgentConfig();
    assert.equal(typeof anthropic.messages.create, 'function');
    assert.equal(anthropic.constructor.name, 'Anthropic');
  });
});
