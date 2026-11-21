import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import type { ContextMenuSource, ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, type RefObject } from "react";

import type { SidebarThreadSummary } from "../../types";
import { useBoardMenu } from "./boardMenu";
import { registerThreadContextMenu, type ThreadContextMenuOptions } from "./threadContextMenu";

export type BoardMenuOptions = ThreadContextMenuOptions;

type SidebarThreadMenuHandler = (
  threadRef: ScopedThreadRef,
  position: { x: number; y: number },
  source: ContextMenuSource,
  fromSearch: boolean,
  board?: BoardMenuOptions,
) => void;

export function useRegisterBoardThreadMenu(handleMenu: SidebarThreadMenuHandler) {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes the mounted Sidebar's menu to board cards
  useEffect(
    () =>
      registerThreadContextMenu((threadRef, position, source, options) =>
        handleMenu(threadRef, position, source, true, options),
      ),
    [handleMenu],
  );
}

export function useBoardThreadMenu(
  threadByKey: RefObject<ReadonlyMap<string, SidebarThreadSummary>>,
) {
  const boardMenu = useBoardMenu();

  function itemState(
    thread: SidebarThreadSummary,
    threadKey: string,
    configLoaded: boolean,
    board?: BoardMenuOptions,
  ) {
    const now = new Date();
    const items = boardMenu.itemState(thread, now);
    const rename = board ? { canRename: board.onStartRename !== undefined } : {};
    if (threadByKey.current.has(threadKey)) return { ...items, ...rename };

    const isSnoozed = configLoaded && effectiveSnoozed(thread, { now: now.toISOString() });
    return {
      ...items,
      ...rename,
      isSnoozed,
      isSettled: configLoaded && !isSnoozed && thread.settledOverride === "settled",
    };
  }

  return { itemState, runAction: boardMenu.runAction };
}
