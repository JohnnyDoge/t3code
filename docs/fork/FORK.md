# Fork: task board for T3 Code

This repository is a personal fork of `pingdotgg/t3code`. It adds one feature, a
kanban-style **task board** of threads, and a build pipeline that ships the fork as
the owner's daily driver on two machines (a Mac mini, Apple Silicon, and a Windows PC)
that are connected to each other through T3 Connect.

The upstream project moves every day. **Every decision in this fork is judged first by
how well it survives a daily rebase onto upstream.** Read the "Survival rules" section
before you change anything.

Reference: upstream PR pingdotgg/t3code#34779 ("task board with threads grouped by
status") is an open, unmerged proposal for a read-only board. We reuse its ideas where
noted, not its code wholesale.

---

## 1. Survival rules (mandatory for every change)

1. **No server, contract or persistence changes.** Nothing under `apps/server/`,
   `packages/contracts/`, database migrations, or wire formats. The board stores its
   state only through commands the stock server already accepts. A stock nightly build
   must be able to run against data the fork wrote, and the other way round.
2. **New code lives in fork-owned paths**, which upstream never touches:
   - `apps/web/src/fork/**` for web UI and logic
   - `apps/desktop/src/fork/**` for desktop shell code
   - `scripts/fork/**` for scripts
   - `.github/workflows/fork-*.yml` for CI
   - `docs/fork/**` for documentation
3. **Upstream files get only seams**: the smallest possible insertion that hands control
   to fork-owned code (one import plus one call, one menu entry, one button). Do not
   refactor, reformat, rename or move upstream code. Do not "fix" unrelated upstream
   code you notice.
4. **Mark every seam** with a comment containing `fork(board)` on or directly above the
   inserted lines, so `git grep "fork(board)"` lists the whole upstream surface. Use the
   comment style of the file (`// fork(board): ...` in TS/TSX, `# fork(board): ...` in
   YAML or shell).
5. **Record every seam** in the table in section 6 of this file, in the same commit
   that adds the seam.
6. **Generated files are regenerated, never hand-merged.** `apps/web/src/routeTree.gen.ts`
   is produced by the TanStack Router generator. Commit the regenerated output.
7. **No new runtime dependencies** unless the task explicitly allows one.
8. **Follow upstream conventions.** Read the repo's `AGENTS.md` and `CLAUDE.md` and
   the docs they point to before you write code. Use the same lint, format, i18n
   (`gt-react`, `msg()` / `useGT()`), Effect and atom patterns as the neighbouring code.
   New user-facing strings go through i18n (`msg()` / `useGT()`) with an English source
   string. **Do not edit `apps/*/src/i18n/translations/*.json`.** Those files change in
   almost every upstream commit and would conflict on every rebase. Fork strings fall back to
   their English source. The fork's CI does not run `i18n:check`. If a generator rewrites
   those files as a side effect, revert that part of its output.
9. **Tests**: pure logic gets unit tests next to it (`*.test.ts`). Prefer unit tests
   over browser tests; add a browser test only where behaviour cannot be tested below
   the UI.

---

## 2. Board data model

### 2.1 Where state lives

The owner uses two client machines that both see threads from both environments via
T3 Connect. Board state must therefore be **stored on the server that owns the thread**,
so both clients see the same thing. Browser `localStorage` is allowed only for
per-device view preferences such as column widths and collapsed columns.

The stock server already supports per-thread **tags**:

- command `thread.tag.set { threadId, tag, tagged: boolean }` (see
  `packages/contracts/src/orchestrationV2.ts`, `ThreadTag` in `threadTags.ts`: trimmed,
  non-empty, at most 64 characters, single line);
- event `thread.tags-updated`, applied to the thread shell by the client projection;
- `tags: string[]` on the thread shell (`OrchestrationV2ThreadShell.tags`).

The web UI of upstream does not display tags anywhere today. All board tags use the
reserved prefix `kb:` and must stay invisible in any UI.

### 2.2 Board tags

| Tag               | Meaning                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| `kb:seen:<runId>` | The owner has looked at the result of run `<runId>`.                                                    |
| `kb:todo:<runId>` | The owner placed the thread in To do while its latest run was `<runId>`. **Implies seen** for that run. |
| `kb:todo:none`    | Same, for a thread that has no run yet.                                                                 |

`<runId>` is `thread.latestRun.runId`. Marks are **scoped to a run**: when a new run
starts, marks for the previous run stop applying without anyone deleting them. This is
what makes a finished new run come back to Review automatically, and what drops a
thread out of To do once work on it starts.

If `"kb:seen:" + runId` would exceed 64 characters, use a stable short hash of the
run id instead (document the scheme in code). Check the real run id format first.

A thread's placement for its current run therefore depends on **one** tag at a time: no
mark (Review), `kb:seen` (Done) or `kb:todo` (To do). Every move adds the new mark
**before** removing the old one, so a partial failure or two clients writing at once can
leave both marks but never neither. When both are present, `kb:todo` wins, and the next
write cleans up.

**Garbage collection**: whenever the board writes a mark for a thread, it also removes
that thread's stale `kb:seen:*` / `kb:todo:*` tags (ones whose run id is not the
current latest run). Never touch tags without the `kb:` prefix.

### 2.3 Column resolution

Given a thread shell, its tags and the current time, the thread goes to exactly one
column. Evaluate top to bottom; the first match wins:

1. Archived thread, or lineage that is not listed (`isListedThreadLineage` false):
   **not on the board**.
2. Settled or snoozed **exactly as the Sidebar decides**: reuse the Sidebar's own
   section resolution (the logic that fills its settled and snoozed shelves, including
   wake times, which are driven by the existing deadline clock, not a minute tick), so the
   board, the Sidebar and every menu agree. Snoozed: **Snoozed**. Settled: **Settled**.
3. Let `s = resolveSidebarThreadStatus(thread)` (the raw status, before the sidebar's
   "visited failure reads as ready" downgrade):
   - `approval`, `input`, `request`, `limited`: **Needs you**
   - `failed`: **Failed**, unless the failure is a failed latest run carrying a mark:
     `kb:todo:<latestRunId>` gives **To do**, `kb:seen:<latestRunId>` gives **Done**. (A runtime failure without a
     failed run has nothing to scope a mark to and stays Failed, like upstream.)
   - `preparing`, `working`: **Working**
   - `waiting`: **Waiting**
   - `ready`:
     - latest run completed (`completedAt` set) with a status other than
       `interrupted` / `cancelled`, and neither `kb:seen:<latestRunId>` nor
       `kb:todo:<latestRunId>`: **Review**
     - else `kb:todo:<latestRunId or "none">` present: **To do**
     - else: **Done**

Important difference from upstream: **opening a thread never changes its column.**
Upstream's `lastVisitedAt` / `hasUnseenCompletion` / `hasUnseenRunFailure` are not used
for Review or Failed; only `kb:seen:*` is.

### 2.4 Columns, left to right

| id          | Label     | Accepts drops | Default   |
| ----------- | --------- | ------------- | --------- |
| `todo`      | To do     | yes           | expanded  |
| `working`   | Working   | no            | expanded  |
| `waiting`   | Waiting   | no            | expanded  |
| `needs-you` | Needs you | no            | expanded  |
| `failed`    | Failed    | no            | expanded  |
| `review`    | Review    | yes           | expanded  |
| `done`      | Done      | yes           | expanded  |
| `snoozed`   | Snoozed   | yes           | collapsed |
| `settled`   | Settled   | yes           | collapsed |

Within a column: pinned threads first, then most recently updated first.

### 2.5 Actions

All actions are expressed as a list of operations, computed by pure functions and
executed by one executor:

```ts
type BoardOp =
  | { readonly kind: "tag"; readonly tag: string; readonly tagged: boolean }
  | { readonly kind: "settle" }
  | { readonly kind: "unsettle" }
  | { readonly kind: "unsnooze" }
  | { readonly kind: "open-snooze-menu" };
```

- **A move is offered only if it works**: the planner applies its ops to the thread's
  tags and state, resolves the column again, and accepts the move only when the result is
  the target column. Tests assert the resulting column, not only the op list.
- **Drop on To do**: add `kb:todo:<runId|none>`, then remove the other current-run mark;
  unsettle if settled; unsnooze if snoozed.
- **Drop on Review**: remove `kb:seen:<runId>` and `kb:todo:<runId>`; unsettle / unsnooze.
- **Drop on Done**: add `kb:seen:<runId>` when there is a run, then remove
  `kb:todo:<runId>`; unsettle / unsnooze.
- **Drop on Snoozed**: open the same snooze choices as the thread menu, presets and
  **Custom…** with its dialog. Snoozing never unsettles; column resolution handles
  precedence, so upstream's Undo restores the previous state unchanged.
- **Drop on Settled**: settle.
- **Drop on Working / Waiting / Needs you / Failed**: rejected, the card returns.
- **Mark as seen** (context menu, chat header button): add `kb:seen:<runId>`. Shown
  when the thread is in Review, or in Failed because of a failed run. There is no
  keyboard shortcut: keybinding commands live in `packages/contracts`, which the fork
  does not change.
- **Mark all as seen** (Review column header, with a confirmation that states the
  count): Mark as seen for every thread currently in Review. Needed on first use,
  when every finished thread starts in Review.
- **Mark as unseen** (context menu): remove `kb:seen:<runId>`. Shown when the thread
  has a completed run that is marked seen.

Every write also performs the garbage collection from 2.2. Writes go to the thread's
own environment, and reads tolerate duplicates or partial writes, for example both the
old and the new mark present for a moment.

Upstream's existing "Mark unread" (visit watermark) is a different feature. Leave it
alone.

---

## 3. UI surface

- **Route** `/board` inside the chat layout (`apps/web/src/routes/_chat.board.tsx`).
- **Entry button**: in the sidebar header row (`SidebarChrome.tsx`, the row with the
  brand mark and the back/forward history buttons), pushed to the **right edge** of
  that row. In Electron that row is a window drag region, so the button must opt out
  (`no-drag`). Toggles between the board and the last main-app location (see
  `mainAppLocation.ts` and how PR #34779 handled it).
- **Command palette**: "Open task board".
- **Cards**: title, project, relative time, the sidebar's status pill or label. Click
  opens the thread. Right-click opens **the same thread context menu as the sidebar**
  (PR #34779's `threadContextMenu.ts` approach: the Sidebar publishes its handler, and
  other surfaces call it).
- **Drag and drop** cards between columns, mapped to the actions in 2.5. Native HTML5
  DnD or pointer events, no new dependency. Give keyboard users an alternative ("Move
  to…" in the card's menu).
- **Columns**: collapse or expand from the header, and resize the width. Store this per
  device in localStorage, with a schema-validated, self-repairing saved layout (as in
  PR #34779). No stacking, vertical split or column reordering in v1. **Empty columns
  shrink automatically** to a slim rail (label and zero count) and widen again as soon as a
  card lands. While a drag is in progress, empty columns that accept the card expand, so
  they stay easy drop targets. Manual collapse still wins.
- **Settled column is complete**: the server sends only the newest settled threads in the
  shell snapshot. The Settled column shows the true count and pages older settled threads
  through the existing older-settled API that the Sidebar shelf uses.
- **Mark as seen in the chat**: a compact button in the chat header, visible only when
  the open thread is in Review (or in Failed because of a failed run).
- **Context menu**: "Mark as seen" / "Mark as unseen" entries in the shared thread
  action menu (sidebar rows, board cards, chat header menu).
- Desktop and web only; mobile app (`apps/mobile`) is out of scope.

---

## 4. Build and release pipeline

- The fork's GitHub repository is public, so the desktop auto-updater can read
  releases without a token.
- `scripts/build-desktop-artifact.ts` points the auto-update feed at
  `T3CODE_DESKTOP_UPDATE_REPOSITORY`, or failing that `GITHUB_REPOSITORY`, so builds
  made in the fork's CI update from the fork's releases.
- Version format: `<upstream base>-nightly.<YYYYMMDD>.<N>`, because
  `/-nightly\.\d{8}\.\d+$/` selects the nightly channel. Versions must increase on every
  release.
- **History is linear**: `main` is the upstream nightly tag plus the fork's own non-merge
  commits. Never merge into `main`; integrate branches by rebasing them onto `main` and
  fast-forwarding.
- **Daily sync by an agent on the Mac mini**, not on GitHub: a T3 scheduled task runs
  `scripts/fork/sync-upstream.sh` on the owner's Mac mini. A clean rebase that passes the
  checks is pushed with the owner's local git credentials. On a conflict or a failing
  check, the agent resolves it by following `docs/fork/SYNC_AGENT.md`, reruns the checks,
  and pushes; if it cannot, it pushes nothing and leaves a clear report. GitHub holds no
  push token.
- **Upstream workflows are removed from the fork** by one fork commit. Upstream edits to
  those files (modify/delete conflicts) and new upstream workflows are resolved by
  deleting them during sync, so nothing upstream ever runs in the fork's Actions.
- **Weekly** CI job (`fork-release`), plus a manual trigger: build macOS arm64
  (dmg + zip) and Windows x64 (nsis), then publish a GitHub prerelease with the
  electron-builder update metadata.
- macOS: no Apple Developer account. Builds are signed with one **stable self-signed
  code-signing certificate** (stored as CI secrets), so every build has the same
  designated requirement. Notarization is skipped. Squirrel.Mac's check was verified to
  accept updates between two builds signed this way (`docs/fork/MAC_SIGNING.md`). The
  certificate lives in `~/.t3-fork-signing/` on the Mac mini and in the fork's CI secrets.
  Losing it breaks in-app updates on macOS, so the owner keeps a backup.
- **Build entry point**, the contract between the CI workflow and the packaging code:
  `node scripts/fork/build-desktop.ts --platform <mac|win> --arch <arm64|x64> --version <v> --out <dir>`.
  Environment: `T3CODE_DESKTOP_UPDATE_REPOSITORY` (`owner/repo` of the fork) and, on macOS
  only, `FORK_MAC_CERT_P12_BASE64` and `FORK_MAC_CERT_PASSWORD` (the self-signed identity,
  common name `T3 Code Fork Signing`). It writes everything one release needs into
  `<dir>`: installers, the zip for macOS, blockmaps, and the electron-builder update
  metadata (`nightly-mac.yml` / `nightly.yml`, or whatever the build actually emits). It
  wraps `scripts/build-desktop-artifact.ts` and must not fork its logic.
- Windows: unsigned NSIS. electron-updater skips publisher verification when no
  `publisherName` is configured.
- First install on each machine replaces the official T3 Code (Nightly) app. The
  bundle id, app name and user data locations must stay identical to the official
  nightly, so existing threads, settings and `~/.t3` keep working.

---

## 5. Safety rules for agents working on this fork

- The owner's **running** T3 Code (Nightly) app hosts the agents working on this
  repository. Never quit, replace, re-sign or modify `/Applications/T3 Code (Nightly).app`,
  and never touch `~/.t3`, `~/Library/Application Support/*t3*`, or the login keychain
  entries of T3. If a test has to launch a desktop build, it must use fully isolated
  data directories and ports. Find the supported environment variables in the code
  first; if you cannot prove isolation, do not launch the build and report why.
- Do not push, create repositories, change GitHub settings or secrets, or open PRs or
  issues unless your task explicitly says so.
- Never commit secrets, certificates or private keys. Generated signing material goes
  outside the repository, in a path your task names.

---

## 6. Seam registry (upstream files touched by the fork)

| Upstream file                                              | Seam                                                                                                                          | Why                                                       |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `apps/web/src/components/Sidebar.tsx`                      | Register the shared thread menu, add an off-list lookup, and delegate board menu state, marks, and card rename                | Board cards reuse the Sidebar thread menu                 |
| `apps/web/src/components/sidebar/SidebarChrome.tsx`        | Mount the board header button and its width probe                                                                             | Board entry button at the right edge                      |
| `apps/web/src/components/sidebar/mainAppLocation.ts`       | `/board` does not overwrite the main-app return location                                                                      | Button toggles back                                       |
| `apps/web/src/components/CommandPalette.tsx`               | Append the fork-owned palette action                                                                                          | Open task board                                           |
| `apps/web/src/components/threadActionMenu.logic.ts`        | Typed extension items after Mark unread pass through the existing permission filter                                           | Mark as seen / unseen                                     |
| `apps/web/src/components/threadActionMenu.logic.test.ts`   | Cover extension item ordering and permission gating                                                                           | Verify the menu insertion point                           |
| `apps/web/src/hooks/useThreadActionMenu.ts`                | Insert and dispatch board marks via the fork menu hook                                                                        | Chat header menu                                          |
| `apps/web/src/hooks/useThreadActionMenu.test.ts`           | Stub the board menu hook                                                                                                      | Keep upstream permission tests independent of board hooks |
| `apps/web/src/components/chat/ChatHeader.tsx`              | Mount BoardSeenButton                                                                                                         | Mark as seen in the chat                                  |
| `apps/web/src/components/HistorySwipeNavigation.tsx`       | Honor `data-history-swipe="off"` on scrollers                                                                                 | Board's horizontal scroll must not navigate back          |
| `apps/web/src/components/sidebar/SidebarThreadRow.tsx`     | Export `ThreadRenameInput`                                                                                                    | Rename in place on board cards                            |
| `apps/web/src/routes/_chat.board.tsx`                      | New route file mounting `TaskBoardPage` (`routeTree.gen.ts` is regenerated, not registered)                                   | `/board` route                                            |
| `scripts/build-desktop-artifact.ts`                        | `T3CODE_FORK_MAC_SIGNING` selects the fork's self-signed signing hook, skips notarization and Apple-only passkey entitlements | Self-signed macOS builds (no Apple Developer account)     |
| `packages/client-runtime/src/operations/commands.ts`       | `setThreadTag` dispatching stock `thread.tag.set`                                                                             | Write board tags                                          |
| `packages/client-runtime/src/state/threadCommands.ts`      | `setTag` command with optimistic shell update                                                                                 | Cards move instantly                                      |
| `packages/client-runtime/src/state/threadCommands.test.ts` | Cases for `setTag`                                                                                                            | Covers the optimistic update                              |
