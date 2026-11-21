import { RegistryContext } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vite-plus/test";

import { toastManager } from "../../components/ui/toast";
import {
  countFailedBoardMarks,
  useBoardTagsLookup,
  useRunBoardOps,
  useThreadBoardTags,
} from "./boardData";

const { setTag, settle, unsettle, unsnooze } = vi.hoisted(() => ({
  setTag: vi.fn(),
  settle: vi.fn(),
  unsettle: vi.fn(),
  unsnooze: vi.fn(),
}));

vi.mock("../../hooks/useThreadActions", () => ({
  useThreadActions: () => ({
    settleThread: settle,
    unsettleThread: unsettle,
    unsnoozeThread: unsnooze,
  }),
}));
vi.mock("../../state/use-orchestration-command", () => ({
  useOrchestrationCommand: () => setTag,
}));
vi.mock("../../components/ui/toast", () => ({
  stackedThreadToast: (toast: unknown) => toast,
  toastManager: { add: vi.fn() },
}));

const threadRef = scopeThreadRef(EnvironmentId.make("remote"), ThreadId.make("thread-1"));
const threadIndex = Atom.make<ReadonlyMap<ThreadId, { readonly tags: ReadonlyArray<string> }>>(
  new Map(),
);
vi.mock("../../state/threads", () => ({
  threadEnvironment: { setTag: {} },
  environmentThreadShells: { environmentThreadIndexAtom: () => threadIndex },
}));

it("retains the tags and list lookup when a shell tick repeats the same tag values", () => {
  using scope = new DisposableStack();
  const registry = scope.adopt(AtomRegistry.make(), (registry) => registry.dispose());
  const read =
    vi.fn<(tags: ReadonlyArray<string>, lookup: ReturnType<typeof useBoardTagsLookup>) => void>();
  function BoardTagsProbe() {
    read(useThreadBoardTags(threadRef), useBoardTagsLookup());
    return null;
  }
  const render = () =>
    renderToStaticMarkup(
      createElement(RegistryContext.Provider, { value: registry }, createElement(BoardTagsProbe)),
    );

  const tags = ["kb:todo:none"];
  registry.set(threadIndex, new Map([[threadRef.threadId, { tags }]]));
  render();
  expect(read.mock.lastCall?.[0]).toBe(tags);
  const lookup = read.mock.lastCall?.[1];

  registry.set(threadIndex, new Map([[threadRef.threadId, { tags: [...tags] }]]));
  render();
  expect(read.mock.lastCall?.[0]).toBe(tags);
  expect(read.mock.lastCall?.[1]).toBe(lookup);

  registry.set(threadIndex, new Map([[threadRef.threadId, { tags: [] }]]));
  render();
  expect(read.mock.lastCall?.[0]).toEqual([]);
});

it("waits for acceptance before continuing and stops on the first failure", async () => {
  const reply = Promise.withResolvers<AsyncResult.Success<{ sequence: number }>>();
  setTag.mockReset().mockReturnValue(reply.promise);
  settle.mockReset();
  unsettle.mockReset();
  const denied = new Error("Cannot wake this thread");
  unsnooze.mockReset().mockResolvedValue(AsyncResult.failure(Cause.fail(denied)));
  vi.mocked(toastManager.add).mockClear();

  const read = vi.fn<(run: ReturnType<typeof useRunBoardOps>) => void>();
  function BoardExecutorProbe() {
    read(useRunBoardOps());
    return null;
  }
  renderToStaticMarkup(createElement(BoardExecutorProbe));
  const [run] = read.mock.calls[0]!;
  const onOpenSnoozeMenu = vi.fn();
  const execution = run(
    threadRef,
    [
      { kind: "tag", tag: "kb:todo:none", tagged: true },
      { kind: "open-snooze-menu" },
      { kind: "unsnooze" },
      { kind: "unsettle" },
    ],
    { onOpenSnoozeMenu },
  );

  expect(setTag).toHaveBeenCalledWith({
    environmentId: threadRef.environmentId,
    input: { threadId: threadRef.threadId, tag: "kb:todo:none", tagged: true },
  });
  expect(onOpenSnoozeMenu).not.toHaveBeenCalled();
  expect(unsnooze).not.toHaveBeenCalled();
  reply.resolve(AsyncResult.success({ sequence: 2 }));

  await expect(execution).rejects.toBe(denied);
  expect(onOpenSnoozeMenu).toHaveBeenCalledBefore(unsnooze);
  expect(unsnooze).toHaveBeenCalledWith(threadRef);
  expect(unsettle).not.toHaveBeenCalled();
  expect(toastManager.add).toHaveBeenCalledWith(
    expect.objectContaining({ type: "error", title: "Failed to wake thread" }),
  );
});

it("marks at most four threads at a time and continues after a failure", async () => {
  const attempts = Array.from({ length: 5 }, () => Promise.withResolvers<void>());
  const lastStarted = Promise.withResolvers<void>();
  const markSeen = vi.fn((index: number) => {
    if (index === 4) lastStarted.resolve();
    return attempts[index]!.promise;
  });
  const count = countFailedBoardMarks([0, 1, 2, 3, 4], markSeen);

  expect(markSeen.mock.calls).toEqual([[0], [1], [2], [3]]);
  attempts[0]!.reject(new Error("The environment disconnected"));
  await lastStarted.promise;
  expect(markSeen).toHaveBeenLastCalledWith(4);
  for (const attempt of attempts.slice(1)) attempt.resolve();
  await expect(count).resolves.toBe(1);
});
