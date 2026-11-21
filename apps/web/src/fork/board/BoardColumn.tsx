import { useGT, useMessages } from "gt-react";
import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";
import { useId, useRef, type CSSProperties, type DragEvent, type ReactNode } from "react";

import { Button } from "../../components/ui/button";
import { useResizeDrag } from "../../hooks/useResizeDrag";
import { cn } from "../../lib/utils";
import { BOARD_THREAD_DRAG_TYPE } from "./BoardCard";
import {
  BOARD_COLUMN_WIDTH,
  clampBoardColumnWidth,
  isBoardColumnSlim,
  type BoardColumnLayout,
} from "./boardLayout";
import type { BoardColumnId } from "./boardModel";

const RESIZE_STEP = 16;

export function BoardColumn({
  label,
  layout,
  count,
  acceptsDrag,
  headerAction,
  children,
  onToggleCollapsed,
  onResize,
  onDropThread,
}: {
  readonly label: string;
  readonly layout: BoardColumnLayout;
  readonly count: number;
  readonly acceptsDrag: boolean;
  readonly headerAction?: ReactNode;
  readonly children: ReactNode;
  readonly onToggleCollapsed: (id: BoardColumnId) => void;
  readonly onResize: (id: BoardColumnId, width: number) => void;
  readonly onDropThread: (id: BoardColumnId, event: DragEvent<HTMLElement>) => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const labelId = useId();
  const contentId = useId();
  const panel = useRef<HTMLElement>(null);
  const { id, width, collapsed } = layout;
  const slim = isBoardColumnSlim(collapsed, count, acceptsDrag);
  const title = messages(label);
  const { ref, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture } =
    useResizeDrag<HTMLDivElement>(() => {
      const element = panel.current;
      if (!element) return null;
      return {
        width,
        edge: "right",
        bounds: BOARD_COLUMN_WIDTH,
        resize: (nextWidth) => {
          element.style.setProperty("--board-resize-width", `${nextWidth}px`);
          return nextWidth;
        },
        finish: (nextWidth, moved) => {
          if (moved) onResize(id, clampBoardColumnWidth(nextWidth));
        },
        cleanup: () => element.style.removeProperty("--board-resize-width"),
      };
    });

  return (
    <section
      ref={panel}
      aria-labelledby={labelId}
      data-accepts-drag={acceptsDrag || undefined}
      className={cn(
        "relative flex min-h-0 shrink-0 flex-col rounded-xl border border-border/75 bg-muted/30",
        "data-accepts-drag:border-primary/65 data-accepts-drag:bg-primary/8",
        slim ? "w-11" : "w-[var(--board-resize-width,var(--board-column-width))]",
      )}
      style={{ "--board-column-width": `${width}px` } as CSSProperties}
      onDragOver={(event) => {
        if (!acceptsDrag || !event.dataTransfer.types.includes(BOARD_THREAD_DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => onDropThread(id, event)}
    >
      <header
        className={cn(
          "flex shrink-0 items-center gap-2 p-2",
          slim ? "flex-col" : "min-h-11 border-b border-border/65 ps-3",
        )}
      >
        <h2
          id={labelId}
          className={cn(
            "text-sm font-semibold",
            slim ? "order-last [writing-mode:vertical-rl]" : "min-w-0 truncate",
          )}
        >
          {title}
        </h2>
        <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground tabular-nums">
          {count}
        </span>
        {slim && !collapsed ? null : (
          <div className={slim ? "order-first flex flex-col gap-1" : "ms-auto flex gap-1"}>
            {collapsed ? null : headerAction}
            <Button
              variant="ghost-muted"
              size="icon-xs"
              aria-label={
                collapsed
                  ? gt("Expand {column}", { column: title })
                  : gt("Collapse {column}", { column: title })
              }
              aria-expanded={!collapsed}
              aria-controls={contentId}
              onClick={() => onToggleCollapsed(id)}
            >
              {collapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
            </Button>
          </div>
        )}
      </header>
      <div
        id={contentId}
        hidden={slim}
        className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-2"
      >
        {children}
      </div>
      {slim ? null : (
        <div
          ref={ref}
          role="separator"
          tabIndex={0}
          aria-label={gt("Resize {column}", { column: title })}
          aria-controls={contentId}
          aria-orientation="vertical"
          aria-valuemin={BOARD_COLUMN_WIDTH.min}
          aria-valuemax={BOARD_COLUMN_WIDTH.max}
          aria-valuenow={width}
          aria-description={gt("Drag or use the arrow keys to resize. Double-click to reset.")}
          className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none rounded-sm hover:bg-primary/30 focus-visible:bg-primary/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onLostPointerCapture={onLostPointerCapture}
          onDoubleClick={() => onResize(id, BOARD_COLUMN_WIDTH.default)}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const delta = event.key === "ArrowLeft" ? -RESIZE_STEP : RESIZE_STEP;
            onResize(id, clampBoardColumnWidth(width + delta));
          }}
        />
      )}
    </section>
  );
}
