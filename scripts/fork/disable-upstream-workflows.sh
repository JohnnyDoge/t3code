#!/usr/bin/env bash
set -euo pipefail

repo=${1:-}
if [[ $# != 1 || ! $repo =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ||
      $(printf '%s' "$repo" | tr '[:upper:]' '[:lower:]') == pingdotgg/t3code ]]; then
  echo "Usage: $0 <owner/fork-repo>" >&2
  exit 2
fi

workflows=$(gh workflow list --repo "$repo" --all --limit 1000 --json id,path,state \
  --jq '.[] | select(.state == "active" and (.path | startswith(".github/workflows/fork-") | not)) | [.id, .path] | @tsv')

while IFS=$'\t' read -r id path; do
  [[ -n $id ]] || continue
  printf 'Disabling %s in %s\n' "$path" "$repo"
  gh workflow disable "$id" --repo "$repo"
done <<< "$workflows"
