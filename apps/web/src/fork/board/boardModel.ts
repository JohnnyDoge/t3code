import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import {
  effectiveSnoozed,
  type ThreadSnoozeShell,
} from "@t3tools/client-runtime/state/thread-settled";
import { toSortableTimestamp } from "@t3tools/client-runtime/state/thread-sort";
import { isListedThreadLineage } from "@t3tools/contracts";
import { msg } from "gt-react";

import { resolveSidebarThreadStatus } from "../../components/Sidebar.logic";
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
  ThreadSnoozeShell;

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
  if (thread.settledOverride === "settled") return "settled";
  if (effectiveSnoozed(thread, { now })) return "snoozed";

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
      return run?.status === "failed" && tags.includes(seenTag(run.runId)) ? "done" : "failed";
    case "ready":
      if (run !== null && isReviewableRun(run) && !tags.includes(seenTag(run.runId))) {
        return "review";
      }
      return tags.includes(todoTag(run?.runId ?? null)) ? "todo" : "done";
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
  tagsOf: (thread: T) => ReadonlyArray<string>,
  now: string,
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
    const column = resolveBoardColumn(thread, tagsOf(thread), now);
    if (column !== null) groups[column].push(thread);
  }
  for (const column of BOARD_COLUMNS) groups[column.id].sort(compareBoardThreads);
  return groups;
}

function planTagChanges(
  tags: ReadonlyArray<string>,
  runId: string | null,
  changes: { readonly seen?: boolean | undefined; readonly todo?: boolean } = {},
): BoardOp[] {
  const currentSeen = runId === null ? null : seenTag(runId);
  const currentTodo = todoTag(runId);
  const ops: BoardOp[] = [];

  if (changes.todo === true && !tags.includes(currentTodo)) {
    ops.push({ kind: "tag", tag: currentTodo, tagged: true });
  }
  if (changes.seen === true && currentSeen !== null && !tags.includes(currentSeen)) {
    ops.push({ kind: "tag", tag: currentSeen, tagged: true });
  }

  for (const tag of new Set(tags)) {
    const removeSeen =
      tag.startsWith(SEEN_TAG_PREFIX) && (changes.seen === false || tag !== currentSeen);
    const removeTodo =
      tag.startsWith(TODO_TAG_PREFIX) && (changes.todo === false || tag !== currentTodo);
    if (removeSeen || removeTodo) ops.push({ kind: "tag", tag, tagged: false });
  }
  return ops;
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
  if (current === null) return { accepted: false };
  if (current === target) return { accepted: true, ops: [] };

  const run = thread.latestRun;
  const runId = run?.runId ?? null;
  let ops: BoardOp[];
  switch (target) {
    case "todo":
      ops = planTagChanges(tags, runId, {
        todo: true,
        seen: run?.completedAt != null ? true : undefined,
      });
      break;
    case "review":
      if (run === null || !isReviewableRun(run)) return { accepted: false };
      ops = planTagChanges(tags, runId, { seen: false, todo: false });
      break;
    case "done":
      ops = planTagChanges(tags, runId, { seen: true, todo: false });
      break;
    case "snoozed":
      return { accepted: true, ops: [{ kind: "open-snooze-menu" }] };
    case "settled":
      return { accepted: true, ops: [...planTagChanges(tags, runId), { kind: "settle" }] };
    default:
      return { accepted: false };
  }

  if (current === "settled") ops.push({ kind: "unsettle" });
  if (effectiveSnoozed(thread, { now })) ops.push({ kind: "unsnooze" });
  return { accepted: true, ops };
}

export function planAfterSnooze(
  thread: BoardThread,
  tags: ReadonlyArray<string>,
): ReadonlyArray<BoardOp> {
  const cleanup = planTagChanges(tags, thread.latestRun?.runId ?? null);
  return thread.settledOverride === "settled" ? [{ kind: "unsettle" }, ...cleanup] : cleanup;
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
  return planTagChanges(tags, run.runId, { seen: true });
}

export function planMarkUnseen(
  thread: BoardThread,
  tags: ReadonlyArray<string>,
): ReadonlyArray<BoardOp> {
  const run = thread.latestRun;
  if (run?.completedAt == null || !tags.includes(seenTag(run.runId))) return [];
  return planTagChanges(tags, run.runId, { seen: false });
}
