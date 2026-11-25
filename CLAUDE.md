# Privilege A2A Anthropic demo

Three Node processes that show A2A with remote agents (an access review is the worked example) through A2A and MCP, on Anthropic or Google models. The page is a server-rendered string plus a small React island for the shell bar (`web/`, the shared TopMenu vendored in `web/src/top-menu/`, never hand-edited: rule 22).

## Run and test

```sh
npm ci
npm test
```

## Rules that bite

- No real tenant ids, client ids, customer names or internal hostnames. Use `.example` or `.invalid` hosts only.
- Never commit `.env` files or keys. Copy `config.example` to `.env` and fill it in locally (optional; with no `.env` the app starts offline).
- Mock mode works fully offline. Live mode is optional.
- `docs/PRIVILEGE-SETUP.md` is the newcomer guide for Real mode (what to have, the nine steps in Privilege, the AWS agent, refusals). Keep it in step with the README's Privilege sections and `config.example`; `test/privilegeSetupDoc.test.ts` fails if a variable it names disappears, if the README stops pointing to it, or if it gains a key, a UUID or an internal host. The styled page of it is `docs/setup-guide/` (built from the guide by `npm run build:guide`, served at `/setup/` by the main agent, linked from the shell bar while Real is unavailable); edit the guide, never the page, and `test/setupGuidePage.test.ts` fails if the committed page is stale. `docs/setup-guide/assets/site.css` and `site.js` are copied unchanged from Ping's internal guide pages (owner approved shipping them, 2026-11-25): refresh by copying, never hand-edit; `tokens.css` is ours and its colours are estimates.
- Run observability (rule 27) is the shared component, vendored byte for byte and pinned (`web/src/run-observability/`, `server/src/runObservability*.js`, `scripts/run-observability-checkPin.mjs`): never hand-edit it, change the canonical in AI-DEMO-Standalone first. The vendored readers make ONE network call, a read to a loopback Elasticsearch (`RUN_OBS_ES_URL`); the Docker socket is never mounted. The lab's own decision line says passed / stopped / blocked, never a refusal word the shared matchers read.
- Story mode (shared pattern, `shared/story/` in AI-DEMO-Standalone) is vendored byte for byte and pinned (`web/src/story/`, `server/src/story/`, `scripts/story-checkPin.mjs`, vendored from AI-DEMO-Standalone `61d1c89`, PRs #553, #563, #567 and #574; Story is for AI-DEMO-Standalone apps only, for now): never hand-edit it, change the canonical copy first and re-vendor. The wording is `video/captions.md`, the one file the recorded video and the live Story both read; the script is `web/src/storyScript.js`; `test/story.test.ts` fails the build if the two drift. No console screenshot or tenant value ships in this repo.
- Story's wiring is `web/src/storyWiring.js` and `web/src/StoryRoot.jsx` (lazy-loaded from `Shell.jsx` when the Demo | Story toggle is on). It depends on the page scripts announcing every run with `paad:run-start` and `paad:run-end` (`detail.ok` false only when the request failed): keep those events in `ui.ts` and `awsTab.ts`, or every "wait for the run" step stalls. A bubble must only claim what the page shows (its target exists only then). Adding Story to another lab: `shared/story/ADDING-TO-A-LAB.md` in AI-DEMO-Standalone.
- Offline Mock (no model key): with Story on, the two scripted Part 1 questions get a SIMULATED run (`src/storyReplay.ts`, synthetic and labelled simulated; the page sends `story: true` only while Story is on). Any other question, and Demo mode, take the normal path. The observability scene in Story is a bubble on the live panel (`observability_panel`); the video keeps its captured slide.
- The recorded video (`video/take.py`) runs on the same shared overlay, hold formulas and wording as the live Story (`video/story_bridge.py`, wording from `GET /api/story`): do not paste a copy of any of them back into take.py. `video/test_story_bridge.py` (run by `npm test`) fails if you do.
