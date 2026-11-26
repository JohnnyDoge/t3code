// fork(board): Model the optional simulated budgets shown in the Local Node Limits panel.
import { type HttpQuotaAccount, IsoDateTime } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const dailyTokens = 500_000_000;
const weeklyTokens = dailyTokens * 7;

const totalsSchema = Schema.Struct({
  totals: Schema.Struct({
    inputTokens: Schema.NullOr(Schema.Number),
    outputTokens: Schema.NullOr(Schema.Number),
    unknownUsageRequests: Schema.optional(Schema.Number),
  }),
});

const profilesSchema = Schema.Struct({
  profiles: Schema.Array(
    Schema.Struct({
      status: Schema.String,
      activeRequests: Schema.Number,
    }),
  ),
});

const decodeTotals = Schema.decodeUnknownOption(totalsSchema);
const decodeProfiles = Schema.decodeUnknownOption(profilesSchema);
const asIso = Schema.decodeUnknownSync(IsoDateTime);
type Account = typeof HttpQuotaAccount.Type;
type Window = Account["windows"][number];

export function localNodeOrigin(value: string): URL | null {
  const url = URL.parse(value);
  if (
    !url ||
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["/", "/v1", "/v1/"].includes(url.pathname)
  )
    return null;
  return new URL(url.origin);
}

export function localNodeWindows(now: DateTime.DateTime, zone = DateTime.zoneMakeLocal()) {
  const dailyStart = DateTime.startOf(DateTime.setZone(now, zone), "day");
  const daysSinceFriday = (DateTime.toParts(dailyStart).weekDay + 2) % 7;
  const weeklyStart = DateTime.subtract(dailyStart, { days: daysSinceFriday });
  return {
    daily: { start: dailyStart, reset: DateTime.add(dailyStart, { days: 1 }) },
    weekly: { start: weeklyStart, reset: DateTime.add(weeklyStart, { days: 7 }) },
  };
}

export function localNodeOverviewUrl(
  origin: URL,
  start: DateTime.DateTime,
  now: DateTime.DateTime,
): URL {
  const url = new URL("/api/overview", origin);
  url.searchParams.set("period", "custom");
  url.searchParams.set("from", DateTime.formatIso(start));
  url.searchParams.set("to", DateTime.formatIso(now));
  return url;
}

function tokenWindow(
  id: "daily" | "weekly",
  label: string,
  data: unknown,
  limit: number,
  reset: DateTime.DateTime,
): Window | undefined {
  const decoded = Option.getOrUndefined(decodeTotals(data));
  if (!decoded) return undefined;
  const { inputTokens, outputTokens, unknownUsageRequests } = decoded.totals;
  const parts = [inputTokens, outputTokens];
  if (
    parts.every((count) => count === null) ||
    parts.some((count) => count !== null && (!Number.isSafeInteger(count) || count < 0))
  ) {
    return undefined;
  }
  const partial = parts.some((count) => count === null) || (unknownUsageRequests ?? 0) > 0;
  // Cached input is already part of input, and reasoning is already part of output.
  const used = (inputTokens ?? 0) + (outputTokens ?? 0);
  return {
    id,
    kind: id === "daily" ? "session" : "weekly",
    label: partial ? `${label} · partial` : label,
    usedPercent: Math.min(100, (100 * used) / limit),
    resetsAt: asIso(DateTime.formatIso(reset)),
  };
}

export function localNodeQuotaAccount(input: {
  readonly profiles: unknown;
  readonly daily: unknown;
  readonly weekly: unknown;
  readonly now: DateTime.DateTime;
}): Account | undefined {
  const windows: Window[] = [];
  const profiles = Option.getOrUndefined(decodeProfiles(input.profiles));
  if (profiles) {
    const slots = profiles.profiles.filter((profile) => profile.status !== "deleting");
    const free = slots.filter(
      (profile) => profile.status === "running" && profile.activeRequests === 0,
    ).length;
    windows.push({
      id: "slots",
      kind: "other",
      label: `Slots · ${free}/${slots.length}`,
      usedPercent: slots.length > 0 ? (100 * (slots.length - free)) / slots.length : 100,
    });
  }
  const { daily, weekly } = localNodeWindows(input.now);
  const day = tokenWindow("daily", "Daily", input.daily, dailyTokens, daily.reset);
  const week = tokenWindow("weekly", "Weekly", input.weekly, weeklyTokens, weekly.reset);
  if (day) windows.push(day);
  if (week) windows.push(week);
  return windows.length > 0
    ? { id: "local-node", label: "Estimated token budgets · 500M daily · 3.5B weekly", windows }
    : undefined;
}
