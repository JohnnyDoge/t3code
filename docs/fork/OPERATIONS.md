# Fork CI operations

## Set up the fork

Publish the fork as a public repository with `main` as its default branch. Enable Actions,
Issues, and the two fork workflows. The sync job must be allowed to force-update `main`.

Under **Settings → Secrets and variables → Actions**, add these repository secrets.

| Secret                     | Value                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FORK_PUSH_TOKEN`          | A fine-grained GitHub personal access token scoped to this fork with **Contents** and **Workflows** set to read and write. Renew it before expiration. |
| `FORK_MAC_CERT_P12_BASE64` | The base64-encoded PKCS#12 export of the stable `T3 Code Fork Signing` identity, including its private key.                                            |
| `FORK_MAC_CERT_PASSWORD`   | The password used to export that PKCS#12 file.                                                                                                         |

Keep a secure backup of the same signing identity for future updates. The built-in
`GITHUB_TOKEN` handles issue reporting and publishing releases with job-specific permissions.

From a shell signed into `gh` as the fork owner, run
`bash scripts/fork/disable-upstream-workflows.sh OWNER/REPO`. It disables all active
workflows outside the `fork-*` family. Run it again if upstream adds workflows.

The starting upstream revision includes these event-triggered workflows. Individual jobs
may restrict the repository, paths, or event subtype.

- Push or pull request events can trigger `agent-context-budget`, `ci`, `deploy-relay`,
  `desktop-macos-preview`, `issue-labels`, `issue-vouch`, `mobile-dev-client`,
  `mobile-eas-preview-fork`, `mobile-eas-preview`, `mobile-eas-production`,
  `mobile-fingerprint-check`, `pr-limits`, `pr-size`, `pr-vouch`,
  `relay-preview-cleanup`, `relay-preview`, `release`, and `web-preview`.
- Workflow completion can trigger `desktop-macos-preview-publish`,
  `mobile-fingerprint-label`, and `thread-transfer-report`.
  `desktop-macos-preview-publish` also listens for pull request target events.
- Schedules and manual dispatch can also reach `mobile-android-apk` and
  `stale-needs-more-info`. `mobile-showcase-screenshots`, `publish-aur`, and
  `windows-tests` accept manual dispatch. `release-desktop` runs when called by another workflow.

## Recover a daily sync

The daily sync runs at 04:17 UTC. The **fork-sync failed** issue names the target nightly,
the failed check or conflicting files, and links to the run. Fix a missed check or an
expired credential, then dispatch **Fork sync** on `main`. A successful run closes the issue.

For a manual conflict resolution, use a clean local checkout with `main` checked out.
Save the current remote SHA for the push lease. The dry run fetches the upstream refs and
aborts on unresolved conflicts. Substitute the nightly reported by that run below.

```bash
git fetch origin main
lease=$(git rev-parse FETCH_HEAD)
git log --oneline "$lease..main"
bash scripts/fork/sync-upstream.sh --dry-run

target=refs/fork-upstream/tags/v0.1.12-nightly.20261121.5038
git config rerere.enabled true
git config rerere.autoupdate true
git rebase --onto "$target" "$(git merge-base main "$target")" main
```

Review any solutions staged by rerere. Edit each remaining conflict, run `git add` on the
resolved files, and run `git rebase --continue` until it finishes. Use
`vp run --filter @t3tools/web build` to regenerate the route tree. For translation JSON,
`git checkout --ours -- <file>` takes the upstream side during the rebase. Keep rerere
enabled for future local runs. CI keeps its own rerere cache.

Run `vp i`, `vp run --filter @t3tools/web typecheck`,
`vp run --filter @t3tools/client-runtime typecheck`, and
`vp run --filter @t3tools/desktop typecheck`. Run `vp test run` against each existing
board test directory under `apps/web/src/fork` and `apps/desktop/src/fork`, then run
`bash scripts/fork/check-seams.sh`. After the checks pass, run
`git push --force-with-lease="refs/heads/main:$lease" origin main` and dispatch **Fork sync**
on `main` to close the issue. If the lease fails, fetch and review the new remote commits
before retrying.

## Release a desktop build

**Fork desktop release** runs on Sundays at 06:43 UTC and skips a commit that already has
a fork release. To publish on demand, run the workflow from `main` in Actions. Select
**Rebuild even if main is already released** to release the same commit with a higher version.
The workflow publishes `T3 Code Fork v<version>` as a prerelease only after both platforms'
assets have uploaded to the draft. It keeps the newest eight fork prereleases and their tags.

The first fork install on each machine must come from the fork's Releases page. It carries
the fork repository in its updater configuration. Later builds are offered by the app's
Update button. Check these release assets if an update is missing or fails to download.

- macOS arm64 reads `nightly-mac.yml`. The updater downloads the ZIP named in that manifest.
  Use the DMG for manual installation.
- Windows x64 reads `nightly.yml` and downloads the NSIS `.exe` named in it.
- Keep the builder's `.blockmap` files with their matching artifacts for differential
  downloads. Check that each manifest's version matches the release tag and that the
  file names and hashes match the assets.

The GitHub updater discovers the release via the fork's `releases.atom` feed, with a
GitHub release-list fallback when the feed has no nightly. Keep the fork's tags limited
to its own releases so other nightlies cannot take priority in the feed.
