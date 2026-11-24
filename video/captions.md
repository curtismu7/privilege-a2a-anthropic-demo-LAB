<!--
  All the WORDING for the two-part A2A recording. Edit the text under each heading — nothing else needs to change.
  The lab serves this file at GET /api/story (the shared Story parser); the live Story and take.py both read that, and take.py fills in the live values (a status code,
  a timing, the agent's own answer) around whatever you write here; it never touches this file itself. SCRIPT.md is the source for every claim below.

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
A2A is how one agent hands work to another. Part 1: our two agents. Part 2: an agent in AWS.

## Column A: Obvious way
- Each agent holds the other's credentials
- Nothing in the middle decides
- No place to stop a bad call

## Column B: These demos: the Privilege gateway
- Each agent shows its own identity to the gateway
- The gateway checks and screens, then forwards
- One place to see and refuse every call

## Verdict
This is a real run, not a mock: live agents, a live gateway and a live AWS agent.

---

# Slide: part2

## Title
Part 2: an agent that runs in AWS

## Lead
The same gateway, in front of an agent on Amazon Bedrock AgentCore.

## Column A: Two ways to reach it
- AWS's default: sign every call with AWS credentials
- This demo: a token from our own identity provider, PingFederate

## Column B: What to watch for
- The token, decoded
- The Agent Card the AWS agent publishes
- A refusal, and which box stops it

## Verdict
The A2A spec leaves how a client gets credentials to the deployment (section 7.3).

---

# Slide: config_app

## Title
How Privilege is set up: the app

## Lead
Read from the Privilege console on 22 November 2026, nothing changed.

## Image
console-app-worker-crop.jpg

## Column A: aws-agent-worker (Remote Agent)
- Backend: the AgentCore regional host
- Auth Mode: Pass Agent Token, so the caller's own verified token goes on to AWS

## Column B: The route
- The gateway route is the address our agent calls
- Its audience is checked against the agent's identity next

## Verdict
An agent reaches a Remote Agent only when the app is selected under its A2A access and policy allows it.

---

# Slide: config_agent

## Title
How Privilege is set up: the agent

## Lead
The agent that may call the app, as read from the console.

## Image
console-agent-caller-crop.jpg

## Column A: aws-agent-caller
- Custodian: aws-agent-caller-identity, a federated identity
- Scope: a2a, reaching peer agents
- No API key: a token from one issuer, for one audience

## Column B: Every token must carry
- client_id and act.sub (the actor claim, RFC 8693)
- Policy is enforced as the principal identity

## Verdict
The refusal later is this identity check, before any app or policy check.

---

# Slide: config_policy

## Title
How Privilege is set up: the policy

## Lead
The policy that joins them, from the console's access graph.

## Image
console-policy-crop.jpg

## Layout
wide

## Column A: What the graph shows
- The identity, aws-agent-caller-identity, is allowed
- through this policy, to the agent key aws-agent-caller
- and on to the app aws-agent-worker

## Column B: Why it matters
- Per Ping's docs, an agent reaches a Remote Agent only when policy allows it
- Policy can pick operations by user, group and time

## Verdict
A bad credential never gets as far as this policy.

---

# Slide: spec

## Title
Five things the A2A specification says

## Lead
A2A Protocol Specification, release 1.0.0.

## Column A: What the spec says
- 8: servers publish an Agent Card
- 4.4.1, 4.5: its securitySchemes say what auth it needs
- 7.3: credentials arranged out of band, sent every request
- 7.4: server MUST authenticate every request, SHOULD say how
- 5.3, 9.4.1: sending is one JSON-RPC call (message/send on AgentCore, SendMessage in 1.0.0)

## Column B: Where you will see it
- The Agent Card step
- The token on every request
- The JSON-RPC message
- The 401 challenge

## Verdict
A2A is agent to agent; MCP is agent to tools (Appendix B).

---

# Slide: rfcs

## Title
The RFCs behind what you saw

## Lead
Each pop-out names the RFC behind what it shows.

## Column A: Getting and carrying a token
- RFC 6749 section 4.4: client-credentials grant, how our agent gets its token
- RFC 6750: Bearer token, and the 401 challenge
- RFC 7519: JWT claims: issuer, subject, audience, expiry
- RFC 9068: a JWT access token carries client_id

## Column B: Who is acting, and refusals
- RFC 8693: the act claim, who acts for whom
- RFC 7515: the token header: alg and kid
- RFC 9110 section 15.5.2: a 401 must carry WWW-Authenticate
- RFC 9728: resource_metadata, where to learn how to sign in

## Verdict
Each rule is paraphrased at the moment it shows up.

---

# Slide: observability

<!-- The columns, image and lead are replaced at record time from assets/observability.json (captured from the logs of the recorded run). The text here is the fallback and the standard wording. -->

## Title
What ends up for observability

## Lead
The log entries this run left behind, read straight after the recording.

## Image
console-activity-logs-crop.jpg

## Layout
wide

## Column A: Allowed (console Activity Logs, above)
- The Agent Card read and the message send, as aws-agent-caller-identity

## Column B: Refused and blocked (gateway log excerpt)
- The refused call and the blocked data call, with their timestamps

## Verdict
Excerpts, ids masked. Logs can stream to a SIEM (Ping's docs).

---

# Slide: protect

## Title
What the Privilege gateway can protect

## Lead
One enforcement point for agent traffic (Ping's Agent Privilege docs).

## Column A: What it enforces
- Who may call: identity checked on every call
- Which surfaces: models, tools (MCP), agents (A2A)
- Which agents and operations, by user, group and time
- What an A2A call says, down to a skill
- What travels in it: AI Guard allows, sanitizes or blocks

## Column B: What that protects
- The credential, ended at the gateway
- Accountability: custodian and Activity Logs
- Risky actions held for human approval
- Secrets from external vaults

## Verdict
This video showed identity checks, data screening and refusals; the rest is from Ping's docs.

---

# Slide: sample_note

<!-- Sample take only. Never shown in the final take. -->

## Title
SAMPLE: simulated, not a live run

## Lead
Local stand-ins, so you can review wording and pacing.

## Column A: What is simulated
- Part 1 is replayed from two recorded live runs
- The AWS agent is a local stand-in
- The refusals come from the stand-ins
- No token mint, so the token scenes are skipped

## Column B: What is genuine
- The script, captions and slides
- The console screenshots
- The tabs, reel and trace, as the lab draws them

## Verdict
The final take is recorded after this.

---

# Closing Slide

## Title
What these two runs showed

## Lead
Our two agents handed work over A2A, and an agent in AWS answered ours, each with the gateway in the path. A call that should not pass was stopped.

## Column A: What we did
- Part 1: data read over MCP, email redacted
- Part 1: a data call blocked by the gateway
- Part 2: a token, the card, two answered messages
- Part 2: an invalid credential got a 401

## Column B: Why it matters
- Our agent held no AWS credentials
- Identity checked on every call, data screened in flight
- A refused call never reaches the other agent
- Every call is a frame with its token and spec

## Verdict
Specs: A2A 1.0.0; AgentCore A2A contract; RFC 6749, 6750, 7519, 8693, 9068, 9110, 9728.

---

# Step: p1_intro

## Title
Part 1: our two agents

## Text
The A2A with remote agents tab. The concierge is the agent you talk to. The analyst is a second agent that reads the access data. Privilege sits between them.

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
The Custodian to AWS agent tab: one of our agents reaching an agent in AWS, and who is accountable along the way.

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

---

# Step: observability_panel

<!-- Story only: the live Run observability panel under the run. The recorded video shows its own captured-evidence slide ("Slide: observability") instead. -->

## Title
What each layer logged for this run

## Text
This panel lists what each layer left for the run you just made: the responses this lab received and any log lines its readers found, each with its own time and a tag that says where it came from. Ids, tokens and addresses are masked. A layer with no line says so; nothing is claimed for it.

---

# Step: sample_observability_panel

<!-- Story only, simulated run: what the panel shows when no product wrote a log. -->

## Title
What each layer logged for this run

## Text
In this simulated run no product wrote a log line. The panel lists what this lab itself noted for the run, so you can see how the real panel reads.

---

# Step: sample_p1_handoff

<!-- Story only, simulated run: the live wording says a call happened; this run made none. -->

## Title
The A2A handoff (simulated)

## Text
This is the shape of the handoff the live demo shows: the concierge hands the question to the analyst, and every call is one frame on the reel. In this simulated run no A2A call was made.

---

# Step: sample_p1_redacted

<!-- Story only, simulated run: nothing was screened here. -->

## Title
Where the gateway screens the data (simulated)

## Text
The email shows as [REDACTED:pii], the way the live demo shows data the gateway screened. In this simulated run nothing was screened; the redaction is part of the recorded shape.

---

# Step: sample_p1_blocked

<!-- Story only, simulated run: no gateway blocked anything here. -->

## Title
Blocked in flight (simulated)

## Text
This shows how the live demo reads when the gateway blocks a tool response: no data reaches the analyst. In this simulated run no gateway was involved; the block is part of the recorded shape.
---

# Step: sample_p1_intro

<!-- Story only, simulated run: the live wording says Privilege sits between the agents -->

## Title
The A2A with remote agents tab (simulated)

## Text
The concierge is the agent you talk to; the analyst is a second agent that reads the access data. In the live demo Privilege sits between them. Here the agents are a local simulation, as the banner says.

---

# Step: sample_p1_message

<!-- Story only, simulated run: the live wording says a message is sent -->

## Title
The message between the agents (simulated)

## Text
In the live demo one JSON-RPC message goes from the concierge to the analyst with an agent key, shown masked. This frame shows the shape of that message; in this simulated run nothing was sent.

---

# Step: sample_p1_mcp

<!-- Story only, simulated run: the live wording says the analyst uses MCP -->

## Title
The analyst reads the data (simulated)

## Text
In the live demo the analyst reads the data over MCP: A2A is how agents talk to each other, MCP is how an agent uses tools (specification, Appendix B). In this simulated run no tool was called.

---

# Step: sample_p1_answer

<!-- Story only, simulated run: the live wording says the answer came from the analyst -->

## Title
The answer (simulated)

## Text
In the live demo the concierge answers from what the analyst returned, and nothing the data did not say. This answer is canned: no model and no analyst produced it.

