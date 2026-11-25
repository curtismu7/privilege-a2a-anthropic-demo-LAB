#!/usr/bin/env node
// npm run setup: write the lab's .env safely, print the Privilege console checklist, and prove with --verify that Privilege is set up.
// Plan mode (no flags) writes nothing. Spec: docs/specs/2026-11-25-setup-script-v1.md. It never prints a key and never creates a Privilege object.
import { chmodSync, closeSync, copyFileSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { DEFAULT_APPS, PROVIDERS, checklist, describeChange, envMap, envUpdates, isSecretName, mergeEnv, normaliseGateway, parseArgs, runVerify, settingsFromEnv, shellOverrides, validate, validateUrls } from './setup-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `Usage: npm run setup -- [options]

  (no options)         Plan: show what would be written and the console checklist. Writes nothing.
  --apply              Write .env (mode 600). An existing .env is backed up first. Asks for the two agent keys without echo.
  --verify             Check that Privilege is set up: model calls, unknown key, tool list, scope refusal, A2A. Changes nothing in .env or
                       Privilege, but it does make real model and agent calls (a few tokens, and records in the gateway log).
  --checklist          Print only the console checklist.

  --gateway <host>     The Privilege AI gateway host, for example gateway.example
  --provider <name>    anthropic (default) or google (Groq and llama.cpp: set by hand, see the guide)
  --main-model <id>    Exactly a model the main key allows        --worker-model <id>   Same, for the worker key
  --worker-app <name>  default ${DEFAULT_APPS.worker}               --mcp-app <name>      default ${DEFAULT_APPS.mcp}
  --aws-app <name>     The Remote Agent app that fronts your AWS agent (optional)
  --path a|b           a = model calls only; b = the full four hops (default). Use --path a on EVERY command if you run Path A:
                       path b also points WORKER_A2A_URL, WORKER_TRACE_URL and MCP_URL at the gateway.
  --wait <minutes>     With --verify: keep retrying checks that can clear on their own, up to this long IN TOTAL across all checks
                       (the gateway takes about 4, up to 6, minutes to pick up a change)
  --file <path>        Another .env file (default: .env in this folder)
  --no-prompt          Never ask; use only flags, the shell and the existing .env
  --help               This text

Keys: read from MAIN_AGENT_KEY and WORKER_AGENT_KEY in your shell, or typed at a hidden prompt with --apply. Never passed as an option, never printed.
Guide: docs/PRIVILEGE-SETUP.md`;

const out = (s = '') => process.stdout.write(`${s}\n`);
const fail = (message, code = 2) => { process.stderr.write(`setup: ${message}\n`); process.exit(code); };

function ask(question, { hidden = false, fallback = '' } = {}) {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    const write = rl._writeToOutput.bind(rl);
    rl._writeToOutput = (s) => { if (!muted) write(s); };
    rl.on('SIGINT', () => { rl.close(); process.stdout.write('\n'); reject(new Error('cancelled: nothing was written')); });
    rl.question(question, (answer) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer.trim() || fallback); });
    muted = hidden;
  });
}

function writeEnvAtomically(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  const fd = openSync(tmp, 'w', 0o600);
  try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  chmodSync(file, 0o600);
}

async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { fail(e.message); }
  if (opts.help) { out(HELP); return; }

  const envFile = opts.file ?? join(root, '.env');
  let existing = null;
  if (existsSync(envFile) || (() => { try { lstatSync(envFile); return true; } catch { return false; } })()) {
    if (lstatSync(envFile).isSymbolicLink()) fail(`${envFile} is a symbolic link: refusing to read or write through it`);
    existing = readFileSync(envFile, 'utf8');
  }
  const current = envMap(existing ?? '');
  const fromFile = settingsFromEnv(current);

  const interactive = process.stdin.isTTY && process.stdout.isTTY && !opts.noPrompt;
  const settings = {
    provider: (opts.provider ?? (fromFile.provider || 'anthropic')).toLowerCase(),
    origin: undefined,
    mainModel: opts.mainModel ?? fromFile.mainModel,
    workerModel: opts.workerModel ?? fromFile.workerModel,
    workerApp: opts.workerApp ?? fromFile.workerApp ?? DEFAULT_APPS.worker,
    mcpApp: opts.mcpApp ?? fromFile.mcpApp ?? DEFAULT_APPS.mcp,
    awsApp: opts.awsApp ?? fromFile.awsApp,
    path: opts.path,
  };

  // --checklist and plan mode need no inputs; --verify reads everything from the .env.
  if (opts.checklist) { out(checklist(settings)); return; }

  if (opts.verify && !opts.apply) {
    if (existing === null) fail(`${envFile} does not exist: run npm run setup -- --apply first`);
    await verify(current, settings, opts, envFile);
    return;
  }

  let gatewayInput = opts.gateway ?? fromFile.origin;
  if (opts.apply && interactive) {
    gatewayInput ||= await ask('Gateway host (for example gateway.example): ');
    settings.mainModel ||= await ask('Model the MAIN key allows (exact ID): ');
    settings.workerModel ||= await ask('Model the WORKER key allows (exact ID, a different one): ');
  }
  if (gatewayInput) {
    const g = normaliseGateway(gatewayInput);
    if (g.error) fail(g.error);
    settings.origin = g.origin;
  }

  const keys = { main: process.env.MAIN_AGENT_KEY?.trim() || undefined, worker: process.env.WORKER_AGENT_KEY?.trim() || undefined };
  if (opts.apply && interactive) {
    try {
      keys.main ||= (await ask('Main agent key (hidden; Enter to leave it unchanged): ', { hidden: true })) || undefined;
      keys.worker ||= (await ask('Worker key (hidden; Enter to leave it unchanged): ', { hidden: true })) || undefined;
    } catch (e) { fail(e.message, 130); }
  }

  const problems = validate(settings, keys, current);
  for (const p of problems) process.stderr.write(`${p.level === 'error' ? 'ERROR' : 'warning'}: ${p.message}\n`);
  if (problems.some((p) => p.level === 'error')) fail('nothing was written: fix the errors above and run it again', 2);

  if (!settings.origin) {
    out(opts.apply ? 'No gateway host given, so there is nothing to write.' : 'Plan: no gateway host yet. Re-run with --gateway <host> (and the model IDs) to see the lines it would write.');
    out('');
    out(checklist(settings));
    if (opts.apply) process.exit(2);
    return;
  }

  const updates = envUpdates(settings, keys);
  const baseText = existing ?? readFileSync(join(root, 'config.example'), 'utf8');
  const merged = mergeEnv(baseText, updates);
  const changed = merged.changes.filter((c) => c.action !== 'unchanged').length;

  out(`${opts.apply ? 'Writing' : 'Plan for'} ${envFile}${existing === null ? ' (new, copied from config.example)' : ''}, path ${settings.path.toUpperCase()}${settings.path === 'b' ? ' (the full four hops: also points the worker, trace and MCP URLs at the gateway; use --path a for model calls only)' : ' (model calls only: the worker, trace and MCP URLs are left alone)'}:`);
  for (const c of merged.changes) out(describeChange(c, updates[c.name]));
  if (!keys.main || !keys.worker) out(`  (no ${[!keys.main && 'main', !keys.worker && 'worker'].filter(Boolean).join(' or ')} key given: that line is left as it is)`);

  if (!opts.apply) {
    out('');
    out(`${changed} line(s) would change. Nothing was written. Add --apply to write them.`);
    out('');
    out(checklist(settings));
    return;
  }

  if (changed === 0 && existing !== null) {
    out('No changes: .env already has these values.');
  } else {
    if (existing !== null) {
      const backup = `${envFile}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      copyFileSync(envFile, backup);
      chmodSync(backup, 0o600);
      out(`Backed up the old file to ${backup}`);
    }
    writeEnvAtomically(envFile, merged.text);
    out(`Wrote ${envFile} (mode 600, ${changed} line(s) changed).`);
  }

  const wroteKeys = Object.keys(updates).filter((n) => isSecretName(n) && merged.changes.find((c) => c.name === n && c.action === 'set'));
  if (wroteKeys.length) {
    out('');
    out('Save these keys in your password manager now (they are credentials): one item per key, for example');
    out('  "Privilege A2A lab - main agent key (<custodian>)" and "Privilege A2A lab - worker key (<custodian>)",');
    out(`  with the gateway host and "value is in ${envFile}" in the note. The tool never prints a key and cannot read your vault.`);
  }

  if (opts.verify) {
    out('');
    await verify(envMap(readFileSync(envFile, 'utf8')), settings, opts, envFile);
  }
}

async function verify(env, settings, opts, envFile) {
  const mode = lstatSync(envFile).mode & 0o777;
  if (mode !== 0o600) process.stderr.write(`warning: ${envFile} is mode ${mode.toString(8)}; run chmod 600 on it (it holds keys)\n`);
  const fromEnv = settingsFromEnv(env);
  const problems = [...validate(fromEnv, {}, env), ...validateUrls(env, fromEnv.origin, opts.path)];
  for (const p of problems) process.stderr.write(`${p.level === 'error' ? 'ERROR' : 'warning'}: ${p.message}\n`);
  if (problems.some((p) => p.level === 'error')) fail('not calling the gateway, and sending no key, until the errors above are fixed', 2);
  const overridden = shellOverrides(env, process.env, ['MAIN_AGENT_KEY', 'WORKER_AGENT_KEY', 'ANTHROPIC_AUTH_TOKEN']);
  if (overridden.length) process.stderr.write(`warning: your shell sets ${overridden.join(', ')} to a different value than .env; when the lab runs, the shell value wins (tsx --env-file does not override it). These checks use the .env value.\n`);
  if (!fromEnv.origin) fail('no gateway is set in .env (ANTHROPIC_BASE_URL, GEMINI_BASE_URL or GROQ_BASE_URL): run --apply first');
  out(`Verifying through ${fromEnv.origin} (path ${opts.path.toUpperCase()}${opts.wait ? `, waiting up to ${opts.wait} min for changes to reach the gateway` : ''}):`);
  const results = await runVerify(env, {
    path: opts.path,
    waitMinutes: opts.wait,
    onWait: (check, r, pause) => out(`  ... ${check.label}: not yet (${r.status ?? 'no answer'}); trying again in ${Math.round(pause / 1000)} s`),
    onResult: (r) => out(`${r.ok ? 'PASS' : 'FAIL'}  ${r.label}${r.status ? `  [${r.status}]` : ''}  ${r.reason}${r.attempts > 1 ? `  (${r.attempts} tries)` : ''}`),
  });
  const failed = results.filter((r) => !r.ok);
  out('');
  out(failed.length ? `${failed.length} of ${results.length} checks failed. The guide's refusal table (section "Troubleshooting") explains each status.` : `All ${results.length} checks passed.`);
  if (opts.path === 'a') out('Path A checks only: the worker, tool and A2A checks need the full four hops (--path b).');
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => fail(e.message, 1));
