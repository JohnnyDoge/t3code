#!/usr/bin/env bash
set -euo pipefail

upstream_url=https://github.com/pingdotgg/t3code.git
upstream_main=refs/fork-upstream/main
upstream_tags=refs/fork-upstream/tags
route_tree=apps/web/src/routeTree.gen.ts

fetch_upstream() {
  # Keep upstream nightly tags out of the fork's release tag namespace.
  local advertised_tags latest_ref
  advertised_tags=$(git ls-remote --refs --tags --exit-code --sort=-version:refname \
    "$upstream_url" 'refs/tags/v*-nightly.*')
  latest_ref=$(awk 'NR == 1 { print $2 }' <<< "$advertised_tags")
  new_tag="$upstream_tags/${latest_ref##*/}"
  # Fetch refspecs allow only one wildcard, so expand the tag pattern first.
  {
    printf '+refs/heads/main:%s\n' "$upstream_main"
    awk -v dest="$upstream_tags/" '{ print "+" $2 ":" dest substr($2, 11) }' <<< "$advertised_tags"
  } | git fetch --atomic --no-tags --quiet --stdin "$upstream_url"
}

latest_nightly() {
  git for-each-ref --sort=-version:refname --count=1 --format='%(refname)' "$@" "$upstream_tags"
}

output() {
  if [[ -n ${GITHUB_OUTPUT:-} ]]; then
    printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"
  fi
}

run_rebase() {
  GIT_EDITOR=true git -c rerere.enabled=true -c rerere.autoupdate=true rebase "$@"
}

stage=initialization
rebasing=false
finish() {
  local status=$?
  if (( status != 0 )); then
    output failure "$stage"
    printf 'Fork sync failed during %s.\n' "$stage" >&2
    if [[ $rebasing == true && -d $(git rev-parse --git-path rebase-merge) ]]; then
      run_rebase --abort
    fi
  fi
}
trap finish EXIT

cd "$(git rev-parse --show-toplevel)"
case ${1:---dry-run} in
  --upstream-base)
    [[ $# == 1 ]]
    stage="fetch upstream nightlies"
    fetch_upstream
    shared_base=$(git merge-base HEAD "$upstream_main")
    base_tag=$(latest_nightly --merged="$shared_base")
    if [[ -z $base_tag ]]; then
      echo "HEAD has no upstream nightly base." >&2
      exit 1
    fi
    printf '%s\n' "${base_tag##*/}"
    exit 0
    ;;
  --push)
    [[ $# == 2 && $2 =~ ^[0-9a-f]{40}$ ]]
    stage="push main with the original checkout as lease"
    git push --force-with-lease="refs/heads/main:$2" origin main
    exit 0
    ;;
  --dry-run|--rebase-only)
    [[ $# -le 2 ]]
    branch=${2:-main}
    ;;
  *)
    echo "Usage: $0 [--dry-run [branch] | --rebase-only [branch] | --upstream-base | --push <original-main-sha>]" >&2
    exit 2
    ;;
esac

stage="verify checkout"
git check-ref-format --branch "$branch" > /dev/null
if [[ -n $(git status --porcelain) || -d $(git rev-parse --git-path rebase-merge) ||
      -d $(git rev-parse --git-path rebase-apply) ]]; then
  echo "Start from a clean worktree without a rebase in progress." >&2
  exit 1
fi
original_sha=$(git rev-parse --verify "refs/heads/$branch")
output original_sha "$original_sha"
output rebased false

stage="fetch upstream nightlies"
fetch_upstream
output target_tag "${new_tag##*/}"

stage="verify the upstream nightly base"
if ! git merge-base --is-ancestor "$new_tag" "$upstream_main"; then
  echo "The newest nightly is outside upstream main." >&2
  exit 1
fi
if git merge-base --is-ancestor "$new_tag" "$original_sha"; then
  printf '%s is up to date on %s.\n' "$branch" "${new_tag##*/}"
  exit 0
fi

# Both histories share upstream through the previous nightly. At that point
# the fork's linear history diverges, so only its commits are above the merge base.
old_base=$(git merge-base "$original_sha" "$new_tag")
old_tag=$(latest_nightly --merged="$old_base")
if [[ -z $old_tag || $(git rev-parse "$old_tag^{commit}") != "$old_base" ||
      -n $(git rev-list --merges "$old_base..$original_sha") ]]; then
  echo "Expected a linear fork history starting at an older upstream nightly tag." >&2
  exit 1
fi

rebasing=true
stage="rebase $branch onto ${new_tag##*/}"
last_conflict_commit=
resolve_conflicts() {
  local commit path regenerate=false
  local translations=() other_conflicts=()
  [[ -d $(git rev-parse --git-path rebase-merge) ]] || return 1
  commit=$(git rev-parse --verify REBASE_HEAD)
  if [[ $commit == "$last_conflict_commit" ]]; then
    return 1
  fi
  last_conflict_commit=$commit

  while IFS= read -r -d '' path; do
    if [[ $path == "$route_tree" ]]; then
      regenerate=true
    elif [[ $path =~ ^apps/[^/]+/src/i18n/translations/[^/]+\.json$ ]]; then
      translations+=("$path")
    else
      other_conflicts+=("$path")
    fi
  done < <(git diff --name-only --diff-filter=U -z)

  if (( ${#other_conflicts[@]} )); then
    stage="unresolved conflicts in ${other_conflicts[*]}"
    printf 'Unresolved conflict: %s\n' "${other_conflicts[@]}" >&2
    return 1
  fi
  if (( ${#translations[@]} )); then
    for path in "${translations[@]}"; do
      # During a rebase, stage 2 (ours) is the upstream side.
      if git cat-file -e ":2:$path" 2>/dev/null; then
        git checkout --ours -- "$path"
        git add -- "$path"
      else
        git rm -- "$path"
      fi
    done
  fi
  if [[ $regenerate == true ]]; then
    stage="install dependencies to regenerate $route_tree"
    vp i
    stage="regenerate $route_tree with the web build's TanStack Router plugin"
    rm -f -- "$route_tree"
    vp run --filter @t3tools/web build
    git add -- "$route_tree"
  fi
}

if ! run_rebase --empty=drop --onto "$new_tag" "$old_base" "$branch"; then
  while true; do
    resolve_conflicts
    stage="continue rebase $branch onto ${new_tag##*/}"
    if run_rebase --continue; then
      break
    fi
  done
fi
rebasing=false

if [[ ${1:-} != --rebase-only ]]; then
  stage="vp i"
  vp i
  for package in web client-runtime desktop; do
    stage="typecheck @t3tools/$package"
    vp run --filter "@t3tools/$package" typecheck
  done
  for test_path in apps/web/src/fork apps/desktop/src/fork; do
    if [[ -d $test_path ]]; then
      stage="vp test run $test_path"
      vp test run "$test_path"
    fi
  done
  stage="check fork seam registry"
  bash scripts/fork/check-seams.sh
fi

stage="verify worktree after checks"
if [[ -n $(git status --porcelain) ]]; then
  git status --short >&2
  echo "Checks left the worktree dirty." >&2
  exit 1
fi
output rebased true
printf 'Rebased %s onto %s locally.\n' "$branch" "${new_tag##*/}"
