# Setup script V1 spec

**Status:** built (after an independent review: 29 findings confirmed and fixed)   **Owner:** the lab owner (go given in chat 2026-11-25: "start P1 scripting"; read as V1 of the survey's plan)

## Goal
A newcomer who has made the Privilege objects in the console (the guide's Steps 1 to 6) runs one command to write the lab's `.env` safely, get the exact console checklist, and then prove with `--verify` that Privilege is set up, instead of finding out by a refusal. It never creates Privilege objects, never needs console credentials, and never prints a key.

## What it is (and is not)
- `npm run setup` (`scripts/setup.mjs`, Node built-ins only, no new dependency).
- **Plan mode is the default** and writes nothing. `--apply` writes `.env`. `--verify` makes real model and agent calls through the gateway: it changes nothing in `.env` or Privilege, but it spends a few tokens and leaves records in the gateway log. Console checklist is printed in plan mode and with `--checklist`.
- Not in V1: creating apps, keys or grants through the console API (needs a proving run on an empty tenant); the PingFederate setup; the AWS runtime; rotating or deleting anything; Groq and llama.cpp (the lab reads a separate `*_GROQ_KEY` for the model call and `<agent>_KEY` for the A2A and MCP legs, so one key per agent does not describe them: Anthropic and Google only, the rest by hand).

## Acceptance criteria (each one a runnable check)
1. `node scripts/setup.mjs` with no `.env` and no flags prints a plan and the checklist, exits 0, and creates no file.
2. `--apply` with a gateway, provider, models and two keys (from the hidden prompt or the env vars `MAIN_AGENT_KEY` / `WORKER_AGENT_KEY`) writes `.env` with mode 600, copied from `config.example` when absent, changing only the named lines (comments, order and unknown lines kept); an existing `.env` is backed up first to `.env.bak-<timestamp>` (also ignored by git); a second identical run reports "no changes" and writes nothing.
3. A key is never printed, logged or put in an error: output shows only `set (N characters)` or `unchanged`. A test runs the whole tool against a fake gateway with a canary key and asserts the canary is absent from stdout, stderr and the backup name.
4. `--verify` runs these checks against the URLs in `.env` and prints PASS or FAIL for each, with the HTTP status and a short reason, and exits 1 if any FAIL: worker key model call `200`; main key model call `200`; unknown key `401`; (Path B) MCP session `initialize` then `tools/list` with the worker key returns the tools the checklist names; (Path B) main key on the MCP route refused with a "not scoped" message (`403` or `401`: a real gateway answered a missing `llm` scope with `401`); (Path B) A2A `message/send` with the main key returns `200` with a `result` and no `error`.
5. `--verify --wait <minutes>` retries a failing check with a bounded back-off up to that long (the gateway takes about four minutes, up to six, to pick up changes) and says so; without it, one pass.
6. A `200` that carries an empty body or a JSON-RPC `error` is a FAIL, not a PASS.
7. Before any key is sent: every URL the checks call (`MCP_URL`, `WORKER_A2A_URL`, and the AWS and trace URLs when set) must be https (loopback http excepted), carry no user name or password, and be on the gateway's own origin, so a stale host, a typo or a pasted `.env` cannot send a live key to a third party; the library refuses and makes zero calls. The all-or-none PingFederate triple, a doubled key, a key with whitespace or under 20 characters, a provider other than anthropic or google, or one that differs between the two agents, a key or value containing `#` or a quote (the `.env` loader would misread it), a non-https gateway (loopback excepted), a model left blank when a gateway is set, and a `.env` that is not mode 600 are each reported before any network call.
8. The checklist's app names, paths, scopes and tool names match the repo: a test compares them with `k8s/deployment.yaml`, `config.example` and the tools registered in `src/mcp-server/index.ts`.
9. `docs/PRIVILEGE-SETUP.md` (section 7 and Step 9) names the command, its three modes and what it does not do; the styled page is rebuilt (`npm run build:guide`); README and CLAUDE.md point to it.

## Unhappy paths (each needs a check)
- No `.env`, a read-only folder, a `.env` that is a symlink (refuse), or a half-written file: nothing partial is left (write to a temp file, fsync, rename; the backup is made before the rename).
- No terminal (CI, a pipe): never prompts; a missing key is reported and the line is left unchanged.
- Ctrl-C at a prompt: nothing written, terminal echo restored.
- Gateway down, DNS failure, TLS certificate not trusted (a local mkcert gateway), slow, or redirecting: FAIL with the reason and the setting to check (`LOCAL_GATEWAY_CA`), each call bounded by a timeout; never hangs.
- `401` (key), `403` (scope or app not selected: points to Step 4/5 and the four-minute wait), `404` (route), `429` (cap), `400` blocked by AI Guard: each has its own plain message.
- Response bodies are never echoed beyond a short, key-scrubbed excerpt.
- Re-running after a partial apply is safe (idempotent by line); a name that appears twice in `.env` is updated everywhere (the loader takes the last one).
- `.env` is parsed with Node's own parser (`util.parseEnv`), so the tool and the lab read the same values; a key exported in the shell wins over `.env` when the lab runs, and `--verify` warns when the two differ.
- An unknown option is reported by name only: a key typed as an option is never echoed.

## Out of scope
Everything under "Not in V1" above; changing `doctor` (it keeps its own scope and still passes with nothing configured; the guide says so).

## Protected / must not break
Mock mode with no `.env` (the lab starts offline); `config.example` stays the source of the variable names (a test already ties the guide to it); the lab never reads a provider's real key; no key, tenant id or internal host in any shipped file.

## Rule 14 (credentials)
The agent keys are credentials. The tool never stores them anywhere except `.env` (mode 600) and prints a closing reminder to save them in the team's password manager, with a suggested item name and where the value lives, never the value.

## Verification plan
`npm test` on the Air with the new tests (unit tests for the `.env` writer, the validators and the checklist drift; an integration run against a fake gateway that serves 200, 401, 403, 429, empty-body 200, JSON-RPC error, a delayed grant and an unreachable port); a real run of `--apply` and plan mode on a scratch copy; an independent review of the diff; owner says "merge N". No deploy.
