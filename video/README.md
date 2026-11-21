# AWS A2A video (standalone lab)

Follows the demo family's video standards: `VIDEO-BEST-PRACTICES.md` (copy of the canonical file in `privilege-cimd-test/video`).
Order of work: `SCRIPT.md` (sources first) -> `captions.md` (wording) -> **sample** -> review -> real take.

    # sample: mock stand-in, headless, labelled SAMPLE (no gateway, no AWS, no model)
    VIDEO_STATE=/tmp/a2a-video ./video/services.sh start      # from the repo root; mock lab on :6981
    APP_URL=http://127.0.0.1:6981 SAMPLE=1 python3 video/take.py video/out/sample-work   # -> sample.mp4
    VIDEO_STATE=/tmp/a2a-video ./video/services.sh stop

    # rehearsal (fast, no video; REHEARSE_SHOTS=dir keeps a still per caption)
    APP_URL=http://127.0.0.1:6981 REHEARSE=1 python3 video/take.py video/out/rehearse

    # real take: the lab on :6881 in LIVE mode; follow "Before every recording" in VIDEO-BEST-PRACTICES.md first
    python3 video/take.py video/out/take-work                 # opens its own Chrome window, records it with ffmpeg

Needs node (with the repo's `node_modules`), python3 with playwright and pillow, ffmpeg. `out/` and `assets/` are gitignored: `assets/` holds a screenshot of the Privilege console (internal hostnames), so re-capture it from the console (`console-agent-caller-crop.jpg`, referenced in `captions.md`) rather than committing it.
Rehearse on the mock with `REHEARSE=1 SAMPLE=1` (fast, no video, `REHEARSE_SHOTS=dir` keeps a still per caption and slide).
The real take refuses to run unless the tab says LIVE route and the Mock/Real switch is on Real, and refuses to claim success (`result.json`) unless the AWS agent answered and the refused call was really refused at the gateway. It needs the lab (branch `feat/aws-tab-hub-explainer` or later) built with the refused-call button.
