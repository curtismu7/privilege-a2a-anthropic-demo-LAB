# A2A video (standalone lab): two parts, our two agents then an agent in AWS

## Watch the videos (no setup needed)

The current cuts (28 November 2026, 7:03 monitor and 7:10 laptop) are on the repository's [Releases page](https://github.com/curtismu7/privilege-a2a-anthropic-demo-LAB/releases/tag/privilege-a2a-anthropic-demo-lab-video-2026-11-28), with checksums.

The earlier cuts (24 November) are still committed in this repo:

- [`video/releases/2026-11-24-monitor.mp4`](releases/2026-11-24-monitor.mp4) — 1920x1080, 6:58, for a monitor or projector
- [`video/releases/2026-11-24-laptop.mp4`](releases/2026-11-24-laptop.mp4) — 1800x1168, 6:53, the same run at laptop text size

Download and play in any video player; no sound, captions are on screen.

## Secrets in the videos

Every real value is masked as the page renders, before anything is drawn: hosts become `pingfederate.example` / `gateway.example`, the audience becomes `aws-agent-client`, policy names become `example-policy`, the analyst's email is redacted in the tool result, and the first 13 characters of a live agent key are further masked (`onscreen_mask.py`). Console screenshots are shown only as pre-redacted copies (`<name>.redacted.jpg`), which the take refuses to use unless OCR still finds nothing real in them. Both cuts passed the take's own mask-leak gate (0 leaks in `result.json`), OCR over the extracted frames, and a visual review before being committed.

## What you need to run the lab yourself

Docker (OrbStack), then from the repo root `docker compose build && docker compose up`, and open the lab URL the compose output prints. Mock mode works offline (a simulated run, labelled as such); Real mode (what the video shows) needs your own PingOne Privilege setup, and Part 2 an AWS AgentCore agent.

---

Follows the demo family's video standards: `VIDEO-BEST-PRACTICES.md` (copy of the canonical file in `privilege-cimd-test/video`).
Order of work: `SCRIPT.md` (sources first) -> `captions.md` (wording) -> **sample** -> review -> live take.

- Part 1 (A2A with remote agents tab): two questions to the concierge, which hands them to the analyst over A2A; the analyst reads data over MCP. One succeeds (email redacted), one is blocked by the gateway.
- Part 2 (Custodian to AWS agent tab): two questions that the AWS agent answers, then a deliberately invalid credential that is refused with a 401.
- The API call reel is opened at the key frames (the decoded token, the message, the challenge).

    # sample: mock stand-ins, headless, labelled SAMPLE (no gateway, no AWS, no model)
    VIDEO_STATE=/tmp/a2a-video ./video/services.sh start      # from the repo root; mock lab on :6981
    APP_URL=http://127.0.0.1:6981 SAMPLE=1 python3 video/take.py video/out/sample-work   # -> sample.mp4
    VIDEO_STATE=/tmp/a2a-video ./video/services.sh stop

    # rehearsal (fast, no video; REHEARSE_SHOTS=dir keeps a still per caption and slide). Against the live lab it makes the live calls.
    APP_URL=http://127.0.0.1:6981 REHEARSE=1 SAMPLE=1 REHEARSE_SHOTS=video/out/shots python3 video/take.py video/out/rehearse

    # live takes, one per screen (the lab on :6881 in Real mode with the LIVE route): exact-size headless recording is the default
    HEADLESS_REAL=1 PROFILE=monitor python3 video/take.py <dir>   # 1920x1080, app text L, large slides
    HEADLESS_REAL=1 PROFILE=laptop  python3 video/take.py <dir>   # 1800x1169 (the display in points; recorded in page pixels, a bigger canvas only adds grey bands), app text S, normal slides
    # screen capture instead (leave the Mac alone, check every frame): PROFILE=monitor python3 video/take.py <dir>
    # guarded: same take, but if the lab disappears mid-take it stops that take, restarts the lab, moves the partial run to <dir>-aborted-N and tries again (video/guarded_take.py; test: python3 video/test_guarded_take.py)
    HEADLESS_REAL=1 PROFILE=monitor SEGMENT=main python3 video/guarded_take.py <dir>

**The video uses the live Story's own code (2026-11-24).** `take.py` has no copy of the pop-up code, the hold formulas or the wording parser: the pop-ups and slides are the vendored `web/src/story/overlay.js`, the holds are `web/src/story/hold.js` (Normal speed is what the video always did), and the wording is whatever the running lab serves at `GET /api/story` (the shared Story parser reading `captions.md`). `story_bridge.py` turns the vendored modules into classic scripts for the browser; `video/test_story_bridge.py` (run by `npm test`) fails if take.py grows its own copy. So the lab must be running (it always had to be), and to change a pop-up or a hold you change `shared/story` in AI-DEMO-Standalone and re-vendor. A rehearsal (`REHEARSE=1 SAMPLE=1`) of this version gave stills pixel-identical to the previous take.py's, apart from random ids in two request pop-outs.

Needs node (with the repo's `node_modules`), python3 with playwright and pillow, ffmpeg, and tesseract (`brew install tesseract`). New recordings are written to `out/` (gitignored); only the published, gated cuts under `video/releases/` are committed. `out/` and `assets/` are gitignored: `assets/` holds three console screenshots (internal hostnames), so re-capture them from the console rather than committing them: `console-app-worker-crop.jpg` (the app), `console-agent-caller-crop.jpg` (the agent) and `console-policy-crop.jpg` (the policy), referenced in `captions.md`. Capture them read-only, with the page zoomed to about 1.5 so the text is large, and crop out the runtime id.

The page masking cannot change a screenshot, so beside each one put `<name>.redacted.jpg`: the same image with every host, the client id and the policy name painted over with the page's placeholders (`pingfederate.example`, `gateway.example`, `aws-agent-client`, `example-policy`). Keep the captured original beside it. The take shows only the redacted copy, and refuses before the browser opens if either file is missing, if OCR reads almost nothing in the original (the check could not see the values), or if tesseract (on a 3x copy, with line breaks ignored) still reads a real value in the redacted one (`onscreen_mask.public_image`).

The page masking also hides what an app's own "masked" key still shows: the app keeps the first 13 characters of a live agent key, which is 4 real characters after the `sk-<product>-` prefix. They become `xxxx` (`onscreen_mask.py`, which also counts it as a leak in an OCR'd frame or image).

The first page of a published video is its title (rule 29). With `HEADLESS_REAL=1`, `take.py` cuts each recording to start just after its first slide is drawn, and the `end` segment to stop just after the closing slide has been held; the window is in `result.json` as `clip`. So the app page a recording opens on, and the page the `end` segment loads before its first slide, are not in the video. The screen-capture take (no `HEADLESS_REAL`) is not cut and still opens on the page for about 1.5 s, so publish headless takes.
The live take refuses to run unless the lab is in Real mode and the AWS tab says LIVE route, and refuses to claim success (`result.json`) unless Part 1 showed its frames, the data was redacted and then blocked, the AWS agent answered both questions correctly, and the refused call was refused at the gateway. The Agent Card panel's `protocolVersion` row is hidden during the recording (the video names no version below 1.0.0); the take never opens the Agent Card frame's pop-out.
