import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { derivePhysicalProjectKey } from "@t3tools/client-runtime/state/project-grouping";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "../../index.css";

import { act, render } from "../../../test/render";
import { makeThreadFixture } from "../../test-fixtures";
import type { Project, SidebarThreadSummary } from "../../types";
import { useUiStateStore } from "../../uiStateStore";
import { BOARD_COLUMN_WIDTH, saveBoardLayout } from "./boardLayout";
import { planBoardDrop } from "./boardModel";
import { TaskBoardPage } from "./TaskBoardPage";

const mocks = vi.hoisted(() => ({
  runOps: vi.fn(async () => {}),
  snoozeThread: vi.fn(),
  updateMetadata: vi.fn(),
  projects: vi.fn<() => ReadonlyArray<Project>>(),
  threads: vi.fn<() => ReadonlyArray<SidebarThreadSummary>>(),
}));

vi.mock("../../state/entities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/entities")>()),
  useQuietThreadShells: mocks.threads,
  useProjects: mocks.projects,
}));
vi.mock("../../hooks/useThreadActions", () => ({
  useThreadActions: () => ({ snoozeThread: mocks.snoozeThread }),
}));
vi.mock("../../state/use-orchestration-command", () => ({
  useOrchestrationCommand: () => mocks.updateMetadata,
}));
vi.mock("./boardData", () => {
  const tags = () => [];
  return {
    countFailedBoardMarks: vi.fn(),
    useBoardTagsLookup: () => tags,
    useRunBoardOps: () => mocks.runOps,
  };
});

function setup() {
  mocks.runOps.mockClear();
  const thread = makeThreadFixture({ title: "Finished work" });
  mocks.threads.mockReturnValue([thread]);
  mocks.projects.mockReturnValue([]);
  useUiStateStore.getState().setSidebarProjectScopeKeys([]);
  saveBoardLayout([]);
  return thread;
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
  const firstHandle = first.getByRole("separator", { name: "Resize Done" });
  await act(() => (firstHandle.element() as HTMLElement).focus());
  await userEvent.keyboard("{ArrowRight}");
  const width = BOARD_COLUMN_WIDTH.default + 16;
  await expect.element(firstHandle).toHaveAttribute("aria-valuenow", String(width));
  await first.getByRole("button", { name: "Collapse Done" }).click();
  await first.unmount();

  await using second = await render(<TaskBoardPage />, { router: "/board" });
  const expand = second.getByRole("button", { name: "Expand Done" });
  await expect.element(expand).toHaveAttribute("aria-expanded", "false");
  await expand.click();
  const restoredHandle = second.getByRole("separator", { name: "Resize Done" });
  await expect.element(restoredHandle).toHaveAttribute("aria-valuenow", String(width));
  expect(second.getByRole("region", { name: "Done" }).element().getBoundingClientRect().width).toBe(
    width,
  );
  await userEvent.dblClick(restoredHandle);
  await expect
    .element(restoredHandle)
    .toHaveAttribute("aria-valuenow", String(BOARD_COLUMN_WIDTH.default));
});

it("updates the open board when the sidebar selects a project and clears the shared selection", async () => {
  const thread = setup();
  const otherThread = makeThreadFixture({
    id: ThreadId.make("other-thread"),
    projectId: ProjectId.make("other-project"),
    title: "Other work",
  });
  const project: Project = {
    id: thread.projectId,
    environmentId: thread.environmentId,
    title: "First project",
    workspaceRoot: "/projects/first",
    defaultModelSelection: null,
    projectIcon: { kind: "emoji", emoji: "🌱" },
    scripts: [],
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
  mocks.threads.mockReturnValue([thread, otherThread]);
  mocks.projects.mockReturnValue([project]);

  await using screen = await render(<TaskBoardPage />, { router: "/board" });
  const done = screen.getByRole("region", { name: "Done" });
  const card = done.getByRole("button", { name: "Finished work" });
  const otherCard = done.getByRole("button", { name: "Other work" });
  await expect.element(card.getByText("🌱")).toBeVisible();
  await expect.element(done.getByText("2", { exact: true })).toBeVisible();
  await expect.element(otherCard).toBeVisible();

  await act(() => {
    useUiStateStore.getState().setSidebarProjectScopeKeys([derivePhysicalProjectKey(project)]);
  });
  const clear = screen.getByRole("button", { name: "Clear project filter" });
  await expect.element(clear).toHaveTextContent("First project");
  await expect.element(otherCard).not.toBeInTheDocument();
  await expect.element(done.getByText("1", { exact: true })).toBeVisible();

  await clear.click();
  expect(useUiStateStore.getState().sidebarProjectScopeKeys).toEqual([]);
  await expect.element(clear).not.toBeInTheDocument();
  await expect.element(otherCard).toBeVisible();
});
