# transfer_funds tool spec

**Status:** built (not deployed)   **Owner:** Curtis

## Goal
The HITL MFA Lab's Real mode holds a `transfer_funds` call at the Privilege door `lab-banking-hitl`, but the door's backend (this MCP server, `mcpdemo`) has no such tool. After a human approves the hold, the call reaches the backend and fails with `Tool transfer_funds not found`, so the video take never sees an allowed call. Add the tool to this server, off by default.

## Acceptance criteria (each one a runnable check)
1. With `MCP_ENABLE_TRANSFER_FUNDS=true`, `tools/list` includes `transfer_funds`. (test/transferFunds.test.ts)
2. `tools/call transfer_funds {amount: 150, from: "ACC-1001", to: "ACC-2002"}` returns a JSON result with `status: "completed"`, the same amount, from and to, a `transferId`, and a note that no money moved. Each call gets a new id.
3. With the flag unset or `false`, `tools/list` does not include `transfer_funds` and the existing 18 tools are unchanged.
4. `amount` given as the string `"150"` is accepted (the gateway records hold fields as strings).

## Unhappy paths (each needs a check too)
- amount zero, negative, not a number, or above 1,000,000: the call is rejected with an MCP error, no transfer id is issued.
- `from` or `to` missing, empty, or longer than 64 characters: rejected.
- `from` equal to `to`: rejected (a transfer to the same account is meaningless).
- Hostile input (control characters, very long strings): rejected by the length limit; nothing is logged beyond ids and amount.
- The tool holds no state beyond an in-memory counter: restart resets it. No persistence, no money, no network call.

## Out of scope
Real money movement; the hold policy (it lives in Privilege, `lab-banking-hitl-hold`); changing any existing tool; the image build and cluster rollout (separate step, owner gives the go).

## Protected / must not break
- The 18 existing tools and `open_ticket` (the one write tool the injection demo relies on) behave exactly as before.
- Default is OFF, so the A2A demo agents, `lab-banking-full/limited/blocked` and every other door on `mcpdemo` see no change until the deployment sets the flag.
- `MCP_REQUIRE_BEARER`, stateless/stateful and JSON-response modes keep working.

## Verification plan
- `tsx --test test/transferFunds.test.ts` (new) and the existing `test/verticals.test.ts` on the Air via `air-test`; fails before the change, passes after.
- Local smoke: run the server with the flag, `tools/list` and one `tools/call` over HTTP.
- Independent `/code-review` of the diff before merge.
- No image push or cluster change until the owner says go in this conversation. Rollout plan: build a `curtismu7` image, `kubectl set image` on `deploy/mcpdemo` only (not the worker or main agent), set `MCP_ENABLE_TRANSFER_FUNDS=true` on it, roll back by setting the previous image. Then re-run discovery on the `lab-banking-hitl` door and re-check `tools/list`.

## Evidence (2026-11-25, run on the Air with `air-test`)
- Before the change: `test/transferFunds.test.ts` failed 2 of 4 (tool not listed; string amount rejected as "tool not found").
- After: `npx tsc --noEmit` OK; `npm test` 325/325 server tests and 136/136 web tests pass. Criteria 1 to 4 and every unhappy path above are asserted in `test/transferFunds.test.ts`.
- One existing check changed: `test/setupScript.test.ts` now counts only unconditionally registered tools (two-space indent), so the flag-gated `transfer_funds` is not required in the setup checklist. The checklist itself is unchanged.
- Not done yet: independent code review, image build, cluster rollout (owner's go).
