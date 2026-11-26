import type { ContextMenuItem, EnvironmentId } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";

import { requestCustomSnooze } from "../../components/CustomSnoozeDialog";
import { pickSnoozePreset, resolveSnoozePresets } from "../../components/Sidebar.snooze";
import { buildThreadActionMenuItems } from "../../components/threadActionMenu.logic";
import type { MessageResolver } from "../../i18n/messages";

export async function chooseBoardSnooze(
  showMenu: (choices: readonly ContextMenuItem[]) => Promise<string | null>,
  timestampFormat: TimestampFormat,
  environmentId: EnvironmentId,
  messages: MessageResolver,
) {
  const presets = resolveSnoozePresets(new Date(), timestampFormat, environmentId, messages);
  const entries = buildThreadActionMenuItems(
    {
      canOperate: true,
      branch: null,
      projectFilter: null,
      isPinned: false,
      isSettled: false,
      autoSettleEnabled: false,
      isSnoozed: false,
      canSnoozeNow: true,
      isRegeneratingTitle: false,
      isRunning: false,
      hasCompletedRun: false,
      supports: {
        settlement: false,
        autoSettleOptOut: false,
        snooze: true,
        pinning: false,
        titleRegeneration: false,
      },
      snoozePresets: presets,
    },
    messages,
  );
  const choices = entries.find(({ id }) => id === "snooze")?.children;
  if (choices === undefined) return null;
  const choice = await showMenu(choices);
  if (choice === "snooze:custom") return requestCustomSnooze();
  if (choice?.startsWith("snooze:")) {
    return pickSnoozePreset(
      presets,
      choice.slice("snooze:".length),
      timestampFormat,
      environmentId,
      messages,
    );
  }
  return null;
}
