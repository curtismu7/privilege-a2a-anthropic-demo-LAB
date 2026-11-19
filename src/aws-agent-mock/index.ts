import { createAwsAgentMockApp } from './app.js';

// The simulated AWS agent as its own process, like the worker and the MCP server. Loopback unless told otherwise (a container sets 0.0.0.0).
const port = Number(process.env.AWS_MOCK_PORT) > 0 ? Number(process.env.AWS_MOCK_PORT) : 6885;
const host = process.env.AWS_MOCK_HOST?.trim() || '127.0.0.1';
const requireBearer = ['true', '1', 'yes'].includes((process.env.AWS_MOCK_REQUIRE_BEARER ?? '').trim().toLowerCase());

createAwsAgentMockApp({ requireBearer, publicUrl: process.env.AWS_MOCK_PUBLIC_URL?.trim() || `http://127.0.0.1:${port}/` }).listen(port, host, () => {
  console.log(`Simulated AWS agent (A2A) listening on http://${host}:${port}/${requireBearer ? ' (Bearer required)' : ''}`);
});
