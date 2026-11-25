# Setup guide page spec

**Status:** agreed   **Owner:** the lab owner (decisions made in chat 2026-11-25: ship the reference stylesheet, build both the static page and the app route, keep "Pick your path first", estimated colours are fine)

## Goal
A newcomer who wants Real mode reads the Privilege setup guide as a proper guide page (header, steps, ToC rail, code blocks with Copy, tables, light/dark) instead of raw markdown, from the repo (`docs/setup-guide/`) or from the running lab (`/setup/`). A link in the shell bar offers it exactly when Real is unavailable.

## Acceptance criteria (each one a runnable check)
1. `npm run build:guide` writes `docs/setup-guide/index.html` and `docs/setup-guide/PRIVILEGE-SETUP.md` from `docs/PRIVILEGE-SETUP.md`. `test/setupGuidePage.test.ts` fails if the committed page differs from a fresh build (a guide edit without a rebuild).
2. The page has one `h2` per guide section, each with an id and a ToC link that resolves; no remaining "section N" wording; every table is wrapped for phone scroll; no `Mock:` banner.
3. The generated page and its assets contain no key (`sk-...`), UUID or internal host name (same patterns as `test/privilegeSetupDoc.test.ts`).
4. `GET /setup` answers 301 to `/setup/`; `GET /setup/` answers 200 `text/html` whose `<title>` names the guide; `GET /setup/assets/site.css` answers 200 `text/css`; `GET /setup/PRIVILEGE-SETUP.md` answers 200.
5. A path-traversal request (`/setup/..%2f..%2fpackage.json`, `/setup/%2e%2e/package.json`) never returns a file outside `docs/setup-guide/`.
6. The host guard still applies: a request with a foreign Host gets 421 on `/setup/` like every other route.
7. The Docker image carries `docs/setup-guide` (test reads the Dockerfile) and the built image serves `/setup/`.
8. The shell bar shows a "How to set up Real" link to `/setup/` when `/api/info` says `realAvailable: false`, and does not when it is true or unknown (island test).
9. Browser check at 1440 and 390 wide, light and dark: page renders, no sideways page scroll, Copy works, the ToC highlights the section in view, the theme toggle works, the shell-bar link opens the page.

## Unhappy paths (each needs a check)
- A file that is not there (and, the same way, a `docs/setup-guide` missing from an image): a plain 404, never a stack trace or a file listing; the rest of the lab is unaffected (test: `/setup/nope.html` and the folder URL).
- Guide edited without rebuilding: the drift test fails with the command to run.
- Guide gains a heading that has no id or a duplicate id: build fails.
- Guide still says "section N" for a number the builder does not know: build fails (no silent stale reference).
- JS blocked or `localStorage` throws: the page still renders (theme falls back to the OS).
- Behind the lab-proxy: only GET, no cookies, no writes; nothing new to guard.

## Out of scope
Screenshots of the console (a public repo ships none); a feedback form; serving the guide from the worker or MCP processes; translating the guide; the setup script (separate decision).

## Protected / must not break
The vendored top menu, Story mode and run observability (never hand-edited); Demo mode looks as before; the `Real needs a model provider` hint and the 409 path; the existing `privilegeSetupDoc` test; no key, tenant id or internal host in any shipped file.

## Source of the styling
The page layout stylesheet (`assets/site.css`) and script (`assets/site.js`) come from Ping's internal AI labs guide pages, copied byte for byte so a later refresh is a copy; the owner approved shipping them in this public repo on 2026-11-25. `assets/tokens.css` is ours: its colours are estimates (the reference's token file was not available), see its header. The reference site's name, logo and host are not used.

## Verification plan
`npm test` on the Air (including the new tests and the island test); a real-browser pass (Playwright) at the sizes in criterion 9 with screenshots read; an independent review of the diff; owner says "merge N". No deploy in this change.
