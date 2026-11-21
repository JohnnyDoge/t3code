import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { vi } from "vite-plus/test";

import * as ElectronApp from "../electron/ElectronApp.ts";
import { layerWithForkInstanceFeedback } from "./SingleInstance.ts";

const { focus, getAllWindows, on, removeListener, requestSingleInstanceLock, showErrorBox } =
  vi.hoisted(() => ({
    focus: vi.fn(),
    getAllWindows: vi.fn<() => unknown[]>(),
    on: vi.fn<(event: string, listener: () => void) => void>(),
    removeListener: vi.fn(),
    requestSingleInstanceLock: vi.fn<() => boolean>(),
    showErrorBox: vi.fn(),
  }));

vi.mock("electron", () => ({
  app: { focus, on, removeListener, requestSingleInstanceLock },
  BrowserWindow: { getAllWindows },
  dialog: { showErrorBox },
}));

it.effect("prompts the user when the shared lock denies launch", () => {
  requestSingleInstanceLock.mockReturnValue(false);
  showErrorBox.mockClear();
  return Effect.gen(function* () {
    const app = yield* ElectronApp.ElectronApp;

    assert.isFalse(yield* app.requestSingleInstanceLock);
    assert.equal(showErrorBox.mock.calls.length, 1);
  }).pipe(Effect.provide(layerWithForkInstanceFeedback));
});

it.effect("focuses the running fork when its windows are closed", () => {
  requestSingleInstanceLock.mockReturnValue(true);
  getAllWindows.mockReturnValue([]);
  on.mockClear();
  focus.mockClear();
  return Effect.gen(function* () {
    const app = yield* ElectronApp.ElectronApp;

    assert.isTrue(yield* app.requestSingleInstanceLock);
    const listener = on.mock.calls.find(([event]) => event === "second-instance")?.[1];
    assert.isDefined(listener);
    listener?.();
    assert.deepEqual(focus.mock.calls, [[{ steal: true }]]);
  }).pipe(Effect.provide(layerWithForkInstanceFeedback));
});
