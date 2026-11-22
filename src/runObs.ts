import { randomUUID } from 'node:crypto';

// Rule 27 (run observability). The shared core and the log readers are vendored plain JS (server/src/, pinned by
// web/src/run-observability/run-observability.sha256); this file is the lab's own glue: it records the trace events of the
// latest run, turns them into rows, logs one line per decision and answers GET /api/run-observability.
// @ts-expect-error the vendored core is plain JavaScript, its shape is typed below
import { createRunObservability } from '../server/src/runObservability.js';
// @ts-expect-error the vendored readers are plain JavaScript, their shape is typed below
import { readersFromEnv } from '../server/src/runObservabilityReaders.js';

export type RunLayer = 'person' | 'agent' | 'authorize' | 'privilege' | 'gateway' | 'resource';
export type RunOutcome = 'allowed' | 'refused' | 'blocked' | 'info';
export type RunSource = 'mock' | 'real';
export type RunKind = 'chat' | 'chain' | 'aws-agent';

/** One thing the lab saw during the run, already placed in a layer. `at` is epoch milliseconds. */
export interface RunNote { at: number; layer: RunLayer; outcome: RunOutcome; message: string; product?: string }

/** The few fields of a trace event this module reads. Everything else in the event is ignored. */
export interface TraceLike { kind?: unknown; from?: unknown; to?: unknown; text?: unknown; detail?: unknown; wire?: { status?: unknown } }

/** The product id the lab's own decision lines are read under (ping_product / demo_service / container name). */
export const LAB_PRODUCT = 'privilege-a2a-lab';

const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').slice(0, max) : '');
const statusOf = (e: TraceLike): number | null => (typeof e.wire?.status === 'number' ? e.wire.status : null);
/** A tool reply the gateway's content check blocked: the measured wording is code content_blocked, "response blocked by security policy". Words like denied or forbidden are ordinary errors, not a block. */
const isBlockedReply = (e: TraceLike): boolean => e.kind === 'error' && e.from === 'mcp' && /content_blocked|blocked by security policy/i.test(str(e.detail, 1000));
const toolName = (e: TraceLike): string => str(e.text, 80).replace(/^analyst\s*(?:→|->)\s*/, '').replace(/\s+returned$|\s+failed$/, '');
const failedStatus = (status: number | null): boolean => status !== null && status >= 400;
const who = (v: unknown): string => str(v, 40).toLowerCase().replace(/[^a-z0-9_-]/g, '-') || 'unknown';

/**
 * The rows one trace event stands for. Nothing is inferred beyond what the event says: a call without a verdict is `info`,
 * and only an answer the lab actually received (a reply, an HTTP status, a blocked tool reply) is allowed, refused or blocked.
 */
export function notesFor(e: TraceLike, at: number): RunNote[] {
  const from = str(e.from, 40) || 'the lab';
  const to = str(e.to, 40) || 'the next hop';
  const status = statusOf(e);
  const note = (layer: RunLayer, outcome: RunOutcome, message: string): RunNote => ({ at, layer, outcome, message });
  switch (e.kind) {
    case 'token':
      if (failedStatus(status)) return [note('agent', status === 401 || status === 403 ? 'refused' : 'info', `${from} asked the identity provider for a token and got HTTP ${status}`)];
      return [note('agent', 'allowed', `${from} was issued a token by the identity provider (client credentials)${status ? `, HTTP ${status}` : ''}`)];
    case 'card':
      return [note('gateway', status === 401 || status === 403 ? 'refused' : 'info', `${from} read ${to}'s Agent Card through the gateway${status ? `, HTTP ${status}` : ''}`)];
    case 'delegate':
      return [note('agent', 'info', `${from} handed the message to ${to} through the gateway`)];
    case 'result':
      if (failedStatus(status)) return [note('gateway', status === 401 || status === 403 ? 'refused' : 'info', `${from} answered ${to} through the gateway with HTTP ${status}`)];
      return [note('gateway', 'allowed', `${from} answered ${to} through the gateway${status ? `, HTTP ${status}` : ''}`)];
    case 'mcp-call':
      return [note('resource', 'info', `${from} called the tool ${toolName(e)} on the MCP server`)];
    case 'mcp-result':
      if (failedStatus(status)) return [note('resource', 'info', `The MCP server answered with HTTP ${status}`)];
      return [note('resource', 'allowed', `The MCP server returned the result of ${toolName(e)}`)];
    case 'error':
      if (isBlockedReply(e)) return [note('privilege', 'blocked', `A tool reply was stopped on its way back: the gateway's content check said it was blocked`), note('gateway', 'blocked', `The gateway did not pass the tool reply from ${from} to ${to}`)];
      if (status === 401 || status === 403) return [note('gateway', 'refused', `The gateway refused the call to ${to}, HTTP ${status}`)];
      return [note('gateway', 'info', `${str(e.text, 120) || 'A hop failed'}${status ? `, HTTP ${status}` : ''}`)];
    default:
      return [];
  }
}

/**
 * The verdict the lab itself saw on a hop, for its decision log line; null when the event carries no verdict.
 * The line says passed / stopped / blocked, never refused, denied, token and the like: the shared matchers read those words as a product's decision.
 */
export function decisionOf(e: TraceLike): { actor: string; target: string; result: 'passed' | 'stopped' | 'blocked' } | null {
  const status = statusOf(e);
  const actor = who(e.from); const target = who(e.to);
  if (isBlockedReply(e)) return { actor, target, result: 'blocked' };
  if ((e.kind === 'error' || e.kind === 'card' || e.kind === 'result' || e.kind === 'token') && (status === 401 || status === 403)) return { actor, target, result: 'stopped' };
  if (failedStatus(status)) return null; // any other failure carries no verdict: no line
  if (e.kind === 'result' || e.kind === 'mcp-result' || e.kind === 'token') return { actor, target, result: 'passed' };
  return null;
}

/** The one line the lab writes to stdout for each decision (run id, actor, target, result; never a token or a message body). Every value is already [a-z0-9_-]. */
export function decisionLine(runId: string, d: { actor: string; target: string; result: string }, now = new Date(), mode: RunSource = 'real'): string {
  return `${now.toISOString()} ${LAB_PRODUCT} decision mode=${mode} run=${runId} actor=${d.actor} target=${d.target} result=${d.result}`;
}

const OUTCOME_OF = { passed: 'allowed', stopped: 'refused', blocked: 'blocked' } as const;

/** The matcher that reads the line above back. Anchored, so text a caller typed can never become a decision row. */
export const LAB_MATCHER = {
  id: 'privilege-a2a-lab-decision',
  product: LAB_PRODUCT,
  layer: 'gateway',
  basis: 'measured-shape',
  pattern: /^\d{4}-\d{2}-\d{2}T[\d:.]+Z privilege-a2a-lab decision mode=(mock|real) run=([a-f0-9-]{36}) actor=([a-z0-9_-]{1,40}) target=([a-z0-9_-]{1,40}) result=(passed|stopped|blocked)$/,
  build: (m: RegExpMatchArray) => ({ outcome: OUTCOME_OF[m[5] as keyof typeof OUTCOME_OF], message: `The lab logged what it saw the gateway do for ${m[3]} → ${m[4]}: ${m[5]} (${m[1]} run)`, detail: { actor: m[3], target: m[4], result: m[5], mode: m[1] } }),
};

export interface RunRecord { [key: string]: unknown }
interface Obs { collectRun(input: Record<string, unknown>): Promise<RunRecord> }

/** One run: from the request to its last trace event. The recorder is the only place events are collected. */
export class RunRecorder {
  readonly runId = randomUUID();
  readonly startedAt = Date.now();
  endedAt: number | null = null;
  readonly notes: RunNote[] = [];
  constructor(readonly kind: RunKind, readonly source: RunSource, private readonly log: (line: string) => void = line => console.log(line)) {}

  /** Called once per trace event the page is sent. */
  note(event: TraceLike, at = Date.now()): void {
    this.notes.push(...notesFor(event, at));
    const decision = decisionOf(event);
    if (decision) this.log(decisionLine(this.runId, decision, new Date(at), this.source));
  }

  finish(at = Date.now()): void { this.endedAt = at; }
}

/** Real runs: how far each side of the run the logs are read, in milliseconds. */
export const READ_PAD_MS = 2000;

const NO_SIGN_IN = 'This lab has no sign-in: the person is a name typed on the page, so no identity-provider line exists for them.';
const NO_AUTHORIZE = 'This lab does not call PingOne Authorize, so nothing is logged for this layer.';

/** The six layer specs for a run. Mock: every row is simulated. Real: rows the lab holds as responses, plus whatever the readers find. */
export function layersFor(notes: RunNote[], source: RunSource): Record<string, unknown>[] {
  const of = (layer: RunLayer): Record<string, unknown>[] => notes.filter(n => n.layer === layer).map(n => ({ at: n.at, outcome: n.outcome, message: n.message, ...(n.product ? { product: n.product } : {}) }));
  const rows = (layer: RunLayer): Record<string, unknown> => (source === 'mock' ? { simulated: of(layer) } : { responses: of(layer) });
  return [
    { layer: 'person', products: [], reason: NO_SIGN_IN },
    { layer: 'agent', products: source === 'mock' ? [] : ['pingfederate'], ...rows('agent'), reason: 'Nothing was recorded for the agent in this run.' },
    { layer: 'authorize', products: [], reason: NO_AUTHORIZE },
    { layer: 'privilege', products: source === 'mock' ? [] : ['privilege-siem', 'privilege-gateway', 'promptguard'], ...rows('privilege'), reason: 'No policy decision, AI Guard verdict or approval was recorded for this run.' },
    { layer: 'gateway', products: source === 'mock' ? [] : ['privilege-gateway', LAB_PRODUCT], ...rows('gateway'), reason: 'Nothing was recorded for the gateway in this run.' },
    { layer: 'resource', products: source === 'mock' ? [] : ['mcp-server'], ...rows('resource'), reason: 'The MCP server was not called in this run.' },
  ];
}

let last: RunRecorder | null = null;

/** Starts a run and makes it the current one. A second run replaces the first: the record is always of the latest run. */
export function beginRun(kind: RunKind, source: RunSource, log?: (line: string) => void): RunRecorder {
  last = new RunRecorder(kind, source, log);
  return last;
}

export const currentRun = (): RunRecorder | null => last;

/** For tests: forget the current run. */
export function resetRuns(): void { last = null; }

export interface ObsBody { record?: RunRecord | null; message?: string; error?: string }

/** The body of GET /api/run-observability. Never throws: a failure is `{ error, message }` JSON (rule 23). */
export async function runObservability(mode: RunSource, obs: Obs = createRunObservability({ readers: readersFromEnv(), matchers: [LAB_MATCHER] })): Promise<{ status: number; body: ObsBody }> {
  const run = last;
  if (!run) return { status: 200, body: { record: null, message: 'No run yet. Send a prompt, then come back to see what each layer logged.' } };
  // A Mock run is never returned as a Real one (or the other way) after the toggle: say which mode the run was in.
  if (run.source !== mode) return { status: 200, body: { record: null, message: `The latest run was in ${run.source === 'real' ? 'Real' : 'Mock'} mode. Switch back to ${run.source === 'real' ? 'Real' : 'Mock'} to see it, or run again in ${mode === 'real' ? 'Real' : 'Mock'}.` } };
  try {
    const record = await obs.collectRun({
      // Real: the window is padded by READ_PAD_MS each side (container clocks and the collector's batching are not the lab's clock); rows
      // found only by time say so (matchedBy: window), the lab's own lines are tied to the run by its id.
      runId: run.runId, startedAt: run.startedAt - (run.source === 'real' ? READ_PAD_MS : 0), endedAt: (run.endedAt ?? Date.now()) + (run.source === 'real' ? READ_PAD_MS : 0),
      correlation: run.source === 'real' ? { requestIds: [run.runId] } : {},
      layers: layersFor(run.notes, run.source), source: run.source,
    });
    return { status: 200, body: { record } };
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    console.error(`[main] run-observability failed: ${typeof code === 'string' ? code.slice(0, 40) : 'error'}: ${str(error instanceof Error ? error.message : '', 200)}`);
    return { status: 500, body: { error: 'internal_error', message: 'The run observability record could not be built.' } };
  }
}
