// The logic behind `npm run setup` (scripts/setup.mjs): write the lab's .env safely, print the console checklist, and prove with --verify that
// Privilege is set up. Pure functions and one verify runner that takes its fetch and clock, so tests run it against a fake gateway.
// Spec: docs/specs/2026-11-25-setup-script-v1.md. Node built-ins only. Hard rule: a key is never printed, logged or put in an error.
import { parseEnv } from 'node:util';

export const CORE_TOOLS = ['list_entitlements', 'who_has_role', 'get_access_grants', 'open_ticket'];
export const DEFAULT_APPS = { worker: 'workeragentdemo', mcp: 'mcpdemo' };
// Groq (and llama.cpp) are not here on purpose: the lab reads a separate *_GROQ_KEY for the model call but ${agent}_KEY for the A2A and MCP legs, so one
// key per agent does not describe them. Set those by hand (guide, Step 1).
export const PROVIDERS = ['anthropic', 'google'];

const SECRET_NAME = /(_KEY|_SECRET|_TOKEN)$/;
export const isSecretName = (name) => SECRET_NAME.test(name);

// ---------------------------------------------------------------------------------------------- arguments
const VALUE_FLAGS = new Set(['gateway', 'provider', 'worker-app', 'mcp-app', 'aws-app', 'main-model', 'worker-model', 'path', 'wait', 'file']);
const BOOL_FLAGS = new Set(['apply', 'verify', 'checklist', 'no-prompt', 'help']);

export function parseArgs(argv) {
  const opts = { path: 'b', wait: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!m) throw new Error(`unexpected argument "${String(arg).split('=')[0].slice(0, 24)}" (see --help)`);
    const [, name, inline] = m;
    if (BOOL_FLAGS.has(name)) {
      if (inline !== undefined) throw new Error(`--${name} takes no value`);
      opts[name.replace(/-(.)/g, (_x, c) => c.toUpperCase())] = true;
    } else if (VALUE_FLAGS.has(name)) {
      const value = inline ?? argv[++i];
      if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value`);
      opts[name.replace(/-(.)/g, (_x, c) => c.toUpperCase())] = value;
    } else {
      throw new Error(`unknown option --${name} (see --help)`);
    }
  }
  if (!['a', 'b'].includes(String(opts.path).toLowerCase())) throw new Error('--path must be a or b');
  opts.path = String(opts.path).toLowerCase();
  const wait = Number(opts.wait);
  if (!Number.isFinite(wait) || wait < 0 || wait > 30) throw new Error('--wait must be a number of minutes from 0 to 30');
  opts.wait = wait;
  return opts;
}

// ---------------------------------------------------------------------------------------------- .env text
/** The variables an .env text defines, parsed by Node's own dotenv parser (the one `tsx --env-file` uses), so this tool and the lab cannot disagree. */
export const envMap = (text) => parseEnv(String(text));

// A value the loader would misread (a '#' ends it, quotes and edge spaces change it) is refused rather than written.
const plain = (name, value) => {
  if (/[\r\n]/.test(value)) throw new Error(`${name} contains a line break`);
  if (/[#'"`]/.test(value) || value !== value.trim()) throw new Error(`${name} has a character the .env loader would misread (# ' " \` or a space at the ends)`);
};

/**
 * Sets the named variables in an .env text and changes nothing else: an active line is replaced in place, a commented `# NAME=` line is
 * turned on in place, and a name found nowhere is appended under one header. Returns the new text and, per name, what happened.
 */
export function mergeEnv(text, updates) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.length ? text.split(/\r?\n/) : [];
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const changes = [];
  const appended = [];
  for (const [name, value] of Object.entries(updates)) {
    plain(name, value);
    const active = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`);
    // Only a line that is exactly "# NAME=" and a value counts as the commented default; prose that mentions NAME= does not.
    const commented = new RegExp(`^\\s*#\\s*${name}=\\S*\\s*$`);
    const hits = lines.flatMap((l, n) => (active.test(l) ? [n] : []));
    if (hits.length) {
      let changed = false;
      for (const n of hits) {
        if (parseEnv(lines[n])[name] !== value) { lines[n] = `${name}=${value}`; changed = true; }
      }
      changes.push({ name, action: changed ? 'set' : 'unchanged', duplicates: hits.length > 1 });
      continue;
    }
    const at = lines.findIndex((l) => commented.test(l));
    if (at >= 0) { lines[at] = `${name}=${value}`; changes.push({ name, action: 'set' }); continue; }
    appended.push(`${name}=${value}`);
    changes.push({ name, action: 'set' });
  }
  if (appended.length) {
    if (lines.length && lines[lines.length - 1] !== '') lines.push('');
    lines.push('# Set by npm run setup', ...appended);
  }
  return { text: lines.join(eol) + (lines.length ? eol : ''), changes };
}

/** One line per change, with a secret shown only as its length: "MAIN_AGENT_KEY  set (48 characters)". */
export function describeChange(change, value) {
  const shown = isSecretName(change.name) ? `${change.action === 'unchanged' ? 'unchanged' : 'set'} (${value.length} characters)` : `${change.action === 'unchanged' ? 'unchanged' : 'set'}  ${value}`;
  return `  ${change.name.padEnd(24)} ${shown}`;
}

// ---------------------------------------------------------------------------------------------- settings
const keyVar = (_provider, agent) => `${agent}_KEY`;
const baseVar = (provider) => ({ anthropic: 'ANTHROPIC_BASE_URL', google: 'GEMINI_BASE_URL' })[provider];
const routeFor = (provider) => ({ anthropic: '/llm/anthropic', google: '/llm/google' })[provider];

/** "gateway.example", "https://gateway.example/" and "gateway.example:8623" all become an origin; anything with a path is refused. */
export function normaliseGateway(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { error: 'no gateway host given' };
  if (/\s/.test(raw)) return { error: 'the gateway host has a space in it' };
  const withScheme = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url;
  try { url = new URL(withScheme); } catch { return { error: `"${raw}" is not a host name` }; }
  if (!['https:', 'http:'].includes(url.protocol)) return { error: 'the gateway must be an https address' };
  if (url.pathname.replace(/\/+$/, '') !== '' || url.search || url.hash || url.username) return { error: 'give the gateway host only, with no path (the lab adds /llm/..., /<app>/a2a and so on)' };
  const loopback = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(url.hostname);
  if (url.protocol === 'http:' && !loopback) return { error: 'the gateway must be https (http is allowed only for localhost)' };
  return { origin: url.origin };
}

/** What a run will write. keys: { main, worker } (either may be absent). Path A writes the model lines only. */
export function envUpdates(settings, keys = {}) {
  const { provider, origin, mainModel, workerModel, workerApp, mcpApp, awsApp, path } = settings;
  const u = { MAIN_AGENT_PROVIDER: provider, WORKER_AGENT_PROVIDER: provider };
  u[baseVar(provider)] = `${origin}${routeFor(provider)}`;
  if (mainModel) u.MAIN_AGENT_MODEL = mainModel;
  if (workerModel) u.WORKER_AGENT_MODEL = workerModel;
  if (keys.main) u[keyVar(provider, 'MAIN_AGENT')] = keys.main;
  if (keys.worker) u[keyVar(provider, 'WORKER_AGENT')] = keys.worker;
  if (path === 'b') {
    u.WORKER_A2A_URL = `${origin}/${workerApp}/a2a`;
    u.WORKER_TRACE_URL = `${origin}/${workerApp}/trace`;
    u.MCP_URL = `${origin}/${mcpApp}/mcp`;
    if (awsApp) u.AWS_AGENT_A2A_URL = `${origin}/${awsApp}/a2a`;
  }
  return u;
}

/** Settings recovered from an existing .env, so a plan or --verify needs no flags. provider is '' when it is not set. */
export function settingsFromEnv(map) {
  const provider = String(map.MAIN_AGENT_PROVIDER ?? '').trim().toLowerCase();
  const base = map[baseVar(provider)] ?? '';
  const origin = /^(https?:\/\/[^/]+)\/llm\//.exec(base)?.[1];
  const app = (url, tail) => new RegExp(`^https?://[^/]+/([^/]+)/${tail}/*$`).exec(url ?? '')?.[1];
  return {
    provider,
    origin,
    mainModel: map.MAIN_AGENT_MODEL || undefined,
    workerModel: map.WORKER_AGENT_MODEL || undefined,
    workerApp: app(map.WORKER_A2A_URL, 'a2a'),
    mcpApp: app(map.MCP_URL, 'mcp'),
    awsApp: app(map.AWS_AGENT_A2A_URL, 'a2a'),
  };
}

// ---------------------------------------------------------------------------------------------- validation (before any write or call)
export function validateKey(label, value) {
  if (/\s/.test(value)) return `${label} has a space or line break in it (paste it once, with nothing around it)`;
  if (/[#'"`]/.test(value)) return `${label} contains a # or a quote: the .env loader would cut or change it, so it cannot be stored in .env as it is`;
  if (value.length < 20) return `${label} is only ${value.length} characters: an agent key is much longer (is it the whole key?)`;
  if (value.length % 2 === 0 && value.slice(0, value.length / 2) === value.slice(value.length / 2)) return `${label} looks pasted twice (the same text repeated): paste it once`;
  return null;
}

/** Problems with a settings object and the keys about to be written or used. Each is { level: 'error' | 'warn', message }. */
export function validate(settings, keys = {}, env = {}) {
  const out = [];
  const err = (message) => out.push({ level: 'error', message });
  const warn = (message) => out.push({ level: 'warn', message });
  if (!PROVIDERS.includes(settings.provider)) err(`the provider "${settings.provider || '(not set)'}" is not supported by npm run setup: use ${PROVIDERS.join(' or ')} (Groq and llama.cpp need a separate key per agent: set them by hand, guide Step 1)`);
  if (settings.origin) {
    const g = normaliseGateway(settings.origin);
    if (g.error) err(g.error);
  }
  for (const [label, name] of [['the worker app name', settings.workerApp], ['the MCP app name', settings.mcpApp], ['the AWS agent app name', settings.awsApp]]) {
    if (name !== undefined && !/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) err(`${label} "${name}" must be lower-case letters, digits and hyphens`);
  }
  for (const [label, value] of [['the main agent key', keys.main], ['the worker key', keys.worker]]) {
    if (value) { const problem = validateKey(label, value); if (problem) err(problem); }
  }
  if (keys.main && keys.main === keys.worker) warn('the main and worker keys are identical: each agent should hold its own key');
  if (settings.origin) {
    for (const [label, model] of [['main', settings.mainModel], ['worker', settings.workerModel]]) {
      if (!model) err(`the ${label} model is not set: through the gateway it must be exactly a model the ${label} key allows`);
      else if (/-latest$/.test(model)) warn(`the ${label} model "${model}" is an alias: the gateway only accepts a model selected on the key, so use the exact ID`);
    }
  }
  const workerProvider = String(env.WORKER_AGENT_PROVIDER ?? '').trim().toLowerCase();
  if (workerProvider && workerProvider !== settings.provider) err(`MAIN_AGENT_PROVIDER is "${settings.provider}" but WORKER_AGENT_PROVIDER is "${workerProvider}": a key is tied to one provider, and this tool sets both agents to the same one`);
  if (env.ANTHROPIC_AUTH_TOKEN) warn('ANTHROPIC_AUTH_TOKEN is set in .env: the lab uses it instead of the agent keys for Anthropic model calls');
  const pf = ['AWS_AGENT_PF_TOKEN_URL', 'AWS_AGENT_PF_CLIENT_ID', 'AWS_AGENT_PF_CLIENT_SECRET'].filter((n) => env[n]);
  if (pf.length && pf.length < 3) err('set all three of AWS_AGENT_PF_TOKEN_URL, AWS_AGENT_PF_CLIENT_ID and AWS_AGENT_PF_CLIENT_SECRET, or none (the main agent stops at startup otherwise)');
  return out;
}

/**
 * Where the keys will be sent. Every URL the checks call must be https (or loopback http), carry no user name or password, and be on the
 * gateway's own origin: a stale host, a typo or a pasted .env must never send a live key to a third party. Path A calls only the model route.
 */
export function validateUrls(env, origin, path = 'b') {
  const out = [];
  const names = path === 'b' ? ['MCP_URL', 'WORKER_A2A_URL', ...['AWS_AGENT_A2A_URL', 'WORKER_TRACE_URL'].filter((n) => env[n])] : [];
  for (const name of names) {
    const raw = env[name];
    if (!raw) { out.push({ level: 'error', message: `${name} is not set in .env` }); continue; }
    let url;
    try { url = new URL(raw); } catch { out.push({ level: 'error', message: `${name} is not a URL` }); continue; }
    const loopback = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(url.hostname);
    if (url.username || url.password) out.push({ level: 'error', message: `${name} has a user name or password in it` });
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) out.push({ level: 'error', message: `${name} must be an https address (a key would cross the network in clear)` });
    if (origin && url.origin !== origin) out.push({ level: 'error', message: `${name} points at ${url.origin}, not the gateway ${origin}, and the checks send the keys there: run npm run setup -- --apply to set it, or check only the model calls with --path a` });
  }
  return out;
}

/** Names of variables set in the shell to a value that differs from .env: tsx --env-file lets the shell win when the lab runs. */
export const shellOverrides = (env, processEnv, names) => names.filter((n) => processEnv[n] && env[n] && processEnv[n] !== env[n]);

// ---------------------------------------------------------------------------------------------- the console checklist
export function checklist(settings) {
  const s = { workerApp: DEFAULT_APPS.worker, mcpApp: DEFAULT_APPS.mcp, provider: 'anthropic', mainModel: '<a model the main key allows>', workerModel: '<a different model the worker key allows>', path: 'b', ...Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== undefined)) };
  const L = [];
  L.push('Console checklist (you do these by hand in the Privilege console; the guide, docs/PRIVILEGE-SETUP.md, has the screens and the why):');
  L.push('');
  if (s.path === 'b') {
    L.push('Step 3  Register two apps, on the gateway cluster your administrator named');
    L.push(`          1. ${s.workerApp}   type Remote Agent   backend http://${s.workerApp}.<namespace>.svc.cluster.local   entry path /a2a   auth mode None`);
    L.push('             then turn on "Discover A2A agent card" once the worker is running');
    L.push(`          2. ${s.mcpApp}   type MCP   backend http://${s.mcpApp}.<namespace>.svc.cluster.local   entry path /mcp   auth mode None`);
    L.push('             save it again once the MCP server is up, so its tools are discovered');
    L.push('');
  }
  L.push(`Step 4  Worker key   scopes: ${s.path === 'b' ? 'llm, mcp' : 'llm'}   provider: ${s.provider}   allowed model: ${s.workerModel} (exactly one)`);
  if (s.path === 'b') L.push(`          apps: ${s.mcpApp}   tools to allow, by name: ${CORE_TOOLS.join(', ')}`);
  L.push(`Step 5  Main key     scopes: ${s.path === 'b' ? 'llm, a2a' : 'llm'}   provider: ${s.provider}   allowed model: ${s.mainModel} (a different one from the worker)`);
  if (s.path === 'b') L.push(`          Remote Agents: ${s.workerApp}`);
  if (s.path === 'b') {
    L.push('Step 6  AI Guard on the worker key: set it to BLOCK if you want the "blocked" demo to be refused (defaults alert only)');
  }
  L.push('');
  L.push('Give each key a custodian who will stay: if their account goes inactive, the key stops working.');
  L.push('Copy each key when the wizard shows it, then run:  npm run setup -- --apply   (the keys are asked for without echo, or read from MAIN_AGENT_KEY / WORKER_AGENT_KEY in your shell).');
  return L.join('\n');
}

// ---------------------------------------------------------------------------------------------- verify
/** Replaces every secret and any Bearer token in a piece of text. */
export function scrub(text, secrets = []) {
  let out = String(text ?? '');
  for (const secret of secrets) if (secret && secret.length >= 8) out = out.split(secret).join('[key]');
  return out.replace(/Bearer\s+\S+/gi, 'Bearer [key]').replace(/(x-goog-api-key|x-api-key)\s*[:=]\s*\S+/gi, '$1: [key]');
}

const excerpt = (text, secrets) => scrub(String(text).replace(/\s+/g, ' ').trim(), secrets).slice(0, 120);

function describeNetworkError(error, secrets) {
  const code = error?.cause?.code ?? error?.code ?? '';
  const name = error?.name ?? '';
  if (name === 'TimeoutError' || name === 'AbortError') return { reason: 'no answer within the time limit (is the gateway reachable from this machine?)', retry: true };
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) return { reason: `the gateway's certificate is not trusted by this machine (${code}); for a local gateway set LOCAL_GATEWAY_CA`, retry: false };
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { reason: 'the gateway host name did not resolve (check the host in the URL)', retry: false };
  if (code === 'ECONNREFUSED') return { reason: 'connection refused (nothing is listening at that address)', retry: true };
  return { reason: `could not connect: ${excerpt(error?.cause?.message ?? error?.message ?? 'unknown error', secrets)}`, retry: true };
}

/** One HTTP exchange. Never throws; returns { status, text, headers } or { error: { reason, retry } }. */
async function exchange(fetchImpl, url, init, secrets, timeoutMs) {
  try {
    const res = await fetchImpl(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    return { status: res.status, text, headers: res.headers };
  } catch (error) {
    return { error: describeNetworkError(error, secrets) };
  }
}

const json = (text) => { try { return JSON.parse(text); } catch { return undefined; } };

/** The reply to one request in a streamable-HTTP MCP answer: plain JSON, or the `data:` event whose id matches (events for other ids, such as notifications, are skipped). */
function mcpBody(text, id) {
  const direct = json(text);
  if (direct !== undefined) return Array.isArray(direct) ? direct.find((m) => m?.id === id) : direct;
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
    const parsed = data ? json(data) : undefined;
    if (parsed !== undefined && parsed?.id === id) return parsed;
  }
  return undefined;
}

const statusAdvice = (status, text = '') => (status === 401 || status === 403) && /scope/i.test(text)
  ? 'the key is missing a scope for this route (llm for models, mcp for tools, a2a for agents: Steps 4 and 5); change it in the console, then wait for the change to reach the gateway'
  : STATUS_ADVICE(status);

const STATUS_ADVICE = (status) => ({
  401: 'the gateway does not know this key (typo, doubled, revoked or expired)',
  403: 'refused: the app is not selected on the key (Steps 4 and 5), or the scope is missing; wait for the change to reach the gateway (about four minutes) and read the gateway log',
  404: 'no such route: check the gateway host and the app name',
  429: 'a rate or budget cap was hit: wait, or raise the cap',
  400: 'the request was rejected (a wrong model ID, or AI Guard blocked it)',
})[status] ?? (status >= 500 ? 'the gateway or the backend failed: try again, then check the gateway log' : `unexpected status ${status}`);

const retryable = (status) => [401, 403, 404, 502, 503, 504].includes(status) || status === 500;

function modelRequest(provider, base, model, key) {
  if (provider === 'google') {
    return { url: `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: { contents: [{ role: 'user', parts: [{ text: 'Reply with OK.' }] }], generationConfig: { maxOutputTokens: 8 } }, ok: (b) => Array.isArray(b?.candidates) };
  }
  return { url: `${base}/v1/messages`, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'anthropic-version': '2023-06-01' }, body: { model, max_tokens: 8, messages: [{ role: 'user', content: 'Reply with OK.' }] }, ok: (b) => Array.isArray(b?.content) };
}

/** The checks, as small functions that return { ok, status?, reason, retry? }. `ctx` carries the env, a fetch and the secrets to scrub. */
function buildChecks(ctx) {
  const { env, settings, fetchImpl, secrets, timeoutMs, canary } = ctx;
  const provider = settings.provider;
  const base = (env[baseVar(provider)] ?? '').replace(/\/+$/, '');
  const mainKey = env[keyVar(provider, 'MAIN_AGENT')];
  const workerKey = env[keyVar(provider, 'WORKER_AGENT')];
  const missing = (what) => ({ ok: false, reason: `${what} is not set in .env${/_KEY$/.test(what) ? ' (--verify needs each agent key in this .env; add it, or check only what you can)' : ''}`, retry: false });

  const model = (label, model, key) => async () => {
    if (!base) return missing(baseVar(provider));
    if (!key) return missing(keyVar(provider, label === 'worker' ? 'WORKER_AGENT' : 'MAIN_AGENT'));
    if (!model) return missing(`the ${label} model`);
    const req = modelRequest(provider, base, model, key);
    const r = await exchange(fetchImpl, req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body) }, secrets, timeoutMs);
    if (r.error) return { ok: false, ...r.error };
    if (r.status !== 200) return { ok: false, status: r.status, reason: `${statusAdvice(r.status, r.text)}${r.text ? ` (${excerpt(r.text, secrets)})` : ''}`, retry: retryable(r.status) };
    const body = json(r.text);
    if (r.text.trim() === '') return { ok: false, status: 200, reason: 'an empty body with status 200: a gateway node with stale routing; ask the gateway administrator to restart it', retry: true };
    if (body?.error || body?.type === 'error') return { ok: false, status: 200, reason: `status 200 but the body is an error (${excerpt(r.text, secrets)})`, retry: false };
    if (!req.ok(body)) return { ok: false, status: 200, reason: `status 200 but the body is not a ${provider} reply (${excerpt(r.text, secrets)})`, retry: false };
    return { ok: true, status: 200, reason: 'the model answered' };
  };

  const unknownKey = async () => {
    if (!base) return missing(baseVar(provider));
    if (!settings.workerModel && !settings.mainModel) return missing('a model');
    const req = modelRequest(provider, base, settings.workerModel || settings.mainModel, canary);
    const r = await exchange(fetchImpl, req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body) }, secrets, timeoutMs);
    if (r.error) return { ok: false, ...r.error };
    if (r.status === 401) return { ok: true, status: 401, reason: 'a made-up key is refused' };
    return { ok: false, status: r.status, reason: `a made-up key got ${r.status}, not 401: the gateway is not refusing unknown keys here`, retry: r.status >= 500 };
  };

  const rpc = (id, method, params) => ({ jsonrpc: '2.0', id, method, params });
  const mcpHeaders = (key, session) => ({ 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${key}`, 'MCP-Protocol-Version': '2025-06-18', ...(session ? { 'Mcp-Session-Id': session } : {}) });
  const initBody = JSON.stringify(rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'setup-verify', version: '1.0.0' } }));

  const mcpTools = async () => {
    const url = env.MCP_URL;
    if (!url) return missing('MCP_URL');
    if (!workerKey) return missing(keyVar(provider, 'WORKER_AGENT'));
    const init = await exchange(fetchImpl, url, { method: 'POST', headers: mcpHeaders(workerKey), body: initBody }, secrets, timeoutMs);
    if (init.error) return { ok: false, ...init.error };
    if (init.status !== 200) return { ok: false, status: init.status, reason: `the MCP session did not start: ${statusAdvice(init.status, init.text)}`, retry: retryable(init.status) };
    const session = init.headers.get('mcp-session-id') ?? undefined;
    if (mcpBody(init.text, 1)?.error) return { ok: false, status: 200, reason: `the MCP initialize returned an error (${excerpt(init.text, secrets)})`, retry: false };
    await exchange(fetchImpl, url, { method: 'POST', headers: mcpHeaders(workerKey, session), body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }, secrets, timeoutMs);
    const list = await exchange(fetchImpl, url, { method: 'POST', headers: mcpHeaders(workerKey, session), body: JSON.stringify(rpc(2, 'tools/list', {})) }, secrets, timeoutMs);
    if (list.error) return { ok: false, ...list.error };
    if (list.status !== 200) return { ok: false, status: list.status, reason: `tools/list failed: ${statusAdvice(list.status, list.text)}`, retry: retryable(list.status) };
    const body = mcpBody(list.text, 2);
    if (!body) return { ok: false, status: 200, reason: 'tools/list answered 200 with an empty or unreadable body (a stale gateway node, or the MCP app has not been re-saved)', retry: true };
    if (body.error) return { ok: false, status: 200, reason: `tools/list returned an error (${excerpt(JSON.stringify(body.error), secrets)})`, retry: false };
    const names = (body.result?.tools ?? []).map((t) => t.name);
    const missingTools = CORE_TOOLS.filter((t) => !names.includes(t));
    if (!names.length) return { ok: false, status: 200, reason: 'the tool list is empty: save the MCP app again once its backend is up, and allow each tool under Configure Tools (Step 4)', retry: true };
    if (missingTools.length) return { ok: false, status: 200, reason: `these tools are not allowed on the worker key: ${missingTools.join(', ')} (Step 4, Configure Tools)`, retry: true };
    return { ok: true, status: 200, reason: `${names.length} tools: ${names.join(', ')}` };
  };

  const scopeRefused = async () => {
    const url = env.MCP_URL;
    if (!url) return missing('MCP_URL');
    if (!mainKey) return missing(keyVar(provider, 'MAIN_AGENT'));
    const r = await exchange(fetchImpl, url, { method: 'POST', headers: mcpHeaders(mainKey), body: initBody }, secrets, timeoutMs);
    if (r.error) return { ok: false, ...r.error };
    if ((r.status === 401 || r.status === 403) && /scope/i.test(r.text)) return { ok: true, status: r.status, reason: 'the main key is refused on the tool route for lack of the mcp scope' };
    if (r.status === 401 || r.status === 403) return { ok: false, status: r.status, reason: `refused (${r.status}) but not with a scope message: the app may not be registered yet, or the gateway has not picked it up`, retry: true };
    return { ok: false, status: r.status, reason: r.status === 200 ? 'the main key can use the tool route, so it has the mcp scope: the main key should hold only llm and a2a (Step 5), so remove mcp from it' : `the main key got ${r.status} on the tool route; it should be refused (Step 5: scopes llm and a2a only)`, retry: r.status >= 500 };
  };

  const a2a = async () => {
    const url = env.WORKER_A2A_URL;
    if (!url) return missing('WORKER_A2A_URL');
    if (!mainKey) return missing(keyVar(provider, 'MAIN_AGENT'));
    const body = { jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { role: 'user', messageId: 'setup-verify', parts: [{ kind: 'text', text: 'Hello' }] } } };
    const r = await exchange(fetchImpl, `${url.replace(/\/+$/, '')}/jsonrpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mainKey}` }, body: JSON.stringify(body) }, secrets, timeoutMs);
    if (r.error) return { ok: false, ...r.error };
    if (r.status !== 200) return { ok: false, status: r.status, reason: `${statusAdvice(r.status, r.text)}${r.status === 403 ? ' (is the worker selected under Remote Agents on the main key?)' : ''}`, retry: retryable(r.status) };
    if (r.text.trim() === '') return { ok: false, status: 200, reason: 'an empty body with status 200: a gateway node with stale routing; ask the gateway administrator to restart it', retry: true };
    const parsed = json(r.text);
    if (parsed?.error) return { ok: false, status: 200, reason: `status 200 but the reply is a JSON-RPC error (${excerpt(JSON.stringify(parsed.error), secrets)})`, retry: false };
    if (!parsed?.result) return { ok: false, status: 200, reason: 'status 200 but the reply has no result', retry: false };
    return { ok: true, status: 200, reason: 'the worker answered' };
  };

  return [
    { id: 'worker-model', label: 'Worker key reaches its model', path: 'ab', run: model('worker', settings.workerModel, workerKey) },
    { id: 'main-model', label: 'Main key reaches its model', path: 'ab', run: model('main', settings.mainModel, mainKey) },
    { id: 'unknown-key', label: 'An unknown key is refused', path: 'ab', run: unknownKey },
    { id: 'mcp-tools', label: "Worker's tools are discovered", path: 'b', run: mcpTools },
    { id: 'scope-refused', label: 'A missing scope is refused', path: 'b', run: scopeRefused },
    { id: 'a2a', label: 'Main key reaches the worker', path: 'b', run: a2a },
  ];
}

/**
 * Runs the verify checks against the URLs and keys in an .env map. Returns [{ id, label, path, ok, status, reason, attempts }].
 * waitMinutes > 0 retries a failing check, with a growing pause, until that time is up; only for causes that can clear on their own.
 * opts: { path: 'a' | 'b', waitMinutes, fetchImpl, sleep, now, timeoutMs, onResult }
 */
export async function runVerify(env, opts = {}) {
  const { path = 'b', waitMinutes = 0, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(), timeoutMs = 20000, onResult, onWait } = opts;
  const settings = settingsFromEnv(env);
  const provider = settings.provider;
  if (!PROVIDERS.includes(provider)) throw new Error(`the provider "${provider || '(not set)'}" is not supported by npm run setup`);
  const unsafe = [...validate(settings, {}, env), ...validateUrls(env, settings.origin, path)].filter((p) => p.level === 'error');
  if (unsafe.length) throw new Error(`not sending any key: ${unsafe.map((p) => p.message).join('; ')}`);
  const secrets = [env[keyVar(provider, 'MAIN_AGENT')], env[keyVar(provider, 'WORKER_AGENT')], env.AWS_AGENT_PF_CLIENT_SECRET, env.A2A_BFF_SHARED_SECRET].filter(Boolean);
  const canary = `not-a-real-key-${Array.from({ length: 24 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('')}`;
  secrets.push(canary);
  const checks = buildChecks({ env, settings, fetchImpl, secrets, timeoutMs, canary }).filter((c) => c.path.includes(path));
  const deadline = now() + waitMinutes * 60000;
  const results = [];
  for (const check of checks) {
    let attempts = 0;
    let pause = 15000;
    let r;
    for (;;) {
      attempts += 1;
      r = await check.run();
      if (r.ok || !r.retry || now() + pause > deadline) break;
      onWait?.(check, r, pause);
      await sleep(pause);
      pause = Math.min(pause * 2, 60000);
    }
    const result = { id: check.id, label: check.label, path: check.path, ok: Boolean(r.ok), status: r.status, reason: scrub(r.reason, secrets), attempts };
    results.push(result);
    onResult?.(result);
  }
  return results;
}
