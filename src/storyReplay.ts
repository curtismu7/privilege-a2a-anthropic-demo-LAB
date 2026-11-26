// Story mode in offline Mock: a SIMULATED run of the two Part 1 questions. In this lab Mock still needs a model key for a question (the heuristic path needs a vertical
// profile the standalone page does not send), so with no key Story would have nothing to show. This replays a recorded-shape run (the same trace events a live run
// sends) so the walk-through can show the trace, the reel and the answer. It is used ONLY when the page says Story is on (`story: true` in the /chat body), the UI mode
// is Mock and no model is configured; otherwise /chat behaves exactly as before, so Demo mode is unchanged. Every event says it is simulated; hosts, keys and ids are
// synthetic (the repo is public). Nothing here makes a network call.

export interface SimulatedStep { delayMs: number; event: 'trace' | 'token' | 'done'; payload: Record<string, unknown> }
export interface SimulatedRun { kind: 'allowed' | 'blocked'; steps: SimulatedStep[] }

const GATEWAY = 'https://gateway.example/workeragent/a2a/jsonrpc';
const KEY = 'sk-simulated… (masked)';
const TOOL_REPLY = {
  user: { id: 'bob.reyes', name: 'Bob Reyes', email: '[REDACTED:pii]', department: 'Finance', employmentType: 'employee', manager: 'dana.olsen', status: 'active' },
  entitlements: [{ user: 'bob.reyes', resource: 'fare-payments-api', role: 'payments-deployer', grantedAt: '2024-11-08', expiresAt: null, grantedBy: 'dana.olsen', lastUsed: '2026-07-31', justification: 'Service owner; deploys payment service releases.' }],
};
const BOB_ANSWER = 'Bob Reyes holds one access grant:\n\n- **Resource**: fare-payments-api\n- **Role**: payments-deployer\n- **Granted**: 2024-11-08 by dana.olsen\n- **Expires**: No expiration\n- **Last Used**: 2026-07-31\n\nBob is an active Finance employee and can access the fare-payments-api with deployer permissions. (Simulated answer: no model was called.)';
const BLOCKED_ANSWER = 'The data call for passenger-records-db was stopped on its way back: the response was blocked by a security policy, so no access grants came back. (Simulated answer: no model was called.)';

const request = (question: string): string => `POST ${GATEWAY}\nContent-Type: application/json\nAuthorization: Bearer ${KEY}\n\n${JSON.stringify({ jsonrpc: '2.0', id: '<request id>', method: 'message/send', params: { message: { role: 'user', messageId: '<message id>', parts: [{ kind: 'text', text: question }] } } }, null, 2)}`;
const response = (answer: string): string => `HTTP 200\n\n${JSON.stringify({ jsonrpc: '2.0', id: '<request id>', result: { kind: 'message', role: 'agent', parts: [{ kind: 'text', text: answer }] } }, null, 2)}`;

function build(question: string, tool: string, toolInput: string, outcome: SimulatedStep, answer: string, kind: SimulatedRun['kind']): SimulatedRun {
  const head = [
    { delayMs: 0, event: 'trace', payload: { kind: 'model', from: 'main', to: 'main', text: 'main agent · simulated model' } },
    { delayMs: 500, event: 'trace', payload: { from: 'main', to: 'analyst', kind: 'delegate', text: 'concierge → analyst_agent', detail: question, request: request(question), refs: ['a2a-5.3', 'a2a-9.4.1', 'rfc6750-2.1', 'a2a-7.3'], credential: KEY, token: { kind: 'opaque', length: 57 } } },
    { delayMs: 600, event: 'trace', payload: { kind: 'model', text: 'analyst · simulated model', detail: '', from: 'analyst', to: 'analyst' } },
    { delayMs: 400, event: 'trace', payload: { kind: 'mcp-call', text: `analyst → ${tool}`, detail: toolInput, from: 'analyst', to: 'mcp' } },
    outcome,
    { delayMs: 600, event: 'trace', payload: { kind: 'model', text: 'analyst · simulated model', detail: '', from: 'analyst', to: 'analyst' } },
    { delayMs: 500, event: 'trace', payload: { from: 'analyst', to: 'main', kind: 'result', text: 'analyst_agent returned', detail: answer, response: response(answer) } },
    { delayMs: 200, event: 'token', payload: { text: answer } },
  ] as SimulatedStep[];
  return { kind, steps: head };
}

// The two scripted Part 1 questions (the same text as web/src/storyScript.js P1_Q1 and P1_Q2; a test keeps them equal). Matched whole, ignoring case and spacing:
// a question that merely mentions Bob Reyes or the resource is the viewer's own and takes the normal path.
export const SCRIPTED_ALLOWED = 'What can Bob Reyes reach?';
export const SCRIPTED_BLOCKED = 'Review access on passenger-records-db';
const norm = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** The simulated run for one of the two scripted questions, or null (any other question is left to the normal path). */
export function simulatedRun(message: string): SimulatedRun | null {
  if (norm(message) === norm(SCRIPTED_BLOCKED)) {
    return build(message, 'get_access_grants', '{"resource":"passenger-records-db"}',
      { delayMs: 500, event: 'trace', payload: { kind: 'error', text: 'get_access_grants failed', detail: 'Streamable HTTP error: Error POSTing to endpoint: {"error":{"code":"content_blocked","message":"response blocked by security policy"}}', from: 'mcp', to: 'analyst' } },
      BLOCKED_ANSWER, 'blocked');
  }
  if (norm(message) === norm(SCRIPTED_ALLOWED)) {
    return build(message, 'list_entitlements', '{"user":"Bob Reyes"}',
      { delayMs: 500, event: 'trace', payload: { kind: 'mcp-result', text: 'list_entitlements returned', detail: JSON.stringify(TOOL_REPLY, null, 2), from: 'mcp', to: 'analyst' } },
      BOB_ANSWER, 'allowed');
  }
  return null;
}

/** Plays a run through `send`, with the pauses a real run has, stopping at once if the viewer's connection closes. `at` gives the elapsed-time label of an event. */
export async function playSimulated(
  run: SimulatedRun, sessionId: string, send: (event: string, payload: unknown) => void, isClosed: () => boolean,
  sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)), now: () => number = Date.now,
): Promise<boolean> {
  const startedAt = now();
  const at = (): string => `${((now() - startedAt) / 1000).toFixed(1)}s`;
  send('trace', { kind: 'session', text: `session ${sessionId.slice(0, 8)} · simulated (no model call)`, at: at() });
  for (const step of run.steps) {
    if (step.delayMs) await sleep(step.delayMs);
    if (isClosed()) return false;
    send(step.event, step.event === 'trace' ? { ...step.payload, at: at() } : step.payload);
  }
  send('done', { sessionId });
  return true;
}
