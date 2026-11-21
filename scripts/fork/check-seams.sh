#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
registry=docs/fork/FORK.md
marker='fork''(board)'

expected=$(
  awk '
    /^## 6\./ { in_registry = 1; next }
    /^## / { in_registry = 0 }
    in_registry && /^\|[[:space:]]*`[^`]+`[[:space:]]*\|/ {
      split($0, cells, "`")
      print cells[2]
    }
  ' "$registry" | LC_ALL=C sort -u
)
actual=$(git grep -l -F "$marker" -- . ":(exclude)$registry") || [[ $? == 1 ]]
actual=$(printf '%s\n' "$actual" | LC_ALL=C sort -u)

if [[ $expected != "$actual" ]]; then
  diff -u --label "registered seam files" --label "files with seam markers" \
    <(printf '%s\n' "$expected") <(printf '%s\n' "$actual")
  exit 1
fi
echo "Fork seam registry matches the marked files."
