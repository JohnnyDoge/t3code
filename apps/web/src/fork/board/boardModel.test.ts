import { ProviderInstanceId, RunId, ThreadId, ThreadTag } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture, type ThreadFixtureOverrides } from "../../test-fixtures";
import {
  BOARD_COLUMNS,
  BOARD_TAG_PREFIX,
  canMarkSeen,
  canMarkUnseen,
  groupThreadsByColumn,
  isBoardTag,
  planBoardDrop,
  planMarkSeen,
  planMarkUnseen,
  resolveBoardColumn,
  seenTag,
  todoTag,
  type BoardColumnId,
  type BoardThread,
} from "./boardModel";
import type { BoardOp } from "./boardOps";

const startedAt = "2026-01-02T00:00:00.000Z";
const completedAt = "2026-01-03T00:00:00.000Z";
const now = "2026-01-04T00:00:00.000Z";
const snoozedUntil = "2026-01-05T00:00:00.000Z";
const runId = RunId.make("current");
const oldRunId = RunId.make("previous");
const isThreadTag = Schema.is(ThreadTag);

function latestRun(
  overrides: Partial<NonNullable<BoardThread["latestRun"]>> = {},
): NonNullable<BoardThread["latestRun"]> {
  return {
    runId,
    status: "completed",
    requestedAt: startedAt,
    startedAt,
    completedAt,
    assistantMessageId: null,
    ...overrides,
  };
}

function runtime(
  status: NonNullable<BoardThread["runtime"]>["status"],
  overrides: Partial<NonNullable<BoardThread["runtime"]>> = {},
): NonNullable<BoardThread["runtime"]> {
  return {
    status,
    activeRunId: null,
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerName: "Codex",
    lastError: null,
    updatedAt: completedAt,
    ...overrides,
  };
}

function makeBoardThread(overrides: ThreadFixtureOverrides = {}) {
  const run = overrides.latestRun;
  return makeThreadFixture({
    runtime: run == null ? null : runtime(run.status),
    ...overrides,
  });
}

const completed = { latestRun: latestRun() };
const failed = { latestRun: latestRun({ status: "failed" }), runtime: runtime("failed") };
const snoozed = { snoozedAt: completedAt, snoozedUntil };
const settled = { settledOverride: "settled" } as const;
const parentThreadId = ThreadId.make("parent");

describe("resolveBoardColumn", () => {
  it.each<{
    reason: string;
    overrides?: ThreadFixtureOverrides;
    tags?: readonly string[];
    column: BoardColumnId | null;
  }>([
    {
      reason: "archived, even if settled",
      overrides: { ...settled, archivedAt: now },
      column: null,
    },
    {
      reason: "subagents",
      overrides: {
        lineage: { rootThreadId: parentThreadId, parentThreadId, relationshipToParent: "subagent" },
      },
      column: null,
    },
    {
      reason: "side chats",
      overrides: {
        lineage: {
          rootThreadId: parentThreadId,
          parentThreadId,
          relationshipToParent: "fork",
          sideChat: true,
        },
      },
      column: null,
    },
    {
      reason: "settled takes priority over snooze and status",
      overrides: { ...settled, ...snoozed, runtime: runtime("running") },
      column: "settled",
    },
    {
      reason: "snoozed takes priority over status",
      overrides: { ...snoozed, ...completed },
      column: "snoozed",
    },
    { reason: "expired snooze", overrides: { ...completed, snoozedUntil: now }, column: "review" },
    {
      reason: "approval wakes a snoozed thread",
      overrides: { ...snoozed, hasPendingApprovals: true, runtime: runtime("running") },
      column: "needs-you",
    },
    { reason: "input", overrides: { hasPendingUserInput: true }, column: "needs-you" },
    { reason: "guest request", overrides: { pendingGuestMessageCount: 1 }, column: "needs-you" },
    {
      reason: "usage limit",
      overrides: { ...failed, runtime: runtime("failed", { lastErrorClass: "usage_limit" }) },
      tags: [seenTag(runId)],
      column: "needs-you",
    },
    { reason: "failed run", overrides: failed, column: "failed" },
    {
      reason: "visited failed run",
      overrides: { ...failed, lastVisitedAt: now },
      column: "failed",
    },
    { reason: "marked failed run", overrides: failed, tags: [seenTag(runId)], column: "done" },
    {
      reason: "runtime failure with no failed run",
      overrides: { ...completed, runtime: runtime("failed") },
      tags: [seenTag(runId)],
      column: "failed",
    },
    { reason: "preparing", overrides: { runtime: runtime("preparing") }, column: "working" },
    {
      reason: "new running run with both marks for an old run",
      overrides: {
        latestRun: latestRun({ status: "running", completedAt: null }),
        runtime: runtime("running"),
      },
      tags: [seenTag(oldRunId), todoTag(oldRunId)],
      column: "working",
    },
    {
      reason: "waiting on another thread",
      overrides: { runtime: runtime("running"), blockedOnThreadWait: true },
      column: "waiting",
    },
    {
      reason: "completed run takes priority over a To do mark",
      overrides: completed,
      tags: [todoTag(runId)],
      column: "review",
    },
    {
      reason: "visited completed run",
      overrides: { ...completed, lastVisitedAt: now },
      column: "review",
    },
    {
      reason: "new completed run with both marks for an old run",
      overrides: completed,
      tags: [seenTag(oldRunId), todoTag(oldRunId)],
      column: "review",
    },
    {
      reason: "current marks win while stale and duplicate marks are present",
      overrides: completed,
      tags: [seenTag(oldRunId), seenTag(runId), todoTag(runId), seenTag(runId)],
      column: "todo",
    },
    {
      reason: "old To do mark after seeing the new run",
      overrides: completed,
      tags: [todoTag(oldRunId), seenTag(runId)],
      column: "done",
    },
    {
      reason: "completed interrupted run",
      overrides: { latestRun: latestRun({ status: "interrupted" }) },
      column: "done",
    },
    {
      reason: "completed cancelled run",
      overrides: { latestRun: latestRun({ status: "cancelled" }) },
      column: "done",
    },
    { reason: "To do mark before first run", tags: [todoTag(null)], column: "todo" },
    {
      reason: "first run invalidates the no-run To do mark",
      overrides: completed,
      tags: [todoTag(null), seenTag(runId)],
      column: "done",
    },
    { reason: "no run and no mark", column: "done" },
  ])("handles $reason", ({ overrides, tags = [], column }) => {
    expect(resolveBoardColumn(makeBoardThread(overrides), tags, now)).toBe(column);
  });
});

describe("groupThreadsByColumn", () => {
  it("provides every group and sorts by pin, then update time", () => {
    const unpinned = makeBoardThread({ updatedAt: now });
    const earlier = makeBoardThread({ updatedAt: startedAt });
    const pinnedEarlier = makeBoardThread({ updatedAt: startedAt, pinnedAt: now });
    const pinnedLater = makeBoardThread({ updatedAt: completedAt, pinnedAt: startedAt });
    const toDo = makeBoardThread();
    const groups = groupThreadsByColumn(
      [unpinned, pinnedEarlier, earlier, toDo, pinnedLater, makeBoardThread({ archivedAt: now })],
      (thread) => (thread === toDo ? [todoTag(null)] : []),
      now,
    );

    expect(Object.keys(groups)).toEqual(BOARD_COLUMNS.map(({ id }) => id));
    expect(groups.done).toEqual([pinnedLater, pinnedEarlier, unpinned, earlier]);
    expect(groups.todo).toEqual([toDo]);
    expect(Object.values(groups).flat()).toHaveLength(5);
  });
});

const addTag = (tag: string): BoardOp => ({ kind: "tag", tag, tagged: true });
const removeTag = (tag: string): BoardOp => ({ kind: "tag", tag, tagged: false });

describe("planBoardDrop", () => {
  it.each<{
    reason: string;
    overrides?: ThreadFixtureOverrides;
    tags?: readonly string[];
    target: BoardColumnId;
    ops: readonly BoardOp[] | null;
  }>([
    { reason: "To do without a run", target: "todo", ops: [addTag(todoTag(null))] },
    {
      reason: "To do from Review",
      overrides: completed,
      tags: ["keep", "kb:other", seenTag(oldRunId), todoTag(oldRunId), seenTag(oldRunId)],
      target: "todo",
      ops: [
        addTag(todoTag(runId)),
        addTag(seenTag(runId)),
        removeTag(seenTag(oldRunId)),
        removeTag(todoTag(oldRunId)),
      ],
    },
    {
      reason: "To do from Settled and Snoozed",
      overrides: { ...settled, ...snoozed },
      target: "todo",
      ops: [addTag(todoTag(null)), { kind: "unsettle" }, { kind: "unsnooze" }],
    },
    {
      reason: "Review from Settled",
      overrides: { ...settled, ...completed },
      tags: [seenTag(runId), todoTag(runId), todoTag(null)],
      target: "review",
      ops: [
        removeTag(seenTag(runId)),
        removeTag(todoTag(runId)),
        removeTag(todoTag(null)),
        { kind: "unsettle" },
      ],
    },
    { reason: "Review without a run", target: "review", ops: null },
    {
      reason: "Review with an incomplete run",
      overrides: {
        latestRun: latestRun({ status: "running", completedAt: null }),
        runtime: runtime("running"),
      },
      target: "review",
      ops: null,
    },
    {
      reason: "Done from Snoozed",
      overrides: { ...snoozed, ...completed },
      tags: [todoTag(runId), todoTag(oldRunId), seenTag(oldRunId), "keep"],
      target: "done",
      ops: [
        addTag(seenTag(runId)),
        removeTag(todoTag(runId)),
        removeTag(todoTag(oldRunId)),
        removeTag(seenTag(oldRunId)),
        { kind: "unsnooze" },
      ],
    },
    {
      reason: "Done from To do without a run",
      tags: [todoTag(null)],
      target: "done",
      ops: [removeTag(todoTag(null))],
    },
    {
      reason: "Snoozed opens the menu without writing",
      tags: [seenTag(oldRunId)],
      target: "snoozed",
      ops: [{ kind: "open-snooze-menu" }],
    },
    {
      reason: "Settled cleans up stale marks",
      overrides: { ...snoozed, ...completed },
      tags: [seenTag(oldRunId), todoTag(runId)],
      target: "settled",
      ops: [removeTag(seenTag(oldRunId)), { kind: "settle" }],
    },
    { reason: "already in Done", tags: [seenTag(oldRunId)], target: "done", ops: [] },
    {
      reason: "already in Working",
      overrides: { runtime: runtime("running") },
      target: "working",
      ops: [],
    },
    { reason: "off board", overrides: { archivedAt: now }, target: "settled", ops: null },
  ])("handles $reason", ({ overrides, tags = [], target, ops }) => {
    expect(planBoardDrop(makeBoardThread(overrides), tags, target, now)).toEqual(
      ops === null ? { accepted: false } : { accepted: true, ops },
    );
  });

  it.each(["working", "waiting", "needs-you", "failed"] as const)(
    "rejects moving to %s",
    (target) => {
      expect(planBoardDrop(makeBoardThread(), [], target, now)).toEqual({ accepted: false });
    },
  );

  it.each(["interrupted", "cancelled"] as const)("rejects Review for a %s run", (status) => {
    const thread = makeBoardThread({ latestRun: latestRun({ status }) });
    expect(planBoardDrop(thread, [], "review", now)).toEqual({ accepted: false });
  });
});

describe("seen actions", () => {
  it.each<{
    reason: string;
    overrides?: ThreadFixtureOverrides;
    tags?: readonly string[];
    seen: boolean;
    unseen: boolean;
  }>([
    { reason: "Review", overrides: completed, seen: true, unseen: false },
    { reason: "failed run", overrides: failed, seen: true, unseen: false },
    {
      reason: "runtime-only failure",
      overrides: { runtime: runtime("failed") },
      seen: false,
      unseen: false,
    },
    { reason: "Settled", overrides: { ...completed, ...settled }, seen: false, unseen: false },
    {
      reason: "already marked",
      overrides: completed,
      tags: [seenTag(runId)],
      seen: false,
      unseen: true,
    },
    {
      reason: "marked interrupted run",
      overrides: { latestRun: latestRun({ status: "interrupted" }) },
      tags: [seenTag(runId)],
      seen: false,
      unseen: true,
    },
    {
      reason: "marked running run",
      overrides: {
        latestRun: latestRun({ status: "running", completedAt: null }),
        runtime: runtime("running"),
      },
      tags: [seenTag(runId)],
      seen: false,
      unseen: false,
    },
  ])("checks visibility for $reason", ({ overrides, tags = [], seen, unseen }) => {
    const thread = makeBoardThread(overrides);
    expect(canMarkSeen(thread, tags, now)).toBe(seen);
    expect(canMarkUnseen(thread, tags)).toBe(unseen);
  });

  it("changes the seen mark and clears stale tags while retaining the current To do mark", () => {
    const thread = makeBoardThread(completed);
    const tags = ["keep", todoTag(runId), todoTag(oldRunId), seenTag(oldRunId)];
    expect(planMarkSeen(thread, tags)).toEqual([
      addTag(seenTag(runId)),
      removeTag(todoTag(oldRunId)),
      removeTag(seenTag(oldRunId)),
    ]);
    expect(planMarkUnseen(thread, [seenTag(runId), ...tags])).toEqual([
      removeTag(seenTag(runId)),
      removeTag(todoTag(oldRunId)),
      removeTag(seenTag(oldRunId)),
    ]);
    expect(planMarkSeen(makeBoardThread(), tags)).toEqual([]);
    expect(planMarkUnseen(thread, tags)).toEqual([]);
  });
});

describe("board tags", () => {
  it("reserves only the kb: prefix and preserves literal tags at the length limit", () => {
    const id = "x".repeat(56);
    expect(BOARD_TAG_PREFIX).toBe("kb:");
    expect(seenTag(id)).toBe(`kb:seen:${id}`);
    expect(todoTag(id)).toBe(`kb:todo:${id}`);
    expect(todoTag(null)).toBe("kb:todo:none");
    expect(isBoardTag("kb:other")).toBe(true);
    expect(isBoardTag("label:kb:seen")).toBe(false);
  });

  it("uses stable valid tags for overlong IDs, including for reads and cleanup", () => {
    const id = RunId.make(
      "run:thread:thread%3Aprovider%3Acodex%3Anative-thread%3Along-id:ordinal:18",
    );
    const otherId = id.replace(/18$/, "19");
    const thread = makeBoardThread({ latestRun: latestRun({ runId: id }) });
    const seen = seenTag(id);
    const todo = todoTag(id);

    expect(seen).toBe("kb:seen:hash:3049dcce9420a2a6ebb04cc8d1c13efc");
    expect(todo).toBe("kb:todo:hash:3049dcce9420a2a6ebb04cc8d1c13efc");
    expect(isThreadTag(seen)).toBe(true);
    expect(isThreadTag(todo)).toBe(true);
    expect(seenTag(otherId)).not.toBe(seen);
    expect(resolveBoardColumn(thread, [seen, todo], now)).toBe("todo");
    expect(planMarkUnseen(thread, [seen, todo, todoTag(otherId)])).toEqual([
      removeTag(seen),
      removeTag(todoTag(otherId)),
    ]);
  });
});
