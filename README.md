# Privilege A2A Anthropic Demo LAB

Tier: Demo

Repo: https://github.com/curtismu7/privilege-a2a-anthropic-demo-LAB


Three Node processes demonstrate A2A with remote agents (an access review is the worked example) through A2A and MCP, on
Anthropic or Google models. The page is titled "A2A with remote agents". The main agent owns the browser conversation and delegates to the worker.
The worker owns the access-review tools and calls the separate MCP process.

```text
browser page (served by the main agent) ──SSE──▶ main agent :6881
                                                   ├──A2A JSON-RPC──▶ worker :6882
                                                   └──Anthropic Messages API──▶ Privilege
                                                          worker ├──Anthropic Messages API──▶ Privilege
                                                                 └──MCP Streamable HTTP──▶ MCP :6883
```

The A2A boundary carries the analyst's question and result, with a fresh random
context ID for each chat turn so concurrent worker traces stay isolated. The
main agent uses the opaque browser session ID only for its in-memory
conversation history. Neither ID represents an authenticated user. The A2A
boundary does not carry a browser token, user `sub`, `act`, or an RFC 8693 token
exchange. Privilege validates each Agent Access key and applies its configured
policies.

## Run from a clone

Prerequisites: Node 26. Docker (OrbStack) only for the Docker form.

```
git clone https://github.com/curtismu7/privilege-a2a-anthropic-demo-LAB.git
cd privilege-a2a-anthropic-demo-LAB
npm ci
npm run build
npm run doctor
npm start
```

## Ports, and what to do if the port is taken

```
Ports: privilege-a2a-anthropic-demo-LAB listens on 6881 (set with PORT, default 6881).
Port range for this app: 6880-6889.

If the port is taken:
1. Find what is using it:
   lsof -iTCP:6881 -sTCP:LISTEN -n -P
2. If it is an old copy of this app, stop that process: kill <PID>.
3. If it is something else, stop it, or start this app on another port:
   PORT=<other port> npm start
```

Other variable: `None` (Docker host port). Keep both inside 6880-6889.

## How it works through the gateway

In gateway mode every hop goes through the PingOne Agent Privilege, and
each agent presents only its own agent key:

```text
main agent ──① A2A message/send (main key) ──▶ gateway ──▶ worker agent
main agent ──② model call (main key) ────────▶ gateway ──▶ model provider
worker     ──③ model call (worker key) ──────▶ gateway ──▶ model provider
worker     ──④ MCP tools/call (worker key) ──▶ gateway ──▶ MCP server
```

What the gateway does on each leg:

| Leg | Checks | What it can refuse or change |
|---|---|---|
| ① A2A | key, `a2a` scope, policy for the remote agent, guardrail | an ungranted agent (`403`), a prompt-injection message (`400`) |
| ②③ model | key, `llm` scope, allowed model, limits | a model outside the key's list (`403`); swaps in the real provider key |
| ④ MCP | key, `mcp` scope, per-tool grant, guardrail | an ungranted tool (`403`); redacts personal data in a result; blocks a result that carries hidden instructions |

The three-deep chain (`POST /chain`) adds a middle agent: main agent → gateway →
LangChain agent → gateway → specialist. The middle agent calls with its own key,
so its hop is checked on its own.

## Custodian to AWS agent (tab)

The second tab shows one agent reaching another that runs in AWS, and who is accountable along the way:

```text
custodian ──owns──▶ main agent ──A2A message/send (main key)──▶ Privilege gateway ──▶ AWS agent (Bedrock AgentCore)
```

This app never talks to AWS. It calls a Privilege gateway route (a Remote Agent app that fronts the runtime) with the main
agent's own key, so the gateway checks the key, the `a2a` scope and the remote-agent grant (which follows the custodian), then
forwards to the runtime with its own credential. The tab lights up each step from the run's trace and shows what was sent
(key masked) and what came back. A refusal (HTTP 400, 401, 403, 429) is shown as refused at the gateway; this app sees only the
status, so confirm the reason in the gateway log.

- **Mock (default):** with `AWS_AGENT_A2A_URL` blank the AWS agent is a local stand-in (`npm run aws-mock`, port 6885, part of
  `npm run dev` and of the compose stack). It follows AgentCore's documented A2A contract (JSON-RPC `message/send` at the root, the
  reply in `result.artifacts[]`, the Agent Card, `GET /ping`, real HTTP statuses with a JSON-RPC error body): see
  <https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-a2a-protocol-contract.html>. The tab says it is
  simulated; no gateway and no AWS are involved.
- **Live (owner-run):** register the AWS agent in Privilege as a Remote Agent app, select it under Remote Agents on the main
  agent's key, and set `AWS_AGENT_A2A_URL=https://<gateway>/<aws-agent-app>/a2a` in your local `.env`. The call carries
  `MAIN_AGENT_KEY`. `AWS_AGENT_CUSTODIAN` is the name the tab shows for the key's custodian; it is display only (this app cannot
  read it from Privilege). The reply is the runtime's own, passed through: an A2A Task artifact, a Task status message or a plain
  Message are all read. The Agent Card is read from `<route>/.well-known/agent-card.json` on a best-effort basis: UNVERIFIED
  whether a given gateway route serves it there, and a missing card does not stop the run.
- The Remote Agent auth modes on the gateway are None, Static Token, User Token and Pass Agent Token. A runtime that only accepts
  AWS SigV4 cannot be reached through them; an OAuth (JWT) runtime can.

The route is `POST /aws-agent` (same BFF secret rule as `/chat` and `/chain`; streams `trace`, `token`, `done`/`error`).

On the AWS tab:

- **Agent Card panel.** The card step shows the card as a readable list (name, `protocolVersion`, transport, skills, capabilities, `securitySchemes`), beside the raw JSON.
- **Try a refused call.** Sends the first suggested question with a deliberately invalid credential (`REFUSAL_DEMO_CREDENTIAL`, a fixed string no gateway accepts; `POST /aws-agent` with `{"refusal": true}`). Against a live gateway the flow shows the refusal at the gateway and the AWS agent as not reached, and the trace shows the response's `WWW-Authenticate` challenge. In a simulated run the local stand-in refuses it.
- **Secrets-hub explainer.** An off-by-default checkbox that shows where a Privilege secrets hub would sit. Display only: this app does not use a hub and cannot read how the gateway gets its credential.
- **Account ids are masked.** Any 12-digit AWS account id (`?accountId=`, inside an ARN, URL-encoded or not) is replaced in the request, response and error text the page shows. The call itself still uses the real URL.
- **Banner under the shell bar.** It says SIMULATED until `/status` shows the run goes through a gateway, then says LIVE.

## The shell bar (shared top menu)

The page is one server-rendered document (`src/main-agent/ui.ts`) with a small React + Vite island for the shell bar only: the brand
on the left, and the family's shared `TopMenu` on the right (Mode Mock/Real dropdown, Shelf, Reset, Theme, Text size).

- `web/src/top-menu/` is the whole `shared/top-menu/` directory of AI-DEMO-Standalone (rule 22), vendored byte for byte and pinned by
  `top-menu.sha256` (`TopMenu.jsx`, `top-menu.css`). Never edit it here: change the canonical copy, then re-copy every file and
  regenerate the pin (`cd web/src/top-menu && shasum -a 256 TopMenu.jsx top-menu.css > top-menu.sha256`). `test/topMenuPin.test.ts`
  fails on an edited copy.
- `web/src/Shell.jsx` wires it: the mode comes from `GET /api/info` (`source`) and switches with `POST /api/mode`; a 409 (Real not
  configured) keeps the old value and shows the reason. Theme keeps `paad.theme` and `data-theme`, text size keeps `pa2a.font` and sets
  `--fs` (`html { font-size: var(--fs, 16px) }`). Shelf comes from `GET /api/shelf`. This lab has no `docs/VERSION` or docs site, so no Help
  or Version control is shown.
- The island talks to the page script with two window events: `paad:mode` (`detail.mode`) and `paad:reset`. The chat code still reads the
  mode through `window.__uiMode()`, and Reset runs the page's `resetAll`.
- `npm run build:web` builds `web/` into `dist/web`; the main agent serves it at `/web/assets/`. `npm run main` and `npm run dev`
  build it first. The Dockerfile and CI build it as part of `npm run build`.

## Set up on Privilege, in order

This is the order that worked end to end. Apps first, because an agent can only
select apps that already exist.

1. **Deploy the worker and MCP server** (`k8s/deployment.yaml`; see "Run worker
   and MCP in the cluster" below). They can also be registered before they run.
2. **Register two apps** (Agentic Apps → Add Application), on the mesh cluster of
   the gateway that serves traffic:
   - `workeragentdemo`: type **Remote Agent**, backend
     `http://workeragentdemo.<namespace>.svc.cluster.local`, path `/a2a`, Auth
     Mode None.
   - `mcpdemo`: type **MCP**, backend
     `http://mcpdemo.<namespace>.svc.cluster.local`, path `/mcp`, Auth Mode None.
3. **Create the worker's agent** (Agent Privilege → Agent Registry → Add Agent): scopes
   `llm` + `mcp`, one allowed model, MCP Servers → `mcpdemo`, then **Configure
   Tools** and allow each tool. If the tool list is empty, save the `mcpdemo` app
   again to re-run discovery now that its backend is up.
4. **Create the main agent**: scopes `llm` + `a2a`, a different allowed model,
   Remote Agents → `workeragentdemo` (and the middle agent, for the chain).
5. **Store each key where its agent runs**: the main key in `.env` as
   `MAIN_AGENT_KEY`; the worker key in the `privilege-a2a-demo` Secret. Paste a
   key once: a doubled key is refused as `invalid virtual key`.
6. **Point the main agent at the gateway** in `.env`: `WORKER_A2A_URL` and
   `WORKER_TRACE_URL` to `https://<gateway>/workeragentdemo/a2a` and `/trace`,
   the provider base URL, and `MAIN_AGENT_MODEL` to the exact model ID allowed on
   its key.
7. **Turn on Discover A2A agent card** on `workeragentdemo` once it is running.

For the three-deep chain, also:

8. Give the middle agent its own agent (scope `a2a`, the specialists selected)
   **with a different custodian** from the main agent. Remote-agent grants follow
   the custodian, so two agents under one custodian can reach each other's agents.
9. Set `CHAIN_A2A_URL` to the middle agent's gateway route.

Check it with one question that is allowed (`Review Carol Nguyen's access`) and
one that reads the poisoned record (`What access does Dave hold?`, with
`MCP_DEMO_INJECTION=true`): the second should come back as blocked, and the MCP
server's log should show no `open_ticket` call.

## Requirements and local startup

Use Node.js 26 or later. Copy `config.example` to `.env` (optional: with no `.env` the stack starts offline and
heuristics mode works), set the Privilege gateway URLs, Agent Access keys and model IDs, then install dependencies
and start all three processes:

```bash
cp config.example .env
npm ci
npm run dev
```

The lab's own page is at <http://127.0.0.1:6881>, served by the main agent; nothing else needs to run. To run the
three processes separately, use three terminals:

```bash
npm run mcp
npm run worker
npm run main
```

Docker (OrbStack): `docker compose up --build -d` starts the same three processes from one image, each published on
`127.0.0.1` only (6881, 6882, 6883). The optional `.env` beside `docker-compose.yml` is passed into all three
containers. The lab needs no other project.

### Change the local ports

Update the three port values and the local service URLs together in `.env`.
For example, to use ports `6881`, `6882`, and `6883`:

```dotenv
MAIN_AGENT_PORT=6881
WORKER_AGENT_PORT=6882
MCP_SERVER_PORT=6883
WORKER_A2A_URL=http://127.0.0.1:6882/a2a
WORKER_TRACE_URL=http://127.0.0.1:6882/trace
MCP_URL=http://127.0.0.1:6883/mcp
```

Then run `npm run dev`.

Each process reads `.env`. Local listeners bind to loopback. The MCP server
seeds fictional users, grants, and resources; `open_ticket` writes to an
in-memory store that resets when the MCP process restarts.

### Optional: a shared secret on the main agent's chat endpoints

If a trusted server-side front end of your own calls the main agent's chat endpoints instead of the built-in page,
set `A2A_BFF_SHARED_SECRET` (any random value, for example `openssl rand -hex 32`) in `.env`. The main agent then
accepts chat only from callers that send it in the `X-A2A-BFF-Secret` header. Keep it server-side; never put it in
a browser. **Leave it unset for the built-in page**, which sends no secret. The lab needs no other project to run.

## Gateway configuration

### Prepare the Privilege agents

The supplied SE Agentic Demo Setup guide assumes the shared Privilege Endpoint
Controller is already configured and that you can connect to it (including MFA
if prompted). Follow the current Admin Console labels; the guide refers to
**AI Security → Agent Registry** (called **Agent Config** in older versions).

1. Confirm an Anthropic provider key is registered in Privilege and attached to
   the `llm/anthropic` route. The provider key stays in Privilege; never paste
   it into this demo's `.env`.
2. Configure the MainAgent entry for LLM access and remote-agent access to the
   WorkerAgent app. Create or copy its Agent Access virtual key with `llm` and
   `a2a` scopes, then set it as `MAIN_AGENT_KEY`.
3. Configure the WorkerAgent entry for LLM access and the MCP app. Associate
   the MCP app with its MCP Gateway policy, create or copy its Agent Access
   virtual key with `llm` and `mcp` scopes, then set it as `WORKER_AGENT_KEY`.
   Do not edit the shared WorkerAgent or MCP policy while other SEs are using
   the demo.
4. Set each process's Anthropic model ID to one allowed by that agent's
   Privilege policy. The gateway base URL ends in `/llm/anthropic`; the Anthropic
   SDK adds `/v1/messages`.

The key split follows the four-hop flow: MainAgent key for its LLM and outbound
A2A request; WorkerAgent key for its LLM and outbound MCP request. The MCP
backend can run beside the worker in the cluster, while the MainAgent runs
on the laptop and reaches the worker through Privilege. For that layout, set
the main process's `WORKER_A2A_URL` and `WORKER_TRACE_URL` to the worker app's
gateway routes, and set the worker's `MCP_URL` to the MCP app's gateway route.
The exact URL prefixes depend on the app names in the target controller.

The provided guide describes shared per-minute rate limits and budget limits
on the MainAgent. Treat those limits as shared live policy: check the current
policy before a demo, avoid deliberate budget exhaustion, and don't change
shared policy for a local run. A denied gateway request is reported in the
chat trace; rate and budget status codes are produced by the configured
Privilege policy.

**Google or Groq instead of Anthropic.** Each agent picks its provider with
`MAIN_AGENT_PROVIDER` and `WORKER_AGENT_PROVIDER` (`anthropic` by default,
`google` or `groq`), so the two agents can sit on different providers and different
model tiers. A Google agent calls Gemini's `generateContent` API: set
`GEMINI_BASE_URL` to `https://<gateway>/llm/google` and the agent's Privilege
key is sent as `x-goog-api-key`; leave it blank to call Google directly with
`GEMINI_API_KEY`. A Privilege agent key is tied to one provider, so an agent
set to `google` needs a key created with the Google provider. The Google path
returns each reply whole rather than token by token.

**Groq.** Set an agent to `groq`. It runs one of two ways, chosen by `GROQ_BASE_URL`
(the same rule as `LLAMACPP_BASE_URL` for llama.cpp):

- **Through Privilege** (`GROQ_BASE_URL=https://<gateway>/llm/custom/v1`). The
  gateway fronts Groq through an "OpenAI-Compatible (Custom)" connection, so calls
  go to `https://<gateway>/llm/custom/v1/chat/completions` and are in its records
  and under its policy; `/status` shows "via Privilege". Put the **Privilege virtual
  key bound to the Groq connection** in `GROQ_API_KEY` (or `MAIN_AGENT_GROQ_KEY` /
  `WORKER_AGENT_GROQ_KEY`). A virtual key is bound to one connection, so this is a
  different key from a llama.cpp custom-lane key even though both use
  `/llm/custom/v1`. The model must be on that key's allow-list (for example
  `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`); any other
  model answers `403 model "<id>" not allowed for this key`. List the allowed
  models with `GET https://<gateway>/llm/custom/v1/models` and the same Bearer.
  There is no `/llm/groq` route.
- **Direct** (`GROQ_BASE_URL` blank). Calls go to `https://api.groq.com/openai/v1`
  with a Groq API key in the same env names, and **bypass the gateway**: they are
  not in its records and do not follow its policy. The A2A and MCP hops still go
  through it, and the main agent's `/status` says so. A Groq account only lists
  the models it can use, and a model it lacks answers `404 model_not_found`: check
  yours with `curl -H "Authorization: Bearer $GROQ_API_KEY" https://api.groq.com/openai/v1/models`
  (no tokens are spent).

The default model is `openai/gpt-oss-120b`; set `MAIN_AGENT_MODEL` /
`WORKER_AGENT_MODEL` to change it. Every provider has the same 30 s per-attempt
deadline with one retry (`GEMINI_TIMEOUT_MS` / `GROQ_TIMEOUT_MS`).

Set `ANTHROPIC_BASE_URL` to `https://<gateway>/llm/anthropic`. The Anthropic SDK
appends `/v1/messages`, so calls use Privilege's native
`/llm/anthropic/v1/messages` route and its Anthropic `anthropic-version` header.
In this mode, both agents send `Authorization: Bearer` with their own Agent
Access key. The app does not hold the Anthropic provider key; register that
provider key inside Privilege for the Anthropic route.

The model IDs are pinned independently for cost and policy visibility:

```bash
MAIN_AGENT_MODEL=claude-sonnet-5
WORKER_AGENT_MODEL=claude-opus-5
```

Set each to a concrete model permitted for its key in Privilege. There is no
cross-agent key fallback.

### Run worker and MCP in the cluster

Ping's reference demo runs these two on the gateway VM. Here they run as two
Deployments in the cluster instead ([k8s/deployment.yaml](k8s/deployment.yaml)),
so the gateway reaches each by its Service name rather than `localhost`.
Register both backends in PingOne Privilege, using the reference demo's names:

| App | Type | Backend URL | Entry path |
|---|---|---|---|
| `workeragentdemo` | Remote Agent | `http://workeragentdemo.<namespace>.svc.cluster.local` | `/a2a` |
| `mcpdemo` | MCP | `http://mcpdemo.<namespace>.svc.cluster.local` | `/mcp` |

Register the worker as a **Remote Agent** (Agentic Apps, Add Application), not
as an HTTP or MCP app: only Remote Agent apps appear in an agent key's Remote
Agents list, and an app registered as MCP gets an MCP `initialize` sent to its
`/a2a` path. Turn on **Discover A2A agent card** once the backend is running:
the worker serves its card at `/.well-known/agent-card.json` on the Backend
URL, and `WORKER_PUBLIC_URL` sets the address that card advertises.

Set the MCP backend's `AuthMode` to `none`. The gateway authenticates the
worker's Agent Access key before proxying the request.

Create the worker's Agent Access key with `llm` and `mcp` scopes and select
the `mcpdemo` app under the key's MCP Gateway configuration. The worker reuses
`WORKER_AGENT_KEY` for both its model call and its outbound MCP request, and
the manifest reads it from the `privilege-a2a-demo` Secret. Both of the
worker's outbound legs go back through the gateway:

```bash
GEMINI_BASE_URL=https://<gateway>/llm/google     # or ANTHROPIC_BASE_URL=https://<gateway>/llm/anthropic
MCP_URL=https://<gateway>/mcpdemo/mcp
```

Build the image for the cluster's CPU architecture, push it, create the
Secret, then `kubectl apply -f k8s/deployment.yaml`; the commands are at the
top of that file. For a purely local run, leave the defaults: all three
processes on loopback, no cluster needed.

The same manifest also runs the main agent in the cluster (`mainagentdemo`),
for a deployment whose app server cannot reach a laptop. It needs two more
values in the Secret, `MAIN_AGENT_KEY` and `A2A_BFF_SHARED_SECRET`, and whatever
calls it needs its in-cluster address. The main agent is not
registered in Privilege: it is a caller, not a remote agent.

### Run main agent on your laptop

Create the main Agent Access key with `llm` and `a2a` scopes. Associate it with
the worker app and select that app under the key's Agent Privilege Remote Agents
configuration. The main process reuses `MAIN_AGENT_KEY` for its Anthropic call
and its A2A request to the worker.

Configure `.env` with the gateway URLs:

```bash
ANTHROPIC_BASE_URL=https://<gateway>/llm/anthropic
MAIN_AGENT_KEY=sk-orion-<main-agent-access-key>
MAIN_AGENT_MODEL=claude-sonnet-5
WORKER_A2A_URL=https://<gateway>/<worker-app-name>/a2a
WORKER_TRACE_URL=https://<gateway>/<worker-app-name>/trace
```

`WORKER_TRACE_URL` lets the main process forward MCP tool-call traces to the
browser. It uses the main agent key. If you run all processes on one machine,
leave `WORKER_A2A_URL`, `WORKER_TRACE_URL`, and `MCP_URL` on their loopback
defaults while keeping `ANTHROPIC_BASE_URL` on Privilege.

### Provider key registration

Register the Anthropic provider key in Agent Privilege Provider Keys
and associate it with the `llm/anthropic` route. This provider key stays in
Privilege. The demo sends only the Agent Access keys above to that route.

## Configuration reference

| Variable | Purpose |
|---|---|
| `ANTHROPIC_BASE_URL` | Empty for direct Anthropic, or the Privilege base ending in `/llm/anthropic` |
| `MAIN_AGENT_KEY` | Main agent's Privilege key, reused on its model and A2A legs |
| `WORKER_AGENT_KEY` | Worker agent's Privilege key, reused on its model and MCP legs |
| `MAIN_AGENT_ANTHROPIC_API_KEY` | Main direct-provider key when the base URL is empty |
| `WORKER_AGENT_ANTHROPIC_API_KEY` | Worker direct-provider key when the base URL is empty |
| `ANTHROPIC_API_KEY` | Optional shared direct-provider key fallback |
| `MAIN_AGENT_MODEL`, `WORKER_AGENT_MODEL` | Independent concrete Anthropic model IDs |
| `MAIN_AGENT_HOST` | Main-agent bind host; `127.0.0.1` native (`0.0.0.0` inside a container, which Compose sets) |
| `MAIN_AGENT_PORT`, `WORKER_AGENT_PORT`, `MCP_SERVER_PORT` | Process ports; defaults are `6881`, `6882`, and `6883` |
| `A2A_BFF_SHARED_SECRET` | Optional main-agent inbound secret for a server-side front end of your own (header `X-A2A-BFF-Secret`); leave unset for the built-in page |
| `WORKER_A2A_URL` | Worker A2A base URL; client uses its `/jsonrpc` endpoint |
| `WORKER_TRACE_URL` | Worker trace SSE endpoint |
| `MCP_URL` | MCP Streamable HTTP endpoint |
| `WORKER_REQUIRE_BEARER` | Optional local check that inbound A2A/trace requests include a Bearer header |
| `MCP_REQUIRE_BEARER` | Optional local check that MCP requests include a Bearer header |
| `MCP_STATEFUL` | Use MCP session IDs; defaults to `true` |
| `MCP_JSON_RESPONSE` | Use JSON instead of SSE-framed MCP replies; defaults to `false` |
| `MCP_SESSION_TTL_MS` | Idle session lifetime; defaults to `300000` |
| `MCP_DEMO_INJECTION` | Add an instruction-like string to one seeded grant; defaults to `false` |

The optional local bearer settings only check that a header is present. They do
not validate the key; Privilege performs that validation on gateway traffic.

## Tests

Run the demo's integration test from this directory:

```bash
npm ci
npm test
```

It starts the real MCP, worker, and main processes with isolated ports and a
local Anthropic API stub. It exercises the browser chat through A2A delegation
and an MCP entitlement lookup, checks each agent uses its own Anthropic Bearer
key, requires Bearer headers on the local A2A and MCP hops, and runs two chats
concurrently to verify each receives only its own worker trace events.

`npm test` builds the shell bar island first (`npm run build:web`), runs the server tests, then the island's own
vitest tests (`web/`). `npm run build` compiles the TypeScript source and builds the island too.

## Direct Anthropic mode

For local development without a Privilege LLM route, leave
`ANTHROPIC_BASE_URL` empty and set `MAIN_AGENT_ANTHROPIC_API_KEY` and
`WORKER_AGENT_ANTHROPIC_API_KEY`, or the shared `ANTHROPIC_API_KEY`. Agent
Access keys remain separate and are used on A2A/MCP routes only when those URLs
point through Privilege.

---

## If the Privilege desktop agent shows "unregistered"

The PingOne Privilege **desktop app** (the one serving the local console at
`https://local.procyon.ai:8643`) stays registered with the Ping cloud through a background
agent (`ping-helper`). When that agent's device record is deleted or unapproved on the cloud
side, every Privilege app on this machine loses Real mode: the local console stops serving,
connections time out, and the desktop app shows the agent as **unregistered**.

### How to tell this is what happened

1. **The desktop app says the agent is unregistered** (banner or the agent status panel), or its
   diagnostics print `✖ Found N errors` with `Device … not found`.
2. **The local console is down with it**: `https://local.procyon.ai:8643` does not answer
   (connection refused / timeout) even though the PingOne Privilege app is running.
3. **The agent log loops on one error.** Check `/Library/Logs/Procyon/procyon-agent.log`:

   ```
   Error getting the device: HTTP error: 500 Internal Server Error
   Body: { "error": "Device <base64-id> not found", "code": 2, ... }
   ```

   repeated every ~2 seconds. That single line is the tell: the agent is asking the cloud
   about a device record the cloud no longer has. (A one-off is harmless — it is the endless
   repetition that means unregistered.)

### Why it happens

- The cloud side **deletes or disables the device record** (an admin action in the console, a
  tenant sync, or a guard tripping after network churn). The agent cannot re-create it by
  itself: it re-registers only on an enable/disable cycle, and re-registration **waits for a
  human to approve the new device** in the console.
- Network/VPN blips to `privilege.pingone.com` (`lookup … no such host` in the same log) force
  re-registrations and can churn the device identity, making the window for this bigger.

### How to fix it

1. Open the **PingOne Privilege** desktop app and make sure it is running.
2. Sign in to the **cloud console**: `https://console.pingone.com/?env=<your-privilege-env-id>`
   → launch **PingOne Privilege** → open the **Devices** page.
3. Find this machine's device (`DeviceName: mac-…`, type MAC). It is either:
   - **pending approval** — click **Approve** (the agent's certificate request is waiting;
     this is the usual state after a delete), or
   - **missing entirely** — in the desktop app toggle the agent **off and on** (or quit and
     reopen the app) so it mints a fresh certificate request, then approve it in the console.
4. The agent picks up the approval within seconds (watch
   `/Library/Logs/Procyon/procyon-agent.log` for `Device registered with controller`), and the
   local console at `local.procyon.ai:8643` starts serving again. Real mode in this app works
   immediately after — no restart of the app needed.

### If it comes back

The device being deleted repeatedly is a **console-side action** (admin, sync sweep, or a
server-side guard after repeated network drops). Note the times from
`grep "Delete request recieved" /Library/Logs/Procyon/procyon-agent*.log` and raise it with
 whoever administers the Privilege tenant — re-approving treats the symptom; the deletes have
 to stop for it to stay fixed.

---

## Mock and Real

Settings are the lab's own `.env` beside `docker-compose.yml` (copy `config.example`, mode 600, gitignored). Never a
shared settings file in another folder, and nothing from another project.

- **Mock** = the model-free heuristics path. No model call, no provider key, fully offline; the delegation, the A2A hop
  and the MCP tool call still run on the lab's own three processes. This is the default without a provider setting.
- **Real** = the actual model call. The Mode dropdown in the top menu enables it only when a model provider is configured:
  `ANTHROPIC_API_KEY` (or the per-agent keys) for direct Anthropic, or a Privilege gateway through
  `ANTHROPIC_BASE_URL` (or `GEMINI_BASE_URL`, `GROQ_BASE_URL`) with `MAIN_AGENT_KEY` and `WORKER_AGENT_KEY`, and
  `WORKER_A2A_URL`, `WORKER_TRACE_URL`, `MCP_URL` pointing at your gateway routes (steps above). Unconfigured, the
  Real option is disabled and `POST /api/mode {"source":"real"}` answers 409 with the how-to. Keys are write-only:
  scrubbed from every message, error and log line.
- **UNVERIFIED**: Real against a live Privilege gateway or provider is owner-run; the tests use a local provider stub.

## Run observability (rule 27)

Under the Run, the drawer **What each layer logged for this run** shows, for the latest run of either tab, one row per thing each layer
decided or logged, in time order, across six layers: person, agent, Authorize, Privilege, agent gateway, resource server. Each row has an
exact timestamp and an origin tag. The panel is the shared component, vendored byte for byte from AI-DEMO-Standalone
`shared/run-observability` (web files in `web/src/run-observability/`, the core and the log readers in `server/src/`, pinned by
`run-observability.sha256` and checked by `scripts/run-observability-checkPin.mjs`, never edited here). `GET /api/run-observability` answers it;
the page script opens the drawer when a run finishes.

- **Mock.** Every row is `simulated`: it is computed from the trace events the lab itself sent to the page for this run (the handoff, the Agent Card read,
  the answer, a tool call and its reply, a blocked tool reply). None is shown as read from a log. A layer nothing touched says `not logged` and why.
- **Real.** Rows the lab holds as replies (an HTTP status from the gateway, a blocked tool reply, a token issued) are `response` rows, never `logged`.
  `logged` rows are lines a reader found in a product's own log, read-only: Elasticsearch by default (`RUN_OBS_ES_URL`, a loopback URL such as a port-forward,
  and `RUN_OBS_ES_READ_APIKEY`, a read-only key; both empty by default). If none is configured the layer says `unreachable` and what to set, and the lab keeps
  working. The Docker reader is opt-in (`RUN_OBS_DOCKER=1`, for an ad-hoc run or a video capture); **this lab never mounts the Docker socket**. The one network
  call the vendored readers make is that read to the loopback Elasticsearch.
- **The lab's own log.** For each decision it sees, the main agent writes one line to stdout (the same time the row carries): `<ISO time> privilege-a2a-lab decision
  run=<id> actor=<name> target=<name> result=passed|stopped|blocked`. No token, no message body. That line is what the gateway lane reads as `logged`.
- **Time.** A row's time is when the lab saw the event. Real runs are read from 2 s before to 2 s after the run (container clocks and the collector's batching
  differ); a line found only by its time says so (`window`), a line carrying the run's id says `id`. Two runs close together can interleave window-matched rows.
  Real re-reads the logs once about 5 s after a run (the collector ships with a delay) and has a **Re-read logs** button.
- The panel refuses a record whose mode differs from the page's mode, and `GET /api/run-observability` returns no record for a run made in the other mode.

**Where this run leaves logs, and where they stream.**

| Product | Lives in | Streams to |
|---|---|---|
| This lab's main agent | the container's stdout: the decision line above | the family log collector to `demo-logs-privilege-a2a-lab`, then a SIEM, when the collector watches this container |
| MCP server (this lab) | its container's stdout | the collector to `demo-logs-mcp-server` |
| PingFederate | its audit log | not shipped by the collector yet |
| Privilege agent gateway (hosted) and console | the SIEM index `ping-siem-events-v2`; the console Activity Logs (only allowed calls appear) | the Privilege SIEM export |
| Privilege agent gateway (local) | `cyonproxy.log` in its log volume | the collector's file source to `ping-logs-privilege-gateway` |

**What is `not logged` today.** Person (this lab has no sign-in). Authorize (this lab does not call it). A gateway refusal or an AI Guard block as a product log
line: no real line shape has been confirmed, so those events show only as `response` rows from what the lab received; the console Activity Logs show allowed
calls only. PingFederate token issue: its audit log is not shipped. Nothing here claims a line exists that was not read.
