# Bedrock IAM tab spec

**Status:** agreed (owner, 2026-11-24)   **Owner:** the lab owner   **Tier:** 2 (colleagues demo this lab)

## Goal
A third tab, **"Gateway to Bedrock (IAM)"**. It shows our agent's model call going through the Privilege gateway to Amazon Bedrock. There, the gateway signs the call with an AWS identity instead of a stored AWS key: its own role, or a role it assumes in the same account or in another account, with an External ID. A Bedrock guardrail screens the prompt as AI Guard. Owner decisions:
- both parts (A: IAM-signed model calls; B: guardrails);
- **Mock first**: every case is simulated offline and labelled simulated. Real is wired later, once a gateway VM with the IAM roles exists;
- **mirror the Privilege console's labels** (owner, 2026-11-24, which replaces "generic wording" after showing the key screen): Provider, Region, "Sign as this gateway (IAM)", Role ARN, External ID, Session Name, Upstream URL. Never name a build or the internal QA document. Never use real account ids or hosts;
- **the Bedrock type is chosen**: AWS Bedrock (Runtime) or AWS Bedrock (Mantle), and every run shows the calls and permissions of that type;
- Story bubbles for the tab in the same PR (Story-only; the video part comes later).

## What the page shows
- **Tab:** `#tab-bedrock` / `#panel-bedrock`, URL hash `#bedrock`. The tab bar's keyboard handling (arrows, Home, End) works over three tabs, not two.
- **Heading and lede.** The agent holds only its Privilege key. No AWS access key exists in the agent or in the gateway's settings: the gateway calls Bedrock as an IAM role.
- **Banner `#bedrock-mode`.** It always says SIMULATED: nothing in Privilege or AWS is called, in Mock or Real, and Real needs a gateway with an IAM role, not set up yet.
- **Flow nodes** (same look as the AWS tab): Main agent → Privilege gateway → AWS STS (assume role; "not used" for the gateway's own role) → Bedrock guardrail (when on) → Bedrock model. Each node shows its state (waiting, working, done, refused, blocked, skipped).
- **The agent key's settings** (`#bedrock-key`), laid out like the console's "Model Access & Limits", with the same labels:
  - **Provider**: AWS Bedrock (Runtime) or AWS Bedrock (Mantle);
  - **Region**: required, example `us-east-1`;
  - **Sign as this gateway (IAM)**: a toggle, with the console's hint "Authenticate with SigV4 as this gateway's own AWS identity instead of a Bedrock API key". Off means the gateway injects a stored Bedrock API key (the Real Provider Key) instead, and the flow shows no STS step;
  - **Role ARN**: blank uses the gateway host's own identity; example `arn:aws:iam::111122223333:role/privilege-bedrock`;
  - **External ID**: matches, wrong or blank (only with a Role ARN);
  - **Session Name**: default `privilege-ai-gateway`; it labels the assumed session in the target account's CloudTrail;
  - **Upstream URL**: optional, display only.

  A note repeats the console's own: the agent still sends its virtual key as a bearer token, and the gateway replaces it.
- **Controls for Demo mode:** a question input, plus the guardrail settings: "Screen with a Bedrock guardrail" on or off, "Fail closed" on or off, and "Guardrail role reachable" on or off.
- **Runtime vs Mantle.**
  - The "Call the model" frame shows Runtime's `bedrock-runtime` InvokeModel / Converse, or Mantle's CreateInference followed by DeleteInference (the release is part of every Mantle call).
  - The permissions shown follow the type. Runtime: `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream`, `bedrock:CountTokens`. Mantle: `bedrock-mantle:CreateInference`, `bedrock-mantle:DeleteInference`, `bedrock-mantle:CountTokens`.
  - Also shown: `sts:AssumeRole` when a Role ARN is set (with the External ID condition); `CallWithBearerToken` is not used; third-party models also need their AWS Marketplace subscription.
- **Scenario buttons.** Each one sets the controls and runs; these are what Story presses:

| Button id | Case | Simulated result |
|---|---|---|
| `#bedrock-sc-apikey` | Sign as this gateway (IAM) off: a stored Bedrock API key | the model answers; no STS step; the frame says a stored key was injected |
| `#bedrock-sc-own` | A1: the gateway's own role, clean prompt | the model answers |
| `#bedrock-sc-mantle` | A1 on Mantle | CreateInference, then DeleteInference; the model answers |
| `#bedrock-sc-same` | A2: same-account role, matching External ID | AssumeRole ok, the model answers |
| `#bedrock-sc-cross` | A3: cross-account role, matching External ID | AssumeRole in the other account ok, the model answers |
| `#bedrock-sc-wrong-ext` | A3 with a wrong External ID | AssumeRole denied. The gateway returns a generic HTTP 502 `upstream_unreachable`, as today; the page says that the caller cannot tell why. |
| `#bedrock-sc-denied` | guardrail on, a prompt on a denied topic (investment advice) | blocked by the guardrail; the model is never called |
| `#bedrock-sc-fail-closed` | guardrail role unreachable, Fail closed on | request blocked |
| `#bedrock-sc-fail-open` | guardrail role unreachable, Fail closed off | passes uninspected, with a warning; the model answers |

- **Answer box, reel and trace.** The answer is `#bedrock-answer`; it carries `is-error` and `is-blocked` states. The reel `#bedrock-reel` uses the page's existing Reel (`window.Reel.attach`), with frames "Send the prompt", "Assume the role", "Check the guardrail", "Call the model", and "Refused" or "Blocked". Each frame holds the request and response the simulation produced. The trace is `#bedrock-trace`.
- **"What the IAM role needs"** (`<details id="bedrock-iam">`, public AWS knowledge, example account `111122223333` only):
  - model calls: `bedrock:InvokeModel`, `InvokeModelWithResponseStream`, `CountTokens`;
  - guardrails: `bedrock:ApplyGuardrail`;
  - assumed roles: `sts:AssumeRole`, with a trust policy naming the gateway role and an `sts:ExternalId` condition;
  - the common failures: model access not enabled in that account and region; an account id in a foundation-model ARN (it must be `::`); a cross-region inference profile without the destination region's model ARNs; the IMDS hop limit at 1 for a gateway in Docker.

## Server
- `POST /bedrock` with body `{ message, provider: 'runtime'|'mantle', iam: boolean, identity: 'own'|'same'|'cross', externalId: 'match'|'wrong'|'missing', sessionName?: string (at most 64 characters, [\w+=,.@-]), guard: { on, failClosed, reachable } }`. It streams SSE `trace`, `token`, and `done`/`error` events, like `/aws-agent`.
- The deterministic simulator `src/bedrockSim.ts` is pure: input to a list of events, with no network.
  - A clean prompt gets a short canned answer that says it is simulated.
  - The denied topic is detected by keyword.
  - Hosts are `.example` only; ARNs use `111122223333` and `444455556666`.
- Body validation: an unknown enum value is a 400; a message is required and at most 4000 characters.
- The route uses the same origin and BFF-secret guard as `/aws-agent`, and announces `paad:run-start` / `paad:run-end` from the page script (Story depends on them).
- Run observability: if `startRun`/`runObs` take a route name generically, record the run as `bedrock`. Otherwise leave it out and say so in the PR.

## Story (Story-only for now; the video does not change)
- A Part 3 slide, `part3`, then about 13 bubbles keyed `b_*`, placed before the `protect` slide.
- `tab: 'bedrock'`. Scenario steps use `prompt: { press: '#bedrock-sc-...' }`; results use `run-done` targets that exist only when the page shows that result: the blocked answer, the refused node, the `Assume the role` frame.
- Every key goes in `STORY_ONLY`. The wording goes in `video/captions.md`, says simulated, and uses the generic phrasing.
- The `storyWiring.js` host learns the `bedrock` tab: `switchTab`, and `INPUTS` gets `#bedrock-input` / `#bedrock-send`.

## Acceptance criteria
1. The unit tests of `bedrockSim` produce exactly the results in the table for all 9 cases, on Runtime and Mantle where it applies, and every emitted string uses only `.example` hosts and the two example accounts.
2. The route tests cover: a 400 for a bad enum value, a missing message, or a message over 4000 characters; SSE events for each case; and the guard behaving like `/aws-agent`'s.
3. Page tests:
   - three tabs, with arrows, Home and End and the `#bedrock` hash working;
   - the existing two tabs unchanged (their tests still pass);
   - remote text is set with `textContent` only.
4. `test/story.test.ts`: parity holds; the `take.py`-derived counts are unchanged, because the new keys are STORY_ONLY; `video/test_story_bridge.py` passes.
5. `npm test` is green on the Air.
6. Browser:
   - `shared/story/tools/walk.py` (exit 0) at 1920x1080 and 1800x1169, Mock and Real, screenshots read;
   - `play.py` exit 0;
   - each scenario button clicked by hand in Demo mode, screenshots read;
   - a long question and an empty question tried.
7. `/code-review` findings fixed, each with a test that fails without its fix.

## Unhappy paths
Empty or whitespace question: nothing is sent, and Send stays enabled. A double click: one run at a time; the buttons are disabled while a run is in flight. Switching tabs mid-run: the run finishes and its events stay on its own tab. Reset: clears the Bedrock tab. An unknown body value: 400. Story pressing a scenario while a run is in flight: the engine's own wait handles it.

## Out of scope
- Real calls to AWS or a gateway, and creating any IAM role, guardrail or VM.
- The video part.
- Copying the internal QA doc into the repo, or naming its build.
- Geography and Allowed Models from the console screen: shown in the console, not modelled here.

## Protected
- The other two tabs, `/aws-agent` and `/chat`, and the recorded video's wording and counts.
- The vendored `web/src/story/` and `top-menu/` folders are never edited.
- Mock stays offline.
