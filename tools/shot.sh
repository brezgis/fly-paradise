#!/bin/bash
# Headless screenshot of the terrarium for visual checks.
# Usage: shot.sh out.png [query-string] [wait-ms]
set -e
FP_SHOT_OUT="$1"
FP_SHOT_QUERY="${2:-}"
FP_SHOT_WAIT="${3:-6000}"
FP_PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FP_SHOT_PORT="${FP_SHOT_PORT:-8765}"
FP_CHROME_PROFILE="$(mktemp -d)"

python3 -m http.server "$FP_SHOT_PORT" --bind 127.0.0.1 --directory "$FP_PROJECT_ROOT" \
  >/tmp/fly-paradise-shot-server.log 2>&1 &
FP_SERVER_PID=$!
trap 'kill "$FP_SERVER_PID" 2>/dev/null || true; rm -rf "$FP_CHROME_PROFILE"' EXIT

if ! google-chrome --headless=new --no-sandbox --disable-dev-shm-usage --enable-unsafe-swiftshader \
  --user-data-dir="$FP_CHROME_PROFILE" \
  --hide-scrollbars --window-size=1280,800 \
  --virtual-time-budget="$FP_SHOT_WAIT" \
  --screenshot="$FP_SHOT_OUT" \
  "http://127.0.0.1:$FP_SHOT_PORT/?shot=1${FP_SHOT_QUERY:+&}$FP_SHOT_QUERY" \
  2>/tmp/fly-paradise-shot-chrome.log; then
  if [ ! -s "$FP_SHOT_OUT" ]; then
    cat /tmp/fly-paradise-shot-chrome.log >&2
    exit 1
  fi
fi
echo "$FP_SHOT_OUT"
