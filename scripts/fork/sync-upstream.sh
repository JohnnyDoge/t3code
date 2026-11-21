#!/usr/bin/env bash
set -euo pipefail

report='error initialize sync'
lock=
# shellcheck disable=SC2329 # Invoked by the EXIT trap.
finish() {
  if [[ -n $lock ]]; then
    rm -f -- "$lock/conflicts" "$lock/upstream-base.sh"
    rmdir "$lock" || true
  fi
  printf '%s\n' "$report"
  case "$report" in
    up-to-date|pushed\ *) exit 0 ;;
    conflict\ *) exit 2 ;;
    check-failed\ *) exit 3 ;;
    push-rejected) exit 4 ;;
    release-repo-failed\ *) exit 5 ;;
    *) exit 1 ;;
  esac
}
trap finish EXIT

stop() {
  report=$1
  exit 1
}

require_clean() {
  local changes
  changes=$(git status --porcelain --untracked-files=all)
  if [[ -n $changes ]]; then
    printf '%s\n' "$changes" >&2
    stop 'error worktree is dirty'
  fi
}

require_linear() {
  local merges
  git merge-base --is-ancestor "$1" "$2" || stop 'error accepted upstream base is outside the fork history'
  merges=$(git rev-list --merges "$1..$2")
  [[ -z $merges ]] || stop 'error fork history contains merge commits since the upstream base'
}

fetch_target() {
  local advertised sha ref tag accepted='' target_ref accepted_ref
  local private_refs=refs/fork-upstream
  report='error read upstream nightly tags'
  advertised=$(git ls-remote --refs --tags --sort=-version:refname upstream 'refs/tags/v*-nightly.*')
  target_tag=
  while read -r sha ref; do
    [[ -n $ref ]] || continue
    tag=${ref#refs/tags/}
    [[ $tag =~ $nightly_pattern && $sha =~ $sha_pattern ]] || stop "error invalid upstream nightly tag $tag"
    if [[ -z $target_tag ]]; then
      target_tag=$tag
      target_sha=$sha
    fi
    if [[ $tag == "$base_tag" ]]; then
      accepted=$sha
    fi
  done <<< "$advertised"
  [[ -n $accepted ]] || stop "error accepted upstream tag $base_tag was deleted"
  [[ $accepted == "$base_sha" ]] || stop "error accepted upstream tag $base_tag moved from $base_sha to $accepted"

  target_ref="$private_refs/tags/$target_tag"
  accepted_ref="$private_refs/tags/$base_tag"
  local refspecs=("+refs/heads/main:$private_refs/main" "+refs/tags/$target_tag:$target_ref")
  if [[ $target_tag != "$base_tag" ]]; then
    refspecs+=("+refs/tags/$base_tag:$accepted_ref")
  fi
  report='error fetch upstream main and nightly tags'
  git fetch --atomic --no-tags upstream "${refspecs[@]}"
  [[ $(git rev-parse "$target_ref") == "$target_sha" && $(git rev-parse "$accepted_ref") == "$base_sha" ]] ||
    stop 'error upstream tags changed during fetch'
  git merge-base --is-ancestor "$target_sha" "$private_refs/main" ||
    stop "error upstream tag $target_tag is outside upstream main"
  git merge-base --is-ancestor "$base_sha" "$target_sha" ||
    stop "error upstream tag $target_tag regressed from $base_tag"
  report="error upstream route check for $target_tag"
  bash scripts/fork/check-routes.sh --upstream "$target_sha"
}

is_rebasing() {
  [[ -d $rebase_dir ]]
}

run_rebase() {
  # Apply the path policies before rerere, whose cache keys do not include the path.
  GIT_EDITOR=true git -c rerere.enabled=false rebase "$@"
}

continue_rebase() {
  local commit last_commit='' path conflicts
  while is_rebasing; do
    report="error continue rebase onto $target_tag"
    commit=$(git rev-parse --verify REBASE_HEAD)
    [[ $commit != "$last_commit" ]] || return 1
    last_commit=$commit
    git diff --name-only --diff-filter=U -z > "$lock/conflicts"
    while IFS= read -r -d '' path; do
      case "$path" in
        "$route_tree"|apps/*/src/i18n/translations/*.json)
          git restore --source="$target_sha" --staged --worktree -- "$path"
          ;;
      esac
    done < "$lock/conflicts"
    git -c rerere.enabled=true -c rerere.autoupdate=true rerere
    conflicts=$(git diff --name-only --diff-filter=U)
    if [[ -n $conflicts ]]; then
      stop "conflict ${conflicts//$'\n'/ }"
    fi
    if run_rebase --continue; then
      break
    fi
  done
  [[ $(git symbolic-ref --quiet --short HEAD) == "$candidate" ]]
}

prepare_candidate() {
  report='error restore upstream translations'
  local translations=':(glob)apps/*/src/i18n/translations/*.json'
  if ! git diff --quiet "$target_sha" HEAD -- "$translations"; then
    git restore --source="$target_sha" --staged --worktree -- "$translations"
  fi

  report='check-failed generate-routes'
  bash scripts/fork/check-routes.sh --generate
  printf '%s %s\n' "$target_tag" "$target_sha" > "$base_file"
  git add -- "$base_file" "$route_tree"
  if ! git diff --cached --quiet; then
    report='error commit upstream base and regenerated route tree'
    git -c core.hooksPath=/dev/null commit -m "chore(fork): sync with upstream $target_tag"
  fi
}

check() {
  report="check-failed $1"
  printf 'Running %s\n' "$1" >&2
  shift
  "$@" || exit 3
}

run_checks() {
  local package
  check upstream-base read_upstream_base
  [[ $base_tag == "$target_tag" && $base_sha == "$target_sha" ]] || exit 3
  check seams bash scripts/fork/check-seams.sh
  check routes bash scripts/fork/check-routes.sh
  check playwright-chromium node apps/web/node_modules/playwright/cli.js install --only-shell chromium
  check web-tests bash -c 'cd apps/web && vp test run src/fork src/components/threadActionMenu.logic.test.ts'
  check thread-command-tests vp test run packages/client-runtime/src/state/threadCommands.test.ts
  check fork-script-tests vp test run scripts/fork/*.test.ts
  for package in web client-runtime desktop; do
    check "$package-typecheck" vp run --filter "@t3tools/$package" typecheck
  done
  report='check-failed dirty-after-checks'
  local changes
  changes=$(git status --porcelain --untracked-files=all)
  if [[ -n $changes ]]; then
    printf '%s\n' "$changes" >&2
    exit 3
  fi
}

return_to_main() {
  git switch main
  git branch -D "$candidate"
  rm -- "$state"
}

main() {
  cd "$(git rev-parse --show-toplevel)"
  local state rebase_dir original lease target_tag target_sha candidate base_tag base_sha
  local mode=${1:-} head belongs_to_sync=false
  state=$(git rev-parse --git-path fork-sync-state)
  rebase_dir=$(git rev-parse --git-path rebase-merge)
  head=$(git symbolic-ref --quiet --short HEAD || true)
  [[ $# -le 1 ]] || stop 'error expected no arguments, --resume or --abort'
  report='error another sync is running'
  mkdir "$state.lock"
  lock="$state.lock"
  report="error load sync configuration"
  if [[ $mode == --resume || $mode == --abort ]]; then
    # The pipeline scripts may not have been replayed at a stopped rebase.
    git show refs/heads/main:scripts/fork/upstream-base.sh > "$lock/upstream-base.sh"
    # shellcheck source=scripts/fork/upstream-base.sh
    source "$lock/upstream-base.sh"
  else
    # shellcheck source=scripts/fork/upstream-base.sh
    source scripts/fork/upstream-base.sh
  fi
  case "$mode" in
    "")
      [[ $head == main ]] || stop 'error check out main before starting a sync'
      [[ ! -e $state ]] || stop 'error pending sync; use --resume or --abort'
      for operation in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD sequencer; do
        [[ ! -e $(git rev-parse --git-path "$operation") ]] || stop "error Git operation in progress: $operation"
      done
      require_clean
      report='error read committed upstream base'
      read_upstream_base
      original=$(git rev-parse HEAD)
      require_linear "$base_sha" "$original"
      report='error fetch origin main for the push lease'
      git fetch --no-tags origin refs/heads/main
      lease=$(git rev-parse FETCH_HEAD)
      git merge-base --is-ancestor "$lease" "$original" ||
        stop 'error origin main has commits absent from local main'
      fetch_target
      candidate="sync/$target_tag"
      report="error create candidate branch $candidate"
      git switch -c "$candidate"
      printf '%s %s %s %s\n' "$original" "$lease" "$target_tag" "$target_sha" > "$state"
      if [[ $target_sha != "$base_sha" ]]; then
        report="error rebase onto $target_tag"
        if ! run_rebase --no-autostash --no-update-refs --empty=drop --onto "$target_sha" "$base_sha"; then
          is_rebasing || exit 1
          continue_rebase
        fi
      fi
      ;;
    --resume|--abort)
      report='error read pending sync state'
      [[ -f $state ]] || stop 'error no pending sync'
      read -r original lease target_tag target_sha < "$state"
      [[ $original =~ $sha_pattern && $lease =~ $sha_pattern &&
         $target_tag =~ $nightly_pattern && $target_sha =~ $sha_pattern ]] || stop 'error invalid pending sync state'
      candidate="sync/$target_tag"
      [[ $(git rev-parse refs/heads/main) == "$original" ]] || stop 'error local main changed during sync'
      if is_rebasing && [[ $(cat "$rebase_dir/head-name") == "refs/heads/$candidate" ]]; then
        belongs_to_sync=true
      fi
      if "$belongs_to_sync"; then
        if [[ $mode == --abort ]]; then
          report='error abort rebase'
          run_rebase --abort
        else
          continue_rebase
        fi
      else
        [[ $head == "$candidate" ]] || stop "error expected to be on $candidate"
        require_clean
      fi
      if [[ $mode == --abort ]]; then
        report='error restore main'
        return_to_main
        stop 'error sync aborted'
      fi
      ;;
    *) stop 'error expected no arguments, --resume or --abort' ;;
  esac

  require_clean
  require_linear "$target_sha" HEAD
  check dependencies vp i
  report='error read upstream base on candidate'
  read_upstream_base
  if [[ $base_sha != "$target_sha" || $base_tag != "$target_tag" ]]; then
    prepare_candidate
  fi
  run_checks

  report='error finalize sync'
  [[ $(git rev-parse refs/heads/main) == "$original" ]] || stop 'error local main changed during sync'
  if [[ $(git rev-parse HEAD) == "$lease" ]]; then
    report='error verify origin main after checks'
    local remote_main
    remote_main=$(git ls-remote --exit-code origin refs/heads/main)
    [[ ${remote_main%%$'\t'*} == "$lease" ]] || stop push-rejected
    return_to_main
    stop up-to-date
  fi
  local release_repo_changes
  release_repo_changes=$(git diff --name-only "$lease" HEAD -- scripts/fork/release-repo/)
  if ! git push --no-follow-tags --force-with-lease="refs/heads/main:$lease" origin HEAD:refs/heads/main; then
    stop push-rejected
  fi
  git branch -f main HEAD
  return_to_main
  if [[ -n $release_repo_changes ]] && ! bash scripts/fork/publish-release-repo.sh; then
    stop "release-repo-failed $target_tag"
  fi
  stop "pushed $target_tag"
}

main "$@"
