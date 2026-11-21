#!/usr/bin/env bash
set -euo pipefail

if [[ $# -gt 1 ]]; then
  echo "Usage: $0 [release-repo-url-or-path]" >&2
  exit 1
fi

repository=${1:-https://github.com/JohnnyDoge/t3code-fork-releases.git}
root_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
scratch=$(mktemp -d "${TMPDIR:-/tmp}/t3-release-repo.XXXXXXXX")
trap 'rm -rf -- "$scratch"' EXIT
trap 'exit 1' HUP INT TERM

checkout="$scratch/repo"
mkdir "$scratch/source"
git -C "$root_dir" archive HEAD:scripts/fork/release-repo | tar -xf - -C "$scratch/source"
git clone --single-branch --no-tags -- "$repository" "$checkout"
branch=$(git -C "$checkout" symbolic-ref --short HEAD)
rsync -a --delete --exclude='/.git' "$scratch/source/" "$checkout/"
git -C "$checkout" add -A
if git -C "$checkout" diff --cached --quiet; then
  echo 'release-repo up-to-date'
  exit 0
fi

git -C "$checkout" commit -m 'chore(release): sync desktop release workflow'
sha=$(git -C "$checkout" rev-parse HEAD)
git -C "$checkout" push --no-follow-tags origin "HEAD:refs/heads/$branch"
printf 'release-repo pushed %s\n' "$sha"
