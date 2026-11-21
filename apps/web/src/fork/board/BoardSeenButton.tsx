import { AuthOrchestrationOperateScope, type ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { EyeIcon } from "lucide-react";

import { Button } from "../../components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";
import { useNowAfter } from "../../hooks/useDeadline";
import { useQuietThreadShell } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { useThreadBoardTags } from "./boardData";
import { useRunBoardMark } from "./boardMenu";
import { canMarkSeen } from "./boardModel";

export function BoardSeenButton({ threadRef }: { threadRef: ScopedThreadRef }) {
  const canOperate = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope);
  const thread = useQuietThreadShell(canOperate ? threadRef : null);
  const tags = useThreadBoardTags(threadRef);
  const nowMs = useNowAfter(Date.parse(thread?.snoozedUntil ?? "") || null);
  const runBoardMark = useRunBoardMark();
  const gt = useGT();

  if (!thread || !canMarkSeen(thread, tags, new Date(nowMs).toISOString())) return null;

  const label = gt("Mark as seen");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            onClick={() => void runBoardMark(threadRef, thread, "seen")}
            size="icon-xs"
            variant="ghost-muted"
          />
        }
      >
        <EyeIcon />
      </TooltipTrigger>
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}
