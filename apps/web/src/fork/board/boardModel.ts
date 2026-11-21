import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import {
  canSnooze,
  effectiveSnoozed,
  type ThreadSnoozeShell,
} from "@t3tools/client-runtime/state/thread-settled";
import { toSortableTimestamp } from "@t3tools/client-runtime/state/thread-sort";
import { isListedThreadLineage } from "@t3tools/contracts";
import { msg } from "gt-react";

import {
  resolveSidebarThreadSection,
  resolveSidebarThreadStatus,
} from "../../components/Sidebar.logic";
import type { SidebarThreadSummary } from "../../types";
import type { BoardOp } from "./boardOps";

export type BoardColumnId =
  | "todo"
  | "working"
  | "waiting"
  | "needs-you"
  | "failed"
  | "review"
  | "done"
  | "snoozed"
  | "settled";

export const BOARD_COLUMNS: ReadonlyArray<{
  readonly id: BoardColumnId;
  readonly label: string;
  readonly acceptsDrops: boolean;
  readonly defaultCollapsed: boolean;
}> = [
  { id: "todo", label: msg("To do"), acceptsDrops: true, defaultCollapsed: false },
  { id: "working", label: msg("Working"), acceptsDrops: false, defaultCollapsed: false },
  { id: "waiting", label: msg("Waiting"), acceptsDrops: false, defaultCollapsed: false },
  { id: "needs-you", label: msg("Needs you"), acceptsDrops: false, defaultCollapsed: false },
  { id: "failed", label: msg("Failed"), acceptsDrops: false, defaultCollapsed: false },
  { id: "review", label: msg("Review"), acceptsDrops: true, defaultCollapsed: false },
  { id: "done", label: msg("Done"), acceptsDrops: true, defaultCollapsed: false },
  { id: "snoozed", label: msg("Snoozed"), acceptsDrops: true, defaultCollapsed: true },
  { id: "settled", label: msg("Settled"), acceptsDrops: true, defaultCollapsed: true },
];

export type BoardThread = Pick<
  SidebarThreadSummary,
  | "archivedAt"
  | "blockedOnThreadWait"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "latestRun"
  | "lineage"
  | "pendingGuestMessageCount"
  | "pendingSubagentRequest"
  | "pinnedAt"
  | "runtime"
  | "settledOverride"
  | "updatedAt"
> &
  ThreadSnoozeShell & { readonly shelfAvailable?: boolean };

export const BOARD_TAG_PREFIX = "kb:";
const SEEN_TAG_PREFIX = `${BOARD_TAG_PREFIX}seen:`;
const TODO_TAG_PREFIX = `${BOARD_TAG_PREFIX}todo:`;

export function isBoardTag(tag: string): boolean {
  return tag.startsWith(BOARD_TAG_PREFIX);
}

function runTag(prefix: string, runId: string): string {
  if (prefix.length + runId.length <= 64) return prefix + runId;

  // RunId is unbounded; the server mints run:thread:<encoded threadId>:ordinal:<n>.
  // Overlong tags use a hash: prefix followed by the first 128 bits of SHA-256 in hex.
  return `${prefix}hash:${bytesToHex(sha256(utf8ToBytes(runId)).subarray(0, 16))}`;
}

export function seenTag(runId: string): string {
  return runTag(SEEN_TAG_PREFIX, runId);
}

export function todoTag(runId: string | null): string {
  return runTag(TODO_TAG_PREFIX, runId ?? "none");
}

function isReviewableRun(run: NonNullable<BoardThread["latestRun"]>): boolean {
  return run.completedAt != null && run.status !== "interrupted" && run.status !== "cancelled";
}

export function resolveBoardColumn(
  thread: BoardThread,
  tags: ReadonlyArray<string>,
  now: string,
): BoardColumnId | null {
  if (thread.archivedAt !== null || !isListedThreadLineage(thread.lineage)) return null;
  const section = resolveSidebarThreadSection({
    snoozed: thread.shelfAvailable !== false && effectiveSnoozed(thread, { now }),
    settled: thread.shelfAvailable !== false && thread.settledOverride === "settled",
    pinned: thread.pinnedAt != null,
  });
  if (section === "snoozed" || section === "settled") return section;

  const run = thread.latestRun;
  switch (resolveSidebarThreadStatus(thread)) {
    case "approval":
    case "input":
    case "request":
    case "limited":
      return "needs-you";
    case "preparing":
    case "working":
      return "working";
    case "waiting":
      return "waiting";
    case "failed":
      if (run?.status !== "failed") return "failed";
      if (tags.includes(todoTag(run.runId))) return "todo";
      return tags.includes(seenTag(run.runId)) ? "done" : "failed";
    case "ready":
      if (tags.includes(todoTag(run?.runId ?? null))) return "todo";
      if (run !== null && isReviewableRun(run) && !tags.includes(seenTag(run.runId))) {
        return "review";
      }
      return "done";
  }
}

function compareBoardThreads(left: BoardThread, right: BoardThread): number {
  return (
    Number(right.pinnedAt != null) - Number(left.pinnedAt != null) ||
    (toSortableTimestamp(right.updatedAt) ?? 0) - (toSortableTimestamp(left.updatedAt) ?? 0)
  );
}

export function groupThreadsByColumn<T extends BoardThread>(
  threads: ReadonlyArray<T>,
  resolveColumn: (thread: T) => BoardColumnId | null,
): Record<BoardColumnId, T[]> {
  const groups: Record<BoardColumnId, T[]> = {
    todo: [],
    working: [],
    waiting: [],
    "needs-you": [],
    failed: [],
    review: [],
    done: [],
    snoozed: [],
    settled: [],
  };
  for (const thread of threads) {
    const column = resolveColumn(thread);
    if (column !== null) groups[column].push(thread);
  }
  for (const column of BOARD_COLUMNS) groups[column.id].sort(compareBoardThreads);
  return groups;
}

function planTagChanges(
  tags: ReadonlyArray<string>,
  runId: string | null,
  mark: "seen" | "todo" | null,
): BoardOp[] {
  const retainedTag =
    mark === "todo" ? todoTag(runId) : mark === "seen" && runId !== null ? seenTag(runId) : null;
  const ops: BoardOp[] = [];

  if (retainedTag !== null && !tags.includes(retainedTag)) {
    ops.push({ kind: "tag", tag: retainedTag, tagged: true });
  }
  const removals = new Set(tags);
  if (mark === null && runId !== null && removals.delete(todoTag(runId))) {
    // When both marks exist, removing To do first would briefly reveal Done.
    removals.add(todoTag(runId));
  }
  for (const tag of removals) {
    if (
      tag !== retainedTag &&
      (tag.startsWith(SEEN_TAG_PREFIX) || tag.startsWith(TODO_TAG_PREFIX))
    ) {
      ops.push({ kind: "tag", tag, tagged: false });
    }
  }
  return ops;
}

function currentMark(tags: ReadonlyArray<string>, runId: string | null): "seen" | "todo" | null {
  if (tags.includes(todoTag(runId))) return "todo";
  return runId !== null && tags.includes(seenTag(runId)) ? "seen" : null;
}

function resolveDropResult(
  thread: BoardThread,
  tags: ReadonlyArray<string>,
  ops: ReadonlyArray<BoardOp>,
  now: string,
): BoardColumnId | null {
  const shell = { ...thread };
  const nextTags = new Set(tags);
  for (const op of ops) {
    switch (op.kind) {
      case "tag":
        if (op.tagged) nextTags.add(op.tag);
        else nextTags.delete(op.tag);
        break;
      case "settle":
        Object.assign(shell, { settledOverride: "settled", snoozedUntil: null, snoozedAt: null });
        break;
      case "unsettle":
        Object.assign(shell, { settledOverride: "active" });
        break;
      case "unsnooze":
        Object.assign(shell, { snoozedUntil: null, snoozedAt: null });
        break;
      case "open-snooze-menu":
        // Preview the result once the user picks a future wake time.
        Object.assign(shell, {
          snoozedAt: now,
          snoozedUntil: new Date(Date.parse(now) + 1).toISOString(),
        });
        break;
    }
  }
  return resolveBoardColumn(shell, [...nextTags], now);
}

export type BoardDropPlan =
  | { readonly accepted: false }
  | { readonly accepted: true; readonly ops: ReadonlyArray<BoardOp> };

export function planBoardDrop(
  thread: BoardThread,
  tags: ReadonlyArray<string>,
  target: BoardColumnId,
  now: string,
): BoardDropPlan {
  const current = resolveBoardColumn(thread, tags, now);
  if (current === null || !BOARD_COLUMNS.find(({ id }) => id === target)?.acceptsDrops) {
    return { accepted: false };
  }
  if (current === target) return { accepted: true, ops: [] };

  const runId = thread.latestRun?.runId ?? null;
  let ops: BoardOp[];
  switch (target) {
    case "todo":
      ops = planTagChanges(tags, runId, "todo");
      break;
    case "review":
      ops = planTagChanges(tags, runId, null);
      break;
    case "done":
      ops = planTagChanges(tags, runId, "seen");
      break;
    case "snoozed":
      if (!canSnooze(thread, { now })) return { accepted: false };
      ops = [{ kind: "open-snooze-menu" }];
      break;
    case "settled":
      if (
        thread.hasPendingApprovals ||
        ["preparing", "starting", "running", "waiting"].includes(thread.latestRun?.status ?? "")
      )
        return { accepted: false };
      ops = [...planTagChanges(tags, runId, currentMark(tags, runId)), { kind: "settle" }];
      break;
    default:
      return { accepted: false };
  }

  if (target === "todo" || target === "review" || target === "done") {
    if (thread.shelfAvailable !== false && thread.settledOverride === "settled") {
      ops.push({ kind: "unsettle" });
    }
    if (current === "snoozed") ops.push({ kind: "unsnooze" });
  }
  return resolveDropResult(thread, tags, ops, now) === target
    ? { accepted: true, ops }
    : { accepted: false };
}

export function planAfterSnooze(
  thread: BoardThread,
  tags: ReadonlyArray<string>,
): ReadonlyArray<BoardOp> {
  const runId = thread.latestRun?.runId ?? null;
  return planTagChanges(tags, runId, currentMark(tags, runId));
}

export function canMarkSeen(
  thread: BoardThread,
  tags: ReadonlyArray<string>,
  now: string,
): boolean {
  const column = resolveBoardColumn(thread, tags, now);
  return column === "review" || (column === "failed" && thread.latestRun?.status === "failed");
}

export function canMarkUnseen(thread: BoardThread, tags: ReadonlyArray<string>): boolean {
  const run = thread.latestRun;
  return run?.completedAt != null && tags.includes(seenTag(run.runId));
}

export function planMarkSeen(
  thread: BoardThread,
  tags: ReadonlyArray<string>,
): ReadonlyArray<BoardOp> {
  const run = thread.latestRun;
  if (run === null || (run.status !== "failed" && !isReviewableRun(run))) return [];
  return planTagChanges(tags, run.runId, tags.includes(todoTag(run.runId)) ? "todo" : "seen");
}

export function planMarkUnseen(
  thread: BoardThread,
  tags: ReadonlyArray<string>,
): ReadonlyArray<BoardOp> {
  const run = thread.latestRun;
  if (run?.completedAt == null || !tags.includes(seenTag(run.runId))) return [];
  return planTagChanges(tags, run.runId, tags.includes(todoTag(run.runId)) ? "todo" : null);
}
