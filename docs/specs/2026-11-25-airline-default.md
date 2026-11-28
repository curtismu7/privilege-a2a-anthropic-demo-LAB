# Airline as the default demo spec

> **Renamed 2026-11-28:** the airline is now AirGuard Airlines (owner decision; see AI-DEMO-Standalone `docs/specs/2026-11-28-airline-default-fleet.md`). This spec was written for the first name, Meridian Air; the rest is unchanged apart from the name.

**Status:** agreed   **Owner:** the lab owner (decisions in chat 2026-11-25: this A2A lab first; an airline access review with the same four tools; change the app now and re-record the video later; the fictional airline is "AirGuard Airlines")

## Goal
The lab's default demo is an access review of **AirGuard Airlines**, a fictional airline, instead of a generic cloud estate. The same four tools (`list_entitlements`, `who_has_role`, `get_access_grants`, `open_ticket`), the same flow (main agent -> A2A -> analyst -> MCP) and the same AI Guard injection demo, with airline people, systems, roles and questions. `prod-db-primary` and its neighbours are gone from the demo, the Story, the docs and the tests.

## The airline world (one definition; everything else follows it)

| Was | Now |
|---|---|
| resource `prod-db-primary` (critical, primary customer database) | `passenger-records-db`: "Primary passenger records database: bookings, passports, loyalty" (critical) |
| `payments-api` (critical) | `fare-payments-api`: "Fare payment processing service" (critical) |
| `s3-customer-exports` (sensitive) | `flight-manifest-exports`: "Storage holding generated flight manifest and passenger data exports" (sensitive) |
| `jenkins-ci` (internal) | `ops-deploy-pipeline`: "Build and deploy pipeline for flight operations software" (internal) |
| roles `prod-db-admin`, `prod-db-reader`, `exports-reader`, `ci-admin`, `payments-deployer` | `passenger-db-admin`, `passenger-db-reader`, `manifest-reader`, `pipeline-admin`, `payments-deployer` (unchanged) |
| email `@acme.com`, `@contractor.acme.com` | `@airguard.example`, `@contractor.airguard.example` |
| departments Engineering / Finance / Security / Support | Dana: Flight Operations Technology; Alice and Carol: Reservations Engineering; Bob: Revenue and Payments; Dave: Security; Erin: Customer Support |
| "sharding migration"; "February incident"; "customer data requests" | "reservation system migration"; "February schedule-disruption incident"; "passenger data requests" |

The six people keep their ids and names (Dana Olsen, Alice Chen, Bob Reyes, Carol Nguyen, Dave Okoro, Erin Walsh), so every question that names a person keeps working: `What can Bob Reyes reach?`, `Review Carol Nguyen's access`, `What access does Dave hold?`. The default blocked-injection question becomes `Review access on passenger-records-db`. Both agents' system prompts say they work for AirGuard Airlines, a fictional airline.

## Acceptance criteria (each one a runnable check)
1. `test/airlineDefault.test.ts` fails if any retired identifier (`prod-db`, `payments-api`, `s3-customer-exports`, `jenkins-ci`, `exports-reader`, `ci-admin`, `acme.com`, `sharding`) appears in a shipped file: `src/`, `web/src/` (outside the vendored folders), `README.md`, `CLAUDE.md`, `docs/` (outside `docs/specs/`), `video/` text sources, or `config.example`; and passes with the airline names present.
2. The seeded data is internally consistent: every grant's user, resource, role owner and `grantedBy` exists; every resource has an owner who is a user; the injection payload names a seeded user and the `passenger-records-db` resource; the four tools return airline records.
3. The scripted Story answers (`src/storyReplay.ts`) agree with the seeded data for Bob Reyes and the blocked question, and `test/story.test.ts` (captions/script parity) still passes.
4. The page's default questions and the Story's scripted questions are the airline ones; Demo mode's behaviour is otherwise unchanged.
5. Unknown resources and users still produce an honest "not found" and never an invented record (the old `prod-db-primary` is now an unknown resource and proves it).
6. The vertical specialists (banking, healthcare, retail, airlines `sensitive_passenger_record`, admin) and `test/fixtures/a2aSpecialists.js` parity are untouched.
7. `docs/PRIVILEGE-SETUP.md` (Step 9 questions), `README.md`, `docs/DEMO-DRIVER-GUIDE.md` and `video/SCRIPT.md` use the airline questions; the styled page is rebuilt and its drift test passes.
8. A real-browser pass (Mock, offline) at 1440 and 390 wide: the default question runs, the answer is airline data, Story's Part 1 plays with airline wording, no console errors; screenshots read.
9. `npm test` passes on the Air.

## Unhappy paths (each needs a check)
- A question about a retired resource (`Review access on prod-db-primary`): the analyst reports no such resource and invents nothing.
- A question about a person who is not seeded: unchanged "unknown user" behaviour (`test/unknownUser.test.ts`).
- The hostile payload with `MCP_DEMO_INJECTION=true`: still reaches the analyst only as a tool result, still names a real seeded user and resource, and the demo's guardrail story is unchanged.
- A viewer arriving from Customer Agent LAB with `?vertical=airlines`: the vertical path is unchanged (it never used this data).
- Story offline Mock with no model key: the two scripted questions still get the simulated run, now with airline data.

## Out of scope
Nothing about the tools' own names (`list_entitlements`, `who_has_role`, `get_access_grants`, `open_ticket`).
Re-recording the public video (the released cut stays up, labelled as the earlier access-review cut, until a re-record is asked for); the other labs and AI-DEMO2 (the airline default reaches them one lab at a time, reusing this world); renaming tools; changing the people; new airline tools; real airline names, data or logos.

## Also renamed in this change (owner decision 2026-11-27)
The leftover "Acme" identifiers: the MCP server's name `acme-access-tools` -> `airguard-access-tools`; the gateway route the wiring diagram and its test show, `/acme-tools/mcp` -> `/lab-a2a-full/mcp` (a door name from `AI-DEMO2/privilege/NAMING-CONVENTION.md`: `lab-<system>-<variant>`, system `a2a`; the diagram is illustrative, no tenant object is created); the worker's `ACME_TOOLS` -> `ACCESS_REVIEW_TOOLS`. The retired-name test now covers all three.

## Protected / must not break
The vendored Story, run-observability and TopMenu code (never hand-edited); the AI Guard injection demonstration; the A2A/MCP/Privilege flow and its tests; the setup script and its checklist (which names the four tools); no real tenant, host, key or real airline anywhere in the repo.

## Verification plan
`npm test` on the Air; a real-browser pass with screenshots read; an independent review of the diff (including a completeness sweep for any retired identifier left behind); the owner says "merge N". No deploy until the owner says go.
