import { expect, it } from "vite-plus/test";

import { BOARD_COLUMN_WIDTH, isBoardColumnSlim, resolveBoardLayout } from "./boardLayout";
import { BOARD_COLUMNS } from "./boardModel";

it("repairs missing, unknown, and duplicate columns in canonical order", () => {
  const layout = resolveBoardLayout([
    { id: "settled", collapsed: false, width: 350 },
    { id: "unknown", collapsed: true, width: 320 },
    { id: "settled", collapsed: true, width: 270 },
    { id: "todo", collapsed: true },
  ]);

  expect(layout).toEqual(
    BOARD_COLUMNS.map(({ id, defaultCollapsed }) =>
      id === "settled"
        ? { id, collapsed: false, width: 350 }
        : { id, collapsed: id === "todo" || defaultCollapsed, width: BOARD_COLUMN_WIDTH.default },
    ),
  );
});

it("clamps widths, rounds fractional pixels, and defaults non-finite widths", () => {
  const layout = resolveBoardLayout([
    { id: "todo", width: 0 },
    { id: "working", width: 10_000 },
    { id: "waiting", width: 301.6 },
    { id: "done", width: Infinity },
  ]);

  expect(layout.find(({ id }) => id === "todo")?.width).toBe(BOARD_COLUMN_WIDTH.min);
  expect(layout.find(({ id }) => id === "working")?.width).toBe(BOARD_COLUMN_WIDTH.max);
  expect(layout.find(({ id }) => id === "waiting")?.width).toBe(302);
  expect(layout.find(({ id }) => id === "done")?.width).toBe(BOARD_COLUMN_WIDTH.default);
});

it.each([
  { collapsed: false, count: 0, acceptsDrag: false, slim: true },
  { collapsed: false, count: 0, acceptsDrag: true, slim: false },
  { collapsed: false, count: 1, acceptsDrag: false, slim: false },
  { collapsed: true, count: 0, acceptsDrag: true, slim: true },
  { collapsed: true, count: 1, acceptsDrag: false, slim: true },
])(
  "uses a slim rail ($slim) for collapse $collapsed, count $count and drag $acceptsDrag",
  (row) => {
    expect(isBoardColumnSlim(row.collapsed, row.count, row.acceptsDrag)).toBe(row.slim);
  },
);
