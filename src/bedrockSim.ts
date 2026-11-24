// The "Gateway to Bedrock (IAM)" tab's simulator: our agent's model call through the Privilege gateway to Amazon Bedrock, where the gateway signs the call
// with an AWS identity (its own role, or a role it assumes with an External ID) or injects a stored Bedrock API key, and a Bedrock guardrail can screen the
// prompt. Pure: the same input always gives the same events, and nothing here makes a network call. Every host is .example and every account id is one of
// AWS's two documentation examples (the repo is public). The labels follow the Privilege console's own (Provider, Region, Sign as this gateway (IAM),
// Role ARN, External ID, Session Name, Upstream URL).

import type { RunLayer, RunOutcome } from './runObs.js';

export type Provider = 'runtime' | 'mantle';
export type Identity = 'own' | 'same' | 'cross';
export type ExternalIdChoice = 'match' | 'wrong' | 'missing';
export interface GuardSettings { on: boolean; failClosed: boolean; reachable: boolean }
export interface BedrockInput {
  message: string;
  provider: Provider;
  /** "Sign as this gateway (IAM)". Off: the gateway injects the stored Bedrock API key instead. */
  iam: boolean;
  /** Role ARN blank (own), a role in the gateway's account (same), or a role in another account (cross). */
  identity: Identity;
  externalId: ExternalIdChoice;
  sessionName: string;
  guard: GuardSettings;
}

export type NodeId = 'main' | 'gateway' | 'sts' | 'guard' | 'model';
export type NodeState = 'idle' | 'working' | 'ok' | 'refused' | 'blocked' | 'skipped' | 'error';
export type Step = 'send' | 'identity' | 'sts' | 'guard' | 'model' | 'refused' | 'blocked';

/** One trace event. `nodes` says what each flow node shows after it; `reel` is the frame the page's Reel draws (absent: no frame); `obs` is its run-observability row. */
export interface BedrockEvent {
  kind: 'bedrock';
  step: Step;
  from: string;
  to: string;
  text: string;
  detail?: string;
  request?: string;
  response?: string;
  wire?: { status: number };
  nodes: Partial<Record<NodeId, [NodeState, string]>>;
  reel?: { title: string; status: 'ok' | 'note' | 'refused' | 'error'; word?: string; what: string };
  obs: { layer: RunLayer; outcome: RunOutcome; message: string };
}

export interface BedrockRun {
  outcome: 'answered' | 'refused' | 'blocked';
  events: BedrockEvent[];
  /** The model's (simulated) answer, when it answered. */
  answer?: string;
  /** What the caller is shown when the run did not answer. */
  error?: string;
}

export const MAX_BEDROCK_MESSAGE = 4000;
export const DEFAULT_SESSION_NAME = 'privilege-ai-gateway';
/** AWS's RoleSessionName rule: 2 to 64 of letters, digits and `_+=,.@-`. */
export const SESSION_NAME = /^[\w+=,.@-]{2,64}$/;

export const REGION = 'us-east-1';
export const GATEWAY_URL = 'https://gateway.example';
export const GATEWAY_ROLE = 'arn:aws:iam::111122223333:role/privilege-gateway';
export const SAME_ROLE = 'arn:aws:iam::111122223333:role/privilege-bedrock';
export const CROSS_ROLE = 'arn:aws:iam::444455556666:role/privilege-bedrock';
export const ROLE_ARN: Readonly<Record<Identity, string>> = { own: '', same: SAME_ROLE, cross: CROSS_ROLE };
const STS_HOST = `https://sts.${REGION}.aws.example`;
const RUNTIME_HOST = `https://bedrock-runtime.${REGION}.aws.example`;
const MANTLE_HOST = `https://bedrock-mantle.${REGION}.aws.example`;
export const UPSTREAM_URL: Readonly<Record<Provider, string>> = { runtime: RUNTIME_HOST, mantle: MANTLE_HOST };
const MODEL_ID = 'example.text-model-v1:0';
const GUARDRAIL = 'gr-example01';
export const PROVIDER_LABEL: Readonly<Record<Provider, string>> = { runtime: 'AWS Bedrock (Runtime)', mantle: 'AWS Bedrock (Mantle)' };

/** The permissions the identity the gateway signs with needs, for the chosen type (public AWS knowledge). */
export const PERMISSIONS: Readonly<Record<Provider, readonly string[]>> = {
  runtime: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream', 'bedrock:CountTokens'],
  mantle: ['bedrock-mantle:CreateInference', 'bedrock-mantle:DeleteInference', 'bedrock-mantle:CountTokens'],
};

/** The denied topic the example guardrail blocks: investment advice, found by keyword. */
const DENIED_TOPIC = /\b(invest(ing|ment|ments|or)?|stocks?|shares|portfolio|crypto(currency)?|bitcoin|retirement savings|mutual funds?|index funds?)\b/i;
export const isDeniedTopic = (message: string): boolean => DENIED_TOPIC.test(message);

type Parsed = { ok: true; input: BedrockInput } | { ok: false; error: string };
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T | null => (v === undefined ? fallback : (allowed as readonly unknown[]).includes(v) ? (v as T) : null);
const flag = (v: unknown, fallback: boolean): boolean | null => (v === undefined ? fallback : typeof v === 'boolean' ? v : null);

/** POST /bedrock's body. A field left out takes its default (Runtime, IAM on, own role, guardrail off); a value of the wrong kind is an error (a 400). */
export function parseBedrockBody(raw: unknown): Parsed {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const message = typeof b.message === 'string' ? b.message.trim() : '';
  if (!message || message.length > MAX_BEDROCK_MESSAGE) return { ok: false, error: `message is required (at most ${MAX_BEDROCK_MESSAGE} characters)` };
  const provider = oneOf(b.provider, ['runtime', 'mantle'] as const, 'runtime');
  if (!provider) return { ok: false, error: "provider must be 'runtime' or 'mantle'" };
  const iam = flag(b.iam, true);
  if (iam === null) return { ok: false, error: 'iam must be true or false' };
  const identity = oneOf(b.identity, ['own', 'same', 'cross'] as const, 'own');
  if (!identity) return { ok: false, error: "identity must be 'own', 'same' or 'cross'" };
  const externalId = oneOf(b.externalId, ['match', 'wrong', 'missing'] as const, 'match');
  if (!externalId) return { ok: false, error: "externalId must be 'match', 'wrong' or 'missing'" };
  let sessionName = DEFAULT_SESSION_NAME;
  if (b.sessionName !== undefined && b.sessionName !== '') {
    if (typeof b.sessionName !== 'string' || !SESSION_NAME.test(b.sessionName)) return { ok: false, error: 'sessionName must be 2 to 64 of letters, digits and _+=,.@-' };
    sessionName = b.sessionName;
  }
  const g = b.guard === undefined ? {} : b.guard;
  if (!g || typeof g !== 'object' || Array.isArray(g)) return { ok: false, error: 'guard must be an object' };
  const gr = g as Record<string, unknown>;
  const on = flag(gr.on, false); const failClosed = flag(gr.failClosed, true); const reachable = flag(gr.reachable, true);
  if (on === null || failClosed === null || reachable === null) return { ok: false, error: 'guard.on, guard.failClosed and guard.reachable must be true or false' };
  return { ok: true, input: { message, provider, iam, identity, externalId, sessionName, guard: { on, failClosed, reachable } } };
}

const json = (v: unknown): string => JSON.stringify(v, null, 2);
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const sigV4 = (service: string): string => [
  `Authorization: AWS4-HMAC-SHA256 Credential=ASIA…EXAMPLE (masked)/<yyyymmdd>/${REGION}/${service}/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-security-token, Signature=(hidden)`,
  'X-Amz-Security-Token: (masked)',
].join('\n');
const accountOf = (arn: string): string => arn.split(':')[4] ?? '';

/** The run for one input: the trace events in order, and its end (an answer, a refusal or a block). */
export function simulateBedrock(input: BedrockInput): BedrockRun {
  const { message, provider, iam, identity, externalId, sessionName, guard } = input;
  const events: BedrockEvent[] = [];
  const assumes = iam && identity !== 'own';
  const roleArn = ROLE_ARN[identity];
  const signer = !iam ? 'the stored Bedrock API key' : assumes ? `the assumed role ${roleArn}` : `its own role ${GATEWAY_ROLE}`;
  const signedWord = !iam ? 'key injected' : 'signed and forwarded';

  // 1. The agent sends its prompt to the gateway with its own virtual key; the gateway checks it and replaces it.
  events.push({
    kind: 'bedrock', step: 'send', from: 'main', to: 'gateway', text: 'main sends the prompt to the Privilege gateway with its virtual key',
    detail: 'The gateway checks the virtual key, then replaces it: the Bearer header never reaches AWS.',
    request: [`POST ${GATEWAY_URL}/bedrock/converse`, 'Content-Type: application/json', 'Authorization: Bearer pk-agent-… (masked: the agent\'s virtual key)', '', json({ messages: [{ role: 'user', content: [{ text: message }] }] })].join('\n'),
    nodes: {
      main: ['ok', 'sent'], gateway: ['working', 'checking the key'],
      sts: assumes ? ['idle', 'waiting'] : ['skipped', iam ? 'not used (own role)' : 'not used (stored key)'],
      guard: guard.on ? ['idle', 'waiting'] : ['skipped', 'off'], model: ['idle', 'waiting'],
    },
    reel: { title: 'Send the prompt', status: 'ok', what: 'prompt to the gateway' },
    obs: { layer: 'agent', outcome: 'info', message: 'main sent the prompt to the gateway with its virtual key (simulated)' },
  });

  // 2. Which AWS identity the call goes out as.
  if (!iam) {
    events.push({
      kind: 'bedrock', step: 'identity', from: 'gateway', to: 'gateway', text: 'gateway injects the stored Bedrock API key',
      detail: 'Sign as this gateway (IAM) is off, so the gateway replaces the virtual key with the Bedrock API key stored on the agent key (the Real Provider Key). No STS call is made.',
      nodes: { gateway: ['working', 'injecting the stored key'] },
      obs: { layer: 'gateway', outcome: 'info', message: 'The gateway injected the stored Bedrock API key (simulated)' },
    });
  } else if (!assumes) {
    events.push({
      kind: 'bedrock', step: 'identity', from: 'gateway', to: 'gateway', text: 'gateway signs with its own AWS identity',
      detail: `Role ARN is blank, so the gateway signs with its host's own identity: the EC2 instance role ${GATEWAY_ROLE}, read from the instance metadata service (IMDS). No STS call is made.`,
      nodes: { gateway: ['working', 'signing (own role)'] },
      obs: { layer: 'gateway', outcome: 'info', message: 'The gateway signed with its own role (simulated)' },
    });
  } else {
    const params = [`Action=AssumeRole`, `Version=2011-06-15`, `RoleArn=${roleArn}`, `RoleSessionName=${sessionName}`];
    if (externalId === 'match') params.push('ExternalId=(the agreed External ID, masked)');
    if (externalId === 'wrong') params.push('ExternalId=not-the-agreed-value');
    const request = [`POST ${STS_HOST}/`, 'Content-Type: application/x-www-form-urlencoded', sigV4('sts'), '', params.join('&'),
      '', `(signed with the gateway's own role ${GATEWAY_ROLE})`].join('\n');
    const where = identity === 'cross' ? `in another account (${accountOf(roleArn)})` : `in the gateway's own account (${accountOf(roleArn)})`;
    if (externalId === 'match') {
      events.push({
        kind: 'bedrock', step: 'sts', from: 'gateway', to: 'sts', text: `gateway assumes ${roleArn}`,
        detail: `AssumeRole ${where}, with the External ID the role's trust policy asks for. The session is named ${sessionName}, which is how it shows in that account's CloudTrail.`,
        request, wire: { status: 200 },
        response: ['HTTP 200', '', '<AssumeRoleResponse><AssumeRoleResult>',
          `  <AssumedRoleUser><Arn>arn:aws:sts::${accountOf(roleArn)}:assumed-role/privilege-bedrock/${sessionName}</Arn></AssumedRoleUser>`,
          '  <Credentials><AccessKeyId>ASIA…EXAMPLE (masked)</AccessKeyId><SecretAccessKey>(hidden)</SecretAccessKey><SessionToken>(hidden)</SessionToken><Expiration>(one hour later)</Expiration></Credentials>',
          '</AssumeRoleResult></AssumeRoleResponse>'].join('\n'),
        nodes: { sts: ['ok', 'role assumed'], gateway: ['working', 'signing (assumed role)'] },
        reel: { title: 'Assume the role', status: 'ok', what: 'AssumeRole' },
        obs: { layer: 'gateway', outcome: 'allowed', message: `AWS STS let the gateway assume the role ${where} (simulated)` },
      });
    } else {
      const why = externalId === 'wrong' ? 'the External ID did not match' : 'no External ID was sent';
      events.push({
        kind: 'bedrock', step: 'sts', from: 'gateway', to: 'sts', text: `gateway assumes ${roleArn}: refused`,
        detail: `AssumeRole ${where} was refused: ${why}, so the role's trust policy condition on sts:ExternalId does not hold.`,
        request, wire: { status: 403 },
        response: ['HTTP 403', '', '<ErrorResponse><Error><Type>Sender</Type><Code>AccessDenied</Code>',
          `  <Message>User: arn:aws:sts::111122223333:assumed-role/privilege-gateway/i-0example is not authorized to perform: sts:AssumeRole on resource: ${roleArn}</Message>`,
          '</Error></ErrorResponse>'].join('\n'),
        nodes: { sts: ['refused', 'refused (AccessDenied)'] },
        reel: { title: 'Assume the role', status: 'refused', what: 'AssumeRole' },
        obs: { layer: 'gateway', outcome: 'refused', message: `AWS STS refused AssumeRole: ${why} (simulated)` },
      });
      events.push({
        kind: 'bedrock', step: 'refused', from: 'gateway', to: 'main', text: 'gateway answers 502 upstream_unreachable',
        detail: 'The gateway answers with a generic HTTP 502 upstream_unreachable, the same answer as a network failure. The caller cannot tell that the role was refused: the reason is only in the gateway\'s log and in the target account\'s CloudTrail.',
        wire: { status: 502 }, response: ['HTTP 502', '', json({ error: 'upstream_unreachable' })].join('\n'),
        nodes: { gateway: ['error', '502 to the caller'], ...(guard.on ? { guard: ['skipped', 'not reached'] as [NodeState, string] } : {}), model: ['skipped', 'not reached'] },
        reel: { title: 'Refused', status: 'refused', what: 'gateway reply' },
        obs: { layer: 'gateway', outcome: 'refused', message: 'The gateway answered the caller HTTP 502 upstream_unreachable (simulated)' },
      });
      return {
        outcome: 'refused', events,
        error: `HTTP 502 · {"error":"upstream_unreachable"}\nThat is all the caller sees: the same answer as a network failure. The cause (AssumeRole refused: ${why}) is only in the gateway's log and the target account's CloudTrail. (Simulated.)`,
      };
    }
  }

  // 3. The Bedrock guardrail, as AI Guard: ApplyGuardrail on the prompt before the model is called.
  if (guard.on) {
    const request = [`POST ${RUNTIME_HOST}/guardrail/${GUARDRAIL}/version/1/apply`, 'Content-Type: application/json', sigV4('bedrock'), '',
      json({ source: 'INPUT', content: [{ text: { text: message } }] })].join('\n');
    const blockedReply = (reason: string): string => ['HTTP 403', '', json({ error: 'content_blocked', message: reason })].join('\n');
    if (!guard.reachable) {
      const base = { kind: 'bedrock' as const, step: 'guard' as const, from: 'gateway', to: 'guardrail', request, response: 'No response: the call timed out. The guardrail\'s role could not be reached.' };
      if (guard.failClosed) {
        events.push({ ...base, text: 'guardrail unreachable', detail: 'The guardrail could not be reached, and Fail closed is on: the gateway does not let an unchecked prompt through.',
          nodes: { guard: ['blocked', 'unreachable: blocked (Fail closed)'] }, reel: { title: 'Check the guardrail', status: 'error', what: 'ApplyGuardrail' },
          obs: { layer: 'privilege', outcome: 'info', message: 'The guardrail could not be reached (simulated)' } });
        events.push({ kind: 'bedrock', step: 'blocked', from: 'gateway', to: 'main', text: 'gateway blocks the request (Fail closed)',
          detail: 'The prompt was not inspected, so with Fail closed on the request is blocked. The model is never called.', wire: { status: 403 },
          response: blockedReply('request blocked: the guardrail could not be checked and Fail closed is on'),
          nodes: { gateway: ['blocked', 'blocked'], model: ['skipped', 'not called'] }, reel: { title: 'Blocked', status: 'refused', word: 'Blocked', what: 'gateway reply' },
          obs: { layer: 'privilege', outcome: 'blocked', message: 'The gateway blocked the request: the guardrail could not be checked and Fail closed is on (simulated)' } });
        return { outcome: 'blocked', events, error: 'Blocked: the guardrail could not be reached, and Fail closed is on, so the prompt was not let through. The model was never called. (Simulated.)' };
      }
      events.push({ ...base, text: 'guardrail unreachable: passed uninspected', detail: 'Warning: the guardrail could not be reached and Fail closed is off, so the gateway lets the prompt through uninspected and logs a warning.',
        nodes: { guard: ['skipped', 'not inspected (warning)'] }, reel: { title: 'Check the guardrail', status: 'note', word: 'Uninspected', what: 'ApplyGuardrail' },
        obs: { layer: 'privilege', outcome: 'info', message: 'Warning: the guardrail could not be reached; with Fail closed off the prompt passed uninspected (simulated)' } });
    } else if (isDeniedTopic(message)) {
      events.push({ kind: 'bedrock', step: 'guard', from: 'gateway', to: 'guardrail', text: 'guardrail intervenes: denied topic', request, wire: { status: 200 },
        detail: 'The guardrail found a denied topic, investment advice, and intervened.',
        response: ['HTTP 200', '', json({ action: 'GUARDRAIL_INTERVENED', outputs: [{ text: 'Sorry, this assistant cannot give investment advice.' }], assessments: [{ topicPolicy: { topics: [{ name: 'Investment advice', type: 'DENY', action: 'BLOCKED' }] } }] })].join('\n'),
        nodes: { guard: ['blocked', 'blocked (denied topic)'] }, reel: { title: 'Check the guardrail', status: 'refused', word: 'Intervened', what: 'ApplyGuardrail' },
        obs: { layer: 'privilege', outcome: 'blocked', message: 'The Bedrock guardrail blocked the prompt: denied topic, investment advice (simulated)' } });
      events.push({ kind: 'bedrock', step: 'blocked', from: 'gateway', to: 'main', text: 'gateway blocks the request', wire: { status: 403 },
        detail: 'The guardrail blocked the prompt, so the gateway stops the request here. The model is never called.',
        response: blockedReply('request blocked by security policy'),
        nodes: { gateway: ['blocked', 'blocked'], model: ['skipped', 'not called'] }, reel: { title: 'Blocked', status: 'refused', word: 'Blocked', what: 'gateway reply' },
        obs: { layer: 'gateway', outcome: 'blocked', message: 'The gateway did not pass the prompt to the model (simulated)' } });
      return { outcome: 'blocked', events, error: 'Blocked by the Bedrock guardrail: the prompt asks for investment advice, a denied topic. The model was never called. (Simulated.)' };
    } else {
      events.push({ kind: 'bedrock', step: 'guard', from: 'gateway', to: 'guardrail', text: 'guardrail passes the prompt', request, wire: { status: 200 },
        detail: 'Nothing in the prompt matched the guardrail\'s policies.', response: ['HTTP 200', '', json({ action: 'NONE', outputs: [], assessments: [{}] })].join('\n'),
        nodes: { guard: ['ok', 'passed'] }, reel: { title: 'Check the guardrail', status: 'ok', what: 'ApplyGuardrail' },
        obs: { layer: 'privilege', outcome: 'allowed', message: 'The Bedrock guardrail passed the prompt (simulated)' } });
    }
  }

  // 4. The model call, signed as the chosen identity (or carrying the stored key).
  const answer = `SIMULATED answer: no Bedrock model was called. Through ${PROVIDER_LABEL[provider]}, signed with ${signer}, a real model would now answer: "${clip(message, 120)}"`;
  const auth = iam ? sigV4(provider === 'mantle' ? 'bedrock-mantle' : 'bedrock') : 'Authorization: Bearer (the stored Bedrock API key, masked)';
  const body = json({ messages: [{ role: 'user', content: [{ text: message }] }] });
  const reply = { output: { message: { role: 'assistant', content: [{ text: answer }] } }, stopReason: 'end_turn', usage: { inputTokens: 12, outputTokens: 48 } };
  const request = provider === 'runtime'
    ? [`POST ${RUNTIME_HOST}/model/${MODEL_ID}/converse`, 'Content-Type: application/json', auth, '', body].join('\n')
    : [`POST ${MANTLE_HOST}/inference   (CreateInference; simulated shape)`, 'Content-Type: application/json', auth, '', json({ modelId: MODEL_ID, messages: [{ role: 'user', content: [{ text: message }] }] }),
      '', 'then, once the reply is in (always, as part of every Mantle call):', `DELETE ${MANTLE_HOST}/inference/inf-0example   (DeleteInference)`, auth].join('\n');
  const response = provider === 'runtime'
    ? ['HTTP 200', '', json(reply)].join('\n')
    : ['HTTP 200   (CreateInference)', '', json({ inferenceId: 'inf-0example', ...reply }), '', 'HTTP 200   (DeleteInference: the inference is released)'].join('\n');
  events.push({
    kind: 'bedrock', step: 'model', from: 'gateway', to: 'bedrock', text: provider === 'runtime' ? 'gateway calls Bedrock (Runtime): Converse' : 'gateway calls Bedrock (Mantle): CreateInference, then DeleteInference',
    detail: `${PROVIDER_LABEL[provider]} in ${REGION}, ${iam ? `signed with SigV4 as ${signer}` : 'with the stored Bedrock API key injected'}.`,
    request, response, wire: { status: 200 },
    nodes: { model: ['ok', 'answered'], gateway: ['ok', signedWord] },
    reel: { title: 'Call the model', status: 'ok', what: provider === 'runtime' ? 'Converse' : 'CreateInference + DeleteInference' },
    obs: { layer: 'resource', outcome: 'allowed', message: `${PROVIDER_LABEL[provider]} answered the model call (simulated)` },
  });
  return { outcome: 'answered', events, answer };
}
