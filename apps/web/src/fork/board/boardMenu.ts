import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import type { ContextMenuItem, ScopedThreadRef } from "@t3tools/contracts";
import { msg } from "gt-react";

import { m } from "../../i18n/messages";
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

type BoardMarkAction = "fork-mark-seen" | "fork-mark-unseen";

export function buildBoardMarkMenuItems(
  canMarkSeen: boolean,
  canMarkUnseen: boolean,
): ReadonlyArray<ContextMenuItem<BoardMarkAction>> {
  const items: ContextMenuItem<BoardMarkAction>[] = [];
  if (canMarkSeen) {
    items.push({ id: "fork-mark-seen", label: m(msg("Mark as seen")), icon: "circle-check" });
  }
  if (canMarkUnseen) {
    items.push({ id: "fork-mark-unseen", label: m(msg("Mark as unseen")), icon: "refresh-cw" });
  }
  return items;
}

export function useBoardMenu() {
  const tagsOf = useBoardTagsLookup();
  const runBoardMark = useRunBoardMark();

  function itemState(thread: SidebarThreadSummary, now: Date) {
    const tags = tagsOf(thread);
    return {
      extraItemsAfterMarkUnread: buildBoardMarkMenuItems(
        canMarkSeen(thread, tags, now.toISOString()),
        canMarkUnseen(thread, tags),
      ),
    };
  }

  async function runAction(
    action: string,
    threadRef: ScopedThreadRef,
    thread: SidebarThreadSummary,
  ) {
    switch (action) {
      case "fork-mark-seen":
        return runBoardMark(threadRef, thread, "seen");
      case "fork-mark-unseen":
        return runBoardMark(threadRef, thread, "unseen");
    }
  }

  return { itemState, runAction };
}
