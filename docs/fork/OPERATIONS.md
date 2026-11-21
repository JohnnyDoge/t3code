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

4. In the Mac mini checkout at `~/.t3/projects/t3-desktop`, set `origin` to the code
   fork and `upstream` to `pingdotgg/t3code`. Use the owner's normal Git credentials with
   permission to update the release repository's workflow and force-update the code fork's
   `main` with a lease. Push the fork's `main` without tags. If an earlier push copied upstream
   tags into the code fork, compare them with upstream's tags and remove the copied tags from
   the code fork. The weekly sync fetches upstream tags into `refs/fork-upstream/` and pushes only
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

## Weekly sync

Schedule the T3 task for Saturdays at 07:30 Mac mini local time before the Sunday
release. Select Codex and the project checkout at
`~/.t3/projects/t3-desktop`, use the project root as the working directory, and
paste [SYNC_AGENT.md](SYNC_AGENT.md) as its instructions. Run the task on demand in T3
to trigger an extra sync. The task reports the accepted tag or the blocker, and lists
each tag where it resolved conflicts and the files involved.

The script requires a clean `main` and takes a lease on the current `origin/main`. On
`sync/<newest-tag>`, it rebases onto each nightly after the accepted tag in version order.
Each completed step regenerates the route tree and checks the seam registry. The script
reuses dependencies while the install inputs match and runs the full suite once at
the end, including when the accepted tag is already current. A conflict leaves the
rebase in progress at the reported tag. A failed check leaves the candidate checked
out. Resume continues with the saved tags and lease. `main` stays at its original
commit until the checked candidate has been pushed. If that push changes
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

The workflow uses GitHub-hosted runners. Ubuntu 24.04 builds the shared JS bundle
and the Linux x64 CLI archive embedded in the Windows installer for WSL. Ubuntu 24.04
also builds the Windows installer and its resource monitor, which are checked on
Windows Server 2025. The macOS ARM64 job uses `macos-26` and checks for a macOS 26 or
newer SDK before compiling the Apple Speech helper. It opens the signed app from
the DMG against a seeded test database.

T3 Connect uses the same production Clerk and relay configuration as upstream.
An existing sign-in carries over with the shared profile. For a new sign-in, the
running app registers the shared `t3code://` callback. The self-signed macOS build
uses system-browser sign-in and lacks Apple-provisioned native passkeys.

The workflow validates the versions, file names, SHA-512 hashes, sizes and blockmaps in
`nightly-mac.yml` and `nightly.yml` before publishing. Once the prerelease assets are public, it
updates `update-feed/nightly.json` to point to the newest fork release. A run that skips building
also refreshes the pointer. Keep the `update-feed` release public. The workflow keeps the newest
eight fork prereleases and their tags.

## Install and first run

Install **T3 Code Fork (Nightly)** alongside the official app. Quit the official app
before running the [macOS installer](MAC_SIGNING.md), which opens the fork after
installation. On Windows, run the x64 installer from the
[release repository](https://github.com/JohnnyDoge/t3code-fork-releases/releases)
and use its default install folder and **T3 Code Fork (Nightly)** shortcut.
Use the fork's built-in updater for subsequent fork releases.

To switch, fully quit the official app and open the fork. Your projects, threads,
settings, sign-in and linked environments use the same local data. Quit the fork
before switching back. On macOS, choose **Always Allow** if prompted to give the
fork access to the shared Safe Storage key. See [macOS signing](MAC_SIGNING.md).

Both apps use the normal T3 home (`~/.t3` or an explicit `T3CODE_HOME`), the
same WSL home, and the same Electron profile (`t3code-v2`). The backend still
scans from port 3773 when no port is configured. The shared `t3` launcher follows
the app that last launched and refreshed it. If you remove that app, open the
other one to refresh the launcher.

Switch between builds from the same upstream nightly when possible. A newer
build may migrate the shared database. Desktop startup in an older build can
skip newer migration IDs and still open the database, but an incompatible schema
or stored event can break reads, writes or replay. If the older build cannot
handle the shared data, reopen the build that migrated it or a later compatible
build.
