import { RunId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture } from "../../test-fixtures";
import { buildBoardMarkMenuItems, planBoardMark } from "./boardMenu";
import { seenTag } from "./boardModel";

const runId = RunId.make("current");
const previousRunId = RunId.make("previous");
const completedAt = "2026-01-03T00:00:00.000Z";
const now = "2026-01-04T00:00:00.000Z";
const tag = seenTag(runId);

const thread = makeThreadFixture({
  runtime: null,
  latestRun: {
    runId,
    status: "completed",
    requestedAt: completedAt,
    startedAt: completedAt,
    completedAt,
    assistantMessageId: null,
  },
});

describe("buildBoardMarkMenuItems", () => {
  it.each([
    { seen: false, unseen: false, ids: [] },
    { seen: true, unseen: false, ids: ["fork-mark-seen"] },
    { seen: false, unseen: true, ids: ["fork-mark-unseen"] },
    { seen: true, unseen: true, ids: ["fork-mark-seen", "fork-mark-unseen"] },
  ])(
    "offers actions matching eligibility (seen: $seen, unseen: $unseen)",
    ({ seen, unseen, ids }) => {
      expect(buildBoardMarkMenuItems(seen, unseen).map((item) => item.id)).toEqual(ids);
    },
  );
});

describe("planBoardMark", () => {
  it.each([
    { mark: "seen", tags: [], displayedRunId: runId, tagged: true },
    { mark: "unseen", tags: [tag], displayedRunId: runId, tagged: false },
    { mark: "seen", tags: [], displayedRunId: previousRunId, tagged: null },
    { mark: "unseen", tags: [tag], displayedRunId: previousRunId, tagged: null },
    { mark: "seen", tags: [tag], displayedRunId: runId, tagged: null },
    { mark: "unseen", tags: [], displayedRunId: runId, tagged: null },
  ] as const)(
    "revalidates $mark for the displayed run with current tags $tags",
    ({ mark, tags, displayedRunId, tagged }) => {
      expect(planBoardMark(thread, tags, displayedRunId, mark, now)).toEqual(
        tagged === null ? [] : [{ kind: "tag", tag, tagged }],
      );
    },
  );
});
