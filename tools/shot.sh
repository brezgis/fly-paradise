#!/bin/bash
# Headless screenshot of the terrarium for visual checks.
# Usage: shot.sh out.png [query-string] [wait-ms]
set -e
OUT="$1"
QS="${2:-}"
WAIT="${3:-6000}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
google-chrome --headless=new --enable-unsafe-swiftshader \
  --hide-scrollbars --window-size=1280,800 \
  --virtual-time-budget="$WAIT" \
  --screenshot="$OUT" \
  "file://$DIR/index.html?shot=1${QS:+&}$QS" 2>/dev/null
echo "$OUT"
