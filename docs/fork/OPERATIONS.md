# Fork operations

## One-time setup

Use a public GitHub fork with `main` as the default branch and enable **Fork desktop release** in
Actions. The Mac mini checkout at `/Users/dmitry/.t3/projects/t3-desktop` needs `origin` pointing
at the fork and `upstream` pointing at `pingdotgg/t3code`. Give the owner's normal Git credentials
permission to update workflows and force-update `main` with a lease.

Before the first release, remove any upstream tags copied into the GitHub fork. Compare the two
remotes' tags and keep tags that belong to fork releases. The sync fetches upstream nightlies into
`refs/fork-upstream/`, so it does not recreate the copied tags.

Add two repository secrets in **Settings → Secrets and variables → Actions**.

| Secret                     | Value                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `FORK_MAC_CERT_P12_BASE64` | Base64-encoded PKCS#12 export of the stable `T3 Code Fork Signing` identity and private key |
| `FORK_MAC_CERT_PASSWORD`   | Password for the same PKCS#12 export                                                        |

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
original commit until the checked candidate has been pushed.

Inspect rerere with `git rerere status` and `git rerere diff` during a conflict. To replace a bad
cached resolution for one conflict, recreate the conflict in that file if needed and run
`git rerere forget -- <file>` before resolving it. To clear all cached resolutions, end any
rebase and run `rm -rf .git/rr-cache` from the Mac mini checkout. The checks run after cached
resolutions are applied.

## Weekly desktop release

**Fork desktop release** runs Sundays at 06:43 UTC. To release on demand, select **Run workflow** in
Actions on `main`. Use **Rebuild even if main is already released** to release the same commit
with a higher version.

The workflow validates the versions, file names, SHA-512 hashes, sizes and blockmaps in
`nightly-mac.yml` and `nightly.yml` before publishing. Once the prerelease assets are public, it
updates `update-feed/nightly.json` to point to the newest fork release. A run that skips building
also refreshes the pointer. Keep the `update-feed` release public. The workflow keeps the newest
eight fork prereleases and their tags.

Install the first fork build from the fork's Releases page. Run the
[macOS installer](MAC_SIGNING.md) on macOS or download the Windows x64 NSIS installer. Later builds
appear through the app's updater. It compares the pointer with GitHub's Atom feed and selects the
newer nightly. macOS updates use the ZIP and Windows updates use the EXE.
