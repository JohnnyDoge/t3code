import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  UsageLimitSourceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { CHATGPT_USAGE_URL } from "@t3tools/shared/usageLimits";
import { describe, expect, it, onTestFinished } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { UsageLimitsPooled } from "./UsageLimitsPooled";

const checkedAt = "2026-10-25T16:00:00.000Z";

function managedChatGpt(instanceId: string, displayName: string): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make("codex"),
    displayName,
    enabled: true,
    installed: true,
    version: "0.164.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    usageLimits: {
      checkedAt,
      windows: [],
      unavailable: { reason: "unsupported", message: "Track usage in ChatGPT." },
      externalUsage: { label: "ChatGPT usage", url: CHATGPT_USAGE_URL },
    },
  };
}

describe("UsageLimitsPooled ChatGPT usage card", () => {
  it("names the managed connections it covers", async () => {
    const presentations = new Map([
      [
        EnvironmentId.make("desk"),
        {
          entry: { target: { label: "Desk" } },
          serverConfig: {
            providers: [
              managedChatGpt("chatgpt_work", "ChatGPT Work"),
              managedChatGpt("chatgpt_personal", "ChatGPT Personal"),
            ],
          },
        },
      ],
    ]);
    await using screen = await render(
      <UsageLimitsPooled presentations={presentations} now={Date.parse(checkedAt)} />,
    );

    await expect
      .element(screen.getByText("ChatGPT Work on Desk, ChatGPT Personal on Desk"))
      .toBeVisible();
    await expect
      .element(screen.getByText("View usage in ChatGPT with your connected account."))
      .toBeVisible();
  });
});

describe("UsageLimitsPooled next refill", () => {
  it("skips elapsed resets while waiting for refreshed account data", async () => {
    function account(instanceId: string, usedPercent: number, resetsAt: string): ServerProvider {
      return {
        ...managedChatGpt(instanceId, instanceId),
        usageLimits: {
          checkedAt,
          windows: [{ id: "weekly", label: "Weekly", kind: "weekly", usedPercent, resetsAt }],
        },
      };
    }
    const presentations = new Map([
      [
        EnvironmentId.make("desk"),
        {
          entry: { target: { label: "Desk" } },
          serverConfig: {
            providers: [
              account("Work", 20, "2026-10-25T17:00:00.000Z"),
              account("Personal", 60, "2026-10-25T18:00:00.000Z"),
            ],
          },
        },
      ],
    ]);
    await using screen = await render(
      <UsageLimitsPooled presentations={presentations} now={Date.parse("2026-10-25T17:30:00Z")} />,
    );
    await expect.element(screen.getByText("↻ +30%", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("↻ +30% in 30m")).toBeVisible();

    await screen.rerender(
      <UsageLimitsPooled presentations={presentations} now={Date.parse("2026-10-25T18:00:00Z")} />,
    );
    await expect.element(screen.getByText(/^↻ \+\d+%$/)).not.toBeInTheDocument();
  });
});

// fork(board): Keep Local Node visually aligned with the provider cards above it.
it("renders Local Node with the same cards as native providers", async () => {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  onTestFinished(() => page.viewport(viewport.width, viewport.height));
  await page.viewport(1440, 1050);
  const resetsAt = "2026-10-26T00:00:00.000Z";
  const nativeWindow = {
    id: "weekly",
    label: "Weekly",
    kind: "weekly" as const,
    usedPercent: 30,
    resetsAt,
    windowDurationMins: 10_080,
  };
  const presentations = new Map([
    [
      EnvironmentId.make("desk"),
      {
        entry: { target: { label: "Desk" } },
        serverConfig: {
          providers: [
            {
              ...managedChatGpt("Codex", "Codex"),
              usageLimits: { checkedAt, windows: [nativeWindow] },
            },
          ],
          usageLimitSources: [
            {
              id: UsageLimitSourceId.make("local-node"),
              kind: "http" as const,
              localNodeEstimate: true as const,
              label: "Local Node",
              checkedAt,
              accounts: [],
              quotaAccounts: [
                {
                  id: "local-node",
                  label: "Estimated token budgets · 500M daily · 3.5B weekly",
                  windows: [
                    { id: "slots", label: "Slots · 4/5", kind: "other" as const, usedPercent: 20 },
                    {
                      id: "daily",
                      label: "Daily · partial",
                      kind: "session" as const,
                      usedPercent: 8,
                      resetsAt,
                    },
                    { ...nativeWindow, label: "Weekly · partial", usedPercent: 3 },
                  ],
                },
              ],
            },
          ],
        },
      },
    ],
    [EnvironmentId.make("mini"), { entry: { target: { label: "Mini" } }, serverConfig: null }],
  ]);

  await using screen = await render(
    <UsageLimitsPooled presentations={presentations} now={Date.parse(checkedAt)} />,
  );
  const heading = screen.getByRole("heading", { name: "Local Node", exact: true });
  await expect.element(heading).toBeVisible();
  await expect
    .element(screen.getByText(/partial|estimated token budgets/i))
    .not.toBeInTheDocument();

  const native = screen.getByRole("heading", { name: "Codex", exact: true }).element();
  const nativeCard = native.nextElementSibling!;
  const section = heading.element().closest("section")!;
  const cards = Array.from(section.children).slice(1);
  expect(cards.map((card) => card.firstElementChild?.firstElementChild?.textContent)).toEqual([
    "Slots · 4/5",
    "Daily",
    "Weekly",
  ]);
  for (const card of cards) {
    expect(card.className).toBe(nativeCard.className);
    expect(card.getBoundingClientRect().height).toBe(nativeCard.getBoundingClientRect().height);
    expect(card.querySelector("button")?.getBoundingClientRect().height).toBe(
      nativeCard.querySelector("button")?.getBoundingClientRect().height,
    );
  }

  const dailyBar = screen.getByRole("button", { name: /^Local Node: 92% left.*window left/ });
  await expect.element(dailyBar).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: /^Local Node: 97% left.*window left/ }))
    .toBeVisible();
});
