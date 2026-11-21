import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";

import { readThreadShell } from "../../state/entities";
import type { SidebarThreadSummary } from "../../types";
import { useBoardTagsLookup, useRunBoardOps } from "./boardData";
import {
  canMarkSeen,
  canMarkUnseen,
  planMarkSeen,
  planMarkUnseen,
  type BoardThread,
} from "./boardModel";

export function planBoardMark(
  thread: BoardThread,
  tags: ReadonlyArray<string>,
  displayedRunId: NonNullable<BoardThread["latestRun"]>["runId"] | undefined,
  mark: "seen" | "unseen",
  now: string,
) {
  if (thread.latestRun?.runId !== displayedRunId) return [];
  if (mark === "seen") return canMarkSeen(thread, tags, now) ? planMarkSeen(thread, tags) : [];
  return canMarkUnseen(thread, tags) ? planMarkUnseen(thread, tags) : [];
}

export function useRunBoardMark() {
  const tagsOf = useBoardTagsLookup();
  const runBoardOps = useRunBoardOps();

  return async (
    threadRef: ScopedThreadRef,
    displayedThread: BoardThread,
    mark: "seen" | "unseen",
  ) => {
    const thread = readThreadShell(threadRef);
    if (thread === null) return;
    const ops = planBoardMark(
      thread,
      tagsOf(thread),
      displayedThread.latestRun?.runId,
      mark,
      new Date().toISOString(),
    );
    if (ops.length > 0) await settlePromise(() => runBoardOps(threadRef, ops));
  };
}

export function useBoardMenu() {
  const tagsOf = useBoardTagsLookup();
  const runBoardMark = useRunBoardMark();

  function boardMenuState(thread: SidebarThreadSummary, now: Date) {
    const tags = tagsOf(thread);
    return {
      canMarkSeen: canMarkSeen(thread, tags, now.toISOString()),
      canMarkUnseen: canMarkUnseen(thread, tags),
    };
  }

  return { boardMenuState, runBoardMark };
}
