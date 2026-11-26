# Demo driver's guide — Privilege A2A demo LAB

For the person driving this demo for an audience. One page: what to ask, what
the audience will see, and why each screen looks the way it does.

The demo is an access review at **Meridian Air**, a fictional airline. Its
systems are `passenger-records-db` (the critical one: bookings, passports,
loyalty), `fare-payments-api`, `flight-manifest-exports` and
`ops-deploy-pipeline`; the six people (Dana, Alice, Bob, Carol, Dave, Erin) work
in flight operations, reservations, revenue, security and support.

**The one thing to know before you start:** the MCP server deliberately plants
a prompt-injection payload in one seeded record (Dave Okoro's access grant on
`passenger-records-db`). The gateway's AI Guard catches it and blocks that tool
response. That block is the demo's centrepiece, not a malfunction — the UI
example prompt for it says so on the card. Everything else you ask returns
real data.

## Before the demo

- Stack up: `docker compose up -d` in the lab directory; check
  `http://127.0.0.1:6881/` (or the lab-proxy URL) answers, and the mode badge
  on the page says **Real** and `claude-sonnet-4-5` / `A2A Bearer configured`.
- Wait ~5 minutes after any Privilege console change (key renames, policy
  edits) before demoing — gateway propagation is that slow, and a fresh key
  answers 401 until it lands.
- If a run fails with `invalid virtual key`, the containers are carrying an
  old key: `docker compose up -d --force-recreate` and retry.

## What to ask, and what each proves

Use the **Example prompts** panel — each card states what it proves. The
three:

1. **"Review access on passenger-records-db"** — the A2A hand-off end to end, and
   the AI Guard block. Expect: the concierge hands off to the analyst agent;
   the analyst's tool call succeeds; the *tool reply* comes back
   **blocked by the gateway** (`content_blocked`) because the planted record
   carries hostile instructions. The trace shows the block in flight. Say
   this out loud: *"The agents did not decide this — the gateway did."* This
   is the money shot; do not skip it and do not apologise for it.
2. **"List all entitlements for Carol Nguyen"** — data protection on the MCP
   leg. Expect: real entitlement data, and her personal data (email) redacted
   to `[REDACTED:pii]` in the trace.
3. **"Is Erin Walsh offboarding, and what access does she still hold?"** —
   the analyst, not the concierge, does the data work. Expect: real records,
   Erin flagged as offboarding with a standing grant on
   `flight-manifest-exports`.

If you want a question that returns an access-review list **without** the
planted block (for a clean-data beat), ask about any other resource or user:
`fare-payments-api`, `ops-deploy-pipeline`, `flight-manifest-exports`, or any name other than
Dave Okoro. Only records seeded with the injection payload block.

## Reading the screens

- **✕ Blocked — tool reply blocked** in the trace = AI Guard stopped the
  response before any agent saw it. Working as designed.
- **The refused word** is reserved: a *refusal* is an agent declining; a
  *block* is the gateway enforcing. The demo line says passed / stopped /
  blocked — never "the agent refused."
- **Story mode** (Demo | Story toggle) replays the same script as the
  recorded video; offline it labels runs SIMULATED. The video's wording is
  `video/captions.md` — the live Story reads the same file.

## If something looks broken

| Symptom | What it is | Fix |
|---|---|---|
| `invalid virtual key` (401) on any hop | container/env carries a deleted key, or propagation hasn't landed | recreate the containers; wait ~5 min after console changes |
| `Unauthorized` on the MCP/A2A hop only | the key on the serving side (local `.env` or the cluster Secret) doesn't match the tenant | re-sync the key value from the Privilege console, restart what carries it |
| All tool replies blocked, on every resource | the injection demo is meant to hit one record only; if it hits everything, the guard config was changed | restore the key's AI Guard config from its backup (Webhook `http://localhost:8086/inspect`, `prompt_injection.BlockThreshold: 0.9`) |
| Tool replies never block | `MCP_DEMO_INJECTION` off on the MCP server, or the guard is disarmed | set `MCP_DEMO_INJECTION=true` on the `mcpdemo` deployment; verify the key's guard config above |

The injection demo flag itself: `MCP_DEMO_INJECTION=true` on the MCP server
(defaults off in source; the standing k8s deployment has it on). With it off,
nothing blocks and the AI Guard beat disappears from the demo — leave it on
unless the audience brief says otherwise.

## Where the deep detail lives

- Privilege setup, step by step: `docs/PRIVILEGE-SETUP.md` (served at `/setup/`).
- Video script and wording: `video/captions.md`.
- Key and object naming: `AI-DEMO2/privilege/NAMING-CONVENTION.md`.
- This lab's keys on the tenant: `lab-a2a-main-key` (A2A + model leg) and
  `lab-a2a-worker-key` (model + MCP leg); values live in the lab `.env` and
  the cluster Secret `privilege-a2a-demo-pingid`.
