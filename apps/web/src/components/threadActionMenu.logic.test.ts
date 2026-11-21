import { describe, expect, it } from "vite-plus/test";

import { buildThreadActionMenuItems, type ThreadActionMenuState } from "./threadActionMenu.logic";

const baseState: ThreadActionMenuState = {
  canOperate: true,
  branch: null,
  projectFilter: null,
  isPinned: false,
  isSettled: false,
  autoSettleEnabled: true,
  isSnoozed: false,
  canSnoozeNow: true,
  isRegeneratingTitle: false,
  isRunning: false,
  hasCompletedRun: true,
  supports: {
    settlement: true,
    autoSettleOptOut: true,
    snooze: true,
    pinning: true,
    titleRegeneration: true,
  },
  snoozePresets: [
    { id: "hour", label: "In 1 hour", whenLabel: "3:00 PM", snoozedUntil: "2026-08-07T15:00:00Z" },
  ],
};

describe("buildThreadActionMenuItems", () => {
  // fork(board): preserve the upstream menu and permission behavior without board state.
  it.each([
    { board: undefined, ids: [], canOperate: true },
    {
      board: { canMarkSeen: true, canMarkUnseen: false },
      ids: ["fork-mark-seen"],
      canOperate: true,
    },
    {
      board: { canMarkSeen: false, canMarkUnseen: true },
      ids: ["fork-mark-unseen"],
      canOperate: true,
    },
    {
      board: { canMarkSeen: true, canMarkUnseen: true },
      ids: ["fork-mark-seen", "fork-mark-unseen"],
      canOperate: false,
    },
  ])(
    "inserts board actions after Mark unread when eligible ($ids)",
    ({ board, ids, canOperate }) => {
      const upstream = buildThreadActionMenuItems({ ...baseState, canOperate });
      const items = buildThreadActionMenuItems({
        ...baseState,
        canOperate,
        ...(board ? { board } : {}),
      });
      const expected = upstream
        .map((item) => item.id)
        .flatMap((id) => (id === "mark-unread" ? [id, ...ids] : [id]));
      expect(items.map((item) => item.id)).toEqual(expected);
      const boardItems = items.filter((item) => item.id.startsWith("fork-"));
      expect(boardItems.map((item) => item.disabled === true)).toEqual(ids.map(() => !canOperate));
    },
  );

  it.each([false, true])(
    "disables both lifecycle directions without permission (reversed: %s)",
    (reversed) => {
      const items = buildThreadActionMenuItems({
        ...baseState,
        canOperate: false,
        isPinned: reversed,
        isSettled: reversed,
        isSnoozed: reversed,
      });
      const expected = reversed
        ? [
            "unpin",
            "unsettle",
            "unsnooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ]
        : [
            "pin",
            "settle",
            "snooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ];
      expect(items.filter((item) => item.disabled).map((item) => item.id)).toEqual(expected);
      expect(
        items.find((item) => item.id === "snooze")?.children?.every((child) => child.disabled) ??
          true,
      ).toBe(true);
    },
  );

  it("disables archive and turning into a project while the thread is running", () => {
    const items = buildThreadActionMenuItems({
      ...baseState,
      isRunning: true,
      canTurnIntoProject: true,
    });
    expect(items.find((item) => item.id === "archive")?.disabled).toBe(true);
    expect(items.find((item) => item.id === "turn-into-project")?.disabled).toBe(true);
  });

  it.each([
    ["while the thread is running", { isRunning: true }],
    ["before any run has completed", { hasCompletedRun: false }],
  ])("omits mark unread %s", (_, overrides) => {
    const items = buildThreadActionMenuItems({ ...baseState, ...overrides });
    expect(items.map((item) => item.id)).not.toContain("mark-unread");
  });

  it("disables only rename where no inline title editor exists", () => {
    const items = buildThreadActionMenuItems({ ...baseState, canRename: false });
    expect(items.filter((item) => item.disabled).map((item) => item.id)).toEqual(["rename"]);
  });
});
