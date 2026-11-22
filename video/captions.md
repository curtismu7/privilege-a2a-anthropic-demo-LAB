<!--
  All the WORDING for the two-part A2A recording. Edit the text under each heading — nothing else needs to change.
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
Agents calling agents, through a gateway

## Lead
Two demos of A2A (Agent2Agent), a protocol for one agent to hand work to another. First our own two agents, then an agent that runs in AWS (Bedrock AgentCore). This is a real run, with the calls and tokens shown as they happen.

## Column A: Obvious way: each side trusts the other directly
- Each agent holds the credentials the other one accepts
- Nothing in the middle decides what a call may do
- When an agent misbehaves, there is no single place to stop it

## Column B: These demos: through the Privilege gateway
- Each agent presents its own identity to the Privilege gateway
- The gateway checks it, applies the agent's scope and policy, and screens what travels, before anything is forwarded
- One place to see every call and to refuse one

## Verdict
Part 1: our two agents, with data behind them. Part 2: an agent in AWS, with a bad credential refused at the gateway.

---

# Slide: part2

## Title
Part 2: an agent that runs in AWS

## Lead
The same gateway, now in front of an agent on Amazon Bedrock AgentCore, in another cloud.

## Column A: Two ways to reach it
- AWS's default: sign every call with AWS credentials, so our agent would hold AWS credentials
- This demo: our agent holds a token from our own identity provider, PingFederate, and presents it to the gateway

## Column B: What to watch for
- The token, decoded: who issued it, who it is for, how long it lives
- The Agent Card the AWS agent publishes
- A refusal, and which box stops it

## Verdict
The A2A specification leaves how a client gets its credentials to the deployment (section 7.3).

---

# Slide: config_app

## Title
How Privilege is set up: the app

## Lead
Read from the Privilege console on 22 November 2026, nothing changed. The app is the front door to the agent in AWS.

## Image
console-app-worker-crop.jpg

## Column A: aws-agent-worker (Remote Agent)
- Backend: the AgentCore regional host
- Auth Mode: Pass Agent Token, so the caller's own verified token goes on to the AWS agent

## Column B: The route
- This app's gateway route is the address our agent calls
- Its audience is checked against the agent's identity on the next slide

## Verdict
In Privilege an agent reaches a Remote Agent only when the app is selected under its A2A access and policy allows it (Ping's agent privilege docs).

---

# Slide: config_agent

## Title
How Privilege is set up: the agent

## Lead
The agent that is allowed to call the app, as read from the console.

## Image
console-agent-caller-crop.jpg

## Column A: aws-agent-caller
- Custodian (principal): aws-agent-caller-identity, a federated identity
- Scope: a2a, which means reaching peer agents
- No API key: it signs in with a token from one issuer, for one audience

## Column B: What every token must carry
- client_id and act.sub, the actor claim from RFC 8693
- Policy is enforced as the principal identity: every request authorizes as aws-agent-caller-identity

## Verdict
The refusal later is this identity check: a bad credential is stopped at sign-in, before any app or policy check.

---

# Slide: spec

## Title
Five things the A2A specification says

## Lead
Agent2Agent (A2A) Protocol Specification, release 1.0.0, a2a-protocol.org. Section numbers are from that release.

## Column A: What the spec says
- Section 8: every A2A server publishes an Agent Card, a manifest of its identity, skills and requirements, found at /.well-known/agent-card.json (8.2)
- Sections 4.4.1 and 4.5: the card's optional securitySchemes say what auth it needs
- Section 7.3: the client gets its credentials out of band and sends them with every request
- Section 7.4: the server MUST authenticate every request, and SHOULD include challenge information when it rejects one
- Sections 5.3 and 9.4.1: sending a message is one JSON-RPC call. AgentCore documents it as message/send; 1.0.0 calls it SendMessage

## Column B: Where you will see it here
- The Agent Card step
- The token on every request, shown decoded
- The message: a JSON-RPC 2.0 POST
- The refusal: a 401 with a challenge, and the metadata it points to

## Verdict
A2A (agent to agent) and MCP (agent to tools) are complementary: Appendix B of the specification.

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
- Secrets: hubs connect external vaults so users check out secrets by policy

## Verdict
This video shows the identity check, the data screening and the refusals. The rest is what Ping's docs say Privilege can do; it was not set up or shown here.

---

# Slide: sample_note

<!-- Sample take only. Never shown in the final take. -->

## Title
SAMPLE: simulated, not a live run

## Lead
This preview uses the lab's local stand-ins so you can review wording and pacing. The final take replaces them with live calls.

## Column A: What is simulated
- Part 1 is replayed from two recorded live runs, not run again
- The AWS agent is a local stand-in, called directly
- The refusals come from the stand-ins, not from a gateway
- There is no token mint, so the token scenes are skipped

## Column B: What is genuine in this preview
- The script, the captions and the slides
- The screenshots of the Privilege console
- The tabs, the reel and the trace, as the lab draws them

## Verdict
Review the wording and pacing; the final take is recorded after this.

---

# Closing Slide

## Title
What these two runs showed

## Lead
Two agents of ours handed work over A2A, and an agent in AWS answered ours, each with the gateway in the path. In both, a call that should not pass was stopped.

## Column A: What we did
- Part 1: asked the concierge a question; it handed it to the analyst over A2A; the analyst read data over MCP and the email came back redacted
- Part 1: asked about a resource whose data the gateway blocks, and no data came back
- Part 2: our agent got a token from PingFederate, read the AWS agent's card, and sent two A2A messages, each answered by the AWS agent
- Part 2: sent a deliberately invalid credential and saw a 401 with a challenge

## Column B: Why it matters
- Our agent held no AWS credentials, only a token the gateway checked and passed on
- Identity is checked on every call (Ping's docs), and data is screened in flight
- A refused call stops at the gateway and never reaches the other agent
- Every call is one frame on the reel, with its token and the spec behind it

## Verdict
Agent to agent, with a policy point in the middle. Specs: A2A Protocol Specification 1.0.0; AWS Bedrock AgentCore A2A contract; RFC 9110 section 15.5.2; RFC 6750; RFC 9728; RFC 7519; RFC 6749; RFC 8693. Privilege: Ping's Agent Privilege documentation.

---

# Step: p1_intro

## Title
Part 1: our two agents

## Text
The Access review tab. The concierge is the agent you talk to. The analyst is a second agent that reads the access data. Privilege sits between them.

---

# Step: p1_prompt

## Title
Ask a plain question

## Text
The concierge does not hold the data, so it has to hand the question to the analyst.

---

# Step: p1_handoff

## Title
The A2A handoff

## Text
The concierge hands the question to the analyst over A2A. The custodian is the identity this run is attributed to. Every call below is one frame on the reel.

---

# Step: p1_message

## Title
The message, opened

## Text
One JSON-RPC message goes from the concierge to the analyst. The credential is an agent key, shown masked, and the spec has it sent with every request.

---

# Step: p1_mcp

## Title
Agent to tools: MCP

## Text
To read the data, the analyst uses MCP. A2A is how agents talk to each other; MCP is how an agent uses tools (specification, Appendix B).

---

# Step: p1_redacted

## Title
The gateway screens the data

## Text
The grant is readable, but the email came back as [REDACTED:pii]. Privilege screened the tool response on its way to the analyst.

---

# Step: p1_answer

## Title
The answer

## Text
The concierge answers from what the analyst returned, and nothing the data did not say.

---

# Step: p1_refuse_prompt

## Title
Now a question the gateway will stop

## Text
The same path, for a resource whose data carries a planted hostile instruction. Watch the tool call.

---

# Step: p1_blocked

## Title
Blocked in flight

## Text
The tool response was blocked by a security policy, and no data reached the analyst. The agents did not decide that; the gateway did.

---

# Step: intro

## Title
The AWS agent tab

## Text
The Custodian to AWS agent tab: one of our agents reaching an agent in AWS, and who is accountable along the way. The banner says LIVE.

---

# Step: custodian

## Title
The custodian

## Text
The custodian is the identity this agent's actions are attributed to: a user or a federated identity. Here it is a federated identity, aws-agent-caller-identity.

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
It runs on Bedrock AgentCore. This app's Auth Mode is Pass Agent Token, so the caller's verified token is passed on. A runtime set to JWT inbound auth accepts only a valid token from an issuer it trusts.

---

# Step: live_banner

## Title
Live, not simulated

## Text
With no route set, this tab uses a local stand-in and says so. This one says LIVE route, so the call goes through the gateway to AWS.

---

# Step: pick_prompt

## Title
Ask it to use its tool

## Text
The AWS agent has one tool, add_numbers. We ask it to add two large numbers and show the exact call, so the answer can only come from the AWS side.

---

# Step: token_frame

## Title
Call 1: get a token

## Text
Our agent asks PingFederate for a token with the client-credentials grant. The client secret is masked, and the token is never shown raw. Select the frame to open it.

---

# Step: token_popout

## Title
The token, decoded

## Text
Issuer, subject, audience, expiry, client_id and the act claim, each with the RFC that defines it. The signature is never shown. This token is what the gateway checks.

---

# Step: card_frame

## Title
Call 2: read the Agent Card

## Text
Every A2A server publishes an Agent Card (spec section 8.1), found at /.well-known/agent-card.json (8.2). This is the AWS agent's card, read through the gateway, with the same token on it.

---

# Step: message_popout

## Title
Call 3: send the message

## Text
One JSON-RPC 2.0 message goes to the gateway with the same token. The method on the wire is message/send, the form AgentCore documents; 1.0.0 calls it SendMessage.

---

# Step: result

## Title
The AWS agent answers

## Text
The reply is the AWS agent's own, passed through the gateway. The specification says a server must authenticate every request (section 7.4); that happened before the agent saw the message.

---

# Step: answer

## Title
The answer on screen

## Text
The agent shows the exact call it made, add_numbers, and the sum: 1,111,111,110. This text came from the agent running in AWS. All four boxes lit up, in order.

---

# Step: second_prompt

## Title
A second question, with some reasoning

## Text
Now it must use the tool and then reason about the result: is the sum even or odd?

---

# Step: second_answer

## Title
Tool, then reasoning

## Text
The answer combines the tool's result, 58,000, with the agent's own reasoning. Another full run, with a fresh token and the same checks.

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

# Step: refused_popout

## Title
A 401 carries a challenge

## Text
RFC 9110, section 15.5.2: a 401 must include a WWW-Authenticate header. Here each part is explained, and the A2A specification (section 7.4) says a server should include challenge information.

---

# Step: refused_metadata

## Title
Where to learn how to sign in

## Text
The challenge points at a description of this service's sign-in setup, with the resource_metadata parameter that RFC 9728 (section 5.1) defines. Our app read it, from the same host only, with no credentials.

---

# Step: sample_intro

## Title
SAMPLE: simulated, not a live run

## Text
This preview uses the lab's local stand-ins, so you can review the wording and pacing. Nothing here touches Privilege or AWS.

---

# Step: sample_live_banner

## Title
Simulated, and it says so

## Text
With no route set, the tab labels itself SIMULATED and calls a local stand-in directly, so the gateway box is not in the path. The final take shows LIVE route here.

---

# Step: sample_refused_states

## Title
Stopped (simulated)

## Text
In this preview the local stand-in refuses the invalid credential with HTTP 401. In the final take the gateway does, and the AWS agent is never reached.

---

# Step: sample_closing_lead

## Title
Sample closing lead

## Text
A preview run against local stand-ins. The final take makes the same calls through the Privilege gateway.

---

# Step: sample_closing_bullet

## Title
Sample closing bullet

## Text
Ran the tabs in simulated mode: the calls went to local stand-ins, not to the gateway
