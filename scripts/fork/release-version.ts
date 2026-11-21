const nightlyTagPattern =
  /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))-nightly\.([1-9]\d{7})\.(0|[1-9]\d*)$/;

function parseNightlyTag(tag: string) {
  const match = nightlyTagPattern.exec(tag);
  if (!match) throw new Error(`Invalid nightly tag: ${tag}`);
  const [, base = "", date = "", sequence = ""] = match;
  return { base, date, sequence: BigInt(sequence) };
}

function isOlderBase(base: string, previousBase: string) {
  const previousParts = previousBase.split(".").map(BigInt);
  for (const [index, part] of base.split(".").map(BigInt).entries()) {
    const previous = previousParts[index]!;
    if (part !== previous) return part < previous;
  }
  return false;
}

export function releaseVersion(
  upstreamTag: string,
  date: string,
  runNumber: string,
  previousForkTag?: string,
): string {
  if (!/^[1-9]\d{7}$/.test(date) || !/^[1-9]\d*$/.test(runNumber)) {
    throw new Error("Expected a UTC date as YYYYMMDD and a positive workflow run number.");
  }

  const upstream = parseNightlyTag(upstreamTag);
  const previous = previousForkTag ? parseNightlyTag(previousForkTag) : undefined;
  if (previous && isOlderBase(upstream.base, previous.base)) {
    throw new Error(
      `Upstream base ${upstream.base} is older than fork release ${previousForkTag}.`,
    );
  }
  if (date < upstream.date || (previous && date < previous.date)) {
    throw new Error("Release date precedes the upstream nightly or the last fork release.");
  }

  let sequence = BigInt(runNumber);
  if (upstream.date === date && sequence <= upstream.sequence) {
    sequence = upstream.sequence + 1n;
  }
  if (previous && sequence <= previous.sequence) {
    sequence = previous.sequence + 1n;
  }
  return `${upstream.base}-nightly.${date}.${sequence}`;
}

if (import.meta.main) {
  const [upstreamTag, date, runNumber, previousForkTag] = process.argv.slice(2);
  if (!upstreamTag || !date || !runNumber) {
    throw new Error(
      "Usage: release-version.ts <upstream-tag> <utc-date> <run-number> [previous-fork-tag]",
    );
  }
  process.stdout.write(`${releaseVersion(upstreamTag, date, runNumber, previousForkTag)}\n`);
}
