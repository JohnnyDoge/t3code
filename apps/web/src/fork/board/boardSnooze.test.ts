import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { requestCustomSnooze } from "../../components/CustomSnoozeDialog";
import { m } from "../../i18n/messages";
import { chooseBoardSnooze } from "./boardSnooze";

vi.mock("../../components/CustomSnoozeDialog", () => ({ requestCustomSnooze: vi.fn() }));
vi.mock("../../components/Sidebar.snooze", () => ({ resolveSnoozePresets: () => [] }));

it("offers the shared Custom dialog when there are no snooze presets", async () => {
  const choice = { snoozedUntil: "2026-01-05T00:00:00.000Z" };
  vi.mocked(requestCustomSnooze).mockResolvedValue(choice);
  const showMenu = vi.fn(async () => "snooze:custom");

  await expect(
    chooseBoardSnooze(showMenu, "locale", EnvironmentId.make("remote"), m),
  ).resolves.toBe(choice);
  expect(showMenu).toHaveBeenCalledWith([
    { id: "snooze:custom", label: "Custom…", separatorBefore: false },
  ]);
});
