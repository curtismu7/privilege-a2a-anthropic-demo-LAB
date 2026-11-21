#!/usr/bin/env bash
# Starts/stops a private MOCK instance of the lab for the sample video: the main agent (port 6981) and the local
# AWS stand-in (6985), no .env, no gateway, no AWS, no model. Different ports from the lab's own (6881/6885), so it
# never touches a running lab. Usage: VIDEO_STATE=/path/to/dir video/services.sh start|stop   (run from the repo root)
set -euo pipefail
STATE="${VIDEO_STATE:?set VIDEO_STATE to a writable directory}"; mkdir -p "$STATE"
case "${1:-}" in
  start)
    env -u AWS_AGENT_A2A_URL AWS_MOCK_PORT=6985 node_modules/.bin/tsx src/aws-agent-mock/index.ts >"$STATE/aws-mock.log" 2>&1 & echo $! >"$STATE/aws-mock.pid"
    env -u AWS_AGENT_A2A_URL MAIN_AGENT_PORT=6981 AWS_MOCK_PORT=6985 node_modules/.bin/tsx src/main-agent/index.ts >"$STATE/main.log" 2>&1 & echo $! >"$STATE/main.pid"
    for _ in $(seq 1 40); do curl -fs -o /dev/null http://127.0.0.1:6981/ && echo "mock lab up on http://127.0.0.1:6981" && exit 0; sleep 0.5; done
    echo "mock lab did not come up; see $STATE/main.log" >&2; exit 1 ;;
  stop)
    for f in main aws-mock; do [ -f "$STATE/$f.pid" ] && kill "$(cat "$STATE/$f.pid")" 2>/dev/null || true; rm -f "$STATE/$f.pid"; done; echo stopped ;;
  *) echo "usage: VIDEO_STATE=dir $0 start|stop" >&2; exit 2 ;;
esac
