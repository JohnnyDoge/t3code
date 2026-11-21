import { scopedProjectKey } from "@t3tools/client-runtime/environment";
import {
  pickableProjectGroups,
  type ProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import type { OlderSettledScope } from "@t3tools/client-runtime/state/threads";
import type { EnvironmentId } from "@t3tools/contracts";

import {
  resolveSidebarProjectScopeKeys,
  type SidebarProjectSnapshot,
} from "../../sidebarProjectGrouping";

export function resolveBoardProjectScope(input: {
  readonly groups: ReadonlyArray<SidebarProjectSnapshot>;
  readonly keys: ReadonlyArray<string>;
  readonly settings: ProjectGroupingSettings;
  readonly environmentIds: ReadonlyArray<EnvironmentId>;
}) {
  const { environmentIds } = input;
  const selected = new Set(resolveSidebarProjectScopeKeys(input));
  const groups = pickableProjectGroups(input.groups).filter((group) =>
    selected.has(group.projectKey),
  );
  if (groups.length === 0) {
    return {
      groups,
      projectKeys: null,
      olderSettledScopes: environmentIds.map((environmentId) => ({
        environmentId,
        projectIds: null,
      })),
    };
  }

  const projectRefs = groups.flatMap((group) => group.memberProjectRefs);
  const olderSettledScopes = environmentIds.flatMap((environmentId): OlderSettledScope[] => {
    const projectIds = projectRefs.flatMap((ref) =>
      ref.environmentId === environmentId ? [ref.projectId] : [],
    );
    return projectIds.length === 0 ? [] : [{ environmentId, projectIds }];
  });
  return {
    groups,
    projectKeys: new Set(projectRefs.map(scopedProjectKey)),
    olderSettledScopes,
  };
}
