import { describe, expect, it } from "vite-plus/test";
import { releaseVersion } from "./release-version.ts";

describe("fork release version", () => {
  const upstreamTag = "v0.1.12-nightly.20261121.5038";

  it.each([
    [upstreamTag, "20261122", "1", undefined, "0.1.12-nightly.20261122.1"],
    [upstreamTag, "20261121", "1", undefined, "0.1.12-nightly.20261121.5039"],
    [upstreamTag, "20261121", "2", "v0.1.12-nightly.20261121.5039", "0.1.12-nightly.20261121.5040"],
    [upstreamTag, "20261122", "3", "v0.1.12-nightly.20261121.5040", "0.1.12-nightly.20261122.5041"],
    ["v0.1.11-nightly.20261118.4864", "20261118", "1", undefined, "0.1.11-nightly.20261118.4865"],
  ])("versions %s on %s with run %s and previous %s", (tag, date, run, previous, expected) => {
    expect(releaseVersion(tag, date, run, previous)).toBe(expected);
  });

  it("refuses a downgrade to an older upstream base", () => {
    expect(() =>
      releaseVersion(upstreamTag, "20261122", "5", "v0.1.13-nightly.20261121.2"),
    ).toThrow("older than fork release");
  });

  it("refuses a date before the base nightly", () => {
    expect(() => releaseVersion(upstreamTag, "20261120", "1")).toThrow("Release date precedes");
  });
});
