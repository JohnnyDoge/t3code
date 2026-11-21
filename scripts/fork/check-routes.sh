#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
# shellcheck source=scripts/fork/upstream-base.sh
source scripts/fork/upstream-base.sh

generate_routes() {
  node --input-type=module - "${1:-}" <<'JS'
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const webRoot = NodePath.resolve("apps/web");
const requireFromWeb = NodeModule.createRequire(NodePath.resolve(webRoot, "package.json"));
const requireFromPlugin = NodeModule.createRequire(
  requireFromWeb.resolve("@tanstack/router-plugin"),
);
const { Generator, getConfig } = await import(
  NodeURL.pathToFileURL(requireFromPlugin.resolve("@tanstack/router-generator")).href
);

const config = getConfig({}, webRoot);
const scratchRoot = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-fork-routes-"));
try {
  // The generator can rewrite route sources. Run it on copies at the same relative paths.
  const routesDirectory = NodePath.join(
    scratchRoot,
    NodePath.relative(webRoot, config.routesDirectory),
  );
  const generatedRouteTree = NodePath.join(
    scratchRoot,
    NodePath.relative(webRoot, config.generatedRouteTree),
  );
  await NodeFSP.cp(config.routesDirectory, routesDirectory, { recursive: true });
  await new Generator({
    config: {
      ...config,
      routesDirectory,
      generatedRouteTree,
      tmpDir: NodePath.join(scratchRoot, "tmp"),
    },
    root: scratchRoot,
  }).run();
  await NodeFSP.copyFile(generatedRouteTree, process.argv[2] || config.generatedRouteTree);
} finally {
  await NodeFSP.rm(scratchRoot, { recursive: true, force: true });
}
JS
}

case ${1:-} in
  --upstream)
    base=${2:?Specify the upstream commit to check.}
    if git ls-tree -r --name-only "$base" -- apps/web/src/routes | grep -E '(^|/)_chat\.board\.tsx$'; then
      collision=true
    else
      result=$(git grep -nE "['\"]/board/?['\"]" "$base" -- "$route_tree" apps/web/src/routes) || [[ $? == 1 ]]
      collision=false
      if [[ -n $result ]]; then
        printf '%s\n' "$result" >&2
        collision=true
      fi
    fi
    if "$collision"; then
      echo 'Upstream owns a /board route. Stop and ask the owner how to reconcile the fork route and its entry points.' >&2
      exit 1
    fi
    ;;
  --generate)
    generate_routes
    ;;
  "")
    read_upstream_base
    bash scripts/fork/check-routes.sh --upstream "$base_sha"
    temp_dir=$(mktemp -d)
    trap 'rm -rf "$temp_dir"' EXIT
    generate_routes "$temp_dir/routeTree.gen.ts"
    if ! cmp -s "$route_tree" "$temp_dir/routeTree.gen.ts"; then
      diff -u "$route_tree" "$temp_dir/routeTree.gen.ts" || true
      echo 'Regenerate the route tree with bash scripts/fork/check-routes.sh --generate and commit the result.' >&2
      exit 1
    fi
    ;;
  *) exit 2 ;;
esac
