import { useRouter } from "@tanstack/react-router";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationOperateScope, type ContextMenuSource } from "@t3tools/contracts";
import { useGT, useMessages } from "gt-react";
import { useState, type DragEvent, type MouseEvent } from "react";

import { isTrailingDoubleClick, useSnoozeWakeClock } from "../../components/Sidebar.logic";
import { WorkspacePageHeader } from "../../components/WorkspacePageHeader";
import { Button } from "../../components/ui/button";
import { SidebarInset } from "../../components/ui/sidebar";
import { stackedThreadToast, toastManager } from "../../components/ui/toast";
import { contextMenuSourceOf } from "../../contextMenuSource";
import { isElectron } from "../../env";
import { useClientSettings } from "../../hooks/useSettings";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useThreadActions } from "../../hooks/useThreadActions";
import { isMacPlatform } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import {
  readEnvironmentServerConfigLoaded,
  readThreadShell,
  useProjects,
  useQuietThreadShells,
  useServerConfigs,
} from "../../state/entities";
import { useOlderSettledShelf, useOlderSettledShelfGrowth } from "../../state/olderSettledShelf";
import { readEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { useThreadSelectionStore } from "../../threadSelectionStore";
import type { SidebarThreadSummary } from "../../types";
import { BoardCard, BOARD_THREAD_DRAG_TYPE, type BoardCardActions } from "./BoardCard";
import { BoardColumn } from "./BoardColumn";
import { readBoardLayout, saveBoardLayout, type BoardColumnLayout } from "./boardLayout";
import {
  BOARD_COLUMNS,
  groupThreadsByColumn,
  planAfterSnooze,
  planBoardDrop,
  planMarkSeen,
  resolveBoardColumn,
  type BoardColumnId,
} from "./boardModel";
import { countFailedBoardMarks, useBoardTagsLookup, useRunBoardOps } from "./boardData";
import { chooseBoardSnooze } from "./boardSnooze";

const PAGE_SIZE = 50;

const cardKey = (thread: SidebarThreadSummary) =>
  scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
const columnsById = new Map(BOARD_COLUMNS.map((column) => [column.id, column]));

export function TaskBoardPage() {
  const gt = useGT();
  const messages = useMessages();
  const router = useRouter();
  const shells = useQuietThreadShells();
  const serverConfigs = useServerConfigs();
  const projects = useProjects();
  const tagsOf = useBoardTagsLookup();
  const wakeClock = useSnoozeWakeClock(shells);
  const runOps = useRunBoardOps();
  const { snoozeThread } = useThreadActions();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const updateMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const [layout, setLayout] = useState(readBoardLayout);
  const [shown, setShown] = useState<Partial<Record<BoardColumnId, number>>>({});
  const [drag, setDrag] = useState<{ key: string; startedAt: number } | null>(null);
  const [rename, setRename] = useState<{ key: string; title: string } | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const settledLayout = layout.find(({ id }) => id === "settled");
  const olderSettled = useOlderSettledShelf({
    scopes: [...serverConfigs.keys()].map((environmentId) => ({ environmentId, projectIds: null })),
    expanded: settledLayout?.collapsed === false,
    visibleCount: shown.settled ?? 0,
  });

  const now = new Date(wakeClock).toISOString();
  const threads = shells.map((thread) =>
    serverConfigs.has(thread.environmentId) ? thread : { ...thread, shelfAvailable: false },
  );
  const groups = groupThreadsByColumn(threads, tagsOf, now);
  const listedSettled = groups.settled.filter(olderSettled.isListed);
  useOlderSettledShelfGrowth(olderSettled, listedSettled);
  const settledCount = groups.settled.length + olderSettled.unloadedCount(shells);
  const projectTitles = new Map(
    projects.map((project) => [`${project.environmentId}:${project.id}`, project.title]),
  );
  const dragged = drag === null ? undefined : threads.find((t) => cardKey(t) === drag.key);
  const dragTime =
    drag === null ? now : new Date(Math.max(wakeClock, drag.startedAt)).toISOString();

  function reportFailure(result: AtomCommandResult<unknown, unknown>, title: string) {
    if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title,
        description:
          thrownErrorMessage(squashAtomCommandFailure(result), messages) ??
          gt("An error occurred."),
      }),
    );
  }

  async function openSnoozeMenu(
    thread: SidebarThreadSummary,
    position: { x: number; y: number },
    source: ContextMenuSource,
  ) {
    const api = readLocalApi();
    const ref = scopeThreadRef(thread.environmentId, thread.id);
    if (!api || !readEnvironmentScope(ref.environmentId, AuthOrchestrationOperateScope)) return;
    const choice = await settlePromise(() =>
      chooseBoardSnooze(
        (items) => api.contextMenu.show(items, position, source),
        timestampFormat,
        ref.environmentId,
        messages,
      ),
    );
    if (choice._tag !== "Success" || !choice.value) return;

    const result = await snoozeThread(ref, choice.value.snoozedUntil);
    if (result._tag !== "Success") {
      reportFailure(result, gt("Failed to snooze thread"));
      return;
    }
    const current = readThreadShell(ref);
    if (current) {
      await runOps(ref, planAfterSnooze(current, tagsOf(current))).catch(() => {});
    }
  }

  async function markAllSeen() {
    const api = readLocalApi();
    const review = groups.review;
    if (!api || markingAll || review.length === 0) return;
    setMarkingAll(true);
    const confirmed = await settlePromise(() =>
      api.dialogs.confirm(
        gt(
          "{count, plural, one {Mark {count} thread in Review as seen?} other {Mark {count} threads in Review as seen?}}",
          { count: review.length },
        ),
      ),
    );
    if (confirmed._tag === "Success" && confirmed.value) {
      // oxlint-disable-next-line react/purity -- runs in an event handler (oxc#27309)
      const confirmedAt = new Date().toISOString();
      const count = await countFailedBoardMarks(review, async (thread) => {
        const ref = scopeThreadRef(thread.environmentId, thread.id);
        const current = readThreadShell(ref);
        if (!current) throw new Error("Thread is unavailable");
        const tags = tagsOf(current);
        const boardThread = readEnvironmentServerConfigLoaded(ref.environmentId)
          ? current
          : { ...current, shelfAvailable: false };
        if (
          current.latestRun?.runId !== thread.latestRun?.runId ||
          resolveBoardColumn(boardThread, tags, confirmedAt) !== "review"
        )
          return;
        await runOps(ref, planMarkSeen(current, tags), { reportFailure: false });
      });
      if (count > 0) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: gt(
              "{count, plural, one {Failed to mark {count} thread as seen} other {Failed to mark {count} threads as seen}}",
              { count },
            ),
          }),
        );
      }
    } else {
      reportFailure(confirmed, gt("Failed to confirm marking threads as seen"));
    }
    setMarkingAll(false);
  }

  const moveThread = useStableCallback(
    (
      key: string,
      target: BoardColumnId,
      position: { x: number; y: number },
      source: ContextMenuSource,
    ) => {
      const thread = threads.find((candidate) => cardKey(candidate) === key);
      if (!thread || !columnsById.get(target)?.acceptsDrops) return;
      // oxlint-disable-next-line react/purity -- runs in an event handler (oxc#27309)
      const plan = planBoardDrop(thread, tagsOf(thread), target, new Date().toISOString());
      if (!plan.accepted) return;
      const ref = scopeThreadRef(thread.environmentId, thread.id);
      void runOps(ref, plan.ops, {
        onOpenSnoozeMenu: () => void openSnoozeMenu(thread, position, source),
      }).catch(() => {});
    },
  );

  const openMoveMenu = useStableCallback(
    async (
      thread: SidebarThreadSummary,
      column: BoardColumnId,
      event: MouseEvent<HTMLButtonElement>,
    ) => {
      const api = readLocalApi();
      if (!api) return;
      const { left, bottom } = event.currentTarget.getBoundingClientRect();
      const position = { x: left, y: bottom };
      const source = contextMenuSourceOf(event);
      const key = cardKey(thread);
      const currentTime = new Date().toISOString();
      const tags = tagsOf(thread);
      const targets = BOARD_COLUMNS.filter(
        ({ id, acceptsDrops }) =>
          acceptsDrops && id !== column && planBoardDrop(thread, tags, id, currentTime).accepted,
      );
      if (targets.length === 0) return;
      const clicked = await settlePromise(() =>
        api.contextMenu.show(
          targets.map(({ id, label }) => ({ id, label: messages(label) })),
          position,
          source,
        ),
      );
      if (clicked._tag === "Success" && clicked.value !== null) {
        moveThread(key, clicked.value, position, source);
      }
    },
  );

  const openThread = useStableCallback(
    (thread: SidebarThreadSummary, event: MouseEvent<HTMLButtonElement>) => {
      const ref = scopeThreadRef(thread.environmentId, thread.id);
      const key = scopedThreadKey(ref);
      const selection = useThreadSelectionStore.getState();
      if (isMacPlatform(navigator.platform) ? event.metaKey : event.ctrlKey) {
        selection.toggleThread(key);
        return;
      }
      if (event.shiftKey) {
        const projectKeys = layout.flatMap(({ id, collapsed }) =>
          collapsed
            ? []
            : (id === "settled" ? listedSettled : groups[id])
                .slice(0, shown[id] ?? PAGE_SIZE)
                .filter(
                  (candidate) =>
                    candidate.environmentId === thread.environmentId &&
                    candidate.projectId === thread.projectId,
                )
                .map(cardKey),
        );
        selection.rangeSelectTo(key, projectKeys);
        return;
      }
      if (isTrailingDoubleClick(event.detail)) return;
      selection.clearSelection();
      selection.setAnchor(key);
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(ref),
      });
    },
  );

  const commitRename = useStableCallback(
    async (thread: SidebarThreadSummary, title: string, original: string) => {
      setRename(null);
      const trimmed = title.trim();
      if (trimmed === "") {
        toastManager.add({ type: "warning", title: gt("Thread title cannot be empty") });
      } else if (trimmed !== original) {
        const result = await updateMetadata({
          environmentId: thread.environmentId,
          input: { threadId: thread.id, title: trimmed },
        });
        reportFailure(result, gt("Failed to rename thread"));
      }
    },
  );

  const cardActions: BoardCardActions = {
    onOpen: openThread,
    onStartDrag: (key) => setDrag({ key, startedAt: Date.now() }),
    onEndDrag: () => setDrag(null),
    onOpenMoveMenu: openMoveMenu,
    onStartRename: (key, title) => setRename({ key, title }),
    onCommitRename: (thread, title, original) => void commitRename(thread, title, original),
    onCancelRename: () => setRename(null),
  };

  function updateColumn(id: BoardColumnId, update: Partial<Omit<BoardColumnLayout, "id">>) {
    const next = layout.map((column) => (column.id === id ? { ...column, ...update } : column));
    setLayout(next);
    saveBoardLayout(next);
  }

  const toggleCollapsed = useStableCallback((id: BoardColumnId) => {
    const column = layout.find((candidate) => candidate.id === id);
    if (column) updateColumn(id, { collapsed: !column.collapsed });
  });
  const resizeColumn = useStableCallback((id: BoardColumnId, width: number) =>
    updateColumn(id, { width }),
  );
  const dropThread = useStableCallback((id: BoardColumnId, event: DragEvent<HTMLElement>) => {
    if (drag === null || event.dataTransfer.getData(BOARD_THREAD_DRAG_TYPE) !== drag.key) {
      return;
    }
    event.preventDefault();
    setDrag(null);
    moveThread(drag.key, id, { x: event.clientX, y: event.clientY }, "mouse");
  });

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden">
      <WorkspacePageHeader electron={isElectron} className="border-b border-border/70">
        <h1 className="text-base font-semibold">{gt("Task board")}</h1>
      </WorkspacePageHeader>
      <div data-history-swipe="off" className="min-h-0 flex-1 overflow-x-auto overscroll-x-none">
        <div className="flex h-full min-w-max gap-3 p-3">
          {layout.map((column) => {
            const { id } = column;
            const definition = columnsById.get(id);
            const items = id === "settled" ? listedSettled : groups[id];
            const count = id === "settled" ? settledCount : items.length;
            const limit = shown[id] ?? PAGE_SIZE;
            const settledLoading = id === "settled" && olderSettled.loading;
            const settledFailed = id === "settled" && olderSettled.failed;
            const displayedCount = Math.min(items.length, limit);
            const showMore = count > displayedCount || settledLoading || settledFailed;
            const acceptsDrag =
              dragged !== undefined &&
              definition?.acceptsDrops === true &&
              !groups[id].includes(dragged) &&
              planBoardDrop(dragged, tagsOf(dragged), id, dragTime).accepted;
            return (
              <BoardColumn
                key={id}
                label={definition?.label ?? id}
                layout={column}
                count={count}
                acceptsDrag={acceptsDrag}
                headerAction={
                  id === "review" && count > 0 ? (
                    <Button
                      variant="ghost-muted"
                      size="compact"
                      disabled={markingAll}
                      onClick={() => void markAllSeen()}
                    >
                      {gt("Mark all as seen")}
                    </Button>
                  ) : null
                }
                onToggleCollapsed={toggleCollapsed}
                onResize={resizeColumn}
                onDropThread={dropThread}
              >
                {column.collapsed ? null : (
                  <div className="flex flex-col gap-2">
                    {items.slice(0, limit).map((thread) => {
                      const key = cardKey(thread);
                      return (
                        <BoardCard
                          key={key}
                          thread={thread}
                          column={id}
                          projectTitle={projectTitles.get(
                            `${thread.environmentId}:${thread.projectId}`,
                          )}
                          actions={cardActions}
                          renameTitle={rename?.key === key ? rename.title : null}
                        />
                      );
                    })}
                    {showMore ? (
                      <Button
                        variant="ghost-muted"
                        size="compact"
                        disabled={settledLoading}
                        onClick={() => {
                          if (settledFailed) olderSettled.retry();
                          else setShown({ ...shown, [id]: displayedCount + PAGE_SIZE });
                        }}
                      >
                        {settledFailed
                          ? gt("Retry")
                          : settledLoading
                            ? gt("Loading…")
                            : gt("Show more")}
                      </Button>
                    ) : null}
                  </div>
                )}
              </BoardColumn>
            );
          })}
        </div>
      </div>
    </SidebarInset>
  );
}
