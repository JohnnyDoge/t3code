import * as Schema from "effect/Schema";

import { BOARD_COLUMNS, type BoardColumnId } from "./boardModel";

const STORAGE_KEY = "t3code:fork:board-layout";
export const BOARD_COLUMN_WIDTH = { default: 288, min: 224, max: 640 } as const;

const SavedLayout = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      id: Schema.String,
      collapsed: Schema.optionalKey(Schema.Boolean),
      width: Schema.optionalKey(Schema.Number),
    }),
  ),
);
const decodeLayout = Schema.decodeSync(SavedLayout);
const encodeLayout = Schema.encodeSync(SavedLayout);

export interface BoardColumnLayout {
  readonly id: BoardColumnId;
  readonly collapsed: boolean;
  readonly width: number;
}

export function clampBoardColumnWidth(width: number): number {
  return Math.round(Math.min(BOARD_COLUMN_WIDTH.max, Math.max(BOARD_COLUMN_WIDTH.min, width)));
}

export function resolveBoardLayout(saved: typeof SavedLayout.Type = []): BoardColumnLayout[] {
  const byId = new Map<string, (typeof SavedLayout.Type)[number]>();
  for (const column of saved) {
    if (!byId.has(column.id)) byId.set(column.id, column);
  }
  return BOARD_COLUMNS.map(({ id, defaultCollapsed }) => {
    const column = byId.get(id);
    const width = column?.width;
    return {
      id,
      collapsed: column?.collapsed ?? defaultCollapsed,
      width:
        width !== undefined && Number.isFinite(width)
          ? clampBoardColumnWidth(width)
          : BOARD_COLUMN_WIDTH.default,
    };
  });
}

export function readBoardLayout(): BoardColumnLayout[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) return resolveBoardLayout(decodeLayout(saved));
  } catch {
    // Storage can be unavailable or contain an invalid document.
  }
  return resolveBoardLayout();
}

export function saveBoardLayout(layout: readonly BoardColumnLayout[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, encodeLayout(layout));
  } catch {
    // Layout changes still apply for the current mount when storage is unavailable.
  }
}
