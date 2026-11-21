<!--
  All the WORDING for the AWS A2A recording. Edit the text under each heading — nothing else needs to change.
  take.py reads this file and fills in the live values (a status code, a timing, the agent's own answer) around
  whatever you write here; it never touches this file itself. SCRIPT.md is the source for every claim below.

  Rules for editing safely:
  - Don't rename a "# Opening Slide" / "# Closing Slide" / "# Slide: <key>" / "# Step: <key>" heading, and don't rename
    a "## Title" / "## Text" / "## Lead" / "## Verdict" / "## Image" / "## Column A: ..." / "## Column B: ..." heading.
    Those names are how take.py finds the right piece of text. Editing the WORDS after them is always safe.
  - A "## Column A: <label>" or "## Column B: <label>" heading's <label> IS shown on the slide as that
    column's own heading — edit it freely, just keep "Column A:" / "Column B:" at the start of the line.
  - Keep each bullet under a column on its own line starting with "- ".
  - "## Image" (optional, slides only) is a file name under assets/, shown beside the columns.
  - "---" on its own line separates one section from the next. Keep those.
-->

# Opening Slide

## Title
An agent calls an agent in AWS, through a gateway

## Lead
Before the demo: two ways our agent could reach the agent that runs in AWS (Bedrock AgentCore). Both speak A2A (Agent2Agent).

## Column A: Obvious way: AWS credentials (SigV4)
- AWS's default inbound auth: sign every call with AWS credentials
- Our agent would have to hold AWS credentials; here it holds a token from our own identity provider instead
- No policy of ours sits in the path: AWS's own check is the only one

## Column B: This demo: through the Privilege gateway
- Our agent presents its own identity to the Privilege gateway
- The gateway checks that identity and applies the agent's scope and policy (Ping's docs) before anything is forwarded
- AWS's JWT inbound auth accepts only a valid bearer token from a configured issuer; this runtime accepted our PingFederate token

## Verdict
This demo uses the gateway path. A2A (Agent2Agent Protocol Specification, release 1.0.0, a2a-protocol.org) leaves how a client gets its credentials to the deployment. AgentCore's documented example still uses the 0.3.0 form: protocolVersion 0.3.0 and the method message/send, which 1.0.0 calls SendMessage.

---

# Slide: config

## Title
How Privilege is set up for this call

## Lead
Read from the Privilege console on 21 November 2026, nothing changed. Two objects matter: the Remote Agent app that fronts the runtime, and the agent that may call it.

## Image
console-agent-caller-crop.jpg

## Column A: The app: aws-agent-pass (Remote Agent)
- Backend: the AgentCore regional host, at /runtimes/<runtime>/invocations/
- Auth Mode: Pass Agent Token, so the caller's own verified token goes on to the AWS agent
- This app's gateway route is the address the lab calls

## Column B: The agent: aws-agent-caller (the screenshot)
- Custodian (principal): PFawsagent, a federated identity
- Scope: a2a, which means reaching peer agents
- No API key: it signs in with an OIDC token, from one issuer, for one audience: this app's route
- Every token must carry client_id and act.sub, the actor claim from RFC 8693
- Policy is enforced as the principal identity: every request authorizes as PFawsagent

## Verdict
In Privilege an agent reaches a Remote Agent only when the app is selected under its A2A access and policy allows it (Ping's agent privilege docs). This video does not exercise those checks. The refusal later is the identity check: a bad credential is stopped at sign-in, before any app or policy check.

---

# Slide: protect

## Title
What the Privilege gateway can protect

## Lead
One enforcement point for agent traffic. From Ping's documentation for Agent Privilege:

## Column A: What it enforces
- Who may call: an API key or a workload identity; unregistered or revoked agents are denied, and identity is checked on every call
- Which surfaces: key scopes for models (LLM), tools (MCP) and peer agents (A2A)
- Which peer agents and operations: a Remote Agent must be selected on the agent, and policy picks operations by user or group and time window
- What an A2A call says: skill policies can target an advertised skill or read the message parts
- What travels in it: AI Guard allows, alerts, sanitizes or blocks traffic on MCP, A2A and LLM

## Column B: What that protects
- The credential: validated and ended at the gateway, which injects what the target needs (this app passes the caller's own token instead)
- Accountability: the custodian, and every call and policy decision in Activity Logs, streamable to a SIEM
- Risky actions: policies can hold an action for human approval instead of refusing it
- Secrets: hubs connect external vaults (AWS Secrets Manager, Azure Key Vault, Delinea, GCP) so users check out secrets by policy

## Verdict
This video shows the identity check and the refusal. The rest is what Ping's docs say Privilege can do; it was not set up or shown here.

---

# Slide: spec

## Title
Five things the A2A specification says

## Lead
Agent2Agent (A2A) Protocol Specification, release 1.0.0, a2a-protocol.org. Section numbers are from that release; AgentCore's documentation still shows the 0.3.0 form.

## Column A: What the spec says
- Section 8: every A2A server publishes an Agent Card, a manifest of its identity, skills and requirements; clients find it at /.well-known/agent-card.json (8.2)
- Sections 4.4.1 and 4.5: the card's optional securitySchemes say what auth it needs: API key, HTTP (Bearer), OAuth 2, OpenID Connect or mutual TLS
- Section 7.3: the client gets its credentials out of band (arranged outside A2A) and sends them with every request
- Section 7.4: the server MUST authenticate every incoming request, and SHOULD include challenge information when it rejects one
- Sections 5.3 and 9.4.1: sending a message is one JSON-RPC call, SendMessage in 1.0.0 (message/send in 0.3.0)

## Column B: Where you will see it here
- The Agent Card step: AWS's own card, read through the gateway
- That card says protocolVersion 0.3.0 and declares no securitySchemes
- The credential is on every request in the trace, masked
- The refusal: a 401 with a challenge
- The message: a JSON-RPC 2.0 POST, method message/send

## Verdict
A2A (agent to agent) and MCP (agent to tools) are complementary: Appendix B of the specification.

---

# Slide: sample_note

<!-- Sample take only. Never shown in the real take. -->

## Title
SAMPLE: simulated, not a real run

## Lead
This preview uses the lab's local stand-in for the AWS agent so you can review wording and pacing. The real take replaces it with a live call.

## Column A: What is simulated
- The AWS agent is a local stand-in, called directly
- The refusal comes from the stand-in, not from a gateway
- Nothing touches Privilege or AWS

## Column B: What is real in this preview
- The script, the captions and the three slides
- The screenshot of the Privilege console
- The tab, the Agent Card panel and the trace, as the lab draws them

## Verdict
Review the wording and pacing; the real take is recorded after this.

---

# Closing Slide

<!-- Draft - review this one in particular: what the run actually showed, and why it was worth showing. -->

## Title
What this run just showed

## Lead
A real agent on this machine asked a real agent running in AWS a question, and its own answer came back, with the gateway in the path both ways. Then a bad credential was refused before it reached AWS.

## Column A: What we did
- Opened the Custodian to AWS agent tab, in live mode: the call went to the gateway, not to a stand-in
- Showed how Privilege is set up for it: a Remote Agent app and a federated-identity agent
- Read the AWS agent's Agent Card through the gateway before sending anything
- Sent one A2A message (JSON-RPC 2.0, method message/send) and got the AWS agent's own reply
- Sent the same message with an invalid credential and saw a 401 with a challenge

## Column B: Why it matters
- Our agent held no AWS credentials, only a PingFederate token that the gateway checked and passed on
- The gateway checks the agent's identity on every call (Ping's docs): it passed the real token and refused the bad one
- A refused call stops at the gateway and never reaches AWS
- The 401 tells a client where to learn how to sign in

## Verdict
Agent to agent across clouds, with a policy point in the middle. Specs: A2A Protocol Specification 1.0.0; AWS Bedrock AgentCore A2A contract; RFC 9110 section 15.5.2; RFC 9728. Privilege: Ping's Agent Privilege documentation.

---

# Step: intro

## Title
A real call to an agent in AWS

## Text
This is the Custodian to AWS agent tab, one agent reaching another in AWS, and who is accountable along the way. The banner says LIVE: nothing here is simulated.

---

# Step: custodian

## Title
The custodian

## Text
The custodian is the identity this agent's actions are attributed to: a user or a federated identity. Here it is a federated identity, PFawsagent.

---

# Step: main_agent

## Title
Our agent, on this machine

## Text
For each run it gets a fresh token from PingFederate, using the OAuth client-credentials grant (RFC 6749, section 4.4), and sends the A2A message with it.

---

# Step: gateway

## Title
The gateway is the checkpoint

## Text
Privilege checks the token's issuer, audience and claims against the agent's identity settings, then the a2a scope and policy. If a check fails, the call stops here.

---

# Step: aws_agent

## Title
The agent in AWS

## Text
It runs on Bedrock AgentCore. This app's Auth Mode is Pass Agent Token, so the caller's verified token is passed on to AWS. A runtime set to JWT inbound auth accepts only a valid token from an issuer it trusts.

---

# Step: live_banner

## Title
Live, not simulated

## Text
With no route set, this tab uses a local stand-in and says so. This one says LIVE route, so the call really goes through the gateway to AWS.

---

# Step: pick_prompt

## Title
Ask it who it is

## Text
The first suggested question asks the AWS agent to introduce itself, so its answer can only come from the AWS side.

---

# Step: agent_card

## Title
Step 1: read the Agent Card

## Text
Every A2A server publishes an Agent Card (spec section 8.1), usually found at /.well-known/agent-card.json (8.2). This is AWS's card, through the gateway. It says protocolVersion 0.3.0 and declares no securitySchemes, and the credential is arranged out of band, outside A2A (section 7.3).

---

# Step: delegate

## Title
Step 2: send the message

## Text
One JSON-RPC 2.0 message goes to the gateway. Open What was sent: the credential is masked. The method on the wire is message/send, the form AgentCore documents; 1.0.0 calls it SendMessage. The spec has the credential sent with every request.

---

# Step: result

## Title
Step 3: the AWS agent answers

## Text
The reply is the AWS agent's own, passed through the gateway. The A2A specification says a server must authenticate every request (section 7.4); that happened before the agent saw the message.

---

# Step: answer

## Title
The answer on screen

## Text
This text came from the agent running in AWS. All four boxes lit up, in order, as the run reached them.

---

# Step: refuse_intro

## Title
Now a refusal

## Text
The same question, with a deliberately invalid credential. Nothing else changes. Watch which box stops it.

---

# Step: refused_states

## Title
Stopped at the gateway

## Text
The gateway refused it with HTTP 401, and the AWS agent was never reached.

---

# Step: refused_http

## Title
A 401 carries a challenge

## Text
RFC 9110, section 15.5.2: a 401 must include a WWW-Authenticate header. The A2A specification (section 7.4) says a server should include challenge information when it rejects a request.

---

# Step: refused_metadata

## Title
Where to learn how to sign in

## Text
The challenge points at a description of this API's sign-in setup, its resource metadata, with the resource_metadata parameter that RFC 9728 (section 5.1) defines. The RFC's default location for it is /.well-known/oauth-protected-resource (section 3).

---

# Step: sample_intro

<!-- Sample take only (SAMPLE=1, mock stand-in). Replaces the "intro" text so the sample never claims to be live. -->

## Title
SAMPLE: simulated, not a real run

## Text
This preview uses the lab's local stand-in for the AWS agent, so you can review the wording and pacing. Nothing here touches Privilege or AWS. The real take replaces this with a live call.

---

# Step: sample_live_banner

## Title
Simulated, and it says so

## Text
With no route set, the tab labels itself SIMULATED and calls a local stand-in directly, so the gateway box is not in the path. The real take shows LIVE route here.

---

# Step: sample_refused_states

## Title
Stopped (simulated)

## Text
In this preview the local stand-in refuses the invalid credential with HTTP 401. In the real take the gateway does, and the AWS agent is never reached.

---

# Step: sample_refused_http

## Title
A 401 carries a challenge

## Text
RFC 9110, section 15.5.2: a 401 must include a WWW-Authenticate header. The stand-in sends a simple one; the real take shows the real gateway's header.

---

# Step: sample_closing_lead

## Title
Sample closing lead

## Text
A preview run against the local stand-in. The real take makes the same calls through the Privilege gateway to the agent in AWS.

---

# Step: sample_closing_bullet

## Title
Sample closing bullet

## Text
Opened the Custodian to AWS agent tab in simulated mode: the call went to a local stand-in, not to the gateway
