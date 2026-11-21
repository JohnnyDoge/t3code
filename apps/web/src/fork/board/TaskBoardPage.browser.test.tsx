import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "../../index.css";

import { act, render } from "../../../test/render";
import { makeThreadFixture } from "../../test-fixtures";
import { BOARD_COLUMN_WIDTH, saveBoardLayout } from "./boardLayout";
import { planBoardDrop } from "./boardModel";
import { TaskBoardPage } from "./TaskBoardPage";

const mocks = vi.hoisted(() => ({
  runOps: vi.fn(async () => {}),
  snoozeThread: vi.fn(),
  updateMetadata: vi.fn(),
}));

vi.mock("../../state/entities", async (importOriginal) => {
  const { makeThreadFixture } = await import("../../test-fixtures");
  const threads = [makeThreadFixture({ title: "Finished work" })];
  return {
    ...(await importOriginal<typeof import("../../state/entities")>()),
    useQuietThreadShells: () => threads,
    useProjects: () => [],
  };
});
vi.mock("../../hooks/useThreadActions", () => ({
  useThreadActions: () => ({ snoozeThread: mocks.snoozeThread }),
}));
vi.mock("../../state/use-orchestration-command", () => ({
  useOrchestrationCommand: () => mocks.updateMetadata,
}));
vi.mock("./boardData", () => {
  const tags = () => [];
  return {
    useBoardTagsLookup: () => tags,
    useRunBoardOps: () => mocks.runOps,
  };
});

function setup() {
  mocks.runOps.mockClear();
  saveBoardLayout([]);
}

function dispatchDrag(type: string, element: Element, dataTransfer: DataTransfer) {
  return element.dispatchEvent(
    new DragEvent(type, { dataTransfer, bubbles: true, cancelable: true }),
  );
}

it("offers accepting columns during a drag and executes only their drop plans", async () => {
  setup();
  await using screen = await render(<TaskBoardPage />, { router: "/board" });
  const card = screen.getByRole("button", { name: "Finished work" });
  const todo = screen.getByRole("region", { name: "To do" });
  const working = screen.getByRole("region", { name: "Working" });
  const review = screen.getByRole("region", { name: "Review" });

  const rejected = new DataTransfer();
  await act(() => dispatchDrag("dragstart", card.element(), rejected));
  await expect.element(todo).toHaveAttribute("data-accepts-drag", "true");
  await expect.element(working).not.toHaveAttribute("data-accepts-drag");
  await expect.element(review).not.toHaveAttribute("data-accepts-drag");
  expect(dispatchDrag("dragover", working.element(), rejected)).toBe(true);
  await act(() => dispatchDrag("drop", working.element(), rejected));
  expect(mocks.runOps).not.toHaveBeenCalled();

  const accepted = new DataTransfer();
  await act(() => dispatchDrag("dragstart", card.element(), accepted));
  await expect.element(todo).toHaveAttribute("data-accepts-drag", "true");
  expect(dispatchDrag("dragover", todo.element(), accepted)).toBe(false);
  await act(() => dispatchDrag("drop", todo.element(), accepted));
  const thread = makeThreadFixture();
  const plan = planBoardDrop(thread, [], "todo", thread.updatedAt);
  if (!plan.accepted) throw new Error("Fixture must accept a To do drop");
  expect(mocks.runOps).toHaveBeenCalledExactlyOnceWith(
    scopeThreadRef(thread.environmentId, thread.id),
    plan.ops,
    { onOpenSnoozeMenu: expect.any(Function) },
  );
});

it("restores a collapsed column and its resized width after remount", async () => {
  setup();
  await using first = await render(<TaskBoardPage />, { router: "/board" });
  const firstHandle = first.getByRole("separator", { name: "Resize To do" });
  await act(() => (firstHandle.element() as HTMLElement).focus());
  await userEvent.keyboard("{ArrowRight}");
  const width = BOARD_COLUMN_WIDTH.default + 16;
  await expect.element(firstHandle).toHaveAttribute("aria-valuenow", String(width));
  await first.getByRole("button", { name: "Collapse To do" }).click();
  await first.unmount();

  await using second = await render(<TaskBoardPage />, { router: "/board" });
  const expand = second.getByRole("button", { name: "Expand To do" });
  await expect.element(expand).toHaveAttribute("aria-expanded", "false");
  await expand.click();
  const restoredHandle = second.getByRole("separator", { name: "Resize To do" });
  await expect.element(restoredHandle).toHaveAttribute("aria-valuenow", String(width));
  expect(
    second.getByRole("region", { name: "To do" }).element().getBoundingClientRect().width,
  ).toBe(width);
  await userEvent.dblClick(restoredHandle);
  await expect
    .element(restoredHandle)
    .toHaveAttribute("aria-valuenow", String(BOARD_COLUMN_WIDTH.default));
});
