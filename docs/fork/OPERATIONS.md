# Fork operations

## One-time setup

1. Create the public fork `JohnnyDoge/t3code` of `pingdotgg/t3code` with `main` as the default
   branch. Disable Actions in the fork before pushing code to it.

   ```bash
   gh api -X PUT repos/JohnnyDoge/t3code/actions/permissions -F enabled=false
   ```

2. Create `JohnnyDoge/t3code-fork-releases` as a separate public repository initialized with a
   README on `main`. Enable Actions there and leave release immutability disabled so the workflow
   can replace the update pointer and prune older releases.
3. In the release repository, open **Settings → Secrets and variables → Actions**. Set the
   `FORK_REPOSITORY` repository variable to `JohnnyDoge/t3code`, the workflow's default, and set
   both repository secrets.

   | Secret                     | Value                                                                                       |
   | -------------------------- | ------------------------------------------------------------------------------------------- |
   | `FORK_MAC_CERT_P12_BASE64` | Base64-encoded PKCS#12 export of the stable `T3 Code Fork Signing` identity and private key |
   | `FORK_MAC_CERT_PASSWORD`   | Password for the same PKCS#12 export                                                        |

4. In the Mac mini checkout at `/Users/dmitry/.t3/projects/t3-desktop`, set `origin` to the code
   fork and `upstream` to `pingdotgg/t3code`. Use the owner's normal Git credentials with
   permission to update the release repository's workflow and force-update the code fork's
   `main` with a lease. Push the fork's `main` without tags. If an earlier push copied upstream
   tags into the code fork, compare them with upstream's tags and remove the copied tags from
   the code fork. The daily sync fetches upstream tags into `refs/fork-upstream/` and pushes only
   `main`.
5. From the fork checkout on `main`, publish the committed release repository files.
   This replaces the release repository's default-branch tree with `scripts/fork/release-repo/`.

   ```bash
   bash scripts/fork/publish-release-repo.sh
   ```

6. In the release repository, open **Actions → Fork desktop release → Run workflow** on `main`
   to trigger the first release.

Keep a secure backup of that exact PKCS#12 file and its password. A replacement certificate with
the same common name has a different designated requirement. See [macOS signing](MAC_SIGNING.md).

## Daily sync

Create a daily T3 scheduled task on the Mac mini. Select Codex and the project checkout at
`/Users/dmitry/.t3/projects/t3-desktop`, use the project root as the working directory, and
paste [SYNC_AGENT.md](SYNC_AGENT.md) as its instructions. Choose a time when the checkout is usually
idle. Run the task on demand in T3 to trigger an extra sync. The task's final message reports the
accepted tag and any conflicts resolved, or the blocker and files involved.

The script requires a clean `main` and takes a lease on the current `origin/main`. It checks a
candidate on `sync/<tag>`, including when the accepted tag is already current. A conflict leaves
the rebase in progress. A failed check leaves the candidate checked out. `main` stays at its
original commit until the checked candidate has been pushed. If that push changes
`scripts/fork/release-repo/`, the script syncs the release repository. A
`release-repo-failed <tag>` result means the code push succeeded. Rerun
`bash scripts/fork/publish-release-repo.sh` from `main` after resolving the error.

Inspect rerere with `git rerere status` and `git rerere diff` during a conflict. To replace a bad
cached resolution for one conflict, recreate the conflict in that file if needed and run
`git rerere forget -- <file>` before resolving it. To clear all cached resolutions, end any
rebase and run `rm -rf .git/rr-cache` from the Mac mini checkout. The checks run after cached
resolutions are applied.

## Weekly desktop release

**Fork desktop release** runs Sundays at 06:43 UTC in `JohnnyDoge/t3code-fork-releases`. To release
on demand, select **Run workflow** in that repository's Actions on its default branch. Use
**Rebuild even if main is already released** to release the same fork commit with a higher
version. If the newest official nightly has moved to a newer version base, sync the code fork
before releasing. The release tag targets the release repository and the notes identify the fork
commit used to build the installers.

The workflow validates the versions, file names, SHA-512 hashes, sizes and blockmaps in
`nightly-mac.yml` and `nightly.yml` before publishing. Once the prerelease assets are public, it
updates `update-feed/nightly.json` to point to the newest fork release. A run that skips building
also refreshes the pointer. Keep the `update-feed` release public. The workflow keeps the newest
eight fork prereleases and their tags.

Install the first fork build from the [release repository's Releases page](https://github.com/JohnnyDoge/t3code-fork-releases/releases). Run the
[macOS installer](MAC_SIGNING.md) on macOS or download the Windows x64 NSIS installer. Later builds
appear through the app's updater. It compares the pointer with GitHub's Atom feed and selects the
newer nightly. macOS updates use the ZIP and Windows updates use the EXE.
