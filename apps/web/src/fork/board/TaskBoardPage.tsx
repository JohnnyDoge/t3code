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

import { isTrailingDoubleClick } from "../../components/Sidebar.logic";
import { pickSnoozePreset, resolveSnoozePresets } from "../../components/Sidebar.snooze";
import { WorkspacePageHeader } from "../../components/WorkspacePageHeader";
import { Button } from "../../components/ui/button";
import { SidebarInset } from "../../components/ui/sidebar";
import { stackedThreadToast, toastManager } from "../../components/ui/toast";
import { contextMenuSourceOf } from "../../contextMenuSource";
import { isElectron } from "../../env";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useClientSettings } from "../../hooks/useSettings";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useThreadActions } from "../../hooks/useThreadActions";
import { isMacPlatform } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import { readThreadShell, useProjects, useQuietThreadShells } from "../../state/entities";
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
  type BoardColumnId,
} from "./boardModel";
import { useBoardTagsLookup, useRunBoardOps } from "./boardData";

const PAGE_SIZE = 50;

const cardKey = (thread: SidebarThreadSummary) =>
  scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
const columnsById = new Map(BOARD_COLUMNS.map((column) => [column.id, column]));

export function TaskBoardPage() {
  const gt = useGT();
  const messages = useMessages();
  const router = useRouter();
  const threads = useQuietThreadShells();
  const projects = useProjects();
  const tagsOf = useBoardTagsLookup();
  const minute = useNowMinute();
  const runOps = useRunBoardOps();
  const { snoozeThread } = useThreadActions();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const updateMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const [layout, setLayout] = useState(readBoardLayout);
  const [shown, setShown] = useState<Partial<Record<BoardColumnId, number>>>({});
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [rename, setRename] = useState<{ key: string; title: string } | null>(null);

  const now = `${minute}:00.000Z`;
  const groups = groupThreadsByColumn(threads, tagsOf, now);
  const projectTitles = new Map(
    projects.map((project) => [`${project.environmentId}:${project.id}`, project.title]),
  );
  const dragged = draggedKey === null ? undefined : threads.find((t) => cardKey(t) === draggedKey);
  const empty = BOARD_COLUMNS.every(({ id }) => groups[id].length === 0);

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
    const presets = resolveSnoozePresets(new Date(), timestampFormat, ref.environmentId, messages);
    const clicked = await settlePromise(() =>
      api.contextMenu.show(
        presets.map((preset) => ({ id: preset.id, label: preset.label, detail: preset.whenLabel })),
        position,
        source,
      ),
    );
    if (clicked._tag === "Failure" || clicked.value === null) return;
    const preset = pickSnoozePreset(
      presets,
      clicked.value,
      timestampFormat,
      ref.environmentId,
      messages,
    );
    if (!preset) return;

    const result = await snoozeThread(ref, preset.snoozedUntil);
    if (result._tag !== "Success") {
      reportFailure(result, gt("Failed to snooze thread"));
      return;
    }
    const current = readThreadShell(ref);
    if (current) {
      await runOps(ref, planAfterSnooze(current, tagsOf(current))).catch(() => {});
    }
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
            : groups[id]
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
    onStartDrag: setDraggedKey,
    onEndDrag: () => setDraggedKey(null),
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
    if (draggedKey === null || event.dataTransfer.getData(BOARD_THREAD_DRAG_TYPE) !== draggedKey) {
      return;
    }
    event.preventDefault();
    setDraggedKey(null);
    moveThread(draggedKey, id, { x: event.clientX, y: event.clientY }, "mouse");
  });

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden">
      <WorkspacePageHeader electron={isElectron} className="border-b border-border/70">
        <h1 className="text-base font-semibold">{gt("Task board")}</h1>
      </WorkspacePageHeader>
      {empty ? (
        <p className="grid min-h-0 flex-1 place-items-center p-4 text-sm text-muted-foreground">
          {gt("No threads to show on the board.")}
        </p>
      ) : (
        <div data-history-swipe="off" className="min-h-0 flex-1 overflow-x-auto overscroll-x-none">
          <div className="flex h-full min-w-max gap-3 p-3">
            {layout.map((column) => {
              const { id } = column;
              const definition = columnsById.get(id);
              const items = groups[id];
              const limit = shown[id] ?? PAGE_SIZE;
              const acceptsDrag =
                dragged !== undefined &&
                definition?.acceptsDrops === true &&
                !items.includes(dragged) &&
                planBoardDrop(dragged, tagsOf(dragged), id, now).accepted;
              return (
                <BoardColumn
                  key={id}
                  label={definition?.label ?? id}
                  layout={column}
                  count={items.length}
                  acceptsDrag={acceptsDrag}
                  onToggleCollapsed={toggleCollapsed}
                  onResize={resizeColumn}
                  onDropThread={dropThread}
                >
                  {column.collapsed ? null : (
                    <div className="flex flex-col gap-2">
                      {items.length === 0 ? (
                        <p className="px-2 py-3 text-xs text-muted-foreground">
                          {gt("No threads")}
                        </p>
                      ) : null}
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
                      {items.length > limit ? (
                        <Button
                          variant="ghost-muted"
                          size="compact"
                          onClick={() =>
                            setShown((current) => ({
                              ...current,
                              [id]: (current[id] ?? PAGE_SIZE) + PAGE_SIZE,
                            }))
                          }
                        >
                          {gt("Show more")}
                        </Button>
                      ) : null}
                    </div>
                  )}
                </BoardColumn>
              );
            })}
          </div>
        </div>
      )}
    </SidebarInset>
  );
}
