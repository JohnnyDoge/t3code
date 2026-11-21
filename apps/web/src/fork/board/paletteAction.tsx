import type { NavigateFn } from "@tanstack/react-router";
import { msg } from "gt-react";
import { KanbanIcon } from "lucide-react";

import {
  ITEM_ICON_CLASS,
  type CommandPaletteActionItem,
  type CommandPaletteSubmenuItem,
} from "../../components/CommandPalette.logic";
import type { MessageResolver } from "../../i18n/messages";
import { BOARD_PATH } from "./BoardHeaderButton";

export function appendBoardPaletteAction(
  items: (CommandPaletteActionItem | CommandPaletteSubmenuItem)[],
  pathname: string,
  resolve: MessageResolver,
  navigate: NavigateFn,
) {
  if (pathname === BOARD_PATH) return;
  items.push({
    kind: "action",
    value: "action:board",
    searchTerms: ["board", "kanban", "tasks", "status", "overview"],
    title: resolve(msg("Open task board")),
    icon: <KanbanIcon className={ITEM_ICON_CLASS} />,
    run: async () => {
      await navigate({ href: BOARD_PATH });
    },
  });
}
