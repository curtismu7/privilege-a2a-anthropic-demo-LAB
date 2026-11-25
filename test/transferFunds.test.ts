import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const packageDirectory = dirname(dirname(fileURLToPath(import.meta.url)));

async function withServer(extraEnv: Record<string, string>, run: (client: Client) => Promise<void>): Promise<void> {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const env: NodeJS.ProcessEnv = { ...process.env, MCP_SERVER_PORT: String(port), MCP_REQUIRE_BEARER: 'false', MCP_STATEFUL: 'false', MCP_JSON_RESPONSE: 'true', ...extraEnv };
  if (!('MCP_ENABLE_TRANSFER_FUNDS' in extraEnv)) delete env.MCP_ENABLE_TRANSFER_FUNDS;
  const child = spawn(process.execPath, [join(packageDirectory, 'node_modules/tsx/dist/cli.mjs'), 'src/mcp-server/index.ts'], { cwd: packageDirectory, env, stdio: 'ignore' });
  try {
    for (let i = 0; i < 150; i += 1) {
      try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) break; } catch { /* not up yet */ }
      await delay(100);
    }
    const client = new Client({ name: 'transfer-funds-test', version: '1' }, { capabilities: {} });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    try { await run(client); } finally { await client.close(); }
  } finally {
    child.kill('SIGTERM');
  }
}

type ToolResult = { content: Array<{ text: string }>; isError?: boolean };
const call = (client: Client, args: Record<string, unknown>) => client.callTool({ name: 'transfer_funds', arguments: args }) as Promise<ToolResult>;

test('with the flag on, transfer_funds is listed and completes a mock transfer with a fresh id each time', async () => {
  await withServer({ MCP_ENABLE_TRANSFER_FUNDS: 'true' }, async client => {
    const names = (await client.listTools()).tools.map(tool => tool.name);
    assert.ok(names.includes('transfer_funds'), 'transfer_funds is listed');
    assert.ok(names.includes('open_ticket'), 'the existing write tool is untouched');
    const first = JSON.parse((await call(client, { amount: 150, from: 'ACC-1001', to: 'ACC-2002' })).content[0]!.text) as Record<string, unknown>;
    assert.equal(first.status, 'completed');
    assert.equal(first.amount, 150);
    assert.equal(first.from, 'ACC-1001');
    assert.equal(first.to, 'ACC-2002');
    assert.match(String(first.transferId), /^TRF-/);
    assert.match(String(first.note), /no money moved/i);
    const second = JSON.parse((await call(client, { amount: 150, from: 'ACC-1001', to: 'ACC-2002' })).content[0]!.text) as Record<string, unknown>;
    assert.notEqual(second.transferId, first.transferId);
  });
});

test('the gateway records hold fields as strings, so a numeric string amount is accepted', async () => {
  await withServer({ MCP_ENABLE_TRANSFER_FUNDS: 'true' }, async client => {
    const result = JSON.parse((await call(client, { amount: '150', from: 'ACC-1001', to: 'ACC-2002' })).content[0]!.text) as Record<string, unknown>;
    assert.equal(result.amount, 150);
  });
});

test('bad input is rejected and issues no transfer id', async () => {
  await withServer({ MCP_ENABLE_TRANSFER_FUNDS: 'true' }, async client => {
    // A valid call must work first, so a rejection below cannot be "tool not found".
    const good = JSON.parse((await call(client, { amount: 10, from: 'ACC-1001', to: 'ACC-2002' })).content[0]!.text) as Record<string, unknown>;
    assert.equal(good.status, 'completed');
    const bad: Array<Record<string, unknown>> = [
      { amount: 0, from: 'ACC-1001', to: 'ACC-2002' },
      { amount: -5, from: 'ACC-1001', to: 'ACC-2002' },
      { amount: 'lots', from: 'ACC-1001', to: 'ACC-2002' },
      { amount: 1_000_001, from: 'ACC-1001', to: 'ACC-2002' },
      { amount: 10, to: 'ACC-2002' },
      { amount: 10, from: '', to: 'ACC-2002' },
      { amount: 10, from: 'x'.repeat(65), to: 'ACC-2002' },
      { amount: 10, from: 'ACC-1001', to: 'ACC-1001' },
    ];
    for (const args of bad) {
      let rejected = false;
      try {
        const result = await call(client, args);
        rejected = result.isError === true && !/TRF-/.test(result.content[0]!.text);
      } catch {
        rejected = true;
      }
      assert.ok(rejected, `rejected: ${JSON.stringify(args).slice(0, 80)}`);
    }
  });
});

test('with the flag unset the tool is absent and the 18 existing tools are unchanged', async () => {
  await withServer({}, async client => {
    const names = (await client.listTools()).tools.map(tool => tool.name);
    assert.ok(!names.includes('transfer_funds'), 'transfer_funds is not listed by default');
    assert.equal(names.length, 18);
  });
});
