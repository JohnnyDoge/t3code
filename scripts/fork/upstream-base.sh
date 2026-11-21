#!/usr/bin/env bash

nightly_pattern='^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-nightly\.[1-9][0-9]{7}\.(0|[1-9][0-9]*)$'
sha_pattern='^[0-9a-f]{40}$'
base_file=docs/fork/UPSTREAM_BASE
# shellcheck disable=SC2034 # Used by the fork sync and drift guards.
route_tree=apps/web/src/routeTree.gen.ts

read_upstream_base() {
  local record
  record=$(git show "${1:-HEAD}:$base_file") || return
  read -r base_tag base_sha <<< "$record"
  if [[ ! $base_tag =~ $nightly_pattern || ! $base_sha =~ $sha_pattern ||
        $record != "$base_tag $base_sha" ]]; then
    echo "Invalid upstream tag or SHA in $base_file." >&2
    return 1
  fi
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  set -euo pipefail
  read_upstream_base
  printf '%s\n' "$base_tag"
fi
