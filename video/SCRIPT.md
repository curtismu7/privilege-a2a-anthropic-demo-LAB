# Script: an agent calls an agent in AWS, through Privilege

Written first, before any recording (video standard: every video has a script, built from the specs and docs actually read, not from memory). `captions.md` carries the on-screen wording and must say what this script says. If a source changes, change the script, then the captions, then retake. Revised 2026-11-21 after an independent research-and-verify pass (a second reader re-checked every cited fact against the source; corrections are folded in below).

- **Format:** silent screen capture with numbered captions and five full-screen slides (opening, console configuration, A2A spec, what the gateway can protect, closing), light theme, about 9 minutes. Dense slides are held about 4 words a second. Opens and closes with a slide.
- **Audience:** a colleague who knows what an AI agent is but has not seen A2A or Privilege.
- **One idea:** agent to agent across clouds works with a policy point in the middle: the agent proves who it is, the gateway decides, and a bad credential never reaches AWS.

## Sources (read for this script, 2026-11-21)

| Tag | Source | What the script takes from it |
|---|---|---|
| **A2A** | Agent2Agent (A2A) Protocol Specification, release **1.0.0** (previous 0.3.0, 0.2.6, 0.1.0), <https://a2a-protocol.org/latest/specification/>; 0.3.0 at `/v0.3.0/specification/` | §8.1 every A2A server must publish an Agent Card; §8.2 clients find it by the well-known URI `/.well-known/agent-card.json`, a registry, or direct configuration; §4.4.1 required card fields (name, description, supportedInterfaces, version, capabilities, defaultInputModes, defaultOutputModes, skills), `securitySchemes` is optional; §4.5 scheme types (API key, HTTP incl. Bearer, OAuth2, OpenID Connect, mutual TLS); §7.1 production traffic MUST be encrypted; §7.3 the client learns the required auth from the card's `securitySchemes`, gets credentials out of band, and sends them with every request (no MUST/SHOULD in 7.3); §7.4 the server MUST authenticate every incoming request and SHOULD include challenge information in error responses; §7.5 authorization is the server's own policy; §3.3.2 servers MUST reject invalid or missing credentials; §5.3 / §9.4.1 sending is `SendMessage` in 1.0.0; §3.6 version negotiation; Appendix B A2A and MCP are complementary |
| **A2A-0.3** | The 0.3.0 specification | The send method was `message/send`; the card had a top-level `url`, `protocolVersion` and `preferredTransport`. The 1.0.0 text never uses the string `message/send`, and does not say whether a 1.0 server must still accept it |
| **AWS-A2A** | Amazon Bedrock AgentCore, "A2A protocol contract", <https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-a2a-protocol-contract.html> | Transport is JSON-RPC 2.0 over HTTP, POST to `/`; the card is at `/.well-known/agent-card.json`; its **example** card shows `protocolVersion` 0.3.0 and the example request uses `message/send` (the docs state no supported-version guarantee); auth is an OAuth 2.0 bearer token or AWS SigV4; a missing token on an OAuth/JWT agent gets 401 with `WWW-Authenticate` and a `resource_metadata` URL; a SigV4 agent answers 403 with no challenge; unlike the A2A convention, the runtime returns the real HTTP status with a JSON-RPC error body |
| **AWS-AUTH** | AgentCore "Authenticate and authorize with Inbound Auth and Outbound Auth" (`runtime-oauth`) and the inbound JWT authorizer page | Inbound auth is IAM SigV4 (default) or JWT bearer, not both at once; for a JWT the runtime checks issuer, `client_id` against allowed clients, `aud` against allowed audiences, signature (keys fetched from the discovery URL) and expiry |
| **RFC** | RFC 9110 §15.5.2; RFC 6750 §2.1, §3, §3.1; RFC 9728 §3, §5.1; RFC 7519 §4.1; RFC 9068 §2; RFC 6749 §4.4; RFC 8693 §4.1 (all fetched from rfc-editor.org) | A 401 MUST carry a `WWW-Authenticate` challenge (RFC 9110; **RFC 7235, which the AWS page cites, is obsoleted by RFC 9110**); a Bearer token travels in `Authorization` (RFC 6750); `invalid_token` maps to 401, `insufficient_scope` to 403; the `resource_metadata` parameter of a challenge points at the resource's metadata (RFC 9728 §5.1), served by default under `/.well-known/oauth-protected-resource` inserted between host and path (§3); JWT claims `iss`, `sub`, `aud`, `exp` (RFC 7519; all OPTIONAL there, required only by a profile such as RFC 9068 §2.2); the client-credentials grant (RFC 6749 §4.4); the `act` actor claim (RFC 8693 §4.1) |
| **PRIV** | Ping Identity docs for PingOne Privilege, agent privilege: <https://docs.pingidentity.com/privilege/> (agent registry, remote agent apps, key concepts, secrets hubs, release notes 10 Oct 2026) | Custodian: the Agent Registry field saying whose identity the agent's actions are attributed to, a User or a Federated Identity (**Ping gives no glossary sentence for "custodian"; do not quote one**); key scopes for Models (LLM), Tools (MCP), Agents (A2A); agents authenticate to the AI Gateway with an API key or a workload identity; unregistered or revoked agents are denied, identity validated on every call; the agent's credential is validated and ends at the gateway, which injects what the target needs; Remote Agent auth modes: Static Token, User Token, Pass Agent Token (forwards the caller's own verified token), None; a Remote Agent must be selected on the agent, policy is per app by operation, user or group and time window; A2A skill policies can target an advertised skill or read message parts, human-in-the-loop policies can hold an action for approval; AI Guard allows, alerts, sanitizes or blocks on MCP, A2A and LLM traffic (Fail Closed toggle is on the Agent Registry page); every call and policy decision is auditable in Activity > Activity Logs and can stream to a SIEM; secrets hubs: AWS Secrets Manager, Azure Key Vault, Delinea Secret Server, GCP Secrets Manager. **Not documented:** the status codes of a denied agent request (the live run supplies the 401), how a hub secret reaches an agent request, AgentCore behind a Remote Agent app |
| **CONSOLE** | The Privilege console, read-only, 2026-11-21 (screens and text read, nothing changed) | App `aws-agent-pass`: Remote Agent, backend the AgentCore regional host, path `/runtimes/<runtime>/invocations/`, Auth Mode **Pass Agent Token**. Agent `aws-agent-caller`: principal **PFawsagent** (a federated identity), scope `a2a`, "Policy enforced as: principal identity", authentication by OIDC (issuer, audience = this app's gateway route, subject `*`, JWKS URL, max token lifetime default 3600 s on the gateway), required claims `act.sub` and `client_id`, no API key |
| **LAB** | This repo's README, "Custodian to AWS agent (tab)" | The tab calls a gateway route; the AWS agent is a Remote Agent app in Privilege; the lab mints a PingFederate client-credentials token for each call and the gateway app passes it on |

**Wire-format note (said once, on the opening slide and again at the card):** the spec is at 1.0.0, but AgentCore's documented example card and request use the 0.3.0 form, and AWS's live card says `protocolVersion` 0.3.0. The video uses the names that are on the wire and says so.

**Checks before recording (a script is only true if the run is):**

1. The tab's banner and route note say LIVE, and the page header banner says LIVE (the header no longer claims SIMULATED when the run is live; fixed 2026-11-21).
2. The Mock/Real switch is on Real, and the take refuses to run otherwise.
3. The Agent Card read returns HTTP 200 (the take proves the card, the answer and the refusal are all real; it refuses to claim success otherwise).
4. Re-read the console values on the configuration slide if anything in Privilege changed since 2026-11-21.
5. The AgentCore runtime's own authorizer was not re-read today (the AWS login expired); scene 5 states only what AWS documents for a JWT runtime.

## Scenes

Slides are full screen and unnumbered; caption bubbles are numbered.

| # | On screen | Caption (what the viewer reads) | Source |
|---|---|---|---|
| Open | Slide: SigV4 credentials vs the gateway | Two ways to reach the AWS agent: sign each call with AWS credentials (the AgentCore default), or present an identity to the Privilege gateway, which checks it first. The A2A spec leaves how a client gets credentials to the deployment. On the wire AgentCore shows the 0.3.0 form (`message/send`), which 1.0.0 calls `SendMessage`. | AWS-AUTH; A2A §7.3; A2A-0.3; AWS-A2A |
| 1 | Tab heading, LIVE banner | A real call to an agent in AWS. The banner says LIVE: nothing here is simulated. | LAB |
| 2 | Custodian box | The custodian is the identity this agent's actions are attributed to: a user or a federated identity. Here it is a federated identity, PFawsagent. | PRIV; CONSOLE |
| 3 | Main agent box | Our agent. For each run it gets a fresh token from PingFederate with the OAuth client-credentials grant, and sends the A2A message with that token. | RFC 6749 §4.4; LAB; CONSOLE |
| 4 | Gateway box | The checkpoint: the token's issuer, audience and claims against the agent's identity settings, the `a2a` scope, then policy. A failed check stops the call here. | CONSOLE; PRIV |
| 5 | AWS agent box | The agent in AWS (Bedrock AgentCore). This app's Auth Mode is Pass Agent Token, so the caller's verified token goes on; a runtime set to JWT inbound auth accepts only a token from the issuer it trusts. | CONSOLE; PRIV; AWS-AUTH |
| 6 | Mode note | LIVE route, not a stand-in. | LAB |
| Slide | Real console screenshot + values | How Privilege is set up for this call: the app and the agent, as read from the console. | CONSOLE; PRIV; RFC 8693 §4.1 |
| Slide | Two columns | The A2A specification in five rules (§8, §4.4.1/4.5, §7.3, §7.4, §9.4.1) and where each shows up in this video. | A2A; A2A-0.3 |
| 7 | First suggested question | Ask it who it is: the answer can only come from the AWS side. | LAB |
| 8 | Card step, with the Agent Card panel | Step 1: read the Agent Card. Every A2A server publishes one at `/.well-known/agent-card.json`. This is AWS's card: `protocolVersion` 0.3.0, a top-level url, no `securitySchemes` declared, so the credential is arranged out of band. | A2A §8.1, §8.2, §7.3; A2A-0.3; AWS-A2A; live card |
| 9 | Delegate step, "What was sent" open | Step 2: one JSON-RPC 2.0 message to the gateway. The method on the wire is `message/send` (AgentCore's form; 1.0.0 calls it `SendMessage`). The credential is masked; the spec has it sent with every request. | AWS-A2A; A2A §5.3, §7.3 |
| 10 | Result step | Step 3: the AWS agent answers. The spec says a server MUST authenticate every request; that happened before the agent saw the message. | A2A §7.4 |
| 11 | Answer | The answer came from the agent in AWS. All four boxes lit up, in order. | LAB |
| 12 | "Try a refused call" | Now a refusal: the same question with a deliberately invalid credential. | LAB |
| 13 | Four boxes | The gateway refused it (HTTP 401) and the AWS agent was never reached. | LAB; live run |
| 14 | Error step | A 401 must carry a `WWW-Authenticate` challenge (RFC 9110 §15.5.2); the A2A spec says a server SHOULD include challenge information in a rejection. | RFC 9110; A2A §7.4, §3.3.2 |
| 15 | "What came back" | The challenge points at the resource's metadata (`resource_metadata`), the parameter RFC 9728 §5.1 defines, served under `/.well-known/oauth-protected-resource` (§3). AWS documents a `resource_metadata` challenge for a missing token on a JWT runtime. | RFC 9728; AWS-A2A |
| Slide (before the closing) | Two columns | What the Privilege gateway can protect: who may call, which surfaces, which peer agents and operations, what an A2A call says, what travels in it, the credential, accountability, human approval, secrets. | PRIV |
| Close | Slide | What the run showed (live call, card, refusal, config) and why it matters. Specs and docs listed. | all |

## What is masked and what is not on screen

- Masked everywhere the lab draws a route: the AWS account id (`accountId=` and inside an ARN, also URL-encoded). The old take (recorded before the mask) is deleted; never publish a take without scanning its stills for 12-digit runs.
- **Not masked, on purpose, internal viewers only:** the gateway host, the runtime id, and on the console screenshot the PingFederate issuer host, audience, JWKS URL and the two required-claim values. The screenshot is local-only (`video/assets/` is gitignored) because the lab repo is public and its rules forbid internal hostnames. Decide before sharing the video outside the company.
- The challenge shown in the refusal contains the gateway host in `resource_metadata` and `authorization_uri`.

## Not in this video (on purpose)

- The decoded token (issuer, audience, `act` claim). The console slide names the required claims; showing a live token is a separate scene that needs a redaction rule.
- Any claim about how a secrets hub supplies an agent credential: Ping's docs do not describe it. The hub appears only as the demo's labelled, off-by-default explainer toggle.
- Which AWS account the runtime is in. The tab masks the account id in every URL and card.
