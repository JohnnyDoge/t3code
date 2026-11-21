import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { resolveThreadActivityTimestamp } from "@t3tools/client-runtime/state/thread-sort";
import { useGT, useMessages } from "gt-react";
import { MoveRightIcon } from "lucide-react";
import { memo, useState, type DragEvent, type MouseEvent } from "react";

import { ProjectFavicon, type ProjectFaviconProject } from "../../components/ProjectFavicon";
import { resolveThreadStatusPill } from "../../components/Sidebar.logic";
import { ThreadRenameInput } from "../../components/sidebar/SidebarThreadRow";
import { Button } from "../../components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";
import { contextMenuSourceOf } from "../../contextMenuSource";
import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import { useThreadSelectionStore } from "../../threadSelectionStore";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import type { SidebarThreadSummary } from "../../types";
import type { BoardColumnId } from "./boardModel";
import { showThreadContextMenu } from "./threadContextMenu";

export const BOARD_THREAD_DRAG_TYPE = "application/x-t3-board-thread";

export interface BoardCardActions {
  readonly onOpen: (thread: SidebarThreadSummary, event: MouseEvent<HTMLButtonElement>) => void;
  readonly onStartDrag: (key: string) => void;
  readonly onEndDrag: () => void;
  readonly onOpenMoveMenu: (
    thread: SidebarThreadSummary,
    column: BoardColumnId,
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
  readonly onStartRename: (key: string, title: string) => void;
  readonly onCommitRename: (thread: SidebarThreadSummary, title: string, original: string) => void;
  readonly onCancelRename: () => void;
}

function BoardCardTime({ timestamp }: { timestamp: string | null }) {
  const minute = useNowMinute();
  const messages = useMessages();
  return timestamp === null
    ? null
    : formatRelativeTimeLabel(timestamp, Date.parse(`${minute}:00.000Z`), messages);
}

function BoardCardRename(props: {
  readonly title: string;
  readonly onCommit: (title: string) => void;
  readonly onCancel: () => void;
}) {
  const [title, setTitle] = useState(props.title);
  return (
    <div className="flex min-w-0 rounded-lg border border-border bg-card p-3">
      <ThreadRenameInput
        title={title}
        onTitleChange={setTitle}
        onCommit={() => props.onCommit(title)}
        onCancel={props.onCancel}
      />
    </div>
  );
}

export const BoardCard = memo(function BoardCard({
  thread,
  column,
  project,
  actions,
  renameTitle,
}: {
  readonly thread: SidebarThreadSummary;
  readonly column: BoardColumnId;
  readonly project: ProjectFaviconProject | undefined;
  readonly actions: BoardCardActions;
  readonly renameTitle: string | null;
}) {
  const gt = useGT();
  const messages = useMessages();
  const ref = scopeThreadRef(thread.environmentId, thread.id);
  const key = scopedThreadKey(ref);
  const selected = useThreadSelectionStore((state) => state.selectedThreadKeys.has(key));
  const pill = resolveThreadStatusPill({ thread });
  const openContextMenu = (position: { x: number; y: number }, source: "keyboard" | "mouse") =>
    showThreadContextMenu(ref, position, source, {
      onStartRename: (_, title) => actions.onStartRename(key, title),
    });

  function startDrag(event: DragEvent<HTMLButtonElement>) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(BOARD_THREAD_DRAG_TYPE, key);
    actions.onStartDrag(key);
  }

  if (renameTitle !== null) {
    return (
      <BoardCardRename
        title={renameTitle}
        onCommit={(title) => actions.onCommitRename(thread, title, renameTitle)}
        onCancel={actions.onCancelRename}
      />
    );
  }

  const moveLabel = gt("Move to…");
  return (
    <article className="group/card relative">
      <button
        type="button"
        draggable
        aria-label={thread.title}
        data-selected={selected || undefined}
        onClick={(event) => actions.onOpen(thread, event)}
        onDragStart={startDrag}
        onDragEnd={actions.onEndDrag}
        onContextMenu={(event) => {
          if (openContextMenu({ x: event.clientX, y: event.clientY }, contextMenuSourceOf(event))) {
            event.preventDefault();
          }
        }}
        onKeyDown={(event) => {
          if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
          const { left, bottom } = event.currentTarget.getBoundingClientRect();
          if (openContextMenu({ x: left, y: bottom }, "keyboard")) event.preventDefault();
        }}
        className="flex min-h-19 w-full cursor-pointer flex-col gap-1.5 rounded-lg border border-border/80 bg-card p-3 text-start shadow-xs outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-selected:border-primary/70 data-selected:bg-accent"
      >
        <span className="line-clamp-2 w-full pe-7 text-sm leading-snug font-medium" dir="auto">
          {thread.title}
        </span>
        <span className="flex w-full items-center gap-2 text-xs text-muted-foreground">
          {project ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <ProjectFavicon project={project} className="size-4 shrink-0" />
              <span className="truncate">{project.title}</span>
            </span>
          ) : null}
          <span className="ms-auto shrink-0 tabular-nums">
            <BoardCardTime timestamp={resolveThreadActivityTimestamp(thread)} />
          </span>
        </span>
        {pill ? (
          <span className={cn("inline-flex items-center gap-1.5 text-xs", pill.colorClass)}>
            <span
              className={cn(
                "size-1.5 rounded-full",
                pill.dotClass,
                pill.pulse && "motion-safe:animate-status-pulse",
              )}
            />
            {messages(pill.label)}
          </span>
        ) : null}
      </button>
      <div className="absolute end-2 top-2 pointer-fine:opacity-0 group-focus-within/card:opacity-100 group-hover/card:opacity-100">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost-muted"
                size="icon-xs"
                aria-label={moveLabel}
                aria-haspopup="menu"
                onClick={(event) => actions.onOpenMoveMenu(thread, column, event)}
              />
            }
          >
            <MoveRightIcon />
          </TooltipTrigger>
          <TooltipPopup>{moveLabel}</TooltipPopup>
        </Tooltip>
      </div>
    </article>
  );
});
