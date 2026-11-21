import {
  derivePhysicalProjectKey,
  type ProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { filterSidebarV2VisibleThreads } from "../../components/Sidebar.logic";
import { buildSidebarProjectSnapshots } from "../../sidebarProjectGrouping";
import { makeThreadFixture } from "../../test-fixtures";
import type { Project } from "../../types";
import { resolveBoardProjectScope } from "./boardProjectScope";

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
const other = EnvironmentId.make("other");
const projectId = ProjectId.make("project");
const scratchId = ProjectId.make("scratch");
const archivedId = ProjectId.make("archived");
const settings: ProjectGroupingSettings = {
  sidebarProjectGroupingMode: "separate",
  sidebarProjectGroupingOverrides: {},
};

function project(environmentId: EnvironmentId, id: ProjectId, overrides?: Partial<Project>) {
  return {
    id,
    environmentId,
    title: id,
    workspaceRoot: "/projects/" + id,
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } satisfies Project;
}

const projects = [
  project(local, projectId),
  project(remote, projectId),
  project(local, scratchId, { isScratch: true }),
  project(remote, scratchId, { isScratch: true }),
  project(local, archivedId, { archivedAt: "2026-01-01T00:00:00.000Z" }),
];
const groups = buildSidebarProjectSnapshots({
  projects,
  settings,
  groupScratchProjects: true,
  primaryEnvironmentId: local,
  resolveEnvironmentLabel: () => null,
});

it("expands a grouped scratch scope and a second selection into environment-specific filters", () => {
  const scratch = groups.find((group) => group.isScratch)!;
  const localProject = groups.find(
    (group) => group.id === projectId && group.environmentId === local,
  )!;
  const scope = resolveBoardProjectScope({
    groups,
    keys: [scratch.projectKey, localProject.projectKey],
    settings,
    environmentIds: [local, remote, other],
  });

  expect(scope.groups).toEqual(expect.arrayContaining([scratch, localProject]));
  expect(scope.olderSettledScopes).toEqual([
    { environmentId: local, projectIds: expect.arrayContaining([projectId, scratchId]) },
    { environmentId: remote, projectIds: [scratchId] },
  ]);

  const threads = [
    makeThreadFixture({ environmentId: local, projectId }),
    makeThreadFixture({ environmentId: remote, projectId }),
    makeThreadFixture({ environmentId: remote, projectId: scratchId }),
  ];
  expect(filterSidebarV2VisibleThreads(threads, scope.projectKeys, new Set())).toEqual([
    threads[0],
    threads[2],
  ]);
});

it("uses all projects when the persisted choices are missing or archived", () => {
  const archived = groups.find((group) => group.archived)!;
  expect(
    resolveBoardProjectScope({
      groups,
      keys: ["missing", archived.projectKey],
      settings,
      environmentIds: [local, remote],
    }),
  ).toEqual({
    groups: [],
    projectKeys: null,
    olderSettledScopes: [
      { environmentId: local, projectIds: null },
      { environmentId: remote, projectIds: null },
    ],
  });
});

it("resolves a saved physical scratch selection to the current sidebar group", () => {
  const scratch = groups.find((group) => group.isScratch)!;
  const scope = resolveBoardProjectScope({
    groups,
    keys: [derivePhysicalProjectKey(project(remote, scratchId))],
    settings,
    environmentIds: [remote],
  });

  expect(scope.groups).toEqual([scratch]);
  expect(scope.olderSettledScopes).toEqual([{ environmentId: remote, projectIds: [scratchId] }]);
});
