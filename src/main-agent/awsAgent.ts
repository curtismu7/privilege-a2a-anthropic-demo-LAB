import { randomUUID } from 'node:crypto';

import { MAIN, maskKey, pretty, type CardSummary, type ChainEvent, type WireFacts } from './chain.js';

/**
 * The main agent calling an agent that runs in AWS (a Bedrock AgentCore runtime), through the Privilege gateway.
 *
 * This process never talks to AWS. `url` is the gateway route of a Remote Agent app that Privilege already fronts the runtime
 * with, and `bearer` is this agent's own agent key; the gateway checks the key, the a2a scope and the remote-agent grant
 * (which follows the agent's custodian), then forwards to the runtime with whatever AWS authentication the app is set up for.
 * When no route is configured the URL is the local stand-in (src/aws-agent-mock), and `simulated` says so in every event.
 *
 * What comes back is the runtime's own A2A reply passed through, so the answer is read from a Task artifact, a Task status
 * message or a plain Message (AgentCore documents the artifact form). Refusals keep their real HTTP status: the trace says what
 * the caller saw, not whose rule refused it.
 */

/** This callee's name in the trace. */
export const AWS_AGENT = 'aws-agent';
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_WIRE_TEXT = 4000;

export interface AwsAgentOptions {
  /** The gateway route of the AWS agent's Remote Agent app (or the local stand-in). */
  url: string;
  /** This agent's own key, sent as `Authorization: Bearer`. Never shown unmasked. */
  bearer: string;
  message: string;
  emit: (event: ChainEvent) => void;
  /** True when `url` is the local stand-in; the trace then says nothing in AWS was called. */
  simulated?: boolean;
  contextId?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(text).filter(Boolean) : []);
const record = (value: unknown): Record<string, unknown> =>
  (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {});
const clip = (raw: string): string => (raw.length > MAX_WIRE_TEXT ? `${raw.slice(0, MAX_WIRE_TEXT)}\n… (cut at ${MAX_WIRE_TEXT} characters)` : raw);

function parseJson(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * Where the Agent Card is read from: next to the route, as A2A publishes it. The query string is kept: an AgentCore
 * route names the runtime by ID and needs `?accountId=` on every call, the card read included.
 */
export const cardUrlFor = (url: string): string => {
  const card = new URL(url);
  card.pathname = `${card.pathname.replace(/\/?$/, '/')}.well-known/agent-card.json`;
  return card.toString();
};

function summariseCard(body: Record<string, unknown>): CardSummary {
  const skills = Array.isArray(body.skills) ? body.skills.map(record) : [];
  return {
    name: text(body.name),
    description: text(body.description),
    protocolVersion: text(body.protocolVersion),
    url: text(body.url),
    preferredTransport: text(body.preferredTransport),
    skills: skills.map((skill) => text(skill.name) || text(skill.id)).filter(Boolean),
    version: text(body.version),
    capabilities: Object.entries(record(body.capabilities)).filter(([, v]) => typeof v === 'boolean').map(([k, v]) => `${k}: ${v ? 'yes' : 'no'}`),
    inputModes: strings(body.defaultInputModes),
    outputModes: strings(body.defaultOutputModes),
    skillDetails: skills.map((skill) => ({ id: text(skill.id), name: text(skill.name), description: text(skill.description), tags: strings(skill.tags) })),
    security: Object.keys(record(body.securitySchemes)),
  };
}

function partsText(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .flatMap((part) => {
      const fields = record(part);
      return (fields.kind === 'text' || fields.kind === undefined) && typeof fields.text === 'string' ? [fields.text] : [];
    })
    .join('\n')
    .trim();
}

/** The reply text of an A2A result: artifacts first (AgentCore's form), then a Task's status message, then a Message's parts. */
export function answerFrom(result: Record<string, unknown>): string {
  const artifacts = Array.isArray(result.artifacts)
    ? result.artifacts.map((artifact) => partsText(record(artifact).parts)).filter(Boolean).join('\n\n')
    : '';
  if (artifacts) return artifacts;
  return partsText(record(record(result.status).message).parts) || partsText(result.parts);
}

const reachMessage = (error: unknown): string => {
  const cause = error instanceof Error ? record((error as Error & { cause?: unknown }).cause) : {};
  const code = text(cause.code);
  const base = error instanceof Error ? error.message : String(error);
  return `Could not reach the AWS agent route${code ? ` (${code})` : ''}: ${base}`;
};

export async function runAwsAgent(options: AwsAgentOptions): Promise<string> {
  const { url, bearer, message, emit } = options;
  const doFetch = options.fetchImpl ?? fetch;
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)]);
  const credential = bearer ? maskKey(bearer) : '';
  const route = {
    from: MAIN,
    to: AWS_AGENT,
    toLabel: options.simulated ? 'AWS agent (simulated stand-in)' : 'AWS agent (AgentCore, through Privilege)',
    ...(credential ? { credential } : {}),
  };
  const auth: Record<string, string> = bearer ? { Authorization: `Bearer ${bearer}` } : {};
  const shownAuth = credential ? `\nAuthorization: Bearer ${credential}` : '';

  const fail = (detail: string, wire?: WireFacts, response?: string): never => {
    emit({ ...route, kind: 'error', text: 'The AWS agent call did not complete', detail, ...(wire ? { wire } : {}), ...(response ? { response: clip(response) } : {}) });
    throw new Error(detail);
  };
  const stopped = (): never => fail(options.signal?.aborted ? 'The request was cancelled.' : 'The AWS agent did not answer in time.');

  // The Agent Card. Best effort: a gateway route may not publish one, and a missing card must not stop the demo, but it is said.
  const cardTarget = cardUrlFor(url);
  const cardStarted = Date.now();
  try {
    const response = await doFetch(cardTarget, { headers: { Accept: 'application/json', ...auth }, signal });
    const raw = await response.text();
    const body = response.ok ? parseJson(raw) : null;
    const request = `GET ${cardTarget}${shownAuth}`;
    if (body && text(body.name)) {
      emit({
        ...route, kind: 'card', text: `main reads ${text(body.name)}'s Agent Card`, detail: text(body.description),
        elapsedMs: Date.now() - cardStarted, request, response: clip(pretty(raw)), card: summariseCard(body), wire: { status: response.status },
      });
    } else {
      emit({
        ...route, kind: 'card', text: 'No readable Agent Card; sending the message anyway',
        detail: `HTTP ${response.status} from ${cardTarget}`, elapsedMs: Date.now() - cardStarted, request, response: clip(raw), wire: { status: response.status },
      });
    }
  } catch (error) {
    if (signal.aborted) stopped();
    emit({ ...route, kind: 'card', text: 'No readable Agent Card; sending the message anyway', detail: reachMessage(error), request: `GET ${cardTarget}${shownAuth}` });
  }

  const rpcId = randomUUID();
  const messageId = randomUUID();
  const payload = {
    jsonrpc: '2.0',
    id: rpcId,
    method: 'message/send',
    params: { message: { kind: 'message', messageId, contextId: options.contextId ?? randomUUID(), role: 'user', parts: [{ kind: 'text', text: message }] } },
  };
  const sent = JSON.stringify(payload);
  emit({
    ...route, kind: 'delegate', text: `main → ${AWS_AGENT} through Privilege`, detail: message,
    request: `POST ${url}\nContent-Type: application/json${shownAuth}\n\n${JSON.stringify(payload, null, 2)}`, wire: { rpcId, messageId },
  });

  const started = Date.now();
  let status = 0;
  let raw = '';
  try {
    const response = await doFetch(url, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...auth }, body: sent, signal });
    status = response.status;
    raw = await response.text();
  } catch (error) {
    if (signal.aborted) stopped();
    fail(reachMessage(error));
  }

  const body = parseJson(raw);
  const rpcError = record(body?.error);
  if (status < 200 || status >= 300 || body?.error !== undefined) {
    const code = typeof rpcError.code === 'number' ? rpcError.code : undefined;
    const reason = text(rpcError.message) || clip(raw.trim()).slice(0, 300) || 'no body';
    fail(`HTTP ${status}${code !== undefined ? ` · JSON-RPC ${code}` : ''}: ${reason}`, { status, rpcId, ...(code !== undefined ? { errorCode: code } : {}) }, raw);
  }
  if (!body) fail(`HTTP ${status}: the reply was not JSON`, { status, rpcId }, raw);

  const result = record(body?.result);
  const state = text(record(result.status).state);
  const answer = answerFrom(result);
  if (state === 'failed' || state === 'rejected' || state === 'canceled') fail(`The AWS agent's task ended ${state}${answer ? `: ${answer}` : ''}`, { status, rpcId }, raw);
  if (!answer) fail(state ? `The AWS agent's task is ${state} and returned no text` : 'The AWS agent replied with no text', { status, rpcId }, raw);

  emit({
    kind: 'result', from: AWS_AGENT, to: MAIN, text: `${AWS_AGENT} returned`, detail: answer,
    elapsedMs: Date.now() - started, response: clip(pretty(raw)),
    wire: { status, rpcId, kind: text(result.kind), role: text(record(record(result.status).message).role) },
  });
  return answer;
}
