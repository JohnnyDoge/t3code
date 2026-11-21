import type { ContextMenuSource, ScopedThreadRef } from "@t3tools/contracts";

export interface ThreadContextMenuOptions {
  readonly onStartRename?: (threadRef: ScopedThreadRef, title: string) => void;
}

type ThreadContextMenuHandler = (
  threadRef: ScopedThreadRef,
  position: { x: number; y: number },
  source: ContextMenuSource,
  options?: ThreadContextMenuOptions,
) => void;

let registeredThreadContextMenu: ThreadContextMenuHandler | null = null;

export function registerThreadContextMenu(handler: ThreadContextMenuHandler): () => void {
  registeredThreadContextMenu = handler;
  return () => {
    if (registeredThreadContextMenu === handler) registeredThreadContextMenu = null;
  };
}

/** Opens the sidebar's thread menu; false when no sidebar is mounted to serve it. */
export function showThreadContextMenu(
  threadRef: ScopedThreadRef,
  position: { x: number; y: number },
  source: ContextMenuSource,
  options?: ThreadContextMenuOptions,
): boolean {
  if (registeredThreadContextMenu === null) return false;
  registeredThreadContextMenu(threadRef, position, source, options);
  return true;
}
