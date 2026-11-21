#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
# shellcheck source=scripts/fork/upstream-base.sh
source scripts/fork/upstream-base.sh
read_upstream_base
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

upstream_paths=(. ':(exclude)apps/web/src/fork/**' ':(exclude)apps/desktop/src/fork/**'
  ':(exclude)scripts/fork/**'
  ':(exclude)docs/fork/**' ":(exclude)$route_tree")
marked=$(git grep -l -F "$marker" HEAD -- "${upstream_paths[@]}") || [[ $? == 1 ]]
marked=$(printf '%s\n' "$marked" | sed 's/^HEAD://' | LC_ALL=C sort -u)

changed=$(git diff --no-renames --name-only "$base_sha" HEAD -- "${upstream_paths[@]}" | LC_ALL=C sort -u)

compare_registry() {
  if [[ $expected != "$2" ]]; then
    diff -u --label 'registered seam files' --label "$1" \
      <(printf '%s\n' "$expected") <(printf '%s\n' "$2")
  fi
}
compare_registry 'files with seam markers' "$marked"
compare_registry 'upstream files changed by the fork' "$changed"

tag_access="\\b([a-z]*thread[a-z]*|shell)([?.]+tags\\b|\\[[\"']tags[\"']\\])"
tag_render='[.{,][[:space:]]*tags[[:space:]]*(\??\.(map|join)\(|\})|\bthreadTags\b'
display_uses=$(git grep -niE "$tag_access|$tag_render" HEAD \
  -- ':(glob)apps/web/src/**/*.ts' ':(glob)apps/web/src/**/*.tsx' \
  ':(glob)apps/mobile/src/**/*.ts' ':(glob)apps/mobile/src/**/*.tsx' \
  ':(exclude,glob)**/fork/**' ':(exclude,glob)**/*.test.ts' ':(exclude,glob)**/*.test.tsx') || [[ $? == 1 ]]
if [[ -n $display_uses ]]; then
  printf '%s\n' "$display_uses" >&2
  echo 'Possible thread tag display in upstream UI. Filter kb: tags at the display boundary and review the guard.' >&2
  exit 1
fi

echo 'Fork seam registry matches the marked files and the committed upstream diff.'
