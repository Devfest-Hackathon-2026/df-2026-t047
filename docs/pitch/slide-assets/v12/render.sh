#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=${0:A:h}
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE_BASE="/tmp/idea-audition-v12-chrome"

python3 "$SCRIPT_DIR/gen.py"

for no in {06..15}; do
  "$CHROME" \
    --headless=new \
    --disable-gpu \
    --hide-scrollbars \
    --no-first-run \
    --user-data-dir="$PROFILE_BASE-$no" \
    --window-size=1672,941 \
    --screenshot="$SCRIPT_DIR/s$no.png" \
    "file://$SCRIPT_DIR/s$no.html"
done
