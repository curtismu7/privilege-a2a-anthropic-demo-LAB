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
- Run observability (rule 27) is the shared component, vendored byte for byte and pinned (`web/src/run-observability/`, `server/src/runObservability*.js`, `scripts/run-observability-checkPin.mjs`): never hand-edit it, change the canonical in AI-DEMO-Standalone first. The vendored readers make ONE network call, a read to a loopback Elasticsearch (`RUN_OBS_ES_URL`); the Docker socket is never mounted. The lab's own decision line says passed / stopped / blocked, never a refusal word the shared matchers read.
- Story mode (shared pattern, `shared/story/` in AI-DEMO-Standalone) is vendored byte for byte and pinned (`web/src/story/`, `server/src/story/`, `scripts/story-checkPin.mjs`, vendored from AI-DEMO-Standalone `4cc64ca`, PR #553): never hand-edit it, change the canonical copy first and re-vendor. The wording is `video/captions.md`, the one file the recorded video and the live Story both read; the script is `web/src/storyScript.js`; `test/story.test.ts` fails the build if the two drift. No console screenshot or tenant value ships in this repo.
