# Setting up PingOne Privilege for this lab

This is for someone who has the lab and has never used PingOne Privilege. Mock mode and the Demo | Story walk-through need **none of this**. You only need it to run the lab in **Real** mode, where model calls, agent-to-agent hops and tool calls go through a Privilege gateway you control.

What is verified and what is not: the steps below are the order that worked end to end on one Privilege tenant. The console menus and field names change between releases, so where this guide names a screen, treat it as a pointer, not a promise. Anything marked **UNVERIFIED** is something we have not exercised ourselves.

## Pick your path first

| | Path A: model calls only | Path B: the full four hops |
|---|---|---|
| What goes through Privilege | The model calls | Model calls, the A2A call to the worker, and the worker's MCP calls |
| What you need | A gateway and a provider key. Everything else runs on your machine | The above, plus a place the **gateway can reach** for the worker and the MCP server (a cluster or a VM) |
| Steps | 1, 4, 5, 7 (keys only), 8 (the model lines only), 9 (the model-call checks only), then section 6 | All of section 3 |
| What you will see | Model records and policy in the gateway. The A2A and MCP hops stay on your machine and are **not governed** | The whole story: every hop is a governed, recorded call |

If you are unsure, start with Path A. You can add Path B later; the keys you made carry over.

## 1. What you are building

```text
browser ──▶ main agent ──A2A──▶ Privilege gateway ──▶ worker agent ──MCP──▶ Privilege gateway ──▶ MCP tool server
                │                                         │
                └─ model call ─▶ gateway ─▶ provider       └─ model call ─▶ gateway ─▶ provider
```

- **Two agents, two keys.** The main agent holds its own Privilege *agent key* and uses it for its model calls and for its A2A call to the worker. The worker holds a *different* key for its model calls and its MCP calls. Neither agent ever holds the model provider's own key: Privilege keeps it and injects it.
- **The key is the whole identity.** There is no sign-in and no token exchange for the agents. Each call carries `Authorization: Bearer <agent key>`. The key has scopes (what kinds of call it may make), a model allow-list, limits, an expiry, a **custodian**, and the specific apps it may reach.
- **Selecting an app on a key is the permission.** There is no separate policy to write for this lab: when you save the key with an app selected, Privilege creates the grant for you.

Words used below:

| Word | Meaning |
|---|---|
| **Gateway** | The Privilege AI gateway: the host that proxies every call and records it. Written `<gateway>` below |
| **App** (a "door") | A backend you register behind the gateway, such as the worker or the MCP server. It gets a path on the gateway |
| **Agent key** (a "virtual key") | The credential an agent holds instead of the provider's key |
| **Custodian** | The person the agent acts as. Grants follow the custodian. If that person's account goes inactive, the key stops working |
| **AI Guard** | The per-key guardrail that screens the text an agent sends and receives |
| **Federated identity** | A trusted external token issuer a key can use instead of a stored secret (the console may still call it Non-Human Identity). Only section 4 uses it |
| **Remote Agent** | The app type for an A2A agent |

## 2. Before you start

You need:

- A **PingOne Privilege tenant with an AI gateway**, and a console login with rights to create apps and agents (MFA may be required). This is a Ping service, not something you install on your laptop. Ask your Privilege administrator for the console address, **the gateway's host name** (written `<gateway>` below, for example `gateway.example.invalid`) and **which gateway cluster to choose** in Step 3.
- **You do not set up PingOne for this lab.** The lab has no PingOne settings. PingOne only hosts the Privilege tenant. If you have no tenant yet, adding Privilege to a PingOne environment, adding PingID, signing in the first time and granting yourself the Privilege administrator role are all console steps that no script does for you. Get them from whoever owns the tenant. PingFederate is a separate product and is needed only for the AWS tab's token flow (section 4).
- A **model provider** you can register in Privilege: Anthropic, Google, or an OpenAI-compatible provider such as Groq. You need the provider's own API key once, to give to Privilege. It never goes in this lab's `.env`.
- For Path B only, **somewhere the gateway can reach the worker and the MCP server.** A remote gateway cannot reach `localhost` on your laptop. Run those two in a cluster or on a VM the gateway can see. For a trial on one machine, see section 6; it covers model calls only, not the full four hops.
- A **custodian** for each key: a real user who will stay and who should answer for the agent.

Names: the lab and its manifests use `workeragentdemo` and `mcpdemo` for the two apps. The names are yours to choose, but the URLs in your `.env` must use the same names. **A key's name cannot be changed later** (renaming means deleting and recreating it, which changes the key), so pick names you can live with.

## 3. Steps

The order matters: register the apps first, start the MCP server, save the app again so its tools are found, then create the keys, and only then deploy the worker, because it needs its key.

### Step 1. Register the model provider and its route

Make the provider's route available. Some consoles have a provider screen (Agent Privilege, Provider Keys) where you register the provider's own API key and attach it to the route; others take the provider and its key only in the agent-key wizard (see the second bullet below). The routes the lab uses are:

| Provider | Gateway route the lab uses | Lab settings |
|---|---|---|
| Anthropic | `https://<gateway>/llm/anthropic` | `ANTHROPIC_BASE_URL` |
| Google | `https://<gateway>/llm/google` | `GEMINI_BASE_URL`, and `MAIN_AGENT_PROVIDER` / `WORKER_AGENT_PROVIDER` set to `google` |
| Groq or another OpenAI-compatible provider | `https://<gateway>/llm/custom/v1` (an "OpenAI-Compatible (Custom)" connection) | `GROQ_BASE_URL`, `MAIN_AGENT_PROVIDER` / `WORKER_AGENT_PROVIDER` set to `groq`, and the Groq-bound agent key in `GROQ_API_KEY` |

- A Privilege agent key is tied to **one** provider, so two providers means two keys. The Anthropic SDK appends `/v1/messages` itself; do not add it.
- **Where the provider's real key goes is UNVERIFIED.** In the console's API the provider and its real key are fields of each `llm`-scoped agent key, and we found no separate "Provider Keys" object. So your console may have no separate screen for this step, and the real key may be entered only in the key wizard (Step 4 and Step 5). If you do find a provider screen, register the provider there; if you do not, go on to the next step on your path and enter the real key when the key wizard (Step 4 and Step 5) asks for it. Either way you do not paste it anywhere in the lab, and the API never returns it afterwards.
- The real key is yours: you have to type it into the console. Nothing can fetch it for you.
- The first real test of the provider and route is Step 9.

### Step 2. Prepare the host and start the MCP server

For Path B, `k8s/deployment.yaml` holds **three** Deployments and their Services: `mcpdemo`, `workeragentdemo` and `mainagentdemo`. It was written for one cluster, so edit its placeholders (namespace, image, secret names) first. Build the image for your cluster's CPU architecture.

- Apply only the `mcpdemo` documents now. Skip or delete `mainagentdemo`: the main agent runs on your machine in this layout, and that pod needs `MAIN_AGENT_KEY` and `A2A_BFF_SHARED_SECRET` in its Secret, so left in it fails to start.
- `MCP_DEMO_INJECTION=true` is set on the `mcpdemo` Deployment already. It is what makes the poisoned record for the "blocked" demo.
- Hold the worker (`workeragentdemo`) back until Step 7.

A VM running `npm run worker` and `npm run mcp`, reachable by the gateway, works too.

### Step 3. Register two apps

Console: **Agentic Apps, Add Application**, on the gateway cluster your administrator named.

| App | Type | Backend URL | Entry path | Auth mode |
|---|---|---|---|---|
| `workeragentdemo` | **Remote Agent** | `http://workeragentdemo.<namespace>.svc.cluster.local` (or wherever the worker listens) | `/a2a` | None |
| `mcpdemo` | **MCP** | `http://mcpdemo.<namespace>.svc.cluster.local` (or wherever the MCP server listens) | `/mcp` | None |

- Register the worker as a **Remote Agent**, not as an HTTP or MCP app. Only Remote Agent apps appear in a key's Remote Agents list, and an app registered as MCP gets an MCP `initialize` sent to its `/a2a` path.
- "Auth mode None" is right here: the gateway has already authenticated the caller's agent key before it proxies the request.
- Once the MCP server is up, **save the `mcpdemo` app again** so the gateway discovers its tools. An empty tool list in Step 4 means this was skipped, or the gateway cannot reach the MCP server (a remote gateway cannot see `localhost`). Wait for the change to reach the gateway (see Step 9), then check the app's tool list before you go on.
- When the worker is running (Step 7), turn on **Discover A2A agent card** for it. The worker serves its card at `/.well-known/agent-card.json` and advertises `WORKER_PUBLIC_URL`, which should be `https://<gateway>/<worker app name>/a2a/jsonrpc`.
- The lab also reads the worker's trace at `/<worker app name>/trace`. That is a second path on the worker, separate from the entry path `/a2a`. UNVERIFIED: whether your gateway route serves it without a second app; if the trace panel stays empty, that is why.

### Step 4. Create the worker's agent key

Console: **Agent Privilege, Agent Registry, Add Agent** (older versions call it Agent Config). It is a four-step wizard.

1. **Identity and access.** Name, custodian, expiry, scopes. Give the worker only `llm` and `mcp`. A three-scope key is one secret that reaches models, tools and agents. (Path A: give it only `llm`; the apps below do not exist yet.)
2. **Gateway and apps.**
   - `llm`: choose the provider, **one allowed model**, and the rate and budget limits. Creating a key with the `llm` scope asks for the provider's real key; Privilege stores it and hands the agent only the virtual key.
   - `mcp`: select `mcpdemo`, then **Configure Tools** and allow each tool by name (other tools are hidden and refused). Do not leave the list blank and assume that means "all".
3. **Runtime protection.** The per-key guardrail (AI Guard). See Step 6.
4. **Review and create.** Shows the key (a long string with a vendor prefix; the exact prefix varies) and ready-made calling code. **Copy it now and treat it as a secret.**

### Step 5. Create the main agent's key

Same wizard. Scopes `llm` and `a2a`. A **different** allowed model from the worker, so the two agents show up separately in the records. Under Remote Agents, select `workeragentdemo` (Path A: skip this, and give the main key only `llm`). The provider you pick for this key must match `MAIN_AGENT_PROVIDER` in `.env` (and the worker's key must match `WORKER_AGENT_PROVIDER`).

Use Auth Mode None (or Static Token) on the worker app for these key callers: a key cannot satisfy Pass Agent Token.

For the optional three-deep chain, a middle agent needs its own key with scope `a2a`, its specialists selected, and a **different custodian** from the main agent: remote-agent grants follow the custodian, so two agents under one custodian can reach each other's agents. The middle agent is a separate agent that is **not in this repo or in the manifest**, so you must bring your own. Then set `CHAIN_A2A_URL=https://<gateway>/<middle app>/a2a/jsonrpc`; blank disables the chain.

### Step 6. Decide how the guardrail behaves

AI Guard is per key. On our tenant its defaults mostly **alert rather than block**, but this is UNVERIFIED for yours, and the lab's README treats the poisoned-record demo as blocked. Check the worker key's AI Guard settings and set it to block if you want the refusal. If it does not block, the poisoned text reaches the model and the model may ask to open a ticket (the MCP server prints a `[mcp] ticket` line when that happens). You will still see the call and an alert in the gateway log. The console's API also has an AI Guard field on the app itself. We have not checked whether it matters here, so set the key's, and look at the app's if the block does not happen.

### Step 7. Put the keys where each agent runs, and deploy the worker

- **Main agent key:** `.env`, as `MAIN_AGENT_KEY`.
- **Worker key:** the Secret the worker's Deployment reads (`privilege-a2a-demo` in the manifest), as `WORKER_AGENT_KEY`. Create it in your namespace with `kubectl create secret generic`, then continue below.
- **Paste a key once.** A doubled key is refused as `invalid virtual key`.
- Keep `.env` mode 600. Never paste a key into a chat, a ticket or a screenshot. The console shows keys unredacted and the gateway log can contain them, so restrict who can read those.

Before you apply the worker, edit these values in its Deployment (they hold placeholders, and it is easy to miss one):

| Setting | Set it to |
|---|---|
| `WORKER_PUBLIC_URL` | `https://<gateway>/<worker app name>/a2a/jsonrpc` |
| `ANTHROPIC_BASE_URL` (or `GEMINI_BASE_URL`) | Your gateway route from Step 1 |
| `WORKER_AGENT_PROVIDER` | `anthropic`, `google` or `groq` |
| `WORKER_AGENT_MODEL` | Exactly the model the worker key allows |
| `MCP_URL` | `https://<gateway>/<mcp app name>/mcp` |
| ANTHROPIC_AUTH_TOKEN (read from a Secret called `ai-demo-secrets`) | Change it to read the worker key from your Secret, or remove it. As shipped it points at a different Secret and may override `WORKER_AGENT_KEY`, so the worker's model calls would use the wrong key |

Then `kubectl apply` the worker's Deployment and Service.

### Step 8. Point the lab at the gateway

The quick way: `npm run setup -- --gateway <gateway> --main-model <id> --worker-model <id>` shows what it would write and prints the console checklist (it writes nothing; the `--` is needed so npm passes the options on); add `--apply` to write `.env` (mode 600, the old file backed up first). It asks for the two agent keys without echo, or reads them from `MAIN_AGENT_KEY` and `WORKER_AGENT_KEY` in your shell, and never prints one. **On Path A add `--path a` to every command**: the default is Path B, which also points the worker, trace and MCP URLs at the gateway. It supports Anthropic and Google; for Groq or llama.cpp edit `.env` by hand (Step 1). It wants both keys in this `.env`, even if the worker runs in a cluster, because `--verify` uses them; that is an extra copy of a credential, so skip it (and those checks) if you prefer. See section 7.

By hand: copy `config.example` to `.env` (it sets the provider names for you; a hand-written `.env` falls back to a different default provider) and set:

```dotenv
ANTHROPIC_BASE_URL=https://<gateway>/llm/anthropic
MAIN_AGENT_KEY=<the main agent key>
WORKER_AGENT_KEY=<the worker key, if the worker runs on this machine>
MAIN_AGENT_MODEL=<exactly a model the main key allows>
WORKER_AGENT_MODEL=<exactly a model the worker key allows>
WORKER_A2A_URL=https://<gateway>/<worker app name>/a2a
WORKER_TRACE_URL=https://<gateway>/<worker app name>/trace
MCP_URL=https://<gateway>/<mcp app name>/mcp
```

- The model ID must match what the key allows **exactly**. A `-latest` alias or a near miss gives `403 model "x" not allowed for this key`.
- The provider's real key is never in `.env`.
- `WORKER_A2A_URL` ends in `/a2a` because the lab adds `/jsonrpc` itself. The smoke test in Step 9 calls the full path, `/a2a/jsonrpc`. Both are right.
- **Docker Compose caveat.** `docker-compose.yml` pins the worker's `MCP_URL` and `WORKER_PUBLIC_URL` to local values, and those beat `.env`. With Compose, the worker's MCP calls stay local and ungoverned. To govern them, run the worker with `npm run worker`, or edit the worker service in the Compose file.

### Step 9. Wait, then verify

App and policy changes take about **four minutes** to reach the gateway; allow up to six. Do not conclude it failed before then, and read the **response body**, not just the status: a `200` can carry a JSON-RPC error.

`npm run doctor` checks only your own machine (Node, `.env` permissions, the build, the lab's `/api/health`). It never calls the gateway, and it can pass with nothing configured. The checks that tell you Privilege is set up are these, and `npm run setup -- --verify --wait 6` runs them for you (add `--path a` for Path A):

| Check | Path | How | Expect |
|---|---|---|---|
| Worker key reaches its model | A and B | A one-line model call to the route you set up in Step 1 for your provider, with the worker key and the exact allowed model. The request shape depends on the provider (Anthropic Messages, Gemini generateContent, OpenAI-compatible) | `200` |
| Main key reaches its model | A and B | The same, with the main key and its own model | `200` |
| Worker's tools are discovered | B only | An MCP session on `<gateway>/<mcp app name>/mcp` with the worker key: `initialize` first, then `tools/list`. UNVERIFIED: the exact calls your gateway accepts, so use any MCP client you have | The tools you allowed in Step 4, and no others |
| Main key reaches the worker | B only | The smoke test below | `200`, and a `result` (not an `error`) in the body |
| A missing scope is refused | B only | Call `<gateway>/<mcp app name>/mcp` with the **main** key (it has no `mcp` scope) | `403` (or `401`) with a "not scoped" message |
| An unknown key is refused | A and B | Any call with a made-up key | `401` |

Smoke-test the worker through the gateway with the main key (swap the path for any scope). It prints the body, then the status code on its own line:

```bash
curl -s -w '\n%{http_code}\n' -X POST "https://<gateway>/<worker app name>/a2a/jsonrpc" \
  -H "Authorization: Bearer $MAIN_AGENT_KEY" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"message/send","params":{"message":{"role":"user","messageId":"m1","parts":[{"kind":"text","text":"Hello"}]}}}'
```

Expect `200` and a JSON body with a `result`; an `error` object inside a `200` is a failure. `401` means the key; a bare `403` see section 5; `404` means the app name or path is wrong.

Then start the lab (`npm run dev`, or `docker compose up --build -d`), switch the Mode menu to **Real**, and ask:

- `Review Carol Nguyen's access`: allowed; the trace shows each hop.
- With `MCP_DEMO_INJECTION=true` on the MCP server, `What access does Dave hold?`: comes back **blocked** only if the worker key's AI Guard is set to block (Step 6). Either way, the check is the MCP server's log: with a block, no `[mcp] ticket` line appears for Dave.

The Mode menu offers Real only when a model provider is configured; otherwise the option is disabled and says why.

## 4. The AWS agent (the "Custodian to AWS agent" tab)

Only if you want that tab live. Everything in sections 1 to 3 comes first. The lab never calls AWS itself: it calls a gateway route that fronts your AWS agent.

Pick one:

| I want | Auth mode | You also need |
|---|---|---|
| The tab to work | **Static Token** | Nothing beyond the app below. Set only `AWS_AGENT_A2A_URL` |
| To reproduce the video's token flow | **Pass Agent Token** | PingFederate and a federated identity (below) |

You also need, and the lab does **not** include:

- An **AWS account** and an agent on **Amazon Bedrock AgentCore** that serves A2A with **OAuth/JWT inbound authorization**. A runtime that accepts only AWS SigV4 cannot sit behind a Privilege Remote Agent app.
- A **Remote Agent app** in Privilege for that runtime, with the auth mode from the table. Select the app on the main agent's key; that selection is the grant, as in section 1.
- `AWS_AGENT_A2A_URL=https://<gateway>/<aws agent app>/a2a`. The call carries `MAIN_AGENT_KEY`. `AWS_AGENT_CUSTODIAN` is only the name the page shows.

**The token flow shown in the video** (Pass Agent Token). A key alone cannot satisfy that mode, because it carries no workload assertion to forward. So the AWS agent's key must be one whose custodian is a federated identity:

1. Create the **federated identity** for the PingFederate client, with the **issuer** your token endpoint signs as, a **JWKS** the gateway can fetch, the **audience** bound to the route (an unbound token could be replayed elsewhere), and required claims **`client_id`** and **`act.sub`**, where `act` is a JSON object, not text.
2. Create an **agent key whose custodian is that federated identity**. It has no stored secret, no workload identity of its own and no human user. An identity with no key behind it authenticates nobody (the gateway log shows `rebuilding 0 key(s)`).
3. Add the AWS agent's app to **that key's** grant, **in the console**. Do not create this grant through the API: in our tests a grant created by API for a key with a federated-identity custodian was deleted by the gateway within about 80 seconds in our tests (cause unknown, and we tried it on one tenant). The route we have seen survive is to add the app to the grant the console made when you saved the key.
4. In `.env`, set `AWS_AGENT_PF_TOKEN_URL`, `AWS_AGENT_PF_CLIENT_ID` and `AWS_AGENT_PF_CLIENT_SECRET`: all three or none, or the main agent stops at startup.

PingFederate needs:

- version 13.1 or later, licensed, and **reachable from the gateway** (not `127.0.0.1`, not a laptop address);
- a client-credentials client for the lab;
- a JWT token manager that signs with its own published key and emits `client_id`, `sub` and an `act` claim that is an object (`act.sub`).

The issuer, the JWKS address and the audience in the federated identity are your PingFederate's own values. The lab asks for its token with a plain client-credentials request (no `resource` and no `scope`); whether your token manager answers that request is **UNVERIFIED**, so test the token endpoint with a `curl` first. The rest of the PingFederate setup is **UNVERIFIED** here: this repo does not document it.

AWS-side traps: the runtime id goes in the URL path as `/runtimes/<id>/invocations/?accountId=<id>` (an ARN in the path gives a misleading "anonymous is not authorized" error); the JWT discovery URL must be reachable from the internet and have no path; `allowedClients` must list the client id that is inside the token.

The "Gateway to Bedrock (IAM)" tab is simulated and needs nothing.

## 5. When it does not work

| What you see | Usual cause | Fix |
|---|---|---|
| `401`, or `401 invalid virtual key` on a model call | Wrong, mistyped, doubled, revoked or expired key | Check the key exists, is not revoked, is not past its expiry |
| `401 virtual key not scoped for llm access` (seen on a real gateway, 2026-11-25) | The key was created without the `llm` scope, or the route is for another provider | Add the scope on the key in the console (Steps 4 and 5), or use the key made for that provider; wait for the change to reach the gateway |
| `403 key not scoped for mcp access` | The key lacks that scope (self-describing refusals like this and the 401 above are the exceptions) | Add the scope |
| bare `403 Forbidden` | The app is not selected on the key, **or** the remote agent's Auth Mode cannot be satisfied by a key | Rule out those two first. To tell them apart you need the gateway log: `policy denied` means a missing grant; `requires token-pass` means the auth mode |
| `403 model "x" not allowed for this key` | Model not on the key's allow-list | Use the exact allowed ID |
| `403 wrong_provider` | The key belongs to a different provider | Use the matching key |
| `429` with `retry-after` | Rate or budget cap | Wait or raise the cap |
| `400 content_blocked`, or JSON-RPC `-32600 request blocked by security policy` | AI Guard blocked the text | Working as designed |
| `200` with an **empty body** | A gateway node with stale routing, not an auth problem | Restart that gateway node. If you do not run the gateway, ask its administrator to restart it |

Order to check things: what exactly the caller sees, whether the key is alive, the scope, the provider and the model, whether the app is **selected** on the key (and whether you waited four minutes), the remote agent's Auth Mode, and then the **gateway log**. The bare `403` is explained only there. If you do not run the gateway, ask its administrator to read the log lines for you. Gateway probes can mislead you: the gateway answers metadata and `401` for any door path, including apps that do not exist, so a `401` proves nothing.

## 6. Running everything on one machine (Path A)

Leave `WORKER_A2A_URL`, `WORKER_TRACE_URL` and `MCP_URL` on their loopback defaults and keep only `ANTHROPIC_BASE_URL` (and the keys) pointing at the gateway. Then only the model calls go through Privilege; the A2A and MCP hops stay local and are not governed. That is enough to see model records and policy, but it is not the full four-hop story. You still need the gateway to be reachable from your machine, and the worker key must be the one the worker process reads (`WORKER_AGENT_KEY` in `.env`).

**A middle layout: the MCP server stays on your machine.** You can also send the model calls and the A2A call to the worker through the gateway while the tool server stays local (`MCP_URL` on its loopback default). The tool calls are then not governed, but the agent-to-agent hop is. Use `--path a` on every `npm run setup` command in this layout: Path B would point `MCP_URL` at the gateway and overwrite your local address, and `--verify` on Path B refuses to run while `MCP_URL` is not on the gateway, because it never sends a key to another address. `--path a` checks only the model calls, so test the A2A hop by hand with the `curl` smoke test in Step 9, using the worker app's real name in the URL.

## 7. What a script can and cannot do for you

This section is for people who want to automate setup; you can skip it. `npm run setup` does the part that needs no console credentials, and it never creates a Privilege object: every one in the steps (Steps 1 and 3 to 6) is still made by hand in the console. It has three modes:

| Command | What it does |
|---|---|
| `npm run setup -- --gateway <host> --main-model <id> --worker-model <id>` | The plan (the default): shows the `.env` lines it would write and prints the console checklist (the apps, scopes, models and tool names to enter). Writes nothing (`--checklist` prints only the checklist). The `--` after `npm run setup` is required, and on Path A every command also needs `--path a` |
| `npm run setup -- --apply` | Writes `.env` from `config.example` (mode 600), changing only the lines it names. An existing `.env` is backed up first, and running it twice changes nothing. Keys come from a hidden prompt or from `MAIN_AGENT_KEY` and `WORKER_AGENT_KEY` in your shell. Refuses a doubled or too-short key, a key or value the `.env` loader would misread, a partial PingFederate trio, a missing model, a gateway with a path, a provider other than Anthropic or Google, or a linked `.env`, before writing anything |
| `npm run setup -- --verify` | The six checks in Step 9, each PASS or FAIL with the status and the reason; exits 1 if any fail. It changes nothing in `.env` or Privilege, but it makes real model and agent calls (a few tokens, and records in the gateway log). It refuses to send a key to any address that is not the gateway's own, or that is not https. `--wait <minutes>` keeps retrying checks that can clear on their own, up to that long in total across all the checks (the gateway takes about four, up to six, minutes). A `200` with an empty body or a JSON-RPC error is a FAIL |

It never prints a key, not even in an error. When it writes keys it reminds you to save them in your password manager; it cannot read your vault. `npm run setup -- --help` lists every option.

What more could be automated, from what we found ("Partly" means possible but not built):

| Task | Can a script do it? |
|---|---|
| Create the two apps, the two keys and their grants through the console API | Partly. The API supports it, but no working body has been proven on an empty tenant, and signing in to the API for a cloud console is a 60-minute browser cookie |
| AI Guard thresholds on the key | Partly. The values that make the "blocked" demo block are unverified |
| The federated identity and its key | Partly. The grant must stay in the console (section 4) |
| The PingFederate client and token manager | Partly, through PingFederate's admin API, with a script written for this lab |
| Console sign-in and MFA, the provider's real key, the Privilege tenant, the AWS role and runtime, the desktop agent | No |

Never let a script print a key. The console's API, the gateway log and the audit feed all show agent keys unredacted.

## 8. What this guide does not cover

- Installing or licensing a Privilege tenant or gateway itself.
- Whether the Privilege desktop agent is needed when you only use a hosted gateway: the lab documents it only for one failure (an "unregistered" agent), see the main README.
- Elasticsearch and log shipping for the live rows in "Run observability" (see the main README).
- Exact AI Guard settings and policy object names: they depend on your tenant.

Keys expire. Put each key's expiry on a calendar. To rotate one you recreate it with the same name (its grants follow the name); snapshot its settings first and keep the provider's real key at hand, because an `llm`-scoped key cannot be recreated without it.
