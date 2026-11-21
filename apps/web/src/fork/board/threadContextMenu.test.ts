import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { registerThreadContextMenu, showThreadContextMenu } from "./threadContextMenu";

it("serves the latest Sidebar through an older Sidebar's cleanup", () => {
  const threadRef = scopeThreadRef(EnvironmentId.make("remote"), ThreadId.make("thread-1"));
  const position = { x: 12, y: 34 };
  const options = { onStartRename: vi.fn() };
  const oldHandler = vi.fn();
  const currentHandler = vi.fn();

  expect(showThreadContextMenu(threadRef, position, "keyboard")).toBe(false);
  const unregisterOld = registerThreadContextMenu(oldHandler);
  const unregisterCurrent = registerThreadContextMenu(currentHandler);
  try {
    unregisterOld();
    expect(showThreadContextMenu(threadRef, position, "keyboard", options)).toBe(true);
    expect(oldHandler).not.toHaveBeenCalled();
    expect(currentHandler).toHaveBeenCalledWith(threadRef, position, "keyboard", options);
  } finally {
    unregisterCurrent();
  }
  expect(showThreadContextMenu(threadRef, position, "keyboard")).toBe(false);
});
