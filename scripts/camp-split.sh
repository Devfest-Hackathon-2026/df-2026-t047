#!/usr/bin/env bash
# Cut packages/camp into a single English commit on a branch for the public repository camp-protocol/camp.
# This repository stays the source of truth; run this again to sync, then push the branch yourself.
# The public commit uses the GitHub noreply address, so no personal email goes public.
#   scripts/camp-split.sh [branch] [message]
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
if [ -n "$(git status --porcelain packages/camp)" ]; then
  echo "packages/camp has uncommitted changes. Commit them first." >&2
  exit 1
fi
branch="${1:-camp-public}"
message="${2:-CAMP v1: initial public release of @camp-protocol/kit}"
name="Yuto Maki"
email="202973271+yuto-valiark@users.noreply.github.com"

tree="$(git rev-parse HEAD:packages/camp)"
commit="$(GIT_AUTHOR_NAME="$name" GIT_AUTHOR_EMAIL="$email" GIT_COMMITTER_NAME="$name" GIT_COMMITTER_EMAIL="$email" \
  git commit-tree "$tree" -m "$message")"
git branch -f "$branch" "$commit"

# Nothing private may go public
if git grep -nIiE 'idea-audition-run|ACCESS_CODE=|GOOGLE_CLOUD_PROJECT|\.iam\.gserviceaccount\.com|@gmail\.com' "$branch" -- . ; then
  echo "Found project-specific or personal values in $branch. Stop and check." >&2
  exit 1
fi
if git log -1 --format='%ae %ce' "$branch" | grep -vq 'users.noreply.github.com.*users.noreply.github.com'; then
  echo "The public commit must use the noreply address." >&2
  exit 1
fi
echo "Branch $branch: 1 commit by $(git log -1 --format='%an <%ae>' "$branch"), $(git ls-tree -r --name-only "$branch" | wc -l | tr -d ' ') files."
echo "Replace the public repository with it (this overwrites its history):"
echo "  git push --force git@github.com:camp-protocol/camp.git $branch:main"
