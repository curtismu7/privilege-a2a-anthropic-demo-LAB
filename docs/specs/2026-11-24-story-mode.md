# Story mode spec (A2A lab)

**Status:** agreed; slice 1 built (revised 2026-11-24 after the shared contract)   **Owner:** Curtis (decides scope)
**Process tier:** 1 (lab prototype only the owner sees). Moves to Tier 2 before it is rolled out to colleagues.
**Contract:** `shared/story/README.md` in AI-DEMO-Standalone (PR #552, open). This spec follows it, with the two amendments below.

## Goal
Today the numbered pop-ups and the slides exist only in the recorded video (`video/take.py` drives the page from outside). Add a **Demo | Story** toggle to the lab page: **Demo** is the page exactly as it is now; **Story** adds the same pop-ups and the same slides the video has, so a presenter can walk the story live without a recording. Works in **both Mock and Real**.

## Decisions by the owner (2026-11-24)
1. **Both pacing modes now:** user-paced Next/Back/Exit, plus an optional **Play for me** auto-play. The shared contract says "no timers" and lists auto-play as out of scope, so this work **amends the contract** (Amendment A below) in the same PR that adds the canonical code.
2. **Screenshots follow the contract:** no console screenshot, redacted or not, is committed. Slides are text-only unless a local, gitignored `assets/` folder is supplied.
3. **Observability slide = the live Run Observability panel** already in the page (no captured image, no stale "captured earlier today").
4. **The video pipeline (`take.py`) switches to the shared overlay and wording as the last PR.**

## Amendment A to the contract (made in the canonical PR)
Story has two ways to move: **Next/Back** (viewer-paced, the default and the only thing in the first version) and an optional **Play for me** that advances on a per-step delay and sends the pre-filled prompt for the viewer. Play stops on any manual input (click, key, Exit). Next/Back never uses a timer.

**Play speed (owner, 2026-11-24): slower / normal / faster, plus Pause.** **Normal is an exact match of the video:** a bubble is held `max(5.0, words x 0.30 + 2.2)` seconds (or the step's own fixed `secs`, for example 4.5 for a prompt step); a slide is held `min(10.0, max(6.0, words x 0.25 + 3.0))` seconds. Slower multiplies every hold by 1.5 and faster by 0.67 (my defaults; the owner can change them). Pause freezes the current bubble. The hold formulas live in one shared function that `take.py` also uses after the last PR, so the match is guaranteed, not copied.

## Design (follows the contract)
- Canonical code in `shared/story/` of AI-DEMO-Standalone (overlay engine taken from `OVERLAY` in `take.py`, the toggle component, the parser, the live-value filler). The lab vendors a **byte-for-byte pinned copy** and never edits it. A pin test fails on any drift.
- Wording stays in `video/captions.md`; a Node parser serves it at `/api/story`. Live values use `{braces}` filled from the DOM by one small page function using the same selectors as `take.py`.
- The toggle sits in `Shell.jsx`'s `extra` slot (TopMenu is vendored; rule 22). Demo is the default; `?story=1` and localStorage turn it on. Story loads lazily.
- A step has a target selector and a trigger (`load`, `run-done`, `frame`). A step whose target is absent is skipped; "n of N" counts only the shown steps.
- Prompt steps pre-fill the exact question and say "press Send".
- Mock uses the `sample_*` wording, says it is **simulated**, and makes no network calls.
- The observability step targets the existing Run Observability panel; it is skipped if the panel is absent (for example no Elasticsearch).

## Acceptance criteria (each one a runnable check)
1. Story off: the served page and `npm test` are unchanged from `main`; a test asserts no story script is requested.
2. Story on: bubble "1 of N" shows on the Review tab; Next advances, Back returns, Esc exits to Demo with no overlay left in the DOM.
3. Parity test: every `# Step:` and `# Slide:` key in `captions.md` has a matching step, and the reverse; a mismatch fails the build.
4. Pin test: the vendored `shared/story/` copy matches the canonical commit byte for byte; editing it fails the test.
5. Mock, no `.env`, offline: the whole story walks Part 1 and Part 2 with no network call except the lab's own; it says "simulated" and uses the `sample_*` wording.
6. Real: Part 1 (redacted answer, blocked question) and Part 2 (token, card, message, answer, refusal) walk end to end; each live value matches what the page shows; the bubble count equals the live9 video's 27 for the same path.
7. Prompt steps pre-fill the exact script text; nothing is sent until the viewer presses Send (or Play for me sends it).
8. Play for me reaches the same end state as the Next walk, stops on any manual input, and never runs in Demo mode.
8a. Speed: at Normal, the hold for every bubble and slide in `captions.md` equals the video's `hold()` / `hold_slide()` result (test computes both over all keys, including the fixed-`secs` prompt steps; any difference fails). Slower is x1.5 and faster is x0.67 of Normal. Pause freezes the current bubble and resume continues with the time left. The speed choice persists (localStorage) and defaults to Normal.
8b. Play never advances on a timer past a run: it waits for the step's trigger (`run-done`, `frame`), with a timeout, then stops with a message if the run failed or timed out.
9. No image is committed for slides; a check fails the build if `video/assets` or any story image appears in the tracked files. Slides render text-only without the local folder.
10. 1920x1080 and 1800x1169 browser check, with an empty state: no clipped bubble, no overlap with its target, text readable (screenshots read, rule 9).
11. `scripts/check-ui-standard.sh`, the run-observability pin check and the TopMenu pin check pass; no vendored file changed.
12. After the last PR, a sample rehearsal take still shows 25 bubbles.

## Unhappy paths (each needs a check too)
- Target missing (tab not rendered, no "Call the tool" frame, no observability panel): the step is skipped, the counter adjusts, nothing throws.
- Run fails or the model call errors: the story shows the failure honestly and never claims success. The gateway gives no reason for a 401: the wording says so.
- Real not available (no key): Story still runs in Mock; Real wording is not shown.
- Viewer presses Send early, edits the pre-filled prompt or clicks away: the story re-syncs to the page state or offers Restart; it never shows a bubble for a run that did not happen.
- Play for me while a run is slow or fails: it waits for the trigger (with a timeout), then stops with a message; it never skips past a failed run.
- Two quick Next clicks, or Play plus a manual click: one step at a time; Play pauses on manual input.
- Tab switch mid-story, window resize: bubbles reposition, stale overlays are removed.
- Long or hostile text: all overlay text uses `textContent`; long answers are cut at a sentence, never mid-word.
- localStorage blocked: the toggle still works for the session.

## Out of scope
Editing the shared TopMenu; any gateway, Privilege, cluster or tenant change; committing any screenshot; re-recording the videos; deck slide 15; cluster rollout.

## Protected / must not break
Demo mode and its tests; Mock/Real behaviour; no tenant ids, client ids, customer names or internal hostnames in the repo; vendored TopMenu and run-observability files; `standalone-ui.css` and its sha pin; the video takes (guarded take, frame sizes).

## Verification plan
- Unit, parity and pin tests on the Air (`air-test`); Playwright check of toggle, Next/Back/Esc, Play, a skipped step, Mock offline.
- Real-browser run in Mock and in Real at both sizes, screenshots read. No cluster or tenant writes.
- `/code-review` on each diff. The owner says "merge N" before any merge; no deploy is part of this work.
- Slices: (0) AI-DEMO-Standalone PR: canonical `shared/story/` engine + contract Amendment A, stacked on #552 (or after "merge 552"); (1) lab: vendor + pin + parser + `/api/story` + parity test, no UI change; (2) lab: toggle, engine wiring, Part 1 steps; (3) lab: Part 2 steps, slides, observability step, Play for me; (4) lab: `take.py` uses the shared overlay and `/api/story`.

## Open question for the owner
- PR #552 (the contract) is still open. Slice 0 builds on it. Do you want me to stack slice 0 on that branch, or wait until you say "merge 552"?

## Status note
- Slice 0 (shared engine): AI-DEMO-Standalone PR #553 (`feat/story-engine`, two code reviews, all findings fixed).
- Slice 1 (this lab, no UI change), built 2026-11-24: vendored engine from `4cc64ca` with its pin and `scripts/story-checkPin.mjs`; `src/story.ts` and `GET /api/story` (the wording, parsed once; a broken file is a 500 that names the problem); `web/src/storyScript.js` (one entry per caption key, the video's order); the Dockerfile copies `video/captions.md` into the image; `test/story.test.ts` (pin, parity both ways, the bubble order, the 27 live and 25 simulated counts, the mode flags, the questions and the fixed holds all read from take.py, public-safe, no tracked screenshot, the route, a captions.md edit shows without a restart, Demo page unchanged). An independent code review of this slice found nine issues, all fixed (among them a wrong fixed hold on `refuse_intro`, now caught by a test that reads take.py).
- Checks (on the Air): `npm test` 227 server tests and 70 browser tests pass; the image built on the Air holds `/app/video/captions.md` and parses 33 steps and 9 slides.
- Not yet: the toggle and engine wiring (slice 2), Part 2, slides and observability, Play for me wiring (slice 3), `take.py` switch (slice 4), browser checks at both sizes.
- Slice 2 (the Demo | Story toggle, the wiring, the walk-through), built 2026-11-24: `web/src/storyWiring.js` (the host: run events, prompts, tabs; the script as engine steps; pop-out hooks; live fact lines), `web/src/StoryRoot.jsx`, the toggle in `Shell.jsx`, `paad:run-start` / `paad:run-end` in both page scripts. Bubbles only show when the page shows what they claim (a handoff hop, a trace that says blocked, an answer box that is not an error). The observability slide is held back (`NOT_YET`) until the live panel is wired.
- Browser-verified (Playwright, Mock, 1920x1080 and 1800x1169): the full walk (19 bubbles, 10 slides), Back, Esc, Demo unchanged; Play for me (Next never self-advances, hold, Pause, Resume, a real click stops it, an unattended run to the end). Found and fixed in the shared overlay (AI-DEMO-Standalone #563): a bubble under the Story bar.
- Known: offline Mock cannot run the Part 1 questions (Mock still needs a model key in this lab), so Part 1 shows its intro and prompts and skips the handoff, pop-out and blocked bubbles honestly. Real mode not yet walked. The counter numbers slides too.

