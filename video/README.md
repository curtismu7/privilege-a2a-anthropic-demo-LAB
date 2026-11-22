# A2A video (standalone lab): two parts, our two agents then an agent in AWS

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

Needs node (with the repo's `node_modules`), python3 with playwright and pillow, ffmpeg. `out/` and `assets/` are gitignored: `assets/` holds two console screenshots (internal hostnames), so re-capture them from the console rather than committing them: `console-app-worker-crop.jpg` (the app) and `console-agent-caller-crop.jpg` (the agent), referenced in `captions.md`. Capture them read-only, with the page zoomed to about 1.5 so the text is large, and crop out the runtime id.
The live take refuses to run unless the lab is in Real mode and the AWS tab says LIVE route, and refuses to claim success (`result.json`) unless Part 1 showed its frames, the data was redacted and then blocked, the AWS agent answered both questions correctly, and the refused call was refused at the gateway. The Agent Card panel's `protocolVersion` row is hidden during the recording (the video names no version below 1.0.0); the take never opens the Agent Card frame's pop-out.
