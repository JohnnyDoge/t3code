import { createFileRoute } from "@tanstack/react-router";

import { TaskBoardPage } from "../fork/board/TaskBoardPage";

// fork(board): mount the task board inside the chat layout.
export const Route = createFileRoute("/_chat/board")({
  component: TaskBoardPage,
});
