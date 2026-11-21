# Weekly fork sync

Run Saturdays at 07:30 Mac mini local time in `~/.t3/projects/t3-desktop`. Load
`~/.config/vite-plus/env` and run `bash scripts/fork/sync-upstream.sh`. Act on its last line.

The script pins the ordered list of upstream nightly tags at the start. It rebases onto
each tag in turn, regenerates the route tree, and checks the seam registry before moving
on. Leave any tags published during the sync for the next run. The full check suite runs
at the end, before a single push of the code. List every tag where you resolved
conflicts, with the affected files, in your final report.

- **`up-to-date` or `pushed <tag>`**. Finish with one line giving the accepted tag from
  `docs/fork/UPSTREAM_BASE` and the conflicts you resolved. When a code push changes
  `scripts/fork/release-repo/`, the sync runs
  `bash scripts/fork/publish-release-repo.sh` after pushing. Include its result when it runs.
- **`release-repo-failed <tag>`**. The checked code is on `origin/main`. Diagnose the
  release repository error and rerun `bash scripts/fork/publish-release-repo.sh` from `main`.
  Report the accepted tag and any remaining blocker.
- **`conflict <tag> <files…>`**. Record the tag and affected files for your final report.
  Read the survival rules and seam registry in `docs/fork/FORK.md`
  (sections 1 and 6). Understand upstream's change and the fork's seam in each file. Reapply the
  smallest seam on top of upstream and keep the `fork(board)` markers. Stage each resolution.
  Continue with the command below. It resumes this tag's rebase and then processes the
  remaining tags. Repeat for later conflicts. The final push uses the original `--force-with-lease`.
- **`check-failed <step> [<tag>]`**. Stay on `sync/<newest-tag>`. Diagnose the failure,
  fix forward with a minimal commit limited to fork code or registered seams, then run
  the resume command. Commit regenerated output when the route check calls for it.
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
changes. Report the blocker and affected files in your final T3 message.
