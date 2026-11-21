import { useAtomValue } from "@effect/atom-react";
import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { arrayElementsEqual } from "@t3tools/client-runtime/state/entities";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import type { ScopedThreadRef } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";
import { msg } from "gt-react";

import { stackedThreadToast, toastManager } from "../../components/ui/toast";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useThreadActions } from "../../hooks/useThreadActions";
import { m } from "../../i18n/messages";
import { environmentThreadShells, threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import type { SidebarThreadSummary } from "../../types";
import type { BoardOp } from "./boardOps";

const EMPTY_TAGS: ReadonlyArray<string> = [];

const threadBoardTagsAtom = Atom.family((key: string) => {
  const ref = parseScopedThreadKey(key);
  if (ref === null) return Atom.make(EMPTY_TAGS);
  const index = environmentThreadShells.environmentThreadIndexAtom(ref.environmentId);
  return Atom.make((get): ReadonlyArray<string> => {
    const tags = get(index).get(ref.threadId)?.tags ?? EMPTY_TAGS;
    const previous = Option.getOrUndefined(get.self<ReadonlyArray<string>>());
    return previous !== undefined && arrayElementsEqual(previous, tags) ? previous : tags;
  });
});

/** Board-relevant tags of a thread (only `kb:` tags are guaranteed to be included). */
export function useThreadBoardTags(threadRef: ScopedThreadRef): ReadonlyArray<string> {
  return useAtomValue(threadBoardTagsAtom(scopedThreadKey(threadRef)));
}

const boardTagsForShell = (thread: SidebarThreadSummary): ReadonlyArray<string> =>
  thread.source.tags ?? EMPTY_TAGS;

/** For list surfaces: a stable lookup from thread shell to its tags. */
// oxlint-disable-next-line t3code/no-hookless-use-function -- the board API returns a module-level function with stable identity
export function useBoardTagsLookup(): (thread: SidebarThreadSummary) => ReadonlyArray<string> {
  return boardTagsForShell;
}

const failureTitles = {
  tag: msg("Failed to update thread tags"),
  settle: msg("Failed to settle thread"),
  unsettle: msg("Failed to un-settle thread"),
  unsnooze: msg("Failed to wake thread"),
};

export async function countFailedBoardMarks<T>(
  threads: readonly T[],
  markSeen: (thread: T) => Promise<void>,
): Promise<number> {
  let next = 0;
  const work = async () => {
    let failures = 0;
    while (next < threads.length) {
      const thread = threads[next++]!;
      const result = await settlePromise(() => markSeen(thread));
      if (result._tag === "Failure") failures += 1;
    }
    return failures;
  };
  const failures = await Promise.all(Array.from({ length: Math.min(threads.length, 4) }, work));
  return failures.reduce((total, count) => total + count, 0);
}

/**
 * Executes board ops against the thread's own environment, in order.
 * `open-snooze-menu` is not executed here: it is passed to `onOpenSnoozeMenu`.
 * Resolves when all commands are accepted; rejects (and reports through the app's usual
 * toast or failure path) on the first failure.
 */
export function useRunBoardOps(): (
  threadRef: ScopedThreadRef,
  ops: ReadonlyArray<BoardOp>,
  options?: { readonly onOpenSnoozeMenu?: () => void; readonly reportFailure?: boolean },
) => Promise<void> {
  const setTag = useOrchestrationCommand(threadEnvironment.setTag, { reportFailure: false });
  const { settleThread, unsettleThread, unsnoozeThread } = useThreadActions();
  const actions = { settle: settleThread, unsettle: unsettleThread, unsnooze: unsnoozeThread };

  return useStableCallback(async (threadRef, ops, options) => {
    const { environmentId, threadId } = threadRef;
    for (const op of ops) {
      if (op.kind === "open-snooze-menu") {
        options?.onOpenSnoozeMenu?.();
        continue;
      }
      const result = await (op.kind === "tag"
        ? setTag({ environmentId, input: { threadId, tag: op.tag, tagged: op.tagged } })
        : actions[op.kind](threadRef));
      if (result._tag === "Failure") {
        const error = squashAtomCommandFailure(result);
        if (options?.reportFailure !== false && !isAtomCommandInterrupted(result)) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: m(failureTitles[op.kind]),
              description: thrownErrorMessage(error, m) ?? m(msg("An error occurred.")),
            }),
          );
        }
        throw error;
      }
    }
  });
}
