// fork(board): Verify calendar boundaries, usage accounting and profile availability.
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";
import {
  localNodeOrigin,
  localNodeOverviewUrl,
  localNodeQuotaAccount,
  localNodeWindows,
} from "./localNodeQuota.ts";

describe("Local Node estimated limits", () => {
  const friday = DateTime.makeUnsafe("2026-11-26T19:00:00Z");
  const zone = DateTime.zoneMakeNamedUnsafe("Asia/Yekaterinburg");
  const now = DateTime.add(friday, { hours: 12 });

  it("uses midnight each day and Friday midnight each week in the server's local time", () => {
    const before = localNodeWindows(DateTime.subtract(friday, { milliseconds: 1 }), zone);
    expect(DateTime.toUtc(before.daily.reset)).toEqual(friday);
    expect(DateTime.toUtc(before.weekly.reset)).toEqual(friday);
    const after = localNodeWindows(friday, zone);
    expect(DateTime.toUtc(after.daily.start)).toEqual(friday);
    expect(DateTime.toUtc(after.weekly.start)).toEqual(friday);
    expect(DateTime.toUtc(after.weekly.reset)).toEqual(DateTime.add(friday, { days: 7 }));
  });

  it("counts free slots and uses 500M daily and 3.5B weekly without adding cache or reasoning", () => {
    const totals = {
      inputTokens: 200_000_000,
      outputTokens: 50_000_000,
      cachedInputTokens: 150_000_000,
      reasoningTokens: 35_000_000,
      unknownUsageRequests: 0,
    };
    const account = localNodeQuotaAccount({
      now,
      profiles: {
        profiles: [
          { status: "running", activeRequests: 0 },
          { status: "running", activeRequests: 1 },
          { status: "paused", activeRequests: 0 },
          { status: "deleting", activeRequests: 0 },
        ],
      },
      daily: { totals },
      weekly: { totals: { ...totals, inputTokens: 1_700_000_000 } },
    });
    expect(account?.windows.map(({ label, usedPercent }) => [label, usedPercent])).toEqual([
      ["Slots · 1/3", 200 / 3],
      ["Daily", 50],
      ["Weekly", 50],
    ]);
  });

  it("labels partial usage, omits entirely unavailable data and caps the display", () => {
    const account = localNodeQuotaAccount({
      now,
      profiles: undefined,
      daily: { totals: { inputTokens: null, outputTokens: null } },
      weekly: {
        totals: { inputTokens: 4_000_000_000, outputTokens: null, unknownUsageRequests: 2 },
      },
    });
    expect(account?.windows).toMatchObject([{ label: "Weekly · partial", usedPercent: 100 }]);
  });

  it("constructs only loopback dashboard URLs without credentials", () => {
    expect(localNodeOrigin("http://10.0.0.1:8787/")).toBeNull();
    expect(localNodeOrigin("http://name:key@127.0.0.1:8787/")).toBeNull();
    const origin = localNodeOrigin("http://127.0.0.1:8787/v1")!;
    expect(localNodeOverviewUrl(origin, friday, now).searchParams.get("from")).toBe(
      DateTime.formatIso(friday),
    );
  });
});
