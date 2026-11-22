import { randomUUID } from 'node:crypto';

import { MAIN, maskKey, pretty, type CardSummary, type ChainEvent, type WireFacts } from './chain.js';
import { parseChallenge, type Challenge } from './challenge.js';
import { AWS_CARD_REFS, AWS_DELEGATE_REFS, ERROR_REFS, METADATA_REFS, REFUSED_REFS } from './reelRefs.js';
import { describeToken } from './tokenView.js';

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
const METADATA_TIMEOUT_MS = 10_000;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

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
  /** The refused-call demo: `bearer` is a deliberately invalid credential, and the trace says so. */
  refusalDemo?: boolean;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(text).filter(Boolean) : []);
const record = (value: unknown): Record<string, unknown> =>
  (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {});
/**
 * What the page and trace show for a route: the AWS account id (12 digits, in `?accountId=` or inside a runtime ARN) is
 * replaced, so a screenshot or a recording of the tab never carries it. The call itself still sends the real URL.
 */
export const maskAccountIds = (value: string): string =>
  value
    .replace(/(accountId=)\d{12}(?!\d)/gi, '$1xxxxxxxxxxxx')
    .replace(/(:)\d{12}(:)/g, '$1xxxxxxxxxxxx$2')
    // The same id inside a URL-encoded ARN (`%3A`), or encoded twice by a gateway (`%253A`), as AWS's own Agent Card writes it.
    .replace(/(%(?:25)?3A)\d{12}(?=%(?:25)?3A)/gi, '$1xxxxxxxxxxxx');
/** Every wire body the page shows goes through here: cut to a readable length and with the AWS account id masked. */
const clip = (raw: string): string => {
  const masked = maskAccountIds(raw); // mask before cutting: a cut inside an id would leave digits that no longer match
  return masked.length > MAX_WIRE_TEXT ? `${masked.slice(0, MAX_WIRE_TEXT)}\n… (cut at ${MAX_WIRE_TEXT} characters)` : masked;
};

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
    url: maskAccountIds(text(body.url)),
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

const maskChallenge = (challenge: Challenge): Challenge => ({
  scheme: challenge.scheme,
  params: Object.fromEntries(Object.entries(challenge.params).map(([key, value]) => [key, maskAccountIds(value)])),
});

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
  // The same credential goes on the card read and on the message, so one decoded view serves both. Never the raw token.
  const tokenView = bearer ? { token: describeToken(bearer) } : {};
  const shownAuth = credential ? `\nAuthorization: Bearer ${credential}` : '';

  const report = (rawDetail: string, wire?: WireFacts, response?: string, challenge?: Challenge | null): string => {
    const detail = maskAccountIds(rawDetail);
    emit({
      ...route, kind: 'error', text: 'The AWS agent call did not complete', detail, ...(wire ? { wire } : {}), ...(response ? { response: clip(response) } : {}),
      ...(challenge ? { challenge: maskChallenge(challenge) } : {}), refs: [...(challenge ? REFUSED_REFS : ERROR_REFS)],
    });
    return detail;
  };
  const fail = (rawDetail: string, wire?: WireFacts, response?: string): never => {
    throw new Error(report(rawDetail, wire, response));
  };

  /**
   * RFC 9728: a 401 can point at the service's sign-in metadata. Read it, with no credentials, when the address is https (or
   * loopback, for the local stand-in) and on the same host as the route; say why when it is skipped. Never fails the run.
   */
  const readMetadata = async (challenge: Challenge): Promise<void> => {
    const address = challenge.params.resource_metadata;
    if (!address) return;
    const metaRoute = { from: MAIN, to: AWS_AGENT, ...(route.toLabel ? { toLabel: route.toLabel } : {}) };
    const shownAddress = maskAccountIds(address);
    const skipped = (why: string): void => emit({ ...metaRoute, kind: 'metadata', text: 'Sign-in metadata not read', detail: why, request: `GET ${shownAddress}`, refs: [...METADATA_REFS] });
    let target: URL;
    let routeHost: string;
    try {
      target = new URL(address);
      routeHost = new URL(url).hostname;
    } catch {
      skipped('The metadata address in the challenge is not a valid URL, so it was not fetched.');
      return;
    }
    if (target.protocol !== 'https:' && !(target.protocol === 'http:' && LOOPBACK_HOSTS.has(target.hostname))) {
      skipped('The metadata address is not https, so it was not fetched.');
      return;
    }
    if (target.username || target.password) {
      skipped('The metadata address carries a user name or password, so it was not fetched.');
      return;
    }
    if (target.hostname !== routeHost) {
      skipped('The metadata address is on a different host from the route, so it was not fetched.');
      return;
    }
    const started = Date.now();
    const request = `GET ${shownAddress}\nAccept: application/json\n(no credentials sent)`;
    try {
      const response = await doFetch(target.toString(), {
        method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error',
        signal: AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(METADATA_TIMEOUT_MS)]),
      });
      const raw = await response.text();
      const body = response.ok ? parseJson(raw) : null;
      const servers = body && Array.isArray(body.authorization_servers) ? strings(body.authorization_servers) : [];
      emit({
        ...metaRoute, kind: 'metadata', request, elapsedMs: Date.now() - started, wire: { status: response.status }, refs: [...METADATA_REFS],
        text: response.ok && body ? 'main reads the sign-in metadata' : 'Sign-in metadata not available',
        detail: response.ok && body
          ? (servers.length ? `Tokens for this service come from: ${maskAccountIds(servers.join(', '))}` : 'The service describes itself, but names no authorization server.')
          : `HTTP ${response.status} from ${shownAddress}`,
        response: clip(`HTTP ${response.status}\n${pretty(raw)}`),
      });
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      emit({ ...metaRoute, kind: 'metadata', text: 'The sign-in metadata could not be read', detail: maskAccountIds(why), request, elapsedMs: Date.now() - started, refs: [...METADATA_REFS] });
    }
  };
  const stopped = (): never => fail(options.signal?.aborted ? 'The request was cancelled.' : 'The AWS agent did not answer in time.');

  // The Agent Card. Best effort: a gateway route may not publish one, and a missing card must not stop the demo, but it is said.
  const cardTarget = cardUrlFor(url);
  const shownCard = maskAccountIds(cardTarget);
  const shownUrl = maskAccountIds(url);
  const cardStarted = Date.now();
  try {
    const response = await doFetch(cardTarget, { headers: { Accept: 'application/json', ...auth }, signal });
    const raw = await response.text();
    const body = response.ok ? parseJson(raw) : null;
    const request = `GET ${shownCard}${shownAuth}`;
    if (body && text(body.name)) {
      emit({
        ...route, kind: 'card', text: `main reads ${text(body.name)}'s Agent Card`, detail: maskAccountIds(text(body.description)),
        elapsedMs: Date.now() - cardStarted, request, response: clip(pretty(raw)), card: summariseCard(body), wire: { status: response.status },
        ...tokenView, refs: [...AWS_CARD_REFS],
      });
    } else {
      emit({
        ...route, kind: 'card', text: 'No readable Agent Card; sending the message anyway',
        detail: `HTTP ${response.status} from ${shownCard}`, elapsedMs: Date.now() - cardStarted, request, response: clip(raw), wire: { status: response.status },
        ...tokenView, refs: [...AWS_CARD_REFS],
      });
    }
  } catch (error) {
    if (signal.aborted) stopped();
    emit({ ...route, kind: 'card', text: 'No readable Agent Card; sending the message anyway', detail: maskAccountIds(reachMessage(error)), request: `GET ${shownCard}${shownAuth}`, ...tokenView, refs: [...AWS_CARD_REFS] });
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
    ...route, kind: 'delegate', text: `main → ${AWS_AGENT} through Privilege${options.refusalDemo ? ' (deliberately invalid credential)' : ''}`, detail: message,
    request: `POST ${shownUrl}\nContent-Type: application/json${shownAuth}\n\n${JSON.stringify(payload, null, 2)}`, wire: { rpcId, messageId },
    ...tokenView, refs: [...AWS_DELEGATE_REFS],
  });

  const started = Date.now();
  let status = 0;
  let raw = '';
  let challenge = '';
  try {
    const response = await doFetch(url, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...auth }, body: sent, signal });
    status = response.status;
    challenge = response.headers.get('www-authenticate') ?? '';
    raw = await response.text();
  } catch (error) {
    if (signal.aborted) stopped();
    fail(maskAccountIds(reachMessage(error)));
  }

  const body = parseJson(raw);
  const rpcError = record(body?.error);
  if (status < 200 || status >= 300 || body?.error !== undefined) {
    const code = typeof rpcError.code === 'number' ? rpcError.code : undefined;
    const reason = text(rpcError.message) || clip(raw.trim()).slice(0, 300) || 'no body';
    const parsed = challenge ? parseChallenge(challenge) : null;
    const detail = report(`HTTP ${status}${code !== undefined ? ` · JSON-RPC ${code}` : ''}: ${reason}`, { status, rpcId, ...(code !== undefined ? { errorCode: code } : {}) },
      // A 401 carries its challenge in a header (RFC 9110 section 15.5.2); show it, because that is where the client is told how to sign in.
      challenge ? `HTTP ${status}\nWWW-Authenticate: ${maskAccountIds(challenge)}\n\n${raw}` : raw, parsed);
    if (status === 401 && parsed) await readMetadata(parsed);
    throw new Error(detail);
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
