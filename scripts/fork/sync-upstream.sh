#!/usr/bin/env bash
set -euo pipefail

report='error initialize sync'
lock=
# shellcheck disable=SC2329 # Invoked by the EXIT trap.
finish() {
  if [[ -n $lock ]]; then
    rm -f -- "$lock/conflicts" "$lock/plan" "$lock/upstream-base.sh"
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

fetch_plan() {
  local advertised sha ref tag previous_sha=$base_sha previous_tag=$base_tag step
  local private_refs=refs/fork-upstream
  local refspecs=("+refs/heads/main:$private_refs/main")
  local accepted=false
  tags=()
  shas=()
  report='error read upstream nightly tags'
  advertised=$(git ls-remote --refs --tags --sort=version:refname upstream 'refs/tags/v*-nightly.*')
  while read -r sha ref; do
    [[ -n $ref ]] || continue
    tag=${ref#refs/tags/}
    [[ $tag =~ $nightly_pattern && $sha =~ $sha_pattern ]] || stop "error invalid upstream nightly tag $tag"
    if [[ $tag == "$base_tag" ]]; then
      [[ $sha == "$base_sha" ]] || stop "error accepted upstream tag $base_tag moved from $base_sha to $sha"
      accepted=true
    fi
    if "$accepted"; then
      tags+=("$tag")
      shas+=("$sha")
      refspecs+=("+$ref:$private_refs/tags/$tag")
    fi
  done <<< "$advertised"
  "$accepted" || stop "error accepted upstream tag $base_tag was deleted"
  report='error fetch upstream main and nightly tags'
  git fetch --atomic --no-tags upstream "${refspecs[@]}"
  for step in "${!tags[@]}"; do
    tag=${tags[step]}
    sha=${shas[step]}
    [[ $(git rev-parse "$private_refs/tags/$tag") == "$sha" ]] ||
      stop "error upstream tag $tag changed during fetch"
    git merge-base --is-ancestor "$sha" "$private_refs/main" ||
      stop "error upstream tag $tag is outside upstream main"
    git merge-base --is-ancestor "$previous_sha" "$sha" ||
      stop "error upstream tag $tag regressed from $previous_tag"
    report="error upstream route check for $tag"
    bash scripts/fork/check-routes.sh --upstream "$sha"
    previous_sha=$sha
    previous_tag=$tag
  done
}

save_plan() {
  local step
  printf '%s %s\n' "$original" "$lease"
  for step in "${!tags[@]}"; do
    printf '%s %s\n' "${tags[step]}" "${shas[step]}"
  done
}

load_plan() {
  local tag sha extra
  read -r original lease extra
  [[ $original =~ $sha_pattern && $lease =~ $sha_pattern && -z $extra ]] ||
    stop 'error invalid pending sync state'
  tags=()
  shas=()
  while read -r tag sha extra; do
    [[ $tag =~ $nightly_pattern && $sha =~ $sha_pattern && -z $extra ]] ||
      stop 'error invalid pending sync state'
    tags+=("$tag")
    shas+=("$sha")
  done
  [[ ${#tags[@]} -gt 0 ]] || stop 'error empty pending sync plan'
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
      stop "conflict $target_tag ${conflicts//$'\n'/ }"
    fi
    if run_rebase --continue; then
      break
    fi
  done
  [[ $(git symbolic-ref --quiet --short HEAD) == "$candidate" ]]
}

prepare_candidate() {
  check "generate-routes $target_tag" bash scripts/fork/check-routes.sh --generate
  report='error restore upstream translations'
  local translations=':(glob)apps/*/src/i18n/translations/*.json'
  if ! git diff --quiet "$target_sha" HEAD -- "$translations"; then
    git restore --source="$target_sha" --staged --worktree -- "$translations"
  fi

  printf '%s %s\n' "$target_tag" "$target_sha" > "$base_file"
  git add -- "$base_file" "$route_tree"
  report='error commit upstream base and regenerated route tree'
  local commit_args=(-m "chore(fork): sync with upstream $target_tag")
  # Replace this run's previous bookkeeping commit when it is still at the tip.
  if [[ $base_tag != "${tags[0]}" &&
        $(git log -1 --format=%s) == "chore(fork): sync with upstream $base_tag" ]]; then
    commit_args+=(--amend)
  fi
  git -c core.hooksPath=/dev/null commit "${commit_args[@]}"
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

install_dependencies() {
  if [[ -z $installed_for ]] ||
    ! git diff --quiet "$installed_for" HEAD -- ':(glob)**/package.json' pnpm-lock.yaml pnpm-workspace.yaml .npmrc; then
    check "dependencies $target_tag" vp i
    installed_for=$(git rev-parse HEAD)
  fi
}

advance_candidate() {
  local step current=-1 next installed_for='' onto
  report='error read upstream base on candidate'
  read_upstream_base "$candidate"
  for step in "${!tags[@]}"; do
    if [[ $base_tag == "${tags[step]}" && $base_sha == "${shas[step]}" ]]; then
      current=$step
      break
    fi
  done
  ((current >= 0)) || stop 'error candidate base is outside the pending sync plan'
  next=$((current + 1))
  if ! is_rebasing && ((current > 0)); then
    # A failed install or generation can leave HEAD rebased with the prior base record.
    if ((next == ${#tags[@]})) ||
      git merge-base --is-ancestor "${shas[next]}" "$base_sha" ||
      ! git merge-base --is-ancestor "${shas[next]}" HEAD; then
      check "seams $base_tag" bash scripts/fork/check-seams.sh
    fi
  fi
  if is_rebasing && ((next == ${#tags[@]})); then
    stop 'error unexpected rebase after the last sync step'
  fi

  for ((step = next; step < ${#tags[@]}; step++)); do
    target_tag=${tags[step]}
    target_sha=${shas[step]}
    printf 'Syncing %s onto %s\n' "$base_tag" "$target_tag" >&2
    if is_rebasing; then
      require_linear "$base_sha" "$candidate"
      onto=$(git rev-parse "$target_sha^{commit}")
      [[ $(cat "$rebase_dir/onto") == "$onto" ]] || stop "error rebase target does not match $target_tag"
      continue_rebase
    elif ! git merge-base --is-ancestor "$target_sha" HEAD; then
      require_linear "$base_sha" HEAD
      report="error rebase onto $target_tag"
      if ! run_rebase --merge --no-autostash --no-update-refs --empty=drop --onto "$target_sha" "$base_sha"; then
        is_rebasing || exit 1
        continue_rebase
      fi
    fi
    require_clean
    require_linear "$target_sha" HEAD
    install_dependencies
    require_clean
    prepare_candidate
    check "seams $target_tag" bash scripts/fork/check-seams.sh
    base_tag=$target_tag
    base_sha=$target_sha
  done
  target_tag=$base_tag
  target_sha=$base_sha
  install_dependencies
}

return_to_main() {
  git switch main
  git branch -D "$candidate"
  rm -- "$state"
}

main() {
  cd "$(git rev-parse --show-toplevel)"
  local state rebase_dir original lease target_tag target_sha candidate base_tag base_sha
  local mode=${1:-} head operation
  local -a tags shas
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
      fetch_plan
      candidate="sync/${tags[${#tags[@]} - 1]}"
      save_plan > "$lock/plan"
      report="error create candidate branch $candidate"
      git switch -c "$candidate"
      mv -- "$lock/plan" "$state"
      ;;
    --resume|--abort)
      report='error read pending sync state'
      [[ -f $state ]] || stop 'error no pending sync'
      load_plan < "$state"
      candidate="sync/${tags[${#tags[@]} - 1]}"
      [[ $(git rev-parse refs/heads/main) == "$original" ]] || stop 'error local main changed during sync'
      if is_rebasing; then
        [[ $(cat "$rebase_dir/head-name") == "refs/heads/$candidate" ]] || stop "error expected a rebase of $candidate"
        if [[ $mode == --abort ]]; then
          report='error abort rebase'
          run_rebase --abort
        fi
      else
        [[ $head == "$candidate" ]] || stop "error expected to be on $candidate"
        for operation in rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD sequencer; do
          [[ ! -e $(git rev-parse --git-path "$operation") ]] || stop "error Git operation in progress: $operation"
        done
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

  advance_candidate
  require_linear "$target_sha" HEAD
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
