import { useLocation, useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { KanbanIcon } from "lucide-react";

import { useNavigateToMainApp } from "../../components/sidebar/mainAppLocation";
import { Button } from "../../components/ui/button";
import { useSidebar } from "../../components/ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";
import { cn } from "../../lib/utils";

export const BOARD_PATH = "/board";

export function BoardHeaderButton({ onBackdrop }: { onBackdrop: boolean }) {
  const gt = useGT();
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();
  const isOnBoard = useLocation({ select: (location) => location.pathname === BOARD_PATH });
  const { isMobile, setOpenMobile } = useSidebar();
  const label = gt("Task board");

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            aria-pressed={isOnBoard}
            data-pressed={isOnBoard ? "" : undefined}
            className={cn(
              "z-10 [-webkit-app-region:no-drag]",
              onBackdrop && "relative top-auto translate-y-0",
            )}
            size="icon-sm"
            variant={onBackdrop ? "media-navigation" : "ghost"}
            onClick={() => {
              if (isMobile) setOpenMobile(false);
              void (isOnBoard ? navigateToMainApp() : navigate({ href: BOARD_PATH }));
            }}
          />
        }
      >
        <KanbanIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}
