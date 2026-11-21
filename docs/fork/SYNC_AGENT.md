# Daily fork sync

Run in `/Users/dmitry/.t3/projects/t3-desktop` on the Mac mini. Load
`~/.config/vite-plus/env` and run `bash scripts/fork/sync-upstream.sh`. Act on its last line.

- **`up-to-date` or `pushed <tag>`**. Finish with one line giving the accepted tag from
  `docs/fork/UPSTREAM_BASE` and the conflicts you resolved, if any. When a code push changes
  `scripts/fork/release-repo/`, the sync runs `bash scripts/fork/publish-release-repo.sh`
  after pushing. Include its result when it runs.
- **`release-repo-failed <tag>`**. The checked code is on `origin/main`. Diagnose the
  release repository error and rerun `bash scripts/fork/publish-release-repo.sh` from `main`.
  Report the accepted tag and any remaining blocker.
- **`conflict <files…>`**. Read the survival rules and seam registry in `docs/fork/FORK.md`
  (sections 1 and 6). Understand upstream's change and the fork's seam in each file. Reapply the
  smallest seam on top of upstream and keep the `fork(board)` markers. Stage each resolution.
  Continue with the command below. Repeat for later conflicts. It continues the rebase, regenerates
  the route tree, reruns the checks and pushes with the original `--force-with-lease`.
- **`check-failed <step>`**. Stay on `sync/<tag>`. Diagnose the failure, fix forward with a minimal
  commit limited to fork code or registered seams, then run the resume command. Commit regenerated
  output when the route check calls for it.
- **`push-rejected` or `error <reason>`**. Inspect the reason. Never replace a rejected lease with a
  fresh one until the owner has reconciled their changes. Ask the owner to decide how to handle an
  upstream `/board` collision, moved or deleted tag, or an upstream change you cannot cover with a
  minimal seam.

```bash
git show main:scripts/fork/sync-upstream.sh | bash -s -- --resume
```

Preserve upstream behaviour and linear history. Never merge, push with failing checks, or touch
the live app, `~/.t3`, or the signing certificate.

If you cannot finish before the code push, push nothing. Abort the sync's rebase or restore the original `main` with
`git show main:scripts/fork/sync-upstream.sh | bash -s -- --abort`. Preserve the owner's worktree
changes. Report the blocker and affected files briefly in your final T3 message.
