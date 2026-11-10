#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=${0:A:h}
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE_DIR="/tmp/idea-audition-deck-chrome"

for name in slide-02-abundance slide-03-problem slide-07-video slide-13-oss; do
  "$CHROME" \
    --headless=new \
    --disable-gpu \
    --hide-scrollbars \
    --no-first-run \
    --user-data-dir="$PROFILE_DIR-$name" \
    --window-size=1672,941 \
    --screenshot="$SCRIPT_DIR/$name.png" \
    "file://$SCRIPT_DIR/$name.html"
done
